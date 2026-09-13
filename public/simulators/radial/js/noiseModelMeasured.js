// Measured ("실측 기반 v1 패치") noise / artefact model for the wrist capacitive electrode array.
//
// Parameters were fitted from the real 12-pad patch recordings (data/data_version1/*.csv at 250 Hz,
// + data_version2/Result_01.csv) by research/digital-twin/eval/fit_noise_model.py; the full fit with
// per-file tables is research/digital-twin/assets/noise_model_v1.json and docs/NOISE_MODEL.md.
// The generative parameters are embedded here as a constant so the browser needs no fetch.
//
// Units: every amplitude is a FRACTION of the measured median ensemble pulse amplitude ("A", the median
// over pulse-carrying pads of one recording; 22.4 ADC counts pooled). The twin converts with
//   A_pF = pulseRef_pF / max_over_median      (pulseRef_pF = capPerMmHg·42 ≈ 0.9 pF = best-coupled pad)
// so that the twin's best pad has the same noise/pulse ratio as the measured best pad.
//
// Everything is seeded/deterministic: all randomness comes from hashU(seed, channel, sample index, salt).

export const NOISE_MODEL_V1 = {
  schema: 'cbp-noise-model/v1',
  fitted_from: 'data/data_version1 (R3_0415-01..10 quiet baseline, nonwoven_R3_2stage_01..04, posechange_R3_plane_01..06) + data_version2/Result_01; 250 Hz',
  fs_meas_Hz: 250,
  // pulse reference (standard set, per-file median over pulse-carrying pads)
  pulse: { median_amp_counts: 22.4, max_over_median: 1.47, noise_over_pulse_per_pad: 0.19, n_pulse_pads_of_12: 4 },
  // white floor: flat 15–50 Hz at 250 Hz, sigma per 250 Hz sample; PSD rolls off above hf_corner (AFE filter)
  // (sigma_frac = flat level in front of the LP, fitted in log-PSD to the pooled residual spectrum; the
  //  15–50 Hz floor of the data corresponds to sigma 0.063 per 250 Hz sample)
  white: { sigma_frac: 0.073, hf_corner_Hz: 45, common_mode_corr: 0.21 },
  // coloured part of the pulse-free residual (1/f^0.95 envelope, corner ≈ 34 Hz against the floor), realised as a
  // sum of AR(1) [corner Hz, stationary sigma]: 0.5 + 2 Hz terms = log-PSD fit of the 0.5–110 Hz residual spectrum
  // (band RMS 0.5–5 Hz 0.08, 5–30 Hz 0.05); 0.08 Hz term = <0.5 Hz baseline wander from the raw signal
  // (0.05–0.5 Hz RMS 0.09 excl. respiration) — see noise_model_v1.json generative.twin_realisation
  pink: { alpha: 0.95, corner_Hz: 34, rms_0p5_5Hz_frac: 0.082, rms_0p05_0p5Hz_frac: 0.092, common_mode_corr: 0.20,
    ar1: [[0.08, 0.125], [0.5, 0.072], [2.0, 0.088]] },
  // respiration-band (0.15–0.5 Hz) component: discrete peak ~3× above the 1/f trend
  respiration: { freq_Hz: 0.24, amp_frac: 0.10, per_channel_gain_jitter: 0.3, coh_with_ecg_edr_v2: 0.71 },
  // baseline settle after (re)attachment: fast exponential + slow relaxation; sign is negative in 10/10 quiet files
  drift: { settle_amp_frac: 1.0, tau_s: 5.2, late_rate_frac_per_s: 0.043, slow_tau_s: 60 },
  // posture-change / motion transients (posechange set = artefact source; rate of the quiet set as the resting rate)
  motion: { rate_per_min_rest: 1.1, rate_per_min_posechange: 2.7, amp_frac_median: 4.7, amp_lognormal_sigma: 1.0 /* measured IQR 1.9–10.9 → σ≈1.3; clipped at ±1.5σ */,
    per_channel_gain_lognormal_sigma: 0.7 /* → max/median pad ≈ 3–4 as measured */, duration_s_median: 0.8, duration_lognormal_sigma: 0.7,
    post_shift_frac: 5.2, recovery_tau_s: 3.7, persistent_tau_s: 30 /* assumption: files too short to fit */,
    acc_amp_ratio: 0.94 },
  // isolated single-sample spikes (JUMP-only events not adjacent to a dropout)
  spike: { rate_per_min: 0.83, amp_frac: 1.5, per_channel: true },
  quant: { step_frac: 0.0447 },              // 1 ADC count
  mains60_present: false,                          // no 60 Hz line in the residual PSD (ratio ≈ 1.08)
  skew_us_per_slot: 87.72,                         // ATA5009 TDM slot (spec); not resolvable from the logs
  // observed but NOT generated here: all-pad read-out dropouts (all cells → 0 for 8 ms, 40 ms linear ramp back)
  dropout: { glitch_rate_per_min: 0.66, rezero_rate_per_min: 7.2, applied: false },
  // v1.1 (2026-08-24) — coupling inhomogeneity, ASSUMED (not fitted; see docs/NOISE_MODEL.md §6): the real 12-pad patch
  // carries the pulse on ≈ 4 pads of comparable strength (per-pad amplitude ratios 0.94/0.77/0.75/0.60 … 0.22 of the best)
  // and the blind-MRC lock flips between pad sets from window to window (coupling-pattern similarity vs a 16 s reference
  // 0.43 median on the standard recordings, x̂ SD 2.6 mm; eval/results_measured_replay.md). The twin's smooth Gaussian
  // coupling kernel gives a pattern similarity of 1.00, so the attachment monitor could not be tested honestly against
  // it. Modelled as (a) a per-pad STATIC pulse-visibility factor exp(σ_v·z), z ~ N(0,1) clipped to [−1.5, +0.5] (mostly
  // attenuation: skin/contact inhomogeneity, fixed per session and pad), and (b) a per-pad SLOW GAIN random walk
  // AR(1) in ln-gain (stationary σ_g, time constant τ_g) — both multiply the ARTERIAL pulse only (DC / noise unchanged).
  // σ_v, σ_g, τ_g are assumptions chosen so that the twin's 3×4 @ 250 Hz stream shows pattern-similarity drops and
  // MRC lock flips of the same order as the standard recordings (not a fit — the real per-pad gain statistics are
  // not separable from the beat-to-beat shape variation in the available data). Synthetic noise model: unchanged.
  coupling: { visibility_lognormal_sigma: 0.6, visibility_z_clip: [-1.5, 0.5], gain_rw_sigma_ln: 0.25, gain_rw_tau_s: 15, applied: true },
};

