// EMG model: derives muscle activation from posture-holding torque (pendulum model)
// plus dynamic (movement) components, then synthesizes a raw surface-EMG-like
// interference pattern: band-limited (20–450 Hz) zero-mean seeded Gaussian noise
// multiplied by the activation envelope, for each muscle group.
// This is a phenomenological approximation, not a motor-unit recruitment simulation.
//
// Amplitude scaling (model assumptions): full activation → 0.45 mV rms (≈ ±1.35 mV peaks, i.e.
// 0–1.5 mV raw sEMG at MVC-like effort); electronic noise floor 5 µV rms. The signal is zero-mean
// — plot symmetric about 0 (an envelope/RMS view needs rectification + smoothing downstream).

import { SEGMENT_INERTIA } from './kinematics.js';

const G = 9.81;

export const MUSCLES = {
  biceps_brachii: { label: '위팔두갈래근(이두)', joint: 'elbowFlex', role: 'flexor' },
  triceps_brachii: { label: '위팔세갈래근(삼두)', joint: 'elbowFlex', role: 'extensor' },
  deltoid: { label: '어깨세모근(삼각근)', joint: 'shoulderAbd', role: 'flexor' },
  flexor_carpi_radialis: { label: '노쪽손목굽힘근', joint: 'wristFlex', role: 'flexor' },
  extensor_carpi_radialis: { label: '노쪽손목폄근', joint: 'wristFlex', role: 'extensor' },
  pronator_teres: { label: '원엎침근', joint: 'wristPron', role: 'flexor' },
};
const MUSCLE_INDEX = Object.fromEntries(Object.keys(MUSCLES).map((m, i) => [m, i]));

// Internal noise generator rate and band (Hz); FIR = windowed-sinc band-pass 20–450 Hz (Hamming, 63 taps)
const EMG_FS = 2000;
const EMG_BAND = [20, 450];
const FIR_HALF = 31;
const BLOCK = 1000; // samples per cached block (0.5 s)
const KEEP_BLOCKS = 24; // history kept per muscle (12 s) — older blocks are evicted
const FULL_RMS_mV = 0.45;
const FLOOR_RMS_mV = 0.005;

function makeBandpass(fs, fLo, fHi, half) {
  const n = 2 * half + 1;
  const h = new Float64Array(n);
  const sinc = (x) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const k = i - half;
    const lp = (fc) => (2 * fc / fs) * sinc(2 * fc * k / fs);
    const w = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1)); // Hamming
    h[i] = (lp(fHi) - lp(fLo)) * w;
    sumSq += h[i] * h[i];
  }
  // unit-rms output for unit-variance white input
  const s = 1 / Math.sqrt(sumSq);
  for (let i = 0; i < n; i++) h[i] *= s;
  return h;
}
const BANDPASS = makeBandpass(EMG_FS, EMG_BAND[0], EMG_BAND[1], FIR_HALF);

// Small seeded PRNG (mulberry32) + Box–Muller; seeded by (muscle index, block index) so every block
// is reproducible and independent of evaluation order.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function whiteBlock(muscleIdx, blockIdx, out) {
  const rnd = mulberry32(((muscleIdx + 1) * 7919 + blockIdx * 104729 + 12345) >>> 0);
  for (let i = 0; i < out.length; i += 2) {
    const u1 = Math.max(1e-12, rnd()), u2 = rnd();
    const r = Math.sqrt(-2 * Math.log(u1));
    out[i] = r * Math.cos(2 * Math.PI * u2);
    if (i + 1 < out.length) out[i + 1] = r * Math.sin(2 * Math.PI * u2);
  }
  return out;
}

export class EmgModel {
  constructor() {
    this._activation = {};
    for (const name of Object.keys(MUSCLES)) this._activation[name] = 0.05;
    this._blocks = new Map(); // `${muscleIdx}:${blockIdx}` -> Float32Array(BLOCK) band-limited unit-rms noise
    this._scratchPrev = new Float64Array(BLOCK);
    this._scratchCur = new Float64Array(BLOCK);
  }

