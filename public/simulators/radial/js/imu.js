// Wrist-mounted IMU model: 3-axis accelerometer (g) and 3-axis gyroscope (deg/s).
// The sensor frame is reached through the chain  world → torso (sway tilt) → shoulder
// → elbow → forearm pronation, so the reading is the VECTOR COMBINATION of:
//   • gravity, rotated by torso tilt and arm joint angles (specific force, +1 g "up" at rest)
//   • torso linear acceleration (postural sway + breathing), rotated into the sensor frame
//   • torso angular velocity (tilt oscillation), rotated into the sensor frame
//   • arm-joint rigid-body terms: centripetal ω²·r (toward the joint) and tangential α·r
//     (perpendicular, α from frame-to-frame differencing of the joint rate) for elbow and shoulder
//   • a small cardiac ballistic component and seeded Gaussian sensor noise
//
// Approximations (model assumptions): the two-link chain is rigid (upper arm 0.30 m, elbow→sensor
// 0.26 m), the sensor sits on the forearm axis (pronation adds no linear acceleration), torso
// sway is treated as pure translation + small tilt at the shoulder, the joint angular acceleration
// is a finite difference of the (already finite-differenced) joint rates supplied per frame.
// Noise: accelerometer 4 mg rms, gyroscope 0.15 dps rms, white, seeded per axis (consumer MEMS-class
// in-band noise — model assumption, ~100–200 µg/√Hz × √(≈500 Hz)).

import { ARM_GEOMETRY } from './kinematics.js';

function deg2rad(d) { return (d * Math.PI) / 180; }

function rotX(v, a) { const c = Math.cos(a), s = Math.sin(a); return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c]; }
function rotY(v, a) { const c = Math.cos(a), s = Math.sin(a); return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]; }
function rotZ(v, a) { const c = Math.cos(a), s = Math.sin(a); return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

// Deterministic integer hash → uniform [0,1) (lowbias32-style mixing), stable across frames/runs.
function hashU(n, k) {
  let x = (Math.imul(n | 0, 0x9E3779B1) ^ Math.imul((k | 0) + 0x632BE5AB, 0x85EBCA77)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7FEB352D) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x846CA68B) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 4294967296;
}
// Pair of standard-normal deviates (Box–Muller) for sample index n and stream k.
function gaussPair(n, k, out) {
  const u1 = Math.max(1e-12, hashU(n, 2 * k)), u2 = hashU(n, 2 * k + 1);
  const r = Math.sqrt(-2 * Math.log(u1)), a = 2 * Math.PI * u2;
  out[0] = r * Math.cos(a); out[1] = r * Math.sin(a);
}

const NOISE_TICK_HZ = 16000; // noise sample index grid (engine sample rate); white up to the Nyquist of the consumer
const MAX_ALPHA_RAD = deg2rad(4000); // clamp on differenced joint angular acceleration (rad/s²)

export class ImuModel {
  constructor() {
    this.noiseAccel = 0.004; // g rms (white, seeded Gaussian)
    this.noiseGyro = 0.15; // dps rms (white, seeded Gaussian)
    this.seed = 1; // noise seed (change for a different realisation)
    this._prevRate = null; // { t, elbow, shoulder } (rad/s) for α estimation
    this._alpha = { elbow: 0, shoulder: 0 }; // rad/s², held between rate updates
    this._frame = { angles: null, angVel: null, torso: null, g: null, torsoAcc: null, torsoW: null, joint: null }; // per-frame cache
    this._gp = [0, 0];
  }

  // Transform a world-frame vector into the wrist sensor frame.
  // Simplified chain: torso pitch (X) & roll (Z) → shoulder flexion (Z in this approximation)
  // → elbow flexion (X) → forearm pronation (Y).
  _worldToSensor(v, angles, torso) {
    let r = v;
    if (torso) {
      // Structural orientation (e.g. -90° supine) plus micro-motion tilt.
      r = rotX(r, -deg2rad((torso.basePitch_deg || 0) + torso.tiltPitch_deg));
      r = rotZ(r, -deg2rad(torso.tiltRoll_deg));
    }
    r = rotZ(r, deg2rad(angles.shoulderAbd));
    r = rotX(r, deg2rad(angles.elbowFlex));
    r = rotY(r, deg2rad(angles.wristPron));
    return r;
  }

  // Joint angular acceleration from the rates the engine supplies once per frame (they are constant
  // for all samples within a frame, so α is recomputed only when a rate changes and held otherwise).
  _updateAlpha(t, wElbow, wShoulder) {
    const p = this._prevRate;
    if (!p) { this._prevRate = { t, elbow: wElbow, shoulder: wShoulder }; return; }
    if (wElbow === p.elbow && wShoulder === p.shoulder) return;
    const dt = t - p.t;
    if (dt > 1e-6) {
      const cl = (x) => Math.max(-MAX_ALPHA_RAD, Math.min(MAX_ALPHA_RAD, x));
      this._alpha.elbow = cl((wElbow - p.elbow) / dt);
      this._alpha.shoulder = cl((wShoulder - p.shoulder) / dt);
    }
    this._prevRate = { t, elbow: wElbow, shoulder: wShoulder };
  }