// ---- v1.2 (2026-08-24) structure-sensitivity knobs (patent/02 patch-structure simulation) -------------
// Parameter-proxy knobs for the "IF the structure achieves X, THEN…" sensitivity sweeps. ALL DEFAULTS ARE
// A NO-OP (att = 1 paths are bit-identical to v1.1); existing results are unchanged unless a knob is set.
// Set them either by importing NOISE_KNOBS and mutating before the generator warms up, or via the
// environment: DT_NOISE_KNOBS='{"cmAttenuation_dB":20}' node eval/esh_eval.mjs …
export const NOISE_KNOBS = {
  // Differential/guard proxy: attenuates the ARRAY-COMMON part of the noise by 10^(-dB/20):
  // common-mode share of white & pink, respiration common part, posture-event common part (per-event
  // channel-mean), attachment-drift common part. Per-channel-independent parts are untouched.
  cmAttenuation_dB: 0,
  // Coupling-inhomogeneity proxy (preload / adhesive-window uniformity): scales the v1.1 per-pad
  // visibility σ (0.6·s) and slow ln-gain random-walk σ (0.25·s). 1 = as measured-calibrated, 0 = uniform.
  couplingSpread: 1,
  // Adhesive-window proxy: multiplies the arterial pulse visibility of every pad (0 = nonwoven-like,
  // no pulse couples at all — the measured nonwoven 4/4 no-pulse condition). >1 = soft-dielectric
  // gap-filler proxy (proposal 8: series air-gap term reduced → coupling gain up, noise unchanged).
  pulseGain: 1,
  // Segmented-islands proxy (proposal 6): 0 = a posture event hits every channel (v1.1 default, as
  // measured); 1 = each event confined to one channel ("its island"); intermediate values scale the
  // non-centre channels by 1 − eventLocality.
  eventLocality: 0,
  // Mechanical-suspension proxy (proposal 7): scales the interface-reaching amplitude of posture-change
  // events and spikes (0.5 / 0.2 = "IF the suspension attenuates band-borne motion to 50 / 20 %").
  motionAmpGain: 1,
};
if (typeof process !== 'undefined' && process.env && process.env.DT_NOISE_KNOBS) {
  try { Object.assign(NOISE_KNOBS, JSON.parse(process.env.DT_NOISE_KNOBS)); } catch (_) { /* ignore malformed env */ }
}

