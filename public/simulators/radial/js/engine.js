// Simulation engine: integrates cardiac, anatomy (hemodynamics + hydrostatics),
// posture/kinematics, EMG, capacitive array, finger PPG/SpO2 and IMU into
// synchronized 16 kHz sample streams stored in ring buffers.

import { CardiacModel, VascularDriftModel } from './cardiac.js';
import { ARTERIAL_PATH, VENOUS_PATH, hydrostaticOffset_mmHg, cumulativeDelay_s, amplificationFactor, findSegmentIndex, pwvPressureGain } from './anatomy.js';
import { PostureController } from './kinematics.js';
import { EmgModel, MUSCLES } from './emg.js';
import { CapacitiveArrayModel } from './capacitiveArray.js';
import { PpgSpo2Model } from './ppgSpo2.js';
import { ImuModel } from './imu.js';
import { deriveWristTissue, referenceWristTissue, deriveWristCrossSection } from './anthropometry.js';

export const SAMPLE_RATE = 16000;
const BUFFER_SECONDS = 4;
const BUFFER_LEN = SAMPLE_RATE * BUFFER_SECONDS;
const GRID_DECIMATION = 80; // capacitive grid snapshots at 200 Hz

// Mean blood velocity (cm/s) per arterial segment at rest, approximate literature-range values.
const SEGMENT_MEAN_VELOCITY_CMS = {
  aortic_root: 40, subclavian: 35, axillary: 30, brachial: 25,
  radial_forearm: 22, radial_wrist: 20, palmar_arch: 14, digital_finger: 8,
};

export class TwinEngine {
  constructor() {
    this.cardiac = new CardiacModel();
    this.posture = new PostureController();
    this.emg = new EmgModel();
    this.capArray = new CapacitiveArrayModel();
    this.ppg = new PpgSpo2Model();
    this.imu = new ImuModel();

    this.t = 0;
    this.writeIdx = 0;
    this.totalSamples = 0;

    this.wristIdx = findSegmentIndex('radial_wrist');
    this.fingerIdx = findSegmentIndex('digital_finger');
    this.brachialIdx = findSegmentIndex('brachial');

    const mk = () => new Float32Array(BUFFER_LEN);
    this.buf = {
      aorticP: mk(), brachialP: mk(), radialP: mk(), fingerP: mk(),
      radialV: mk(), venousV: mk(),
      ppgRed: mk(), ppgIr: mk(), spo2: mk(),
      capBest: mk(),
      accX: mk(), accY: mk(), accZ: mk(),
      gyrX: mk(), gyrY: mk(), gyrZ: mk(),
    };
    this.emgBuf = {};
    for (const m of Object.keys(MUSCLES)) this.emgBuf[m] = mk();

    // Per-electrode capacitance streams (max 8×6 = 48 channels), 16 kHz with ZOH at the cap rate.
    this.MAX_CH = 48;
    this.capCh = Array.from({ length: this.MAX_CH }, () => mk());
    this._capHoldAll = new Float32Array(this.MAX_CH);

    this.gridSnapshots = [];
    this.maxGridSnapshots = 64;

    this.arteryToneScalar = 1.0;
    this.ageStiffness = 1.0;
    // Long-horizon (hours→weeks) vascular / sensor-interface drift with its OWN accelerated clock
    // (ROADMAP §2.2-11, audit §6.20). DISABLED by default → every produced sample stays bit-identical.
    // While enabled it acts MULTIPLICATIVELY on whatever tone/stiffness the scenario or UI has set, and
    // its `scale` (driftClock ×N) touches NOTHING but the drift process itself: the 16 kHz master clock,
    // the beat timeline, respiration, HRV and every noise generator keep running on real simulation time.
    this.drift = new VascularDriftModel();
    this.toneEffective = 1.0;  // arteryToneScalar × drift tone factor (== arteryToneScalar while drift is off)
    this.stiffEffective = 1.0; // ageStiffness      × drift stiffness factor
    this.body = null; // set by setBody(); null = historical default body (170 cm / 70 kg, depth offset 0, atten 1)
    this.mismatch = null; // e.g. { pwvPerMmHg: 0.009, riExp: 0.5, capNonlin: 1.0 } for robustness evaluation
    this.latest = {};
  }