  // Rigid-body linear acceleration of the sensor due to the elbow and shoulder rotations, expressed
  // in the forearm frame (before pronation): +Y = along the forearm toward the elbow (up when hanging),
  // elbow axis = X, shoulder axis = rotX(θe)·Z. Returns m/s².
  _jointAccel(angles, wElbow, wShoulder) {
    const Lu = ARM_GEOMETRY.upperArm_m, Lf = ARM_GEOMETRY.forearmToWrist_m;
    const te = deg2rad(angles.elbowFlex);
    // Elbow: sensor at r = (0, −Lf, 0) from the elbow, axis X
    const rE = [0, -Lf, 0], axE = [1, 0, 0];
    const centE = cross(axE, cross(axE, rE)).map((v) => v * wElbow * wElbow); // −ω²·r⊥ (toward joint)
    const tanE = cross(axE, rE).map((v) => v * this._alpha.elbow); // α × r
    // Shoulder: sensor at r = −(shoulder − sensor); shoulder relative to elbow = rotX(θe)·(0, Lu, 0)
    const sh = rotX([0, Lu, 0], te);
    const rS = [-sh[0], -(sh[1] + Lf), -sh[2]];
    const axS = rotX([0, 0, 1], te);
    const centS = cross(axS, cross(axS, rS)).map((v) => v * wShoulder * wShoulder);
    const tanS = cross(axS, rS).map((v) => v * this._alpha.shoulder);
    return [0, 1, 2].map((i) => centE[i] + tanE[i] + centS[i] + tanS[i]);
  }

  // Frame-constant terms (gravity, torso, joint rigid-body) — the engine passes the same angles /
  // rate / torso objects for every sample of a frame, so they are recomputed only when one of the
  // objects changes (by identity; pass fresh objects when the values change).
  _frameTerms(t, angles, angularVel_degPerS, torso) {
    const F = this._frame;
    if (F.angles === angles && F.angVel === angularVel_degPerS && F.torso === torso && F.g) return F;
    // 1) Specific force: an accelerometer at rest reads +1 g along 'up' (f = a − g_vec with g_vec = (0,−1,0) g),
    //    so the gravity term is (0,+1,0) rotated into the sensor frame (audit B-9, sign fixed).
    F.g = this._worldToSensor([0, 1, 0], angles, torso);
    // 2) Torso linear acceleration (m/s² → g), same rotation chain.
    F.torsoAcc = torso ? this._worldToSensor([torso.acc[0] / 9.81, torso.acc[1] / 9.81, torso.acc[2] / 9.81], angles, torso) : [0, 0, 0];
    // 3) Arm-joint rigid-body terms (centripetal ω²r + tangential αr), forearm frame → pronation → sensor, in g.
    const wElbow = deg2rad(angularVel_degPerS.elbowFlex || 0);
    const wShoulder = deg2rad(angularVel_degPerS.shoulderAbd || 0);
    this._updateAlpha(t, wElbow, wShoulder);
    const jointF = this._jointAccel(angles, wElbow, wShoulder);
    F.joint = rotY(jointF, deg2rad(angles.wristPron)).map((v) => v / 9.81);
    // Torso angular velocity (world X/Y/Z, deg/s) rotated into the sensor frame.
    F.torsoW = torso ? this._worldToSensor(torso.angVel_degPerS, angles, torso) : [0, 0, 0];
    F.angles = angles; F.angVel = angularVel_degPerS; F.torso = torso;
    return F;
  }

  sample(t, angles, angularVel_degPerS, cardiac, torso = null) {
    const { g, torsoAcc, joint, torsoW } = this._frameTerms(t, angles, angularVel_degPerS, torso);

    // 4) Ballistocardiographic micro-vibration coupled to the pulse (tiny, 3 mg at SBP — model assumption).
    const bcg = ((cardiac.pressureAt(t) - cardiac.dbp) / Math.max(1, cardiac.sbp - cardiac.dbp)) * 0.003;

    // 5) Seeded white Gaussian noise per axis (indexed on the engine sample grid → reproducible).
    const n = (Math.round(t * NOISE_TICK_HZ) + this.seed * 7919) | 0;
    const gp = this._gp;
    gaussPair(n, 0, gp); const nax = gp[0] * this.noiseAccel, nay = gp[1] * this.noiseAccel;
    gaussPair(n, 1, gp); const naz = gp[0] * this.noiseAccel, ngx = gp[1] * this.noiseGyro;
    gaussPair(n, 2, gp); const ngy = gp[0] * this.noiseGyro, ngz = gp[1] * this.noiseGyro;

    const accel = [
      g[0] + torsoAcc[0] + joint[0] + nax,
      g[1] + torsoAcc[1] + joint[1] + bcg + nay,
      g[2] + torsoAcc[2] + joint[2] + naz,
    ];

    // 6) Gyro: torso angular velocity in the sensor frame plus joint rates
    //    (elbow about sensor X, pronation about Y, shoulder about Z in this chain approximation).
    const gyro = [
      torsoW[0] + (angularVel_degPerS.elbowFlex || 0) + ngx,
      torsoW[1] + (angularVel_degPerS.wristPron || 0) + ngy,
      torsoW[2] + (angularVel_degPerS.shoulderAbd || 0) + ngz,
    ];

    return { accel, gyro, components: { gravity: g, torsoAcc, torsoGyro: torsoW, joint } };
  }
}