const WLP_GAIN = 1.0; // the fitted white sigma already refers to the flat level in front of the 2-pole LP

// Deterministic helpers (same construction as capacitiveArray.js)
function hashU(x) { const s = Math.sin(x * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); }
function gaussH(seed) { const u = hashU(seed), v = hashU(seed * 1.61803 + 7.7); return Math.sqrt(-2 * Math.log(Math.max(1e-12, u))) * Math.cos(2 * Math.PI * v); }
// Lognormal draw with the Gaussian clipped to ±1.5σ (the recordings are short: no evidence for the extreme tail)
function logn(median, sigma, seed) { return median * Math.exp(sigma * Math.max(-1.5, Math.min(1.5, gaussH(seed)))); }

// Per-array generator state. One instance per CapacitiveArrayModel; call `sample()` once per channel per
// capacitance sample. Returns {noise, wander, motion} in units of A (fraction of the median pulse amplitude).
export class MeasuredNoiseGenerator {
  constructor(model = NOISE_MODEL_V1) {
    this.m = model;
    this.fs = 0;
    this.ch = [];
    this.cm = null;       // common-mode (array-wide) processes
    this.events = [];     // active motion events
    this.lastEventSec = -1;
    this.spikeIdx = -1;
  }

  _ensure(fs, nCh) {
    if (this.fs !== fs) {
      this.fs = fs;
      const m = this.m;
      // white: same PSD as measured -> per-sample sigma scales with sqrt(fs/fs_meas); 2-pole LP at hf_corner
      this.wSigma = m.white.sigma_frac * Math.sqrt(fs / m.fs_meas_Hz);
      this.wLp = Math.exp(-2 * Math.PI * m.white.hf_corner_Hz / fs);
      // LP gain compensation so that the 15–50 Hz in-band level stays ~equal to the measured floor
      // 2-pole one-pole cascade (unit DC gain): in-band (15–50 Hz) level is ~0.5× the flat input PSD at
      // fc = 41 Hz, so the drive is raised by WLP_GAIN (checked numerically in the smoke test, see NOISE_MODEL.md)
      this.wLpGain = WLP_GAIN;
      // pink: AR(1) bank; stationary sigma of each component is fixed (fs-independent)
      this.ar = m.pink.ar1.map(([fc, sig]) => { const a = Math.exp(-2 * Math.PI * fc / fs); return { a, drive: sig * Math.sqrt(1 - a * a) }; });
      this.slowA = Math.exp(-1 / (m.drift.slow_tau_s * fs));
      // v1.1 coupling gain random walk (AR(1) in ln-gain per pad): stationary sigma fixed, fs-independent
      const cg = m.coupling || null;
      this.gA = cg && cg.applied ? Math.exp(-1 / (cg.gain_rw_tau_s * fs)) : 1;
      this.gDrive = cg && cg.applied ? cg.gain_rw_sigma_ln * (NOISE_KNOBS.couplingSpread ?? 1) * Math.sqrt(1 - this.gA * this.gA) : 0;
      this.ch = [];
      this.cm = null;
      this.events = [];
      this.lastEventSec = -1;
    }
    while (this.ch.length < nCh) this.ch.push({ idx: -1, w1: 0, w2: 0, ar: this.ar.map(() => 0), out: null, g: 0, vis: null });
    if (!this.cm) this.cm = { idx: -1, w1: 0, w2: 0, ar: this.ar.map(() => 0) };
  }

  // Advance the array-wide (common-mode) processes once per sample
  _stepCommon(tIdx, seed) {
    const c = this.cm;
    if (c.idx === tIdx) return;
    c.idx = tIdx;
    const g = gaussH(seed * 0.7 + tIdx * 0.001 + 0.123);
    // white through a unit-DC-gain 2-pole (one-pole cascade) LP
    c.w1 = this.wLp * c.w1 + (1 - this.wLp) * this.wSigma * g;
    c.w2 = this.wLp * c.w2 + (1 - this.wLp) * c.w1;
    for (let i = 0; i < this.ar.length; i++) c.ar[i] = this.ar[i].a * c.ar[i] + this.ar[i].drive * gaussH(seed * 0.31 + i * 97.3 + tIdx * 0.001 + 5.5);
  }