  // 체형(신장·체중) → 손목 조직 파라미터 (js/anthropometry.js — 계수는 모델 가정, 문헌 보정 필요).
  // Applied as DELTAS vs the 170 cm/70 kg reference body so the default body is bit-identical to the
  // twin's historical behaviour (arteryDepthOffset_mm = 0, arterialAttenGain = 1 exactly; effective
  // artery depth stays ARTERY_BASE_DEPTH_MM 2.5 mm). Returns the derived tissue parameters.
  setBody(height_cm = 170, weight_kg = 70) {
    const ref = referenceWristTissue();
    const d = deriveWristTissue({ height_cm, weight_kg });
    this.body = { height_cm, weight_kg, ...d };
    this.capArray.arteryDepthOffset_mm = d.arteryDepth_mm - ref.arteryDepth_mm;
    this.capArray.arterialAttenGain = d.couplingAtten / ref.couplingAtten;
    // 손목 단면 → 볼라 곡률 반지름(a²/b) → 패치 중앙에서 먼 패드의 이격(gap) — ROADMAP §2.1-4 기계 부분, 감사 §6.15 (C).
    // 기본 `curvatureConformity = 1`(완전 순응 패치)에서는 gap ≡ 0 이라 체형과 무관하게 비트 동일하다.
    this.capArray.volarRadius_mm = deriveWristCrossSection({ height_cm, weight_kg }).volarRadius_mm;
    this.ppg.setBodyOptics(height_cm, weight_kg); // 체형 → 손가락 광경로 (§6.14; 기준 체형 170/70 → 정확히 ×1, 비트 동일)
    return this.body;
  }

  // Long-horizon drift clock (audit §6.20). `enableDrift({scale, epochHours, seed, bpCoupling, sensorDrift,
  // config})` starts it AT the current state (the baseline snapshot is taken on the next step, and every
  // drift factor is 1 at that instant, so switching it on never makes the signals jump).
  enableDrift(opts = {}) { return this.drift.enable(opts); }
  disableDrift() { this.drift.disable(this); }
  // driftClock ×N. Re-anchors physiological time so changing the factor mid-run is continuous.
  setDriftScale(n) { this.drift.setScale(n, this.totalSamples / SAMPLE_RATE); }
  driftState() { return this.drift.readout(); }