  // Recompute per-muscle activation level [0..1] from current joint angles/velocities
  // and body posture. Called once per animation frame (not per sample).
  updateActivation(angles_deg, angularVel_degPerS, bodyPosture) {
    const shoulderRad = (angles_deg.shoulderAbd * Math.PI) / 180;
    const elbowRad = (angles_deg.elbowFlex * Math.PI) / 180;

    // Static holding torque via simplified two-link pendulum (arm away from body = higher torque).
    const upperArmTorque = SEGMENT_INERTIA.upperArm.mass * G * SEGMENT_INERTIA.upperArm.length * Math.sin(shoulderRad) * 0.5;
    const forearmTorque = SEGMENT_INERTIA.forearmHand.mass * G * SEGMENT_INERTIA.forearmHand.length * Math.sin(elbowRad) * 0.5;

    const maxTorque = 12; // Nm, normalization constant (model assumption)
    const deltoidStatic = Math.min(1, Math.abs(upperArmTorque) / maxTorque);
    const bicepsStatic = Math.min(1, Math.abs(forearmTorque) / maxTorque);

    // Dynamic component: proportional to |angular velocity| of the joint each muscle spans.
    const dyn = (jointKey) => Math.min(1, Math.abs(angularVel_degPerS[jointKey] || 0) / 25);

    const seatedRelief = bodyPosture === 'sitting' ? 0.85 : 1.0; // slightly less postural load seated

    this._activation.deltoid = 0.03 + deltoidStatic * 0.7 * seatedRelief + dyn('shoulderAbd') * 0.4;
    this._activation.biceps_brachii = 0.03 + bicepsStatic * 0.55 * seatedRelief + dyn('elbowFlex') * 0.5;
    this._activation.triceps_brachii = 0.02 + dyn('elbowFlex') * 0.35;
    this._activation.flexor_carpi_radialis = 0.03 + dyn('wristFlex') * 0.5 + Math.abs(angles_deg.wristFlex) / 90 * 0.15;
    this._activation.extensor_carpi_radialis = 0.03 + dyn('wristFlex') * 0.3;
    this._activation.pronator_teres = 0.03 + dyn('wristPron') * 0.55 + Math.abs(angles_deg.wristPron) / 90 * 0.15;

    for (const k of Object.keys(this._activation)) {
      this._activation[k] = Math.max(0, Math.min(1, this._activation[k]));
    }
  }

  getActivation(muscleName) {
    return this._activation[muscleName] ?? 0;
  }

  getAllActivation() {
    return { ...this._activation };
  }

  // Band-limited unit-rms noise block (cached). The FIR needs the tail of the previous block's white
  // sequence, which is regenerated from its seed (no cross-call state → deterministic).
  _block(muscleIdx, blockIdx) {
    const key = `${muscleIdx}:${blockIdx}`;
    let b = this._blocks.get(key);
    if (b) return b;
    const prev = blockIdx > 0 ? whiteBlock(muscleIdx, blockIdx - 1, this._scratchPrev) : this._scratchPrev.fill(0);
    const cur = whiteBlock(muscleIdx, blockIdx, this._scratchCur);
    const wAt = (i) => (i >= 0 ? cur[i] : prev[BLOCK + i]);
    const h = BANDPASS, n = h.length;
    b = new Float32Array(BLOCK);
    for (let i = 0; i < BLOCK; i++) {
      let acc = 0;
      for (let k = 0; k < n; k++) acc += h[k] * wAt(i - k); // causal FIR (group delay 15.5 ms, irrelevant here)
      b[i] = acc;
    }
    // evict old blocks (monotone time access in the engine)
    if (this._blocks.size > KEEP_BLOCKS * Object.keys(MUSCLES).length) {
      for (const k of this._blocks.keys()) {
        const bi = +k.split(':')[1];
        if (bi < blockIdx - KEEP_BLOCKS) this._blocks.delete(k);
      }
    }
    this._blocks.set(key, b);
    return b;
  }

  // Unit-rms band-limited noise for a muscle at time t (linear interpolation between 2 kHz samples).
  _noise(muscleIdx, t) {
    const x = Math.max(0, t) * EMG_FS;
    const i0 = Math.floor(x), frac = x - i0;
    const b0 = (i0 / BLOCK) | 0, b1 = ((i0 + 1) / BLOCK) | 0;
    const v0 = this._block(muscleIdx, b0)[i0 - b0 * BLOCK];
    const v1 = this._block(muscleIdx, b1)[i0 + 1 - b1 * BLOCK];
    return v0 + (v1 - v0) * frac;
  }

  // Instantaneous synthetic raw EMG (mV, zero-mean) at time t: activation envelope × band-limited
  // Gaussian interference pattern (seeded by muscle INDEX, so no two muscles share a waveform).
  sample(muscleName, t) {
    const idx = MUSCLE_INDEX[muscleName];
    if (idx === undefined) return 0;
    const a = this.getActivation(muscleName);
    const rms = Math.sqrt((a * FULL_RMS_mV) ** 2 + FLOOR_RMS_mV ** 2);
    return rms * this._noise(idx, t);
  }

  // Aggregate "forearm motion artifact" scalar (0..1) used by the capacitive array
  // model to modulate non-arterial ΔC contribution.
  motionArtifactLevel() {
    const wristMuscles = ['flexor_carpi_radialis', 'extensor_carpi_radialis', 'pronator_teres'];
    return wristMuscles.reduce((s, m) => s + this._activation[m], 0) / wristMuscles.length;
  }
}