  // Poisson motion-event schedule: one Bernoulli draw per simulated second (rate ≤ 1/s), deterministic.
  _scheduleEvents(t, seed, ratePerMin) {
    const sec = Math.floor(t);
    if (sec === this.lastEventSec) return;
    // catch up second by second (fast-forward warm-ups)
    for (let s = this.lastEventSec + 1; s <= sec; s++) {
      const pE = Math.min(0.95, ratePerMin / 60);
      if (hashU(seed * 0.017 + s * 0.731 + 11.1) < pE) {
        const m = this.m.motion;
        const eid = s;
        const start = s + hashU(seed * 0.019 + s * 0.37 + 2.2);
        const amp = logn(m.amp_frac_median, m.amp_lognormal_sigma, seed * 0.023 + s * 0.41 + 3.3);
        const dur = logn(m.duration_s_median, m.duration_lognormal_sigma, seed * 0.029 + s * 0.43 + 4.4);
        const shift = logn(m.post_shift_frac, m.amp_lognormal_sigma * 0.7, seed * 0.031 + s * 0.47 + 6.6);
        this.events.push({ eid, start, amp, dur, shift });
      }
    }
    this.lastEventSec = sec;
    // drop events that have fully relaxed
    const keep = 6 * this.m.motion.persistent_tau_s;
    if (this.events.length && t - this.events[0].start > keep) this.events = this.events.filter((e) => t - e.start <= keep);
  }

  // Contribution of all active events to channel k at time t (fraction of A).
  // `att` < 1 (NOISE_KNOBS.cmAttenuation_dB): the per-event CHANNEL-MEAN factor (the array-common part
  // of the event) is attenuated; the per-channel residual is untouched — differential/guard proxy.
  _eventValue(k, t, seed, nCh = 0, att = 1) {
    let v = 0;
    const m = this.m.motion;
    const fk = (e, kk) => {
      const g = logn(1, m.per_channel_gain_lognormal_sigma, seed * 0.037 + e.eid * 0.53 + kk * 7.7 + 8.8);
      const s = hashU(seed * 0.041 + e.eid * 0.59 + kk * 9.1 + 9.9) < 0.5 ? -1 : 1;
      return s * g;
    };
    for (const e of this.events) {
      const dt = t - e.start;
      if (dt < 0) continue;
      // per-channel gain (lognormal) and sign, fixed per event
      let f = fk(e, k);
      if (att !== 1 && nCh > 0) {
        if (e.fmean == null) { let s = 0; for (let j = 0; j < nCh; j++) s += fk(e, j); e.fmean = s / nCh; }
        f -= (1 - att) * e.fmean;
      }
      const loc = NOISE_KNOBS.eventLocality;
      if (loc > 0 && nCh > 0) { // proposal-6 proxy: confine the event to one "island" channel
        if (e.kc == null) e.kc = Math.min(nCh - 1, Math.floor(hashU(seed * 0.071 + e.eid * 0.67 + 14.3) * nCh));
        if (k !== e.kc) f *= 1 - loc;
      }
      if (NOISE_KNOBS.motionAmpGain !== 1) f *= NOISE_KNOBS.motionAmpGain; // proposal-7 suspension proxy
      if (dt < e.dur) {
        // smooth bump (raised cosine) during the movement
        v += f * e.amp * 0.5 * (1 - Math.cos(2 * Math.PI * dt / e.dur));
      } else {
        // persistent baseline shift after the posture change: part recovers with recovery_tau, the rest
        // relaxes slowly (persistent_tau — assumption, the recordings are too short to fit it)
        const u = dt - e.dur;
        const sh = f * e.shift;
        v += sh * (0.65 * Math.exp(-u / m.recovery_tau_s) + 0.65 * Math.exp(-u / m.persistent_tau_s));
      }
    }
    return v;
  }