  // Advance by real elapsed dt (s) and generate corresponding 16 kHz samples.
  step(dtReal) {
    const dt = Math.max(0, Math.min(dtReal || 0, 0.1)); // clamp: no negative/NaN dt, cap bursts on tab wake
    // ---- long-horizon drift (audit §6.20). OFF by default → the two branches below are the same value. ----
    // Physiological drift time is derived from the SAMPLE COUNTER (totalSamples / 16 kHz), not from the
    // accumulated `this.t`, so it carries no step-size rounding history: that is what makes the ×N
    // acceleration exactly separable (same trajectory vs physiological time at any factor).
    let driftTone = 1, driftStiff = 1;
    if (this.drift.enabled) {
      const ds = this.drift.step(this, this.totalSamples / SAMPLE_RATE);
      driftTone = ds.tone; driftStiff = ds.stiff;
    }
    const toneEff = this.drift.enabled ? this.arteryToneScalar * driftTone : this.arteryToneScalar;
    const stiffEff = this.drift.enabled ? this.ageStiffness * driftStiff : this.ageStiffness;
    this.toneEffective = toneEff; this.stiffEffective = stiffEff;
    this.posture.update(dt);
    const angles = this.posture.getAngles();
    const angVel = this.posture.getAngularVelocities();
    this.emg.updateActivation(angles, angVel, this.posture.bodyPosture);

    const wristDeltaH = this.posture.getWristHeightDelta_cm();
    const arteryOffset = this.posture.getArteryOffset_mm();
    const motionLevel = this.emg.motionArtifactLevel();

    // Shared vascular state: tone, stiffness and the pressure dependence of PWV (from central MAP).
    // `mismatch` lets evaluation runs generate data with physiology that differs from what the
    // estimators assume (model-mismatch robustness test): PWV pressure coefficient, reflection
    // exponent, and pressure-stiffening of the capacitive ΔC response.
    const M = this.mismatch;
    // Windkessel layer (audit §6.13 / ROADMAP §2.1-1): tone·stiffness feed the arterial-compliance law,
    // then the layer either SOLVES (SV, TPR) for the set SBP/DBP ('bp' drive — read-outs only, signals
    // unchanged) or DERIVES SBP/DBP from (SV, TPR, HR) ('hemo' drive). Runs BEFORE centralMAP so the
    // pressure-dependent PWV gain below always sees the MAP actually produced this step.
    this.cardiac.setVascularState(toneEff, stiffEff);
    this.cardiac.updateHemodynamics();
    // Shared respiration phase: the PPG breathing modulation and the capacitive baseline wander consume
    // the cardiac respiration RATE, so RSA, the pulsus-paradoxus SBP dip and the sensor-side respiration
    // terms are one oscillator (their own amplitudes are unchanged — audit §6.13).
    const RESP = this.cardiac.respiration;
    this.ppg.breathRate_Hz = RESP.rate_Hz;
    this.capArray.breathRate_Hz = RESP.rate_Hz;
    const centralMAP = this.cardiac.dbp + (this.cardiac.sbp - this.cardiac.dbp) / 3;
    this.pwvGain = M ? Math.max(0.5, 1 + M.pwvPerMmHg * (centralMAP - 93)) : pwvPressureGain(centralMAP);
    // Local (wrist) pressure gain includes the hydrostatic offset: arm down → higher transmural pressure →
    // stiffer wall → higher local PWV and lower distensibility (audit B-3)
    const hydroWrist = hydrostaticOffset_mmHg(wristDeltaH);
    this.pwvGainWrist = M ? Math.max(0.5, 1 + M.pwvPerMmHg * (centralMAP + hydroWrist - 93)) : pwvPressureGain(centralMAP + hydroWrist);
    this.hydroWrist_mmHg = hydroWrist;
    this.capArray.arteryToneScalar = toneEff; this.capArray.ageStiffness = stiffEff; this.capArray.pwvGain = this.pwvGainWrist;
    // Local transmural offset at the wrist — the operating point of the non-linear pressure–diameter curve
    // and of the applanation optimum (audit §6.15 (A)/(B)). 0 at heart level → default unchanged.
    this.capArray.transmuralOffset_mmHg = hydroWrist;
    // Distensibility follows the model's own Bramwell–Hill law: D ∝ 1/PWV² (audit B-2); capNonlin keeps the extra mismatch knob
    this.capArray.distensibilityScale = M && M.capNonlin ? 1 / (1 + M.capNonlin * Math.max(0, centralMAP - 93) / 50) : 1;
    this.ppg.arteryToneScalar = toneEff; this.ppg.ageStiffness = stiffEff; this.ppg.pwvGain = this.pwvGain;
    this.cardiac.reflectionGain = Math.pow(toneEff * stiffEff, M ? M.riExp : 0.7);
    this.cardiac.reflectionTiming = toneEff * stiffEff * this.pwvGain;

    const torso = this.posture.getTorsoState();
    const bestElectrode = this.capArray.bestElectrode(arteryOffset);
    const bestK = bestElectrode ? bestElectrode.k : 0;
    const nCh = Math.min(this.MAX_CH, this.capArray.channelCount());
    const wristArrival_s = cumulativeDelay_s(this.wristIdx, toneEff, stiffEff, this.pwvGain, hydroWrist);
    // Capacitance front-end runs at its own rate; hold the last conversion between updates.
    const capDecim = Math.max(1, Math.round(SAMPLE_RATE / this.capArray.sampleRate_Hz));
    const gridDecim = Math.max(capDecim, GRID_DECIMATION);

    const nSamples = Math.max(1, Math.round(dt * SAMPLE_RATE));
    const sampleDt = 1 / SAMPLE_RATE;

    for (let i = 0; i < nSamples; i++) {
      const t = this.t;
      const idx = this.writeIdx;

      const aortic = this.cardiac.pressureAt(t);
      const brachial = this._segmentPressure(this.brachialIdx, t, wristDeltaH);
      const radial = this._segmentPressure(this.wristIdx, t, wristDeltaH);
      const finger = this._segmentPressure(this.fingerIdx, t, wristDeltaH + 3);

      this.buf.aorticP[idx] = aortic;
      this.buf.brachialP[idx] = brachial;
      this.buf.radialP[idx] = radial;
      this.buf.fingerP[idx] = finger;
      this.buf.radialV[idx] = this._segmentVelocity(this.wristIdx, t, wristDeltaH);
      this.buf.venousV[idx] = this._venousVelocity(t, wristDeltaH);

      const ppg = this.ppg.sample(t, this.cardiac, wristDeltaH, motionLevel, hydroWrist);
      this.buf.ppgRed[idx] = ppg.red;
      this.buf.ppgIr[idx] = ppg.ir;
      this.buf.spo2[idx] = ppg.spo2;

      if (this.totalSamples % capDecim === 0) {
        this.capArray.sampleAllChannels(t, this.cardiac, arteryOffset, motionLevel, this._capHoldAll, wristArrival_s);
      }
      for (let ch = 0; ch < nCh; ch++) this.capCh[ch][idx] = this._capHoldAll[ch];
      this.buf.capBest[idx] = this._capHoldAll[bestK];

      const imu = this.imu.sample(t, angles, angVel, this.cardiac, torso);
      this.buf.accX[idx] = imu.accel[0]; this.buf.accY[idx] = imu.accel[1]; this.buf.accZ[idx] = imu.accel[2];
      this.buf.gyrX[idx] = imu.gyro[0]; this.buf.gyrY[idx] = imu.gyro[1]; this.buf.gyrZ[idx] = imu.gyro[2];

      for (const m of Object.keys(MUSCLES)) this.emgBuf[m][idx] = this.emg.sample(m, t);

      if (this.totalSamples % gridDecim === 0 && !this.capArray.layout) {
        const grid = new Array(this.capArray.rows);
        for (let r = 0; r < this.capArray.rows; r++) { grid[r] = new Array(this.capArray.cols); for (let c = 0; c < this.capArray.cols; c++) grid[r][c] = this._capHoldAll[r * this.capArray.cols + c]; }
        this.gridSnapshots.push({ t, grid });
        if (this.gridSnapshots.length > this.maxGridSnapshots) this.gridSnapshots.shift();
      }

      this.t += sampleDt;
      this.writeIdx = (idx + 1) % BUFFER_LEN;
      this.totalSamples++;
    }

    this.latest = {
      t: this.t, angles, angVel, torso, wristDeltaH, arteryOffset, motionLevel,
      tissue: {arteryLateralAdjust_mm:this.capArray.arteryLateralAdjust_mm||0,arteryDepthAdjust_mm:this.capArray.arteryDepthAdjust_mm||0,arteryLateralShift_mm:arteryOffset.lateral_mm+(this.capArray.arteryLateralAdjust_mm||0),arteryDepthShift_mm:arteryOffset.depth_mm-1+(this.capArray.arteryDepthOffset_mm||0)+(this.capArray.arteryDepthAdjust_mm||0),radiusDelta_mm:this.capArray.tissueRadius_mm[bestK]||0,displacement_mm:this.capArray.tissueDisplacement_mm.slice(),fat_mm:this.capArray.tissueFat_mm,model:"SOMA causal ROM v1"},
      capSampleRate_Hz: SAMPLE_RATE / capDecim,
      nCh, bestK,
      oracleGains: this.capArray.oracleCouplings(arteryOffset),
      capLast: this._capHoldAll.slice(0, nCh),
      emgActivation: this.emg.getAllActivation(),
      hydrostatic_mmHg: hydrostaticOffset_mmHg(wristDeltaH),
      instantHR: this.cardiac.instantHR(this.t),
      hemo: this.cardiac.hemodynamics(), // SV / TPR / CO / C / MAP / PP / respiration (audit §6.13)
      toneEffective: toneEff, stiffEffective: stiffEff,
      drift: this.drift.readout(), // null while the drift clock is off (audit §6.20)
      radialPulseDelay_ms: cumulativeDelay_s(this.wristIdx, toneEff, stiffEff, this.pwvGain, hydroWrist) * 1000,
      fingerPulseDelay_ms: cumulativeDelay_s(this.fingerIdx, toneEff, stiffEff, this.pwvGain, hydroWrist) * 1000,
      spo2: this.buf.spo2[(this.writeIdx - 1 + BUFFER_LEN) % BUFFER_LEN],
      lastGrid: this.gridSnapshots.length ? this.gridSnapshots[this.gridSnapshots.length - 1].grid : null,
    };
  }