  /**
   * Sample channel k at capacitance sample index tIdx (time t seconds).
   * opts: { seed, motionLevel (0..1), motionGain, wanderGain }
   * Returns { noise, wander, motion } in units of the median pulse amplitude A.
   */
  sample(k, tIdx, t, fs, nCh, opts) {
    this._ensure(fs, nCh);
    const m = this.m, seed = opts.seed || 1234;
    const st = this.ch[k];
    this._stepCommon(tIdx, seed);
    const rateRest = m.motion.rate_per_min_rest, ratePose = m.motion.rate_per_min_posechange;
    const rate = (rateRest + (ratePose - rateRest) * Math.min(1, 3 * (opts.motionLevel || 0))) * (opts.motionGain || 1);
    this._scheduleEvents(t, seed, rate);
    if (st.idx !== tIdx) {
      st.idx = tIdx;
      // --- white (2-pole LP) with common-mode share ---
      const g = gaussH(seed + k * 104729 + tIdx * 0.001);
      st.w1 = this.wLp * st.w1 + (1 - this.wLp) * this.wSigma * g;
      st.w2 = this.wLp * st.w2 + (1 - this.wLp) * st.w1;
      // --- pink AR(1) bank ---
      for (let i = 0; i < this.ar.length; i++) st.ar[i] = this.ar[i].a * st.ar[i] + this.ar[i].drive * gaussH(seed + k * 7919 + i * 131.7 + tIdx * 0.001 + 0.37);
      // --- spikes: per-channel Bernoulli per sample ---
      const pS = m.spike.rate_per_min / 60 / fs;
      st.spike = hashU(seed * 0.043 + k * 13.7 + tIdx * 0.0173 + 12.2) < pS ? m.spike.amp_frac * (hashU(seed * 0.047 + k * 15.1 + tIdx * 0.019) < 0.5 ? -1 : 1) : 0;
      if (st.spike !== 0 && NOISE_KNOBS.motionAmpGain !== 1) st.spike *= NOISE_KNOBS.motionAmpGain; // proposal-7 suspension proxy
      // v1.2 knob: common-mode attenuation factor (1 = no-op; att·x === x exactly when att = 1)
      const att = NOISE_KNOBS.cmAttenuation_dB ? Math.pow(10, -NOISE_KNOBS.cmAttenuation_dB / 20) : 1;
      const cmW = m.white.common_mode_corr, cmP = m.pink.common_mode_corr;
      const white = Math.sqrt(1 - cmW) * st.w2 + att * Math.sqrt(cmW) * this.cm.w2;
      let pink = 0, pinkCm = 0;
      for (let i = 0; i < this.ar.length; i++) { pink += st.ar[i]; pinkCm += this.cm.ar[i]; }
      pink = Math.sqrt(1 - cmP) * pink + att * Math.sqrt(cmP) * pinkCm;
      st.noise = white * this.wLpGain + pink;
      // --- respiration (array-wide, per-channel gain jitter; common part = 1, jitter part untouched by att) ---
      const rg = 1 + m.respiration.per_channel_gain_jitter * (2 * hashU(seed * 0.053 + k * 17.3 + 0.5) - 1);
      const rgEff = att === 1 ? rg : att + (rg - 1);
      const fR = m.respiration.freq_Hz * (1 + 0.08 * Math.sin(2 * Math.PI * 0.013 * t + k * 0.0));
      const resp = m.respiration.amp_frac * rgEff * Math.sin(2 * Math.PI * fR * t + 1.3);
      // --- drift: fast settle + slow relaxation after attachment (t = 0), per-channel amplitude jitter
      //     (common part = 1, per-channel residual dj − 1 untouched by att) ---
      const dj = 0.5 + hashU(seed * 0.059 + k * 19.7 + 0.7);      // 0.5 .. 1.5
      const djEff = att === 1 ? dj : att + (dj - 1);
      const settle = -m.drift.settle_amp_frac * djEff * Math.exp(-t / m.drift.tau_s);
      const slow = -m.drift.late_rate_frac_per_s * djEff * m.drift.slow_tau_s * (1 - Math.exp(-t / m.drift.slow_tau_s));
      st.wander = resp + settle + slow;
      st.motion = this._eventValue(k, t, seed, nCh, att);
      // --- v1.1 coupling inhomogeneity (arterial pulse multiplier): static per-pad visibility × slow gain random walk ---
      const cg = m.coupling;
      if (cg && cg.applied) {
        if (st.vis == null) { const sv = cg.visibility_lognormal_sigma * (NOISE_KNOBS.couplingSpread ?? 1); const z = Math.max(cg.visibility_z_clip[0], Math.min(cg.visibility_z_clip[1], gaussH(seed * 0.061 + k * 23.3 + 0.9))); st.vis = Math.exp(sv * z); }
        st.g = this.gA * st.g + this.gDrive * gaussH(seed * 0.067 + k * 29.9 + tIdx * 0.001 + 1.1);
        st.gain = NOISE_KNOBS.pulseGain === 1 ? st.vis * Math.exp(st.g) : st.vis * Math.exp(st.g) * NOISE_KNOBS.pulseGain;
      } else st.gain = NOISE_KNOBS.pulseGain === 1 ? 1 : NOISE_KNOBS.pulseGain;
    }
    return { noise: st.noise, wander: st.wander, motion: st.motion + st.spike, gain: st.gain };
  }
}