  _segmentPressure(segIdx, t, wristDeltaH) {
    const delay = cumulativeDelay_s(segIdx, this.toneEffective, this.stiffEffective, this.pwvGain, this.hydroWrist_mmHg || 0);
    const amp = amplificationFactor(segIdx);
    const p = this.cardiac.pressureAt(t - delay);
    const pulseNorm = (p - this.cardiac.dbp) / Math.max(1, this.cardiac.sbp - this.cardiac.dbp);
    const pp = (this.cardiac.sbp - this.cardiac.dbp) * amp;
    // Hydrostatic offset scales with how far along the arm this segment sits (0 at heart).
    const frac = Math.min(1, ARTERIAL_PATH[segIdx].distanceFromHeart_cm / ARTERIAL_PATH[this.wristIdx].distanceFromHeart_cm);
    const hydro = hydrostaticOffset_mmHg(wristDeltaH * frac);
    return this.cardiac.dbp + pulseNorm * pp + hydro;
  }

  _segmentVelocity(segIdx, t, wristDeltaH) {
    const seg = ARTERIAL_PATH[segIdx];
    const delay = cumulativeDelay_s(segIdx, this.toneEffective, this.stiffEffective, this.pwvGain);
    const p = this.cardiac.pressureAt(t - delay);
    const pulseNorm = (p - this.cardiac.dbp) / Math.max(1, this.cardiac.sbp - this.cardiac.dbp);
    const vmean = SEGMENT_MEAN_VELOCITY_CMS[seg.name] || 20;
    // Gravity assist: dependent arm slightly higher arterial inflow, raised arm lower.
    const gravityFactor = 1 + (wristDeltaH / 100) * 0.25;
    // Vasoconstriction (tone>1) lowers diameter -> higher velocity for same flow (simplified).
    return vmean * (0.35 + 1.6 * pulseNorm) * gravityFactor * this.toneEffective;
  }

  // Venous return velocity at wrist: respiratory pump + muscle pump + gravity.
  // The respiratory pump uses the SHARED respiration phase (audit §6.13); amplitude unchanged.
  _venousVelocity(t, wristDeltaH) {
    const resp = 1 + 0.35 * this.cardiac.respiration.signal(t);
    const musclePump = 1 + 1.2 * this.emg.motionArtifactLevel();
    const gravityResist = Math.max(0.4, 1 - (wristDeltaH / 100) * 0.6); // harder to return from dependent arm
    return 8 * resp * musclePump * gravityResist;
  }

  // Returns the last `seconds` of a named buffer as a contiguous Float32Array (oldest->newest).
  getWindow(name, seconds) {
    const src = this.buf[name] || this.emgBuf[name];
    if (!src) return new Float32Array(0);
    const n = Math.min(BUFFER_LEN, Math.round(seconds * SAMPLE_RATE), this.totalSamples);
    const out = new Float32Array(n);
    let start = (this.writeIdx - n + BUFFER_LEN) % BUFFER_LEN;
    for (let i = 0; i < n; i++) out[i] = src[(start + i) % BUFFER_LEN];
    return out;
  }

  // Clear all sample history (keeps simulation time and model state). Used when a structural
  // parameter changes (capacitance sample rate, array rows/cols/pitch) so windows never mix
  // data produced under different configurations.
  resetBuffers() {
    for (const b of Object.values(this.buf)) b.fill(0);
    for (const b of Object.values(this.emgBuf)) b.fill(0);
    for (const b of this.capCh) b.fill(0);
    this._capHoldAll.fill(0);
    this.gridSnapshots.length = 0;
    this.writeIdx = 0;
    this.totalSamples = 0;
  }

  // Frame of the newest samples produced since `sinceTotal` (for the AnalysisClient): channel-major
  // capacitive block + PPG red/IR + true radial pulse (simulator reference) + oracle couplings.
  frameSince(sinceTotal) {
    const n = Math.min(BUFFER_LEN, this.totalSamples - sinceTotal);
    if (n <= 0) return null;
    const nCh = Math.min(this.MAX_CH, this.capArray.channelCount());
    const start = (this.writeIdx - n + BUFFER_LEN) % BUFFER_LEN;
    const cap = new Float32Array(nCh * n);
    for (let ch = 0; ch < nCh; ch++) { const src = this.capCh[ch]; for (let i = 0; i < n; i++) cap[ch * n + i] = src[(start + i) % BUFFER_LEN]; }
    const take = (src) => { const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = src[(start + i) % BUFFER_LEN]; return o; };
    // Wrist IMU, decimated to 1 kHz on a global grid (sample index % 16 == 0), interleaved ax,ay,az,gx,gy,gz
    const IMU_DEC = 16, first = (IMU_DEC - ((this.totalSamples - n) % IMU_DEC)) % IMU_DEC;
    const imuN = first < n ? Math.floor((n - 1 - first) / IMU_DEC) + 1 : 0;
    const imu = new Float32Array(6 * imuN);
    for (let j = 0; j < imuN; j++) { const k = (start + first + j * IMU_DEC) % BUFFER_LEN; imu[6 * j] = this.buf.accX[k]; imu[6 * j + 1] = this.buf.accY[k]; imu[6 * j + 2] = this.buf.accZ[k]; imu[6 * j + 3] = this.buf.gyrX[k]; imu[6 * j + 4] = this.buf.gyrY[k]; imu[6 * j + 5] = this.buf.gyrZ[k]; }
    return { t0: this.t - n / SAMPLE_RATE, n, nCh, cap, red: take(this.buf.ppgRed), ir: take(this.buf.ppgIr), ref: take(this.buf.radialP), oracleGains: this.latest.oracleGains || null, imu, imuN, imuFs: SAMPLE_RATE / IMU_DEC };
  }

  // ⑤ Replay: write a recorded frame (engine.frameSince() contract) into the ring buffers as if it had
  // just been simulated — capacitive channels, PPG, radial reference, IMU (held between decimated
  // samples). Segment pressures/velocities/EMG are not part of a recording and keep their last values.
  ingestFrame(fr, capFs = null) {
    const n = fr.n | 0; if (n <= 0) return;
    const nCh = Math.min(this.MAX_CH, fr.nCh | 0, this.capArray.channelCount());
    const imuN = fr.imuN | 0;
    for (let i = 0; i < n; i++) {
      const idx = (this.writeIdx + i) % BUFFER_LEN;
      for (let ch = 0; ch < nCh; ch++) this.capCh[ch][idx] = fr.cap[ch * n + i];
      this.buf.ppgRed[idx] = fr.red ? fr.red[i] : 0; this.buf.ppgIr[idx] = fr.ir ? fr.ir[i] : 0;
      this.buf.radialP[idx] = fr.ref ? fr.ref[i] : 0;
      if (imuN > 0) { const j = Math.min(imuN - 1, Math.floor((i * imuN) / n)) * 6; this.buf.accX[idx] = fr.imu[j]; this.buf.accY[idx] = fr.imu[j + 1]; this.buf.accZ[idx] = fr.imu[j + 2]; this.buf.gyrX[idx] = fr.imu[j + 3]; this.buf.gyrY[idx] = fr.imu[j + 4]; this.buf.gyrZ[idx] = fr.imu[j + 5]; }
    }
    this.writeIdx = (this.writeIdx + n) % BUFFER_LEN;
    this.totalSamples += n;
    this.t = fr.t0 + n / SAMPLE_RATE;
    for (let ch = 0; ch < nCh; ch++) this._capHoldAll[ch] = fr.cap[ch * n + n - 1];
    this.latest = { ...this.latest, t: this.t, capLast: this._capHoldAll.slice(0, nCh), capSampleRate_Hz: capFs || this.latest.capSampleRate_Hz || this.capArray.sampleRate_Hz, replay: true };
  }

  // Value of capacitive channel `ch` `agoSamples` samples before the newest sample (clamped to history).
  sampleAgo(ch, agoSamples) {
    const src = this.capCh[ch]; if (!src) return 0;
    const ago = Math.max(0, Math.min(BUFFER_LEN - 1, this.totalSamples - 1, agoSamples | 0));
    return src[(this.writeIdx - 1 - ago + 2 * BUFFER_LEN) % BUFFER_LEN];
  }

  // Decimated window (every `decim`-th sample) of a named buffer, oldest→newest.
  getWindowDecimated(name, seconds, decim) {
    const src = this.buf[name] || this.emgBuf[name];
    if (!src) return new Float32Array(0);
    return this._decimated(src, seconds, decim);
  }

  _decimated(src, seconds, decim) {
    const n = Math.min(BUFFER_LEN, Math.round(seconds * SAMPLE_RATE), this.totalSamples);
    const m = Math.floor(n / decim);
    const out = new Float32Array(m);
    let start = (this.writeIdx - n + BUFFER_LEN) % BUFFER_LEN;
    for (let i = 0; i < m; i++) out[i] = src[(start + i * decim) % BUFFER_LEN];
    return out;
  }

  // Decimated windows for all active capacitive channels: Float32Array[nCh].
  getChannelWindows(seconds, decim) {
    const nCh = Math.min(this.MAX_CH, this.capArray.channelCount());
    const out = [];
    for (let ch = 0; ch < nCh; ch++) out.push(this._decimated(this.capCh[ch], seconds, decim));
    return out;
  }

  describeAnatomy() {
    return { arterial: ARTERIAL_PATH, venous: VENOUS_PATH };
  }
}
