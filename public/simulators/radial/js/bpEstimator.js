// Cuff-calibrated, model-based (inverse digital-twin) estimator of BP, vascular tone and
// arterial stiffness from the wearable signals only (JS mirror of rust/dt-core estimator.rs + features.rs):
//   • MRC-beamformed capacitive waveform  → pulse amplitude A (pF), reflection index RI, reflection timing, HR
//   • finger PPG (IR, optionally Red)     → pulsatile amplitude (AC/DC), PPG RI / timing (OWN beat anchors / HR), wrist→finger PTT
//   • proximal vs distal array rows       → local PTT → local PWV
//
// Forward laws assumed (mirror of the twin's generative model — a model-matched inverse, see estimator.rs header):
//   τ = tone, s = stiffness, g = 1 + 0.006·(MAP − 93), hydro (posture) NOT observable → g_w ≡ g (documented limitation)
//   RI ∝ (τ·s)^0.7            tRefl = T0/M_c − T_PK, M_c = τ·s·g        (central reflection)
//   PWV_w ∝ τ^{wt_w}·s^{ws_w}·g   (wrist segment law, wt_w = 0.824, ws_w = 0.437)      PTT_wf ∝ 1/(τ^{0.961}·s^{0.330}·g)
//   A ∝ PP·D, D ∝ 1/(τ·s·g)²  (Bramwell–Hill)                 PPG AC/DC ∝ PP/τ × perfusion
// Inversion: log-ratios (a, b, γ) = ln(τ/τ0, s/s0, g/g0) by WEIGHTED least squares over the available cues
//   y_RI = 0.7(a+b), y_refl = a+b+γ, y_pwv = wt_w·a + ws_w·b + γ, y_ptt = wt_wf·a + ws_wf·b + γ, y_A = π − 2(a+b+γ), y_P = π − a
// with inverse-variance weights from the realised cue dispersions (+ calibration-baseline uncertainty) and priors
// a ~ N(0, 0.12²), b ~ N(0, 0.06²); MAP = 93 + (g0·e^γ − 1)/0.006, PP = PP0·e^π. Outputs are clamped to physiological
// ranges and carry `confidence` 0–1. 4th pass (2026-08-24, see estimator.rs header): per-slot change-point SEGMENTS
// (running medians / dispersions / baselines restart after a detected step; RI/amplitude steps only with a concurrent
// reflection-timing step), overshoot-free trend median (min rule), systolic-centre refinement of the diastolic fit at
// high M, RI rows only with a model-matched baseline, calibration reflection-fit quality in `confidence`.
// 6th pass (2026-08-25, estimator.rs header + docs/CLINICAL_AUDIT.md §6.17): OBSERVABILITY of three silent
// failures the extended forward model (§6.13–§6.16) exposed — cross-modality (array ↔ PPG) residuals that the
// estimator's own laws say must be zero, z-scored by each estimate's OWN posterior SD plus a model-error floor
// (σ_bio): γ = ln(g(MAP)/g₀) → `couplingFault` (contact/coupling change of the array), π = ln(PP/PP₀) with the γ
// half agreeing → `opticsFault` (PPG optics changed since calibration; the AC/DC row is then GATED), and
// ln(RI/RI₀) array vs PPG → `riLawFault` (the ΔC-shape law is violated). No BP arithmetic changes except the
// gated AC/DC row. The perfusion index is NOT used to normalise the AC/DC cue — PI IS AC/DC up to a constant
// (circular); the independent optical observable is DC (both wavelengths) against its calibration value.
// 5th pass (2026-08-24, estimator.rs header + docs/CLINICAL_AUDIT.md §6.12): the reflection-index cue under the
// MEASURED patch noise — `_riGate` now tests the SMOOTHED σ (RI_SIGMA_SOFT_LN 0.07 … RI_SIGMA_MAX_LN 0.12, break-even
// from the measured SNR sweep) instead of the raw per-window dispersion; every calibration baseline is the PLAIN
// median of its window; the running reflection cues are plausibility-gated on TREFL_MIN_MS..TREFL_MAX_MS; the RI
// spans stop growing at RI_MEDIAN_MAX_S; the RI calibration baselines get no √n averaging.

import { PWV_PER_MMHG, MAP_REF_MMHG } from './anatomy.js';

export const T_PK_MS = 120; // systolic-peak time after beat onset (s) used by the reflection-timing inversion
export const RI_EXP = 0.7;
export const WT_WRIST = 0.1 + 0.9 * (66 / 82), WS_WRIST = 1 - 0.7 * (66 / 82);
export const WT_WF = 0.961, WS_WF = 0.330;
export const PRIOR_SIGMA_TONE_LN = 0.12, PRIOR_SIGMA_STIFF_LN = 0.06;
// ---- Beat-model constants of the diastolic decomposition (mirror of the twin's beat model, cardiac.js) ----
const SYS_PEAK_S = 0.12, REFL_SIGMA_S = 0.05, NOTCH_SIGMA_S = 0.018, TAU_DIAST_S = 0.30, PLATEAU_RISE_S = 0.04, SYS_SIGMA_S = 0.04;
const NOTCH_EXCL_SIGMAS = 2.0, NOTCH_EXCL_DEPTH = 0.7, DIAST_FIT_START_S = 0.04, DIAST_SMOOTH_S = 0.025, REFL_MIN_S = 0.04;
const FIT_COARSE_S = 0.004, FIT_RATE_HZ = 1000;
// systolic-centre refinement when the reflected wave overlaps the systolic peak (4th pass; features.rs SYS_REFINE_*)
const SYS_REFINE_BELOW_S = 0.13, SYS_REFINE_FROM_MS = -18, SYS_REFINE_TO_MS = 6, SYS_REFINE_STEP_MS = 3, SYS_REFINE_TR_HALF_S = 0.016;
const PEAK_LOCAL_MAX_S = 1.5, BEAT_REJECT_K = 4.0, SQI_SNR_LO_DB = 0, SQI_SNR_HI_DB = 15;
// ---- Feature smoothing / cue quality (seconds; converted with the measured analysis cadence) ----
export const MEDIAN_S = 3.0, MEDIAN_MAX_S = 24.0, ADAPT_SIGMA_REF_MMHG = 3.0, ADAPT_SIGMA_REF_RI_MMHG = 6.0, ADAPT_HORIZON_S = 30.0, DISP_S = 6.0, RI_MEDIAN_S = 16.0, WIN_CORR_S = 3.8;
// 5th pass: the RI spans no longer grow past RI_MEDIAN_S — the weight credits at most N_EFF_MAX·WIN_CORR_S = 15.2 s
// of averaging, so a longer span buys no weight and costs pure lag (estimator.rs RI_MEDIAN_MAX_S).
export const RI_MEDIAN_MAX_S = RI_MEDIAN_S;
export const TREND_MIN_LN = 0.015, HIST_S = 30.0, CAL_S = 16.0, DEFAULT_CADENCE_S = 1 / 7.5, OUT_TAU_S = 2.5;
// change-point (step) detection of every cue slot on its current segment (4th pass; estimator.rs STEP_K / STEP_MIN_LN)
export const STEP_K = 3.0, STEP_MIN_LN = 0.02;
export const CONF_SD_REF_MMHG = 8.0, N_EFF_MAX = 4.0, RI_SIGMA_SOFT_LN = 0.07, RI_SIGMA_MAX_LN = 0.12, RI_SIGMA_SOFT_OPEN_LN = 0.15, RI_SIGMA_MAX_OPEN_LN = 0.25, RI_SIGMA_LEGACY_MAX_LN = 0.08, SIGMA_FLOOR_LN = 0.003, Q_GATE = 0.15;
// RI-cue gate evaluation switch (estimator.rs RiGateMode; docs/CLINICAL_AUDIT.md §6.12) and the shipped default
export const RI_GATE_MODES = ['legacy', 'narrow', 'open'];
export const RI_GATE_MODE_DEFAULT = 'legacy'; // pre-registered decision, docs/CLINICAL_AUDIT.md §6.12 (0)/(8)
export const CONTACT_CONF = 0.7; // confidence multiplier of the array-anchored estimates while the attachment monitor flags a contact change (warn only)
// ---- 6th pass: cross-modality residuals + the three faults (estimator.rs, docs/CLINICAL_AUDIT.md §6.17) ----
export const PP_SD_LN_NONE = 2.0;          // reported ppSdLn when no amplitude row was available (π unobserved)
export const XMOD_GAMMA_MODEL_MMHG = 5.0;  // σ_bio of the array−PPG MAP difference (segments, morphology, the UNOBSERVED hydrostatic offset)
export const XMOD_PI_MODEL_LN = 0.20;      // σ_bio of the array−PPG ln(PP/PP0) difference (gravity perfusion term, local distensibility)
export const XMOD_RI_MODEL_LN = 0.03;      // σ_bio of the array−PPG ln(RI/RI0) difference (two morphologies of one reflection)
export const XMOD_REFL_MODEL_LN = 0.02;    // σ_bio of the array−PPG reflection-TIMING difference (log units of tRefl + T_PK)
export const XMOD_Z_GAMMA = 3.5, XMOD_Z_REFL = 3.5, XMOD_Z_PI = 3.0, XMOD_Z_RI = 3.0;
export const XMOD_DWELL_S = 3.0, XMOD_CLEAR_S = 4.0, XMOD_MAX_HOLD_S = 4.0;
export const COUPLING_CONF = 0.25, OPTICS_CONF = 0.2, RI_LAW_CONF = 0.5;
export const PPG_DC_REL_THR = 0.15;        // floor of the self-scaled |ln(DC/DC0)| threshold of the optical-path test
// ---- 7th pass (2026-08-30): PPG-INTERNAL optics observability + perfusion weighting (docs/CLINICAL_AUDIT.md §6.24) ----
// EVALUATION SWITCH bits of `ppgOpt`; 0 = the 6th-pass build, BIT-IDENTICALLY. Mirror of rust `PPG_OPT_*`.
export const PPG_OPT_PI_SIGMA = 1;   // perfusion-scaled σ of the AC/DC cue ([물리 유도])
export const PPG_OPT_INTERNAL = 2;   // array-free `opticsUnverified` channel (flag + confidence, never a gate)
export const PPG_OPT_RECAL = 4;      // an optics flag raises `recalRequired`
export const PPG_OPT_PI_FLOOR = 8;   // absolute perfusion floor drops the AC/DC row
export const PPG_OPT_DEFAULT = PPG_OPT_PI_SIGMA | PPG_OPT_INTERNAL | PPG_OPT_RECAL | PPG_OPT_PI_FLOOR;
export const PPG_PI_ALONE_LN = 0.20; // [모델 가정] PP log-change the AC/DC row may claim alone (3σ ⇒ ≈ 47 % of PP)
export const PPG_HR_STILL_LN = 0.05; // [모델 가정] stillness floor of |ln(HR/HR0)| (self-scaled against 4× its dispersion)
export const PPG_PI_FLOOR = 0.005;   // [모델 가정] absolute AC/DC floor (PI ≈ 0.45 %) — a PLACEHOLDER, no literature
                                     // value backs it and nothing in this twin's scenario sets reaches it
export const PPG_PERF_SIGMA_MAX = 10.0;
export const NOTCH_REL_DEFAULT = 0.063, NOTCH_REL_MIN = 0.03, NOTCH_REL_MAX = 0.10, NOTCH_REL_MAX_SIGMA = 0.03, SHRINK_SD_LO_MMHG = 30.0, SHRINK_SD_HI_MMHG = 50.0, TREFL_MIN_MS = 40, TREFL_MAX_MS = 340;
const MAP_MIN = 50, MAP_MAX = 170, PP_MIN = 15, PP_MAX = 100, SBP_MIN = 70, SBP_MAX = 220, DBP_MIN = 40, DBP_MAX = 130;
const PPG_BETA_N = 45;
/// ⑤ largest cluster-to-cluster alignment accepted (ms) — mirror of features.rs INTER_CLUSTER_MAX_MS
const INTER_CLUSTER_MAX_MS = 25;
// backwards-compatible window-count views (at the default 7.5 Hz cadence)
export const MEDIAN_N = Math.round(MEDIAN_S / DEFAULT_CADENCE_S), RI_MEDIAN_N = Math.round(RI_MEDIAN_S / DEFAULT_CADENCE_S), DISP_N = Math.round(DISP_S / DEFAULT_CADENCE_S), HIST_N = Math.round(HIST_S / DEFAULT_CADENCE_S);

function mean(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : 0; }
function std(a) { const m = mean(a); let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - m; s += d * d; } return Math.sqrt(s / Math.max(1, a.length)); }
function dot(a, b) { const n = Math.min(a.length, b.length); let s = 0; for (let i = 0; i < n; i++) s += a[i] * b[i]; return s; }
function medianOf(v) { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); const m = s.length; return m % 2 ? s[m >> 1] : 0.5 * (s[m / 2 - 1] + s[m / 2]); }
// (median, robust σ = 1.4826·MAD) or null if < 4 values
function medianSigma(v) { if (v.length < 4) return null; const s = [...v].sort((a, b) => a - b); const med = s[s.length >> 1]; const dev = v.map((x) => Math.abs(x - med)).sort((a, b) => a - b); return [med, 1.4826 * dev[dev.length >> 1]]; }
const lvetS = (hr, rr) => Math.min(0.45, Math.max(0.2, Math.min(0.413 - 0.0017 * hr, 0.7 * rr)));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const db = (x) => 10 * Math.log10(Math.max(1e-12, x));

// Remove slow baseline with a centred moving-average high-pass (window in samples); within win/2 of either edge the
// baseline is HELD at the first / last full-window mean (a truncated window contains a fraction of a beat and biased
// the edge beats' morphology by several % of RI).
function highpass(x, win) {
  const n = x.length, out = new Float32Array(n);
  const half = Math.floor(win / 2);
  const cs = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + x[i];
  for (let i = 0; i < n; i++) {
    const c = Math.min(Math.max(i, half), Math.max(0, n - half - 1)), a = Math.max(0, c - half), b = Math.min(n, c + half + 1);
    out[i] = x[i] - (cs[b] - cs[a]) / (b - a);
  }
  return out;
}

// Two-pass moving average (≈ triangular window); `win_s` is the half-width in seconds.
function lowpass(x, fs, win_s = 0.012) {
  const sm = Math.max(2, Math.round(win_s * fs));
  const box = (src) => { const n = src.length, o = new Float32Array(n); const cs = new Float64Array(n + 1); for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + src[i]; for (let i = 0; i < n; i++) { const a = Math.max(0, i - sm), b = Math.min(n - 1, i + sm); o[i] = (cs[b + 1] - cs[a]) / (b - a + 1); } return o; };
  return box(box(x));
}

// Running maximum over ±half samples (van Herk / Gil–Werman, O(n)).
function runningMax(x, half) {
  const n = x.length, w = 2 * half + 1, pre = new Float32Array(n), suf = new Float32Array(n), out = new Float32Array(n);
  for (let i = 0; i < n; i++) pre[i] = i % w === 0 ? x[i] : Math.max(pre[i - 1], x[i]);
  for (let i = n - 1; i >= 0; i--) suf[i] = (i === n - 1 || (i + 1) % w === 0) ? x[i] : Math.max(suf[i + 1], x[i]);
  for (let i = 0; i < n; i++) out[i] = Math.max(suf[Math.max(0, i - half)], pre[Math.min(n - 1, i + half)]);
  return out;
}

// Beat detection: local maxima above 35 % of the LOCAL running maximum (±1.5 s; floor 10 % of the global maximum)
// with a refractory period — beats outside a large transient (posture bump, spike) stay detectable.
function detectPeaks(x, fs, refractory_s = 0.3) {
  const peaks = [];
  if (x.length < 3) return peaks;
  const rm = runningMax(x, Math.round(PEAK_LOCAL_MAX_S * fs));
  let gmax = -Infinity; for (let i = 0; i < rm.length; i++) if (rm[i] > gmax) gmax = rm[i];
  const floor = 0.1 * gmax, ref = Math.round(refractory_s * fs);
  for (let i = 1; i < x.length - 1; i++) {
    const thr = Math.max(rm[i] * 0.35, floor);
    if (x[i] > thr && x[i] >= x[i - 1] && x[i] > x[i + 1]) {
      if (peaks.length && i - peaks[peaks.length - 1] < ref) { if (x[i] > x[peaks[peaks.length - 1]]) peaks[peaks.length - 1] = i; }
      else peaks.push(i);
    }
  }
  return peaks;
}

// Robust heart rate (bpm): median inter-peak interval.
function robustHr(peaks, fs) {
  if (peaks.length < 2) return null;
  const d = []; for (let i = 1; i < peaks.length; i++) d.push(peaks[i] - peaks[i - 1]);
  const med = medianOf(d); return med > 0 ? 60 * fs / med : null;
}
// Baseline-removal window: an INTEGER number of beat periods (2·RR).
// 2·RR up to 2.4 s (HR ≥ 50), else 1·RR — always an integer number of beats.
function baselineWin(hr, fs) { const rr = 60 / Math.max(30, hr); const w = 2 * rr <= 2.4 ? 2 * rr : rr; return Math.round(Math.max(0.6, w) * fs); }

function parabolicOffset(ym, y0, yp) { const den = ym - 2 * y0 + yp; return Math.abs(den) > 1e-12 ? 0.5 * (ym - yp) / den : 0; }

// Ensemble-average a signal around given anchor indices: window [−pre, +post] samples.
function ensemble(x, anchors, pre, post) {
  const L = pre + post + 1, out = new Float32Array(L); let n = 0;
  for (const a of anchors) {
    if (a - pre < 0 || a + post >= x.length) continue;
    for (let i = 0; i < L; i++) out[i] += x[a - pre + i];
    n++;
  }
  if (!n) return null;
  for (let i = 0; i < L; i++) out[i] /= n;
  return out;
}
// Beat-quality-weighted ensemble with a residual gate (beats > BEAT_REJECT_K × median residual are dropped);
// returns [ensemble, {nUsed, nRej, snrDb}].
function ensembleWeightedStats(x, anchors, pre, post) {
  const plain = ensemble(x, anchors, pre, post); if (!plain) return null;
  const L = pre + post + 1, use = anchors.filter((a) => a >= pre && a + post < x.length);
  if (use.length < 2) return [plain, { nUsed: use.length, nRej: 0, snrDb: 0 }];
  const ee = dot(plain, plain);
  const res = use.map((a) => { const seg = x.subarray(a - pre, a - pre + L); const g = ee > 0 ? dot(seg, plain) / ee : 1; let r = 0; for (let i = 0; i < L; i++) { const d = seg[i] - g * plain[i]; r += d * d; } return r / L; });
  const med = Math.max(1e-30, medianOf(res));
  let w = res.map((r) => (r > BEAT_REJECT_K * med ? 0 : 1 / (r + med)));
  const nRej = w.filter((v) => v === 0).length;
  if (w.reduce((s, v) => s + v, 0) <= 0) w = w.map(() => 1);
  const ws = w.reduce((s, v) => s + v, 0);
  const out = new Float32Array(L);
  use.forEach((a, k) => { const wk = w[k] / ws; if (!wk) return; for (let i = 0; i < L; i++) out[i] += wk * x[a - pre + i]; });
  const ens = use.length >= 3 ? out : plain; // weighting 2 beats is meaningless; the statistics are still computed
  const pw = dot(ens, ens) / L;
  return [ens, { nUsed: use.length - nRej, nRej, snrDb: db(pw / med) }];
}
function ensembleWeighted(x, anchors, pre, post) { const r = ensembleWeightedStats(x, anchors, pre, post); return r ? r[0] : null; }

// Dense linear solve (Gaussian elimination, partial pivoting) for small systems.
function solveSmall(A, b) {
  const n = b.length, a = A.map((r) => r.slice()), y = b.slice();
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-18) return null;
    if (p !== c) { [a[p], a[c]] = [a[c], a[p]]; [y[p], y[c]] = [y[c], y[p]]; }
    for (let r = c + 1; r < n; r++) { const f = a[r][c] / a[c][c]; if (f) { for (let k = c; k < n; k++) a[r][k] -= f * a[c][k]; y[r] -= f * y[c]; } }
  }
  const x = new Array(n).fill(0);
  for (let c = n - 1; c >= 0; c--) { let s = y[c]; for (let k = c + 1; k < n; k++) s -= a[c][k] * x[k]; x[c] = s / a[c][c]; }
  return x;
}

// Model-matched decomposition of the diastole (mirror of features.rs `diastolic_fit`):
//   y(t) ≈ bS·G(t; t_PK, σS) + bR·G(t; tR, σR) − bN·G(t; tN, σN) + bD·E(t) + c + d·t   over [peak + 40 ms, peak + min(0.5 s, 0.65·RR)]
// G_S tail-clipped like the twin's systolic peak; E(t) = plateau rise 1 − e^{−(t−onset)/0.04} up to tN = onset + LVET(HR), then the
// Windkessel run-off exp(−(t − tN)/τ). Linear LS at a ≈ 1 kHz sample stride on a 4 ms coarse grid of tR (tabulated Gaussian), refined
// on a 1 ms grid around the coarse minimum and parabola-interpolated → reflected-wave CENTRE (tR) and its amplitude ABOVE the baseline
// (bR). The notch depth is a subject constant: with `notchDepth` known it is subtracted and the ±2σ_N region down-weighted.
// `tS` = systolic CENTRE (samples; = `pre` unless refined): centre of the systolic Gaussian and origin of the beat model
// (onset = tS − 120 ms, notch at onset + LVET); the data window stays anchored at `pre` so SSEs of different tS are
// comparable. `trRange` = [lo, hi] (samples) restricts the reflected-centre grid. Returns {tR, bR, bN, sse}.
function diastolicFit(sl, pre, fs, rr, hr, notchDepth = null, tS = pre, trRange = null) {
  const n = sl.length, i0 = Math.max(0, Math.round(pre + DIAST_FIT_START_S * fs)), i1 = Math.min(n - 1, pre + Math.round(Math.min(0.5, 0.65 * rr) * fs));
  if (i1 < i0 + Math.floor(0.12 * fs)) return null;
  const tN = tS - SYS_PEAK_S * fs + lvetS(hr, rr) * fs, sR = REFL_SIGMA_S * fs, sN = NOTCH_SIGMA_S * fs, sS = SYS_SIGMA_S * fs, tau = TAU_DIAST_S * fs;
  const known = notchDepth != null && isFinite(notchDepth) ? notchDepth : null;
  const eD = new Float32Array(n), gN = new Float32Array(n), gS = new Float32Array(n);
  const tOn = tS - SYS_PEAK_S * fs, tauRise = PLATEAU_RISE_S * fs;
  const rise = (t) => (t > tOn ? 1 - Math.exp(-(t - tOn) / tauRise) : 0), eN = rise(tN);
  const gS0 = Math.exp(-0.5 * (SYS_PEAK_S / SYS_SIGMA_S) ** 2);
  for (let i = 0; i < n; i++) {
    eD[i] = i > tN ? eN * Math.exp(-(i - tN) / tau) : rise(i);
    const dn = (i - tN) / sN; gN[i] = Math.exp(-0.5 * dn * dn);
    const ds = (i - tS) / sS; gS[i] = Math.max(0, Math.exp(-0.5 * ds * ds) - gS0) / (1 - gS0);
  }
  const eDs = lowpass(eD, fs, 0.006), gNs = lowpass(gN, fs, 0.006), gSs = lowpass(gS, fs, 0.006);
  const lbox = 2 * Math.round(0.006 * fs) + 1, sRe = Math.sqrt(sR * sR + 2 * (lbox * lbox - 1) / 12);
  const ds = Math.max(1, Math.round(fs / FIT_RATE_HZ)), mlen = i1 - i0, mm = Math.ceil(mlen / ds);
  const nf = known != null ? 4 : 5;
  const fx = [], y = new Float64Array(mm), sw = new Float64Array(mm), pos = new Int32Array(mm); let yy = 0;
  for (let j = 0; j < mm; j++) {
    const i = i0 + j * ds;
    let r = 1; if (known != null) { const dx = (i - tN) / (NOTCH_EXCL_SIGMAS * sN); r = Math.sqrt(1 - NOTCH_EXCL_DEPTH * Math.exp(-0.5 * dx * dx)); }
    sw[j] = r; pos[j] = i; fx.push([r * eDs[i], r, r * ((j * ds) / mlen), r * gSs[i], -r * gNs[i]]);
    y[j] = r * (sl[i] + (known ?? 0) * gNs[i]); yy += y[j] * y[j];
  }
  const gf = Array.from({ length: 5 }, () => [0, 0, 0, 0, 0]), hf = [0, 0, 0, 0, 0];
  for (let j = 0; j < mm; j++) for (let a = 0; a < nf; a++) { hf[a] += fx[j][a] * y[j]; for (let b = 0; b < nf; b++) gf[a][b] += fx[j][a] * fx[j][b]; }
  const step = Math.max(1, Math.round(0.001 * fs)), cs = Math.max(step, Math.round(FIT_COARSE_S * fs));
  let lo = Math.round(tS + REFL_MIN_S * fs), hi = Math.round(i1 - 0.02 * fs);
  if (trRange) { lo = Math.max(lo, Math.round(trRange[0])); hi = Math.min(hi, Math.round(trRange[1])); }
  if (hi <= lo + 2 * cs) return null;
  const span = hi - lo + mlen + 2 * cs + 2, gtab = new Float64Array(span);
  for (let k = 0; k < span; k++) { const d = k / sRe; gtab[k] = Math.exp(-0.5 * d * d); }
  const evalAt = (tr) => {
    let grr = 0, hr_ = 0; const grf = [0, 0, 0, 0, 0];
    for (let j = 0; j < mm; j++) { const off = Math.min(span - 1, Math.abs(pos[j] - tr)); const g = sw[j] * gtab[off]; grr += g * g; hr_ += g * y[j]; for (let a = 0; a < nf; a++) grf[a] += g * fx[j][a]; }
    const A = [[grr, ...grf.slice(0, nf)]], b = [hr_];
    for (let p = 0; p < nf; p++) { A.push([grf[p], ...gf[p].slice(0, nf)]); b.push(hf[p]); }
    const th = solveSmall(A, b); if (!th) return null;
    let sse = yy; for (let k = 0; k < nf + 1; k++) sse -= th[k] * b[k];
    return { sse, bR: th[0], bN: nf === 5 ? th[5] : known };
  };
  const coarse = [];
  for (let tr = lo; tr <= hi; tr += cs) { const e = evalAt(tr); if (e) coarse.push([tr, e.sse]); }
  if (coarse.length < 3) return null;
  let kc = 0; for (let i = 1; i < coarse.length; i++) if (coarse[i][1] < coarse[kc][1]) kc = i;
  if (kc === 0 || kc + 1 >= coarse.length) return null; // centre on the grid edge: not a resolved hump
  const tc = coarse[kc][0], fine = [];
  for (let tr = tc - cs - step; tr <= tc + cs + step; tr += step) { const e = evalAt(tr); if (e) fine.push([tr, e.sse, e.bR, e.bN]); }
  if (fine.length < 3) return null;
  let k = 0; for (let i = 1; i < fine.length; i++) if (fine[i][1] < fine[k][1]) k = i;
  const [tBest, , bR, bN] = fine[k];
  if (!(bR > 0) || k === 0 || k + 1 >= fine.length) return null;
  const off = Math.max(-1, Math.min(1, parabolicOffset(fine[k - 1][1], fine[k][1], fine[k + 1][1])));
  return { tR: tBest + off * step, bR, bN, sse: fine[k][1] };
}

// Morphology of an ensemble beat anchored at the systolic peak (index `pre`): foot, amplitude, reflection index
// (reflected-wave amplitude above the run-off baseline / systolic amplitude WITHOUT the hump's tail at the peak) and
// reflection timing (peak → reflected wave centre, ms); `learnNotch` runs the notch-learning full fit. Fallback (fit: false)
// without a usable fit: global max of the heavily smoothed diastole after the first post-systolic local minimum.
function morphology(ens, pre, fs, rr, notchRel = null, learnNotch = true) {
  if (pre >= ens.length || ens.length < 8) return null;
  const sl = lowpass(ens, fs, 0.006), hr = 60 / Math.max(0.3, rr);
  let foot = pre, fv = sl[pre]; for (let i = 0; i < pre; i++) if (sl[i] < fv) { fv = sl[i]; foot = i; }
  const wpk = Math.round(0.01 * fs); let pv = sl[pre]; for (let i = Math.max(0, pre - wpk); i <= Math.min(sl.length - 1, pre + wpk); i++) if (sl[i] > pv) pv = sl[i];
  const A1 = pv - fv; if (!(A1 > 0)) return null;
  // (1) notch-learning full fit (if needed) → (2) fixed-notch fit; (3) 4th pass: when the reflected centre lies within
  // SYS_REFINE_BELOW_S of the systolic centre, refine the systolic centre tS on a grid around the detected peak by the SSE of
  // the fixed-notch fit and redo (1)–(2) at the best tS (mirror of features.rs `morphology`)
  const learn = notchRel == null || learnNotch;
  const notchOf = (full) => (notchRel != null ? notchRel * A1 : full ? Math.max(0, full.bN) : null);
  const fitPair = (tS) => { const full = learn ? diastolicFit(sl, pre, fs, rr, hr, null, tS, null) : null; const nd = notchOf(full); return [full, nd != null ? diastolicFit(sl, pre, fs, rr, hr, nd, tS, null) : null]; };
  let tS = pre; let [full, fixed] = fitPair(tS);
  if (fixed && fixed.tR - pre <= SYS_REFINE_BELOW_S * fs) {
    const nd = notchOf(full);
    if (nd != null) {
      const range = [fixed.tR - SYS_REFINE_TR_HALF_S * fs, fixed.tR + SYS_REFINE_TR_HALF_S * fs];
      let best = [pre, fixed.sse];
      for (let off = SYS_REFINE_FROM_MS; off <= SYS_REFINE_TO_MS + 1e-9; off += SYS_REFINE_STEP_MS) {
        const cand = pre + Math.round(off * 0.001 * fs);
        if (Math.abs(cand - pre) <= 0.5) continue;
        const d = diastolicFit(sl, pre, fs, rr, hr, nd, cand, range);
        if (d && d.bR > 0 && d.sse < best[1]) best = [cand, d.sse];
      }
      if (Math.abs(best[0] - pre) > 0.5) { const [f2, x2] = fitPair(best[0]); if (x2) { tS = best[0]; full = f2; fixed = x2; } }
    }
  }
  if (fixed && fixed.bR > 0.02 * A1 && fixed.tR > tS) {
    const df = fixed;
    const eTail = Math.exp(-0.5 * ((df.tR - tS) / (REFL_SIGMA_S * fs)) ** 2), aClean = Math.max(0.5 * A1, A1 - df.bR * eTail);
    return { foot, amp: A1, ri: Math.max(0, Math.min(1.2, df.bR / aClean)), tRefl_ms: ((df.tR - tS) / fs) * 1000, notchRi: full ? full.bN / A1 : null, fit: true };
  }
  const sh = lowpass(ens, fs, DIAST_SMOOTH_S);
  const s0 = pre + Math.round(0.06 * fs), s1 = Math.min(sh.length - 2, pre + Math.round(Math.min(0.5, 0.65 * rr) * fs));
  if (s1 <= s0 + 2) return null;
  let imin = -1; for (let i = s0 + 1; i < s1; i++) if (sh[i] <= sh[i - 1] && sh[i] < sh[i + 1]) { imin = i; break; }
  let i2 = -1;
  if (imin >= 0) { let best = -Infinity; for (let i = imin + 1; i < s1; i++) if (sh[i] > best) { best = sh[i]; i2 = i; } if (i2 >= s1 - 1 || !(best > fv)) i2 = -1; }
  if (i2 < 0) { let best = Infinity; for (let i = s0 + 1; i < s1; i++) { const d = Math.abs(sh[i + 1] - sh[i - 1]); if (d < best) { best = d; i2 = i; } } }
  const i2u = Math.min(sh.length - 1, Math.max(0, i2));
  let t2 = i2u; if (i2u > 0 && i2u < sh.length - 1) t2 = i2u + Math.max(-1, Math.min(1, parabolicOffset(sh[i2u - 1], sh[i2u], sh[i2u + 1])));
  return { foot, amp: A1, ri: Math.max(0, Math.min(1.2, (sh[i2u] - fv) / A1)), tRefl_ms: ((t2 - pre) / fs) * 1000, notchRi: null, fit: false };
}

// Beat-template residual (per-beat gain-fitted ensemble removed); returns [residual, coverage mask].
function templateResidual(x, ens, anchors, pre, post) {
  const n = x.length, L = pre + post + 1, res = new Float32Array(n), cov = new Uint8Array(n), ee = dot(ens, ens);
  for (const a of anchors) { if (a < pre || a + post >= n) continue; const seg = x.subarray(a - pre, a - pre + L); const g = ee > 0 ? dot(seg, ens) / ee : 1; for (let i = 0; i < L; i++) { res[a - pre + i] = seg[i] - g * ens[i]; cov[a - pre + i] = 1; } }
  return [res, cov];
}
// Two-wavelength PPG motion cancellation: Red_pulsatile = ρ·IR, motion couples into both with a different gain →
// n = Red − ρ·IR is a pulse-free motion reference and IR_clean = IR − β·n.
function twoWavelengthClean(ir, red, anchors, pre, post, fs, beta = null) {
  const ei = ensemble(ir, anchors, pre, post), er = ensemble(red, anchors, pre, post); if (!ei || !er) return null;
  const eii = dot(ei, ei); if (!(eii > 0)) return null;
  const rho = dot(er, ei) / eii;
  const [resI, cov] = templateResidual(ir, ei, anchors, pre, post), [resR] = templateResidual(red, er, anchors, pre, post);
  const nres = new Float32Array(ir.length); for (let k = 0; k < ir.length; k++) nres[k] = resR[k] - rho * resI[k];
  const wb = Math.round(0.33 * fs), rib = highpass(resI, wb), nb = highpass(nres, wb);
  let sin_ = 0, snn = 0; for (let k = 0; k < ir.length; k++) if (cov[k]) { sin_ += rib[k] * nb[k]; snn += nb[k] * nb[k]; }
  if (!(snn > 0)) return null;
  const betaRaw = Math.max(0, Math.min(3, sin_ / snn)), b = Math.max(0, Math.min(3, beta ?? betaRaw));
  const clean = new Float32Array(ir.length); for (let k = 0; k < ir.length; k++) clean[k] = ir[k] - b * (red[k] - rho * ir[k]);
  return { clean, betaRaw, rho };
}

// Window quality 0–1: realised beat SNR × (1 − rejected-beat fraction) × HR plausibility × beat count
function windowSqi(st, hr) {
  const snrQ = clamp((st.snrDb - SQI_SNR_LO_DB) / (SQI_SNR_HI_DB - SQI_SNR_LO_DB), 0, 1);
  const tot = st.nUsed + st.nRej, rejQ = tot > 0 ? 1 - st.nRej / tot : 0, hrQ = hr >= 30 && hr <= 200 ? 1 : 0, nQ = Math.min(1, st.nUsed / 3);
  return snrQ * rejQ * hrQ * nQ;
}
// Beat-synchronous preprocessing shared by the array and the PPG paths
function beatTrain(x, fs) {
  const m0 = highpass(x, Math.round(0.8 * fs)); const peaks0 = detectPeaks(m0, fs); if (peaks0.length < 2) return null;
  const hr0 = robustHr(peaks0, fs); if (hr0 == null) return null;
  const hpWin = baselineWin(hr0, fs), hp = highpass(x, hpWin); const peaks = detectPeaks(hp, fs); if (peaks.length < 2) return null;
  const hr = robustHr(peaks, fs); if (hr == null) return null;
  const rr = 60 / Math.max(30, hr);
  return { hr, peaks, pre: Math.round(Math.min(0.35, 0.45 * rr) * fs), post: Math.round(Math.min(0.55, 0.7 * rr) * fs), hpWin, hp };
}
// Sub-sample instant (samples) of the maximum upstroke slope within [i0, i1] of an ensemble beat.
function maxSlopeTime(x, fs, i0, i1) {
  const n = x.length, s = lowpass(x, fs);
  let best = -Infinity, bi = -1;
  const lo = Math.max(1, i0), hi = Math.min(n - 2, i1);
  const d = (i) => s[i + 1] - s[i - 1];
  for (let i = lo; i <= hi; i++) { const v = d(i); if (v > best) { best = v; bi = i; } }
  if (bi < 1) return null;
  if (bi + 2 > n - 1) return bi;
  return bi + parabolicOffset(d(bi - 1), d(bi), d(bi + 1));
}

// ---- delay estimators shared by the row/cluster cues and the per-beat PTT fiducials (features.rs
// `taylor_delay_window_ms` / `xcorr_taylor_delay_ms`). Module level so the multi-fiducial PTT bank below and
// `computeFeatures` use ONE implementation. ----
function rmBaseAt(x, lo, nb) { lo = Math.max(0, Math.min(x.length - 1, lo)); const hi = Math.min(x.length, lo + Math.max(1, nb)); let mm = 0; for (let i = lo; i < hi; i++) mm += x[i]; mm /= (hi - lo); const o = new Float32Array(x.length); for (let i = 0; i < x.length; i++) o[i] = x[i] - mm; return o; }
function ptpWin(x, lo, hi) { let mn = Infinity, mx = -Infinity; for (let i = Math.max(0, lo); i < Math.min(x.length, hi); i++) { if (x[i] < mn) mn = x[i]; if (x[i] > mx) mx = x[i]; } return mx - mn; }
// First-order (Taylor) delay of ye relative to xe over [i0, i1): d(t) = (y − x) ≈ −τ·x'(t) + a + b·t.
function taylorDelayWindowMs(xe, ye, fs, i0 = 1, i1 = null) {
  const hiW = i1 == null ? xe.length - 1 : i1, nb = Math.round(0.008 * fs);
  const sp = rmBaseAt(lowpass(xe, fs), i0, nb), sd = rmBaseAt(lowpass(ye, fs), i0, nb);
  const gp = ptpWin(sp, i0, hiW) || std(sp) || 1, gd = ptpWin(sd, i0, hiW) || std(sd) || 1, scale = gp / gd, mp = mean(sp), md = mean(sd);
  const lo = Math.max(1, i0), hi = Math.min(sp.length - 1, i1 == null ? sp.length - 1 : i1);
  if (hi <= lo + 3) return null;
  const G = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], H = [0, 0, 0];
  for (let i = lo; i < hi; i++) { const dx = (sp[i + 1] - sp[i - 1]) * fs / 2, d = (sd[i] - md) * scale - (sp[i] - mp), tt = (i - lo) / fs; const r = [dx, 1, tt]; for (let a = 0; a < 3; a++) { H[a] += r[a] * d; for (let b = 0; b < 3; b++) G[a][b] += r[a] * r[b]; } }
  const th = solveSmall(G, H); if (!th) return null;
  return -th[0] * 1000;
}
function shiftIntBy(x, d) { const n = x.length, o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = x[Math.max(0, Math.min(n - 1, i - d))]; return o; }
// Delay of `b` relative to `a` when they may be MANY samples apart: coarse integer cross-correlation over the
// upstroke window, then the Taylor refinement on the coarse-aligned pair.
function xcorrTaylorDelayMs(a, b, fs, i0, i1, maxMs) {
  const n = Math.min(a.length, b.length), lo = Math.min(i0, n), hi = Math.min(i1, n);
  if (n < 8 || hi <= lo + 3) return null;
  const maxLag = Math.max(1, Math.round((maxMs / 1000) * fs));
  let bestLag = 0, bestC = -Infinity;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let sa = 0, sb = 0, m = 0;
    for (let i = lo; i < hi; i++) { const j = i + lag; if (j < 0 || j >= n) continue; sa += a[i]; sb += b[j]; m++; }
    if (m * 4 < (hi - lo) * 3) continue;
    const ma = sa / m, mb = sb / m; let ab = 0, aa = 0, bb = 0;
    for (let i = lo; i < hi; i++) { const j = i + lag; if (j < 0 || j >= n) continue; const da = a[i] - ma, db = b[j] - mb; ab += da * db; aa += da * da; bb += db * db; }
    const c = aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : -Infinity;
    if (c > bestC) { bestC = c; bestLag = lag; }
  }
  if (!isFinite(bestC)) return null;
  const fine = taylorDelayWindowMs(a, shiftIntBy(b, -bestLag), fs, lo, hi);
  if (fine == null) return null;
  const tau = (bestLag / fs) * 1000 + fine;
  return Math.abs(tau) > maxMs ? null : tau;
}

// ---- ROADMAP §2.2-10 / docs/CLINICAL_AUDIT.md §6.19: multi-fiducial wrist→finger PTT ----
// Mirror of rust/dt-core/src/features.rs (`PttFiducial`, `upstroke`, `fiducial_ptt_ms`, `ptt_multi_fiducial`).
// EVALUATION SWITCH, not a product mode: `legacy` is bit-identical to the pre-2026-08-25 ensemble max-slope
// path (one number per window, no realised variance) and is the shipped default; every other variant works
// PER BEAT and therefore also reports the beat-to-beat spread that makes the inverse-variance combination
// possible. See features.rs for the full rationale (why the combination is referred to the max-slope frame by
// the ENSEMBLE offsets, and why the combined SE is measured rather than taken as 1/√Σw).
export const PTT_FIDUCIALS = ['legacy', 'maxslope', 'tangent', 'deriv2', 'taylor', 'combo'];
export const PTT_FIDUCIAL_DEFAULT = 'legacy';
const N_FID = 4, FID_MAX_SLOPE = 0, FID_TANGENT = 1, FID_DERIV2 = 2, FID_TAYLOR = 3;
const FID_WANT = {
  legacy: [false, false, false, false], maxslope: [true, false, false, false], tangent: [false, true, false, false],
  deriv2: [false, false, true, false], taylor: [false, false, false, true], combo: [true, true, true, true],
};
const PTT_UPSTROKE_PRE_S = 0.30, PTT_UPSTROKE_POST_S = 0.04, PTT_BEAT_SMOOTH_S = 0.012, PTT_D2_SMOOTH_S = 0.020;
const PTT_MIN_UPSTROKE_S = 0.030, PTT_PROM_MARGIN = 0.06, PTT_PROM_GUARD_S = 0.020;
const PTT_BEAT_MIN_MS = -30, PTT_BEAT_MAX_MS = 150, PTT_TAYLOR_MAX_MS = 25, PTT_ADMIT_FRAC = 0.75;
// beat accumulation of the PTT cue (estimator.rs PTT_MIN_BEATS / PTT_MEDIAN_MAX_S)
export const PTT_MIN_BEATS = 10, PTT_MEDIAN_MAX_S = 12;

// (median, 1.4826·MAD); 2–3 values → half-range, 1 value → unknown spread (NaN)
function medMad(v) {
  const s = v.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return [NaN, NaN];
  const m = s.length % 2 ? s[s.length >> 1] : 0.5 * (s[s.length / 2 - 1] + s[s.length / 2]);
  if (s.length < 2) return [m, NaN];
  if (s.length < 4) return [m, 0.5 * (s[s.length - 1] - s[0])];
  const d = s.map((x) => Math.abs(x - m)).sort((a, b) => a - b);
  return [m, 1.4826 * d[d.length >> 1]];
}
// Sub-sample argmax of f over [lo, hi] with a prominence test against the best value further than `guard`
// away; null when the maximum sits on the window edge, is non-positive, or the peak is flat/ambiguous.
function peakWithProminence(f, lo, hi, guard, margin) {
  if (hi <= lo + 1) return null;
  let bi = lo, best = -Infinity;
  for (let i = lo; i <= hi; i++) { const v = f(i); if (v > best) { best = v; bi = i; } }
  if (bi === lo || bi === hi || !(best > 0)) return null;
  let second = -Infinity;
  for (let i = lo; i <= hi; i++) if (i + guard < bi || i > bi + guard) { const v = f(i); if (v > second) second = v; }
  if (Number.isFinite(second) && second > 0 && best < second * (1 + margin)) return null;
  return bi + clamp(parabolicOffset(f(bi - 1), f(bi), f(bi + 1)), -1, 1);
}
// One beat's upstroke around `anchor`: the raw window (for the Taylor fiducial) and the sub-sample instants of
// the three single-signal fiducials RELATIVE TO THE ANCHOR (samples; NaN = rejected).
function upstrokeOf(x, anchor, fs, rr_s, want) {
  const pre = Math.round(Math.min(PTT_UPSTROKE_PRE_S, 0.40 * rr_s) * fs), post = Math.round(PTT_UPSTROKE_POST_S * fs);
  if (anchor < pre + 2 || anchor + post + 2 >= x.length) return null;
  const raw = x.slice(anchor - pre, anchor + post + 1), n = raw.length;
  const s = lowpass(raw, fs, PTT_BEAT_SMOOTH_S);
  let pk = 0, pv = -Infinity; for (let i = 0; i < n; i++) if (s[i] > pv) { pv = s[i]; pk = i; }
  let foot = 0, fv = Infinity; for (let i = 0; i <= pk; i++) if (s[i] < fv) { fv = s[i]; foot = i; }
  const amp = pv - fv, minUp = Math.round(PTT_MIN_UPSTROKE_S * fs);
  if (!(amp > 0) || pk < foot + minUp || pk + 2 >= n) return null;
  const t = [NaN, NaN, NaN], guard = Math.round(PTT_PROM_GUARD_S * fs);
  const lo = Math.max(1, foot), hi = Math.min(n - 2, pk), d = (i) => s[i + 1] - s[i - 1];
  // (a) maximum of the first derivative (the legacy fiducial, on ONE beat)
  const tm = peakWithProminence(d, lo, hi, guard, PTT_PROM_MARGIN);
  if (want[FID_MAX_SLOPE]) t[FID_MAX_SLOPE] = tm == null ? NaN : tm - pre;
  // (b) intersecting-tangents foot: tangent at the max-slope point × the foot baseline. Sits at the START of
  // the upstroke, so no reflected wave can reach it at any PWV.
  if (want[FID_TANGENT] && tm != null) {
    const i0 = Math.min(Math.max(1, Math.floor(tm)), Math.max(0, n - 3)), fr = clamp(tm - i0, 0, 1);
    const y = s[i0] * (1 - fr) + s[i0 + 1] * fr, slope = 0.5 * (d(i0) * (1 - fr) + d(i0 + 1) * fr);
    if (slope > 0) { const tt = tm - (y - fv) / slope; if (tt >= foot - 0.05 * fs && tt <= tm) t[FID_TANGENT] = tt - pre; }
  }
  // (c) maximum of the SECOND derivative of the EARLY upstroke (SDPPG a-wave-like), searched only between the
  // foot and the max-slope point — strictly before the systolic peak.
  if (want[FID_DERIV2]) {
    const s2 = lowpass(raw, fs, PTT_D2_SMOOTH_S), dd = (i) => s2[i + 1] - 2 * s2[i] + s2[i - 1];
    const hi2 = tm == null ? hi : Math.min(Math.floor(tm), hi);
    const tt = peakWithProminence(dd, lo, hi2, guard, PTT_PROM_MARGIN);
    if (tt != null) t[FID_DERIV2] = tt - pre;
  }
  return { raw, t, foot, pk };
}
// The four fiducial PTTs (ms) of one beat pair / of the two ensembles.
function fiducialPttMs(xa, aa, xp, ap, fs, rr_s, baseMs, want) {
  const out = [NaN, NaN, NaN, NaN];
  const ua = upstrokeOf(xa, aa, fs, rr_s, want), up = upstrokeOf(xp, ap, fs, rr_s, want);
  if (!ua || !up) return out;
  for (let k = 0; k < 3; k++) if (want[k] && Number.isFinite(ua.t[k]) && Number.isFinite(up.t[k])) out[k] = baseMs + ((up.t[k] - ua.t[k]) / fs) * 1000;
  // (d) joint-LS Taylor delay of the two ANCHOR-ALIGNED upstroke windows (coarse xcorr + sub-sample Taylor)
  if (want[FID_TAYLOR]) {
    const n = Math.min(ua.raw.length, up.raw.length);
    const i0 = Math.max(1, Math.min(ua.foot, up.foot)), i1 = Math.min(Math.max(ua.pk, up.pk) + 1, Math.max(0, n - 2));
    if (i1 > i0 + 3) {
      const tau = xcorrTaylorDelayMs(ua.raw.subarray(0, n), up.raw.subarray(0, n), fs, i0, i1, PTT_TAYLOR_MAX_MS);
      if (tau != null) out[FID_TAYLOR] = baseMs + tau;
    }
  }
  return out;
}
// Matched beat pairs (array peak, PPG peak) + the median peak-to-peak lag (samples).
function matchedBeats(arrPeaks, ppgPeaks, fs) {
  const lo = -Math.floor(0.06 * fs), hi = Math.floor(0.15 * fs), pairs = [], lags = [];
  for (const pa of arrPeaks) {
    let best = null, bestP = 0;
    for (const pp of ppgPeaks) { const d = pp - pa; if (d >= lo && d <= hi && (best == null || Math.abs(d) < Math.abs(best))) { best = d; bestP = pp; } }
    if (best != null) { lags.push(best); pairs.push([pa, bestP]); }
  }
  if (lags.length < 2) return null;
  lags.sort((a, b) => a - b);
  return [pairs, lags[lags.length >> 1]];
}
// Multi-fiducial, beat-resolved wrist→finger PTT of one window (mirror of features.rs `ptt_multi_fiducial`).
function pttMultiFiducial(arr, ppg, fs, mode, quantS) {
  const want = FID_WANT[mode] || FID_WANT.legacy;
  if (!want.some((w) => w)) return null;
  const mb = matchedBeats(arr.bt.peaks, ppg.bt.peaks, fs);
  if (!mb) return null;
  const [pairs, lag] = mb, rr_s = 60 / Math.max(30, arr.bt.hr);
  const e = fiducialPttMs(arr.ens, arr.bt.pre, ppg.pens, ppg.pk, fs, rr_s, (lag / fs) * 1000, want);
  const v = [[], [], [], []];
  for (const [pa, pp] of pairs) {
    const f = fiducialPttMs(arr.bt.hp, pa, ppg.bt.hp, pp, fs, rr_s, ((pp - pa) / fs) * 1000, want);
    for (let k = 0; k < N_FID; k++) v[k].push(Number.isFinite(f[k]) && f[k] >= PTT_BEAT_MIN_MS && f[k] <= PTT_BEAT_MAX_MS ? f[k] : NaN);
  }
  const nPairs = pairs.length, floorMs = (quantS / Math.sqrt(12)) * 1000;
  // "usable" beats = those where at least one fiducial succeeded (edge beats have no upstroke window in one
  // of the two signals and must not count against every method's admission) — mirror of features.rs
  let nUsable = 0;
  for (let i = 0; i < nPairs; i++) if (v.some((vk) => Number.isFinite(vk[i]))) nUsable++;
  const perMethod = [NaN, NaN, NaN, NaN], perSe = [NaN, NaN, NaN, NaN], sigma = [NaN, NaN, NaN, NaN], nOk = [0, 0, 0, 0];
  for (let k = 0; k < N_FID; k++) {
    if (!want[k]) continue;
    const vals = v[k].filter((x) => Number.isFinite(x));
    nOk[k] = vals.length;
    if (!vals.length) continue;
    const [m, mad] = medMad(vals), s = Number.isFinite(mad) ? Math.max(mad, floorMs) : Math.max(floorMs, 1e-6);
    perMethod[k] = m; sigma[k] = s; perSe[k] = s / Math.sqrt(vals.length);
  }
  const admitN = Math.ceil(PTT_ADMIT_FRAC * nUsable);
  if (mode !== 'combo') {
    const k = want.findIndex((w) => w);
    if (k < 0 || !Number.isFinite(perMethod[k]) || nOk[k] < 2) return null;
    return { pttMs: Math.max(0, perMethod[k]), seMs: perSe[k], n: nOk[k] };
  }
  // inverse-variance combination in the WEIGHTED-MEAN ENSEMBLE frame Ē = Σ w_k·E_k / Σ w_k (features.rs
  // explains why one method's frame is the wrong choice — it re-injects that fiducial's ensemble noise).
  const w = [0, 0, 0, 0];
  for (let k = 0; k < N_FID; k++) if (Number.isFinite(perMethod[k]) && Number.isFinite(e[k]) && sigma[k] > 0 && nOk[k] >= Math.max(admitN, 2)) w[k] = 1 / (sigma[k] * sigma[k]);
  if (w.every((x) => x === 0)) return null;
  let sew = 0, sww = 0;
  for (let k = 0; k < N_FID; k++) if (w[k] > 0) { sew += w[k] * e[k]; sww += w[k]; }
  const eBar = sew / sww;
  const comb = [];
  for (let i = 0; i < nPairs; i++) {
    let sw = 0, sv = 0;
    for (let k = 0; k < N_FID; k++) if (w[k] > 0 && Number.isFinite(v[k][i])) { sw += w[k]; sv += w[k] * (v[k][i] - (e[k] - eBar)); }
    if (sw > 0) comb.push(sv / sw);
  }
  if (comb.length < 2) return null;
  const [m, mad] = medMad(comb), s = Number.isFinite(mad) ? Math.max(mad, floorMs) : Math.max(floorMs, 1e-6);
  return { pttMs: Math.max(0, m), seMs: s / Math.sqrt(comb.length), n: comb.length };
}

export class BpEstimator {
  constructor() {
    this.cal = null;
    this.est = null; this.estCap = null; this.estPpg = null; // smoothed estimates
    this.alpha = 0.08; // output EMA override hook (default → time-based, OUT_TAU_S)
    this.pwvWeight = 0.6; // measurability prior of the local-PWV MAP cue (the host may lower it)
    this.arrayInvalid = false; // set by the core from the attachment monitor: sheet shifted / detached → hold array-anchored estimates (conf × 0.1, recalRequired)
    this.contactWarn = false; // set by the core from the attachment monitor: contact-pressure change flagged → array-anchored confidence × CONTACT_CONF (no hold)
    this.lastFeatures = null;
    this.fs = null; this._hist = []; this._lastRaw = null;
    this._ppgBetaHist = [];
    // RI-cue gate EVALUATION SWITCH (not a product mode) — survives reset(), set by AnalysisCore.configure
    this.riGateMode = RI_GATE_MODE_DEFAULT;
    // EVALUATION SWITCH (§6.17): cross-modality fault detectors off/on. Survives reset(), set by AnalysisCore.configure.
    this.xmodEnabled = true;
    // EVALUATION SWITCH (§6.24): bitmask of the PPG-internal optics layer. Survives reset(), set by
    // AnalysisCore.configure. 0 = the 6th-pass build, bit-identically.
    this.ppgOpt = PPG_OPT_DEFAULT;
    // EVALUATION SWITCH (ROADMAP §2.2-10 / §6.19): wrist→finger PTT fiducial and the PTT beat-accumulation
    // span. Both survive reset(); `AnalysisCore.configure` sets them. 'legacy' + accum off = the shipped
    // default, bit-identical to the pre-2026-08-25 path.
    this.pttFiducial = PTT_FIDUCIAL_DEFAULT;
    this.pttAccum = false;
    this.reset();
  }
  reset() {
    this.arrayInvalid = false; this.contactWarn = false;
    this.fs = null; this._hist = []; this._lastRaw = null; this.est = null; this.estCap = null; this.estPpg = null;
    this.sigmaPwv_mmHg = null; this.sigmaRefl_mmHg = null; this.sigmaPpgRefl_mmHg = null;
    this.cadence_s = DEFAULT_CADENCE_S; this._lastT = null; this._dtHist = [];
    this.sigLn = {}; this.spanArr = this.win(MEDIAN_S); this.spanPpg = this.win(MEDIAN_S); this.spanRi = this.win(RI_MEDIAN_S); this.spanPpgRi = this.win(RI_MEDIAN_S); this.spanPtt = this.win(MEDIAN_S);
    this._sigHist = []; this.holdArr = 0; this.holdPpg = 0; this.qWinArr = 0; this.qWinPpg = 0;
    this.seg = new Array(BpEstimator.NF).fill(0); // windows since the last detected change-point of each slot (current SEGMENT)
    this._xmodReset();
  }
  // 6th pass: clear the cross-modality residual state (also at every calibrate — the residuals are defined
  // relative to the calibration baselines). Mirror of rust `xmod_reset`.
  _xmodReset() {
    this.xmodGammaZ = NaN; this.xmodReflZ = NaN; this.xmodPiZ = NaN; this.xmodRiZ = NaN; this.dcRelZ = NaN; this._lastCovCap = null; this._lastCovPpg = null;
    this._dwell = [0, 0, 0, 0]; this._clear = [0, 0, 0, 0]; // index 3 = the 7th-pass PPG-internal channel
    this.couplingFault = false; this.opticsFault = false; this.riLawFault = false;
    this.ppgPiZ = NaN; this.ppgStillZ = NaN; this.ppgPerfSigma = 1; this.opticsUnverified = false;
  }

  // 7th pass (§6.24, piece 3) — [물리 유도] perfusion σ-gain of the AC/DC cue. With the front-end noise referred
  // to the detector input the RELATIVE error of a pulsatile-amplitude measurement scales as noise / AC = 1/PI,
  // so a perfusion index below its calibration value inflates the row's log-σ by (AC/DC)0 / (AC/DC). One-sided
  // (`max(1, ·)`): a perfusion RISE does not make the row better than its realised dispersion says. This moves
  // the cue's WEIGHT only, never its value — the one non-circular use of PI (PI ≡ AC/DC on this twin).
  // Mirror of rust `perf_sigma_gain`.
  _perfSigmaGain() {
    if (!(this.ppgOpt & PPG_OPT_PI_SIGMA)) return 1;
    const p = this.fs ? this.fs.ppgAcDc : null, p0 = this.cal ? this.cal.ppg0 : null;
    if (!(p > 0) || !(p0 > 0)) return 1;
    return Math.min(PPG_PERF_SIGMA_MAX, Math.max(1, p0 / p));
  }
  // The smoothed AC/DC sits below the absolute perfusion floor → the amplitude row carries nothing and is
  // dropped. Instantaneous (not latched). Mirror of rust `ppg_perf_low`.
  _ppgPerfLow() {
    if (!(this.ppgOpt & PPG_OPT_PI_FLOOR) || !this.fs) return false;
    const p = this.fs.ppgAcDc;
    return p != null && isFinite(p) && p < PPG_PI_FLOOR;
  }
  win(seconds) { return Math.max(1, Math.round(seconds / Math.max(1e-3, this.cadence_s))); }
  _winCorr() { return Math.max(1, WIN_CORR_S / Math.max(1e-3, this.cadence_s)); }
  // Part of ln(A/A0) the array estimator's own state explains: −2·ln(M/M0) (D ∝ 1/M², M0 = g0 at calibration) from the
  // last array-only estimate; null before calibration / without an estimate (mirror of rust `amp_explained_ln`)
  ampExplainedLn() { const C = this.cal, e = this.estCap; if (!C || !e || !(e.m > 0)) return null; const g0 = 1 + PWV_PER_MMHG * (C.map0 - MAP_REF_MMHG); return g0 > 0 ? -2 * Math.log(e.m / g0) : null; }
  _outAlpha() { return Math.abs(this.alpha - 0.08) > 1e-9 ? this.alpha : 1 - Math.exp(-this.cadence_s / OUT_TAU_S); }

  // Tracked PPG motion-coupling gain (median of the recent per-window estimates from FULL windows; null until ≥ 3).
  _ppgBeta() { return this._ppgBetaHist.length >= 3 ? medianOf(this._ppgBetaHist) : null; }

  // All arrays sampled at `fs` Hz over the same time window. `ppgRed` (optional) enables the two-wavelength motion
  // cancellation of the PPG; `t` (s) = host time of the window end (measures the analysis cadence); `learnNotch`
  // runs the notch-learning fit (the core sets it every few windows).
  // `arrayOk = false` (attachment monitor: transient / detached window): the window is ingested with its array SQI forced to 0 —
  // the array cues are dropped like a low-quality window, the PPG cues are kept (mirror of rust `ingest_at_gated`).
  computeFeatures({ mrc, ppgIr, ppgRed = null, rowProx, rowDist, rowDist_m, rowSignals = null, chanSignals = null, clusterSignals = null, clusterDist_m = null, fs, capFs = 0, t = NaN, learnNotch = true, arrayOk = true }) {
    if (!mrc || mrc.length < fs * 1.5) return null;
    const notchRel = this.cal ? this.cal.notchRel0 : null, ppgNotchRel = this.cal ? this.cal.ppgNotchRel0 : null;
    // ---- array part ----
    let arr = null;
    const bt = beatTrain(mrc, fs);
    if (bt) {
      const rr = 60 / Math.max(30, bt.hr);
      const es = ensembleWeightedStats(bt.hp, bt.peaks, bt.pre, bt.post);
      if (es) { const morph = morphology(es[0], bt.pre, fs, rr, notchRel, learnNotch); if (morph) arr = { bt, ens: es[0], st: es[1], ...morph, sqi: windowSqi(es[1], bt.hr) }; }
    }
    // ---- PPG part (own beat detection / anchors / HR) ----
    let ppg = null;
    if (ppgIr && ppgIr.length >= mrc.length) {
      const dc = mean(ppgIr), dcRed = ppgRed && ppgRed.length ? mean(ppgRed) : 0; let pbt = beatTrain(ppgIr, fs);
      if (pbt) {
        let betaRaw = null, rho = null;
        if (ppgRed && ppgRed.length >= ppgIr.length) {
          // two passes: β/ρ with the raw-IR anchors → provisional clean → re-detect → β/ρ with the clean anchors
          const redHp = highpass(ppgRed, pbt.hpWin); let anchors = pbt.peaks, out = null;
          for (let pass = 0; pass < 2; pass++) { const c = twoWavelengthClean(pbt.hp, redHp, anchors, pbt.pre, pbt.post, fs, this._ppgBeta()); if (!c) break; const peaks = detectPeaks(c.clean, fs); if (peaks.length >= 2) anchors = peaks; out = c; }
          if (out) { betaRaw = out.betaRaw; rho = out.rho; const hr = robustHr(anchors, fs); if (hr != null) { pbt.hr = hr; pbt.peaks = anchors; } pbt.hp = out.clean; }
        }
        const rr = 60 / Math.max(30, pbt.hr);
        const es = ensembleWeightedStats(pbt.hp, pbt.peaks, pbt.pre, pbt.post);
        if (es) {
          const pens = es[0], psl = lowpass(pens, fs, 0.006);
          let plo = Infinity, phi = -Infinity; for (const v of psl) { if (v < plo) plo = v; if (v > phi) phi = v; }
          let pk = pbt.pre, pv = -Infinity; const pEnd = Math.min(pens.length - 1, pbt.pre + Math.round(0.08 * fs));
          for (let i = Math.max(0, pbt.pre - Math.round(0.05 * fs)); i <= pEnd; i++) if (psl[i] > pv) { pv = psl[i]; pk = i; }
          const pm = morphology(pens, pk, fs, rr, ppgNotchRel, learnNotch);
          ppg = { bt: pbt, pens, pk, ac: phi - plo, dc, dcRed, ri: pm ? pm.ri : null, tRefl_ms: pm ? pm.tRefl_ms : null, notchRi: pm ? pm.notchRi : null, fit: pm ? pm.fit : false, betaRaw, rho, st: es[1], sqi: windowSqi(es[1], pbt.hr) };
        }
      }
    }
    if (!arr && !ppg) return null;
    if (ppg && ppg.betaRaw != null && isFinite(ppg.betaRaw) && ppg.st.nUsed >= 4) { this._ppgBetaHist.push(ppg.betaRaw); if (this._ppgBetaHist.length > PPG_BETA_N) this._ppgBetaHist.shift(); }
    const w8 = Math.round(0.008 * fs);
    // wrist→finger PTT. LEGACY (default): matched beats (nearest PPG peak within [−60, +150] ms) refined by the
    // own-anchored ENSEMBLE upstroke instants — one number, no realised variance. Otherwise (ROADMAP §2.2-10,
    // audit §6.19) the per-beat multi-fiducial bank, which also reports its realised standard error and the
    // beats behind it.
    let pttWF_ms = null, pttWFSd_ms = null, pttWFNBeats = 0;
    if (arr && ppg) {
      if (this.pttFiducial === 'legacy') {
        const lo = -Math.floor(0.06 * fs), hi = Math.floor(0.15 * fs), lags = [];
        for (const pa of arr.bt.peaks) { let best = null; for (const pp of ppg.bt.peaks) { const d = pp - pa; if (d >= lo && d <= hi && (best == null || Math.abs(d) < Math.abs(best))) best = d; } if (best != null) lags.push(best); }
        if (lags.length >= 2) {
          const lag = medianOf(lags), tCap = maxSlopeTime(arr.ens, fs, arr.foot, arr.bt.pre), tPpg = maxSlopeTime(ppg.pens, fs, Math.max(0, ppg.pk - Math.round(0.35 * fs)), ppg.pk);
          if (tCap != null && tPpg != null) pttWF_ms = Math.max(0, (lag + (tPpg - ppg.bt.pre) - (tCap - arr.bt.pre)) / fs * 1000);
        }
      } else {
        // quantisation floor of the SE: the array arrives zero-order-held at the capacitance front-end rate
        const cfs = Number.isFinite(capFs) && capFs > 0 ? capFs : fs;
        const m = pttMultiFiducial(arr, ppg, fs, this.pttFiducial, 1 / Math.max(1, Math.min(cfs, fs)));
        if (m) { pttWF_ms = m.pttMs; pttWFSd_ms = m.seMs; pttWFNBeats = m.n; }
      }
    }
    // Local PTT / row delays / per-electrode Δt map (array part only)
    const taylorDelay_ms = (xe, ye, i0 = 1, i1 = null) => taylorDelayWindowMs(xe, ye, fs, i0, i1);
    // ⑤ delay of `b` relative to `a` when they can be MANY samples apart (cluster-to-cluster on a
    // long-baseline patch): coarse integer cross-correlation over the upstroke window, then the Taylor
    // refinement above on the coarse-aligned pair. Mirror of features.rs `xcorr_taylor_delay_ms`.
    const xcorrTaylorDelay_ms = (a, b, i0, i1, maxMs) => xcorrTaylorDelayMs(a, b, fs, i0, i1, maxMs);
    let pttLocal_ms = null, pwvLocal = null, rowDelays_ms = null, chanDelays_ms = null, interClusterDt_ms = null, interClusterPwv = null;
    if (arr) {
      const { peaks, pre, post, hpWin } = arr.bt, foot = arr.foot;
      if (rowProx && rowDist && rowDist_m > 0) {
        const ep = ensemble(highpass(rowProx, hpWin), peaks, pre, post), ed = ensemble(highpass(rowDist, hpWin), peaks, pre, post);
        if (ep && ed) {
          pttLocal_ms = taylorDelay_ms(ep, ed, Math.max(0, foot - w8), pre + w8);
          if (pttLocal_ms != null && pttLocal_ms > 0.05) { const v = rowDist_m / (pttLocal_ms / 1000); if (v >= 3 && v <= 25) pwvLocal = v; }
        }
      }
      if (rowSignals && rowSignals.length >= 2) {
        const e0 = ensemble(highpass(rowSignals[0], hpWin), peaks, pre, post);
        if (e0) { rowDelays_ms = [0]; for (let r = 1; r < rowSignals.length; r++) { const er = ensemble(highpass(rowSignals[r], hpWin), peaks, pre, post); rowDelays_ms.push(er ? taylorDelay_ms(e0, er, Math.max(0, foot - w8), pre + w8) : null); } }
      }
      if (chanSignals && chanSignals.length && rowSignals && rowSignals.length) {
        const e0 = ensemble(highpass(rowSignals[0], hpWin), peaks, pre, post);
        if (e0) { chanDelays_ms = new Array(chanSignals.length).fill(null); for (let k = 0; k < chanSignals.length; k++) { const ek = ensemble(highpass(chanSignals[k], hpWin), peaks, pre, post); if (ek && std(ek) > 1e-4) chanDelays_ms[k] = taylorDelay_ms(e0, ek, Math.max(0, foot - w8), pre + w8); } }
      }
      // ⑤ cluster-to-cluster delay on the CLUSTER BEAMS (no ±6 ms clamp; 3–25 m/s plausibility gate)
      if (clusterSignals && clusterSignals.length >= 2 && clusterDist_m && clusterDist_m.length === clusterSignals.length) {
        const e0 = ensemble(highpass(clusterSignals[0], hpWin), peaks, pre, post);
        if (e0) {
          interClusterDt_ms = [0];
          for (let c = 1; c < clusterSignals.length; c++) {
            const ec = ensemble(highpass(clusterSignals[c], hpWin), peaks, pre, post);
            let d = ec ? xcorrTaylorDelay_ms(e0, ec, Math.max(0, foot - w8), pre + w8, INTER_CLUSTER_MAX_MS) : null;
            if (d != null) { const dm = Math.abs(clusterDist_m[c]); const v = dm > 0 && d > 0.05 ? dm / (d / 1000) : NaN; if (!(v >= 3 && v <= 25)) d = null; }
            interClusterDt_ms.push(d);
          }
          const last = interClusterDt_ms[interClusterDt_ms.length - 1];
          if (last != null) interClusterPwv = Math.abs(clusterDist_m[clusterDist_m.length - 1]) / (last / 1000);
        }
      }
    }
    // PRECEDENCE (docs/CLINICAL_AUDIT.md §6.10): ≥ 2 clusters with a plausible cluster-to-cluster delay
    // ⇒ the local-PWV cue is the CLUSTER baseline; otherwise the intra-cluster row-beam value stands.
    const rowPttLocal_ms = pttLocal_ms, rowPwvLocal = pwvLocal;
    if (interClusterPwv != null) { pttLocal_ms = interClusterDt_ms[interClusterDt_ms.length - 1]; pwvLocal = interClusterPwv; }
    const ppgAc = ppg ? ppg.ac : 0, ppgDc = ppg ? ppg.dc : 1, ppgDcRed = ppg ? ppg.dcRed : 0;
    const f = {
      hr: arr ? arr.bt.hr : (ppg ? ppg.bt.hr : 0), amp: arr ? arr.amp : 0, ri: arr ? arr.ri : 0, tRefl_ms: arr ? arr.tRefl_ms : 0,
      ppgAc, ppgDc, ppgDcRed, ppgAcDc: ppgDc ? ppgAc / ppgDc : 0, ppgRi: ppg ? ppg.ri : null, ppgTRefl_ms: ppg ? ppg.tRefl_ms : null, pttWF_ms, pttWFSd_ms, pttWFNBeats, pttLocal_ms, pwvLocal, rowDelays_ms, chanDelays_ms, interClusterDt_ms, interClusterPwv, rowPttLocal_ms, rowPwvLocal,
      nBeats: arr ? arr.bt.peaks.length : 0, notchRi: arr ? arr.notchRi : null, ppgNotchRi: ppg ? ppg.notchRi : null, ppgBetaRaw: ppg ? ppg.betaRaw : null, ppgRho: ppg ? ppg.rho : null,
      ppgHr: ppg ? ppg.bt.hr : null, ppgNBeats: ppg ? ppg.st.nUsed : 0, sqi: arr ? arr.sqi : 0, ppgSqi: ppg ? ppg.sqi : null, ensSnr_db: arr ? arr.st.snrDb : -99, ppgEnsSnr_db: ppg ? ppg.st.snrDb : null,
      nBeatsRej: arr ? arr.st.nRej : 0, morphFit: arr ? arr.fit : false, ppgMorphFit: ppg ? ppg.fit : false,
    };
    this.lastFeatures = f;
    this._smoothFeatures(arrayOk ? f : { ...f, sqi: 0 }, t); // keep the smoothed baseline + history alive BEFORE calibration too
    this._lastRaw = f; // the estimators' calls with the real feature object must not ingest again
    return f;
  }

  // Cue slots (index into the history vectors): 0 amp, 1 ri, 2 tRefl, 3 ppgAcDc, 4 ppgRi, 5 ppgTRefl, 6 pttWF, 7 pttLocal, 8 pwv, 9 hr,
  // 10 notchRi, 11 ppgNotchRi, 12 sqi, 13 ppgSqi, 14 ppgHr
  // 15 ppgDc, 16 ppgDcRed (6th pass): NOT cues — the only PPG observables independent of the AC/DC cue itself
  static get KEYS() { return ['amp', 'ri', 'tRefl_ms', 'ppgAcDc', 'ppgRi', 'ppgTRefl_ms', 'pttWF_ms', 'pttLocal_ms', 'pwvLocal', 'hr', 'notchRi', 'ppgNotchRi', 'sqi', 'ppgSqi', 'ppgHr', 'ppgDc', 'ppgDcRed']; }
  static get NF() { return 17; }
  // Raw feature vector (quality-gated: array cues null when amp ≤ 0 or sqi < Q_GATE; PPG cues likewise; reflection cues
  // only from the model fit AND only with a physiologically plausible fitted centre TREFL_MIN_MS..TREFL_MAX_MS —
  // 5th pass, see estimator.rs `fvec`: a spurious 370–400 ms lock under the measured patch noise used to restart the
  // reflection-timing segment and swing MAP by ±25 mmHg)
  static fvec(f) {
    const fin = (v) => (v != null && isFinite(v) ? v : null), pos = (v) => (v != null && isFinite(v) && v > 0 ? v : null);
    const arrOk = f.amp > 0 && f.sqi >= Q_GATE, ppgOk = f.ppgAcDc > 0 && f.ppgSqi != null && f.ppgSqi >= Q_GATE;
    const reflOk = (t) => t != null && isFinite(t) && t >= TREFL_MIN_MS && t <= TREFL_MAX_MS;
    const aRefl = reflOk(f.tRefl_ms), pRefl = reflOk(f.ppgTRefl_ms);
    const a = (v) => (arrOk ? fin(v) : null), p = (v) => (ppgOk ? fin(v) : null), am = (v) => (arrOk && f.morphFit && aRefl ? fin(v) : null), pm = (v) => (ppgOk && f.ppgMorphFit && pRefl ? fin(v) : null);
    return [a(pos(f.amp)), am(pos(f.ri)), am(f.tRefl_ms), p(pos(f.ppgAcDc)), pm(pos(f.ppgRi)), pm(f.ppgTRefl_ms), arrOk && ppgOk ? fin(f.pttWF_ms) : null, a(f.pttLocal_ms), a(f.pwvLocal), a(pos(f.hr)), a(f.notchRi), p(f.ppgNotchRi),
      f.amp > 0 ? f.sqi : null, f.ppgAcDc > 0 ? f.ppgSqi : null, p(pos(f.ppgHr)),
      // DC levels: kept for EVERY window with a PPG signal (not quality-gated — a DC step is exactly what a
      // low-SQI window may be reporting; the optics test has its own self-scaled threshold)
      pos(f.ppgDc), pos(f.ppgDcRed)];
  }
  static lnCue(k, x) { const v = k === 2 || k === 5 ? x + T_PK_MS : x; return v > 0 && isFinite(v) ? Math.log(v) : null; }
  // ln values of slot k over the last n entries (null where the window had no valid cue)
  _collectLastLn(k, n) { const h = this._hist; const out = []; for (let i = Math.max(0, h.length - n); i < h.length; i++) { const v = h[i][k]; out.push(v != null && isFinite(v) ? BpEstimator.lnCue(k, v) : null); } return out; }
  // robust σ after removing the half-span median trend (≥ 8 values), plain robust σ (≥ 4), else null
  static detrendedSigma(v) {
    const m = v.length; if (m < 4) return null;
    const resid = v.slice();
    if (m >= 8) { const m1 = medianOf(v.slice(0, m >> 1)), m2 = medianOf(v.slice(m >> 1)), half = m / 2, d = m2 - m1; for (let i = 0; i < m; i++) resid[i] -= d * (i - half) / half; }
    const ms = medianSigma(resid); return ms ? ms[1] : null;
  }
  // Change-point test of one slot (mirror of estimator.rs `step_stat`): short window = last sN entries vs the rest of the segment;
  // true when |median_short − median_long| > max(STEP_K × σ·√(1/n_s + 1/n_l), STEP_MIN_LN), σ = max(30 s-median dispersion prior,
  // detrended dispersion of the long part); null when the test cannot run
  static stepStat(vals, sN, sigmaPrior, winCorr) {
    const m = vals.length; if (!sN || m < 2 * sN) return null;
    const sv = vals.slice(m - sN).filter((v) => v != null), lv = vals.slice(0, m - sN).filter((v) => v != null);
    if (sv.length < ((sN + 1) >> 1) || lv.length < 4) return null;
    const sigLong = BpEstimator.detrendedSigma(lv);
    const sigma = sigmaPrior != null && sigLong != null ? Math.max(sigmaPrior, sigLong) : sigmaPrior != null ? sigmaPrior : sigLong;
    if (sigma == null) return null;
    const mS = medianOf(sv), mL = medianOf(lv), nS = Math.max(1, sv.length / winCorr), nL = Math.max(1, lv.length / winCorr);
    const sd = sigma * Math.sqrt(1 / nS + 1 / nL);
    return Math.abs(mS - mL) > Math.max(STEP_K * sd, STEP_MIN_LN);
  }
  _collectLast(k, n) { const h = this._hist; const out = []; for (let i = Math.max(0, h.length - n); i < h.length; i++) { const v = h[i][k]; if (v != null && isFinite(v)) out.push(v); } return out; }
  _medianLast(k, n) { return medianOf(this._collectLast(k, n)); }
  // Per-window log-dispersion (robust σ of ln), DETRENDED by the half-span medians (a ramp is not noise)
  _dispLn(k, n) {
    const v = this._collectLast(k, n).map((x) => BpEstimator.lnCue(k, x)).filter((x) => x != null); const m = v.length; if (m < 4) return null;
    const resid = v.slice();
    if (m >= 8) { const m1 = medianOf(v.slice(0, m >> 1)), m2 = medianOf(v.slice(m >> 1)), half = m / 2, d = m2 - m1; for (let i = 0; i < m; i++) resid[i] -= d * (i - half) / half; }
    const ms = medianSigma(resid); return ms ? ms[1] : null;
  }
  // Trend-corrected median of ln(slot k): whole-span LOWER median + ramp extrapolation to the END of the span = the SMALLER (same
  // sign, else 0) of d1 = m2 − m1 and d2 = 2·(m2 − median) — both = slope × half span for a ramp; the minimum rule never overshoots
  // a step (the 3rd-pass d1 alone overshot by up to 100 % of a step 8–12 s after it), gated by its realised noise
  _trendMedian(k, n) {
    const vals = this._collectLast(k, n).map((x) => BpEstimator.lnCue(k, x)).filter((x) => x != null); if (!vals.length) return null;
    const m = vals.length, med = [...vals].sort((a, b) => a - b)[(m - 1) >> 1]; let out = med; // lower median
    if (m >= 8) {
      const m1 = medianOf(vals.slice(0, m >> 1)), m2 = medianOf(vals.slice(m >> 1));
      const d1 = m2 - m1, d2 = 2 * (m2 - med), half = m / 2;
      const d = d1 * d2 <= 0 ? 0 : Math.sign(d1) * Math.min(Math.abs(d1), Math.abs(d2));
      const resid = vals.map((x, i) => x - d1 * (i - half) / half); const ms = medianSigma(resid); const sig = ms ? ms[1] : 0;
      const nEff = Math.max(1, m / this._winCorr()), sd = sig * Math.SQRT2 / Math.sqrt(Math.max(0.5, nEff / 2));
      // gate 1 (noise): none below 1.5 σ_d (or 1.5 %), full from 2.25 σ_d
      const thr = Math.max(1.5 * sd, TREND_MIN_LN), frac = clamp((Math.abs(d) - thr) / (0.5 * thr), 0, 1);
      out += d * frac;
    }
    const v = Math.exp(out); return k === 2 || k === 5 ? v - T_PK_MS : v;
  }

  calibrate(features, refSbp, refDbp) {
    if (!features) return false;
    const pp0 = refSbp - refDbp, map0 = refDbp + pp0 / 3;
    const K = BpEstimator.KEYS;
    const f = {}; const raw = BpEstimator.fvec(features); K.forEach((k, i) => { f[k] = raw[i]; });
    if (this.fs) for (const k of K) if (this.fs[k] != null) f[k] = this.fs[k];
    const calN = this.win(CAL_S), nArr = this._collectLast(2, calN).length, nPpg = this._collectLast(5, calN).length;
    // per slot: the calibration window restricted to the slot's segment, unless the segment is younger than half the window
    const segN = (k) => (this.seg[k] >= (calN >> 1) ? Math.min(calN, this.seg[k]) : calN);
    // every baseline is the PLAIN median of its window (5th pass: the 4th-pass trend-corrected RI baseline sampled the
    // instantaneous phase of the RI's slow wander instead of averaging it — estimator.rs `calibrate`)
    if (this._hist.length >= 4) K.forEach((k, i) => { const m = this._medianLast(i, segN(i)); if (m != null) f[k] = m; });
    // the RI baselines get no √n averaging: their dominant error is a wander longer than the calibration window
    const sigma0 = []; for (let k = 0; k < 9; k++) { const n = this._collectLast(k, segN(k)).length, nEff = k === 1 || k === 4 ? 1 : Math.max(1, n / this._winCorr()); sigma0.push(Math.max(SIGMA_FLOOR_LN, this.sigLn[k] ?? 0.05) / Math.sqrt(nEff)); }
    // reflection-fit quality of the baseline: fraction of the gated windows whose reflection cues came from the model fit
    const fitFrac = (kAll, kFit) => { const nAll = this._collectLast(kAll, calN).length; return nAll ? Math.min(1, this._collectLast(kFit, calN).length / nAll) : 0; };
    if (this.fs) for (const k of K) if (f[k] != null && isFinite(f[k])) this.fs[k] = f[k];
    const plaus = (t) => (t != null && t >= TREFL_MIN_MS && t <= TREFL_MAX_MS ? t : null); // plausible reflection-timing baseline
    // dicrotic-notch depth: the learned median when plausible and consistently learned, else the twin's nominal depth
    const notchPrior = (k, v) => { const ms = medianSigma(this._collectLast(k, calN)); const ok = v != null && isFinite(v) && v >= NOTCH_REL_MIN && v <= NOTCH_REL_MAX && (!ms || ms[1] <= NOTCH_REL_MAX_SIGMA); return ok ? v : NOTCH_REL_DEFAULT; };
    const qArr = Math.min(1, nArr / (calN / 2)) * clamp(f.sqi ?? 0, 0, 1), qPpg = Math.min(1, nPpg / (calN / 2)) * clamp(f.ppgSqi ?? 0, 0, 1);
    const tRefl0 = plaus(f.tRefl_ms), ppgTRefl0 = plaus(f.ppgTRefl_ms);
    // RI baselines only with a plausible timing baseline of the same modality (same fits); null = RI rows unused
    const ri0 = tRefl0 != null && f.ri != null && f.ri > 0 ? f.ri : null;
    const ppgRi0 = ppgTRefl0 != null ? (f.ppgRi != null && f.ppgRi > 0 ? f.ppgRi : ri0) : null;
    this.cal = { sbp0: refSbp, dbp0: refDbp, pp0, map0, amp0: f.amp ?? 0, ppg0: f.ppgAcDc ?? 0, ri0, ptt0: f.pttWF_ms, pwv0: f.pwvLocal, hr0: f.hr ?? 72, ppgHr0: f.ppgHr ?? f.hr ?? 0,
      tRefl0, ppgRi0, ppgTRefl0, rr0: 60 / Math.max(30, f.hr ?? 72), notchRel0: notchPrior(10, f.notchRi), ppgNotchRel0: notchPrior(11, f.ppgNotchRi),
      quality: qArr, ppgQuality: qPpg, reflQuality: tRefl0 != null ? fitFrac(0, 2) : 0, ppgReflQuality: ppgTRefl0 != null ? fitFrac(3, 5) : 0, sigma0Ln: sigma0,
      // 6th pass: PPG DC baselines of the two wavelengths (optical-path test of `opticsFault`)
      ppgDc0: f.ppgDc ?? 0, ppgDcRed0: f.ppgDcRed ?? 0, t: Date.now() };
    this.est = null; this.estCap = null; this.estPpg = null;
    this._xmodReset();
    return true;
  }

  // Running-median smoothing of the raw features (quality-gated history, SNR-adaptive spans, RI trend correction) + cue dispersions.
  _smoothFeatures(f, t = NaN) {
    if (this._lastRaw === f) return this.fs; // idempotent per analysis window (called by several estimators)
    this._lastRaw = f;
    if (isFinite(t)) {
      if (this._lastT != null) { const dt = t - this._lastT; if (dt > 1e-3 && dt < 5) { this._dtHist.push(dt); if (this._dtHist.length > 32) this._dtHist.shift(); const m = medianOf(this._dtHist); if (m != null) this.cadence_s = m; } }
      this._lastT = t;
    }
    const histN = this.win(HIST_S), v = BpEstimator.fvec(f);
    this._hist.push(v); while (this._hist.length > histN) this._hist.shift();
    this.holdArr = v[2] != null ? 0 : this.holdArr + 1; this.holdPpg = v[5] != null ? 0 : this.holdPpg + 1;
    // change-point tests on the current segment of every cue slot (4th pass): timing slots first; the other cues of a modality
    // only accept a change-point when the modality's timing cue had one within the last 4 short windows; no tests before the
    // history holds CAL_S of windows (immature noise estimates)
    const medianN = this.win(MEDIAN_S), adaptN = this.win(ADAPT_HORIZON_S), NF = BpEstimator.NF;
    const sigmaPrior = (k, cur) => { const v = this._sigHist.map((h) => h[k]).filter((x) => x != null); return v.length >= 8 ? medianOf(v) : cur; };
    for (let k = 0; k < NF; k++) this.seg[k] = Math.min(this.seg[k] + 1, this._hist.length);
    const timingOf = (k) => (k === 3 || k === 4 || k === 5 ? 5 : 2);
    const mature = this._hist.length >= this.win(CAL_S);
    for (let pass = 0; pass < 2 && mature; pass++) {
      for (let k = 0; k < 9; k++) {
        const isTiming = k === 2 || k === 5;
        if ((pass === 0) !== isTiming) continue;
        if (!isTiming && this.seg[timingOf(k)] > 4 * medianN) continue;
        if (BpEstimator.stepStat(this._collectLastLn(k, this.seg[k]), medianN, sigmaPrior(k, this.sigLn[k] ?? null), this._winCorr()) === true) this.seg[k] = Math.max(1, (medianN + 1) >> 1);
      }
    }
    // per-window log dispersions over the last DISP_S of each slot's segment; a segment younger than the dispersion window
    // is floored at the 30 s median of the slot's dispersion (few correlated windows can only UNDER-estimate the noise)
    const dispN = this.win(DISP_S);
    for (let k = 0; k < NF; k++) {
      if (k === 12 || k === 13) { this.sigLn[k] = null; continue; }
      const d = this._dispLn(k, Math.min(dispN, Math.max(1, this.seg[k])));
      if (this.seg[k] >= dispN) this.sigLn[k] = d;
      else { const prior = k < 9 ? sigmaPrior(k, null) : null; this.sigLn[k] = d != null && prior != null ? Math.max(d, prior) : d != null ? d : prior != null ? prior : (this.sigLn[k] ?? null); }
    }
    this.sigmaPwv_mmHg = this.sigLn[8] != null ? this.sigLn[8] / PWV_PER_MMHG : null;
    this.sigmaRefl_mmHg = this.sigLn[2] != null ? this.sigLn[2] / PWV_PER_MMHG : null;
    this.sigmaPpgRefl_mmHg = this.sigLn[5] != null ? this.sigLn[5] / PWV_PER_MMHG : null;
    // adaptive spans from the 30 s MEDIAN of the per-window dispersion estimates of the 9 cue slots (a transient cannot lengthen them)
    this._sigHist.push(Array.from({ length: 9 }, (_, k) => this.sigLn[k] ?? null)); while (this._sigHist.length > adaptN) this._sigHist.shift();
    const adaptSigma = (k, scale) => { const v = sigmaPrior(k, this.sigLn[k] ?? null); return v != null ? v / scale : 0; };
    const adapt = (s, base, max, ref = ADAPT_SIGMA_REF_MMHG) => { const r = Math.max(1, s / ref); return Math.min(max, Math.max(base, base * r * r)); };
    this.spanArr = this.win(adapt(adaptSigma(2, PWV_PER_MMHG), MEDIAN_S, MEDIAN_MAX_S)); this.spanPpg = this.win(adapt(adaptSigma(5, PWV_PER_MMHG), MEDIAN_S, MEDIAN_MAX_S));
    this.spanRi = this.win(adapt(adaptSigma(1, RI_EXP * PWV_PER_MMHG), RI_MEDIAN_S, RI_MEDIAN_MAX_S, ADAPT_SIGMA_REF_RI_MMHG)); this.spanPpgRi = this.win(adapt(adaptSigma(4, RI_EXP * PWV_PER_MMHG), RI_MEDIAN_S, RI_MEDIAN_MAX_S, ADAPT_SIGMA_REF_RI_MMHG));
    // ROADMAP §2.2-10 — PTT beat accumulation: size the PTT span to PTT_MIN_BEATS INDEPENDENT beats at this
    // window's heart rate (analysis windows overlap by > 95 %, so only the span brings fresh beats), clamped to
    // [MEDIAN_S, PTT_MEDIAN_MAX_S] and — in the median below — by the slot's change-point segment. Off → the
    // legacy shared span (bit-identical default). Mirror of estimator.rs.
    this.spanPtt = this.pttAccum ? this.win(Math.min(PTT_MEDIAN_MAX_S, Math.max(MEDIAN_S, PTT_MIN_BEATS * (60 / Math.max(30, this._medianLast(9, medianN) ?? 72))))) : this.spanArr;
    if (!this.fs) this.fs = {};
    BpEstimator.KEYS.forEach((key, k) => {
      let val; const n = (span) => Math.min(span, Math.max(1, this.seg[k])); // medians over min(span, segment)
      if (k === 1) val = this._trendMedian(k, n(this.spanRi)); else if (k === 4) val = this._trendMedian(k, n(this.spanPpgRi));
      else if (k === 6) val = this._medianLast(k, n(this.spanPtt));
      else if (k === 3 || k === 5 || k === 11) val = this._medianLast(k, n(this.spanPpg));
      else if (k === 9 || k === 14 || k === 12 || k === 13) val = this._medianLast(k, medianN);
      else val = this._medianLast(k, n(this.spanArr));
      this.fs[key] = val; // a vanished cue must not stay at its last value
    });
    const meanQ = (k, n) => { const h = this._hist; let s = 0, c = 0; for (let i = Math.max(0, h.length - n); i < h.length; i++) { s += h[i][k] ?? 0; c++; } return c ? s / c : 0; };
    this.qWinArr = meanQ(12, this.spanArr); this.qWinPpg = meanQ(13, this.spanPpg);
    this._xmodUpdate();
    this._ppgOpticsUpdate();
    return this.fs;
  }

  // 6th pass (docs/CLINICAL_AUDIT.md §6.17) — the three cross-modality residuals from the LAST published
  // single-modality estimates (one window of lag ≪ the dwell) + the dwell/clear hysteresis. Mirror of rust
  // `xmod_update`. Every residual is a quantity the estimator's own laws say must be ZERO, z-scored by the two
  // estimates' own posterior SDs plus a model-error floor (σ_bio) — so it cannot fire because both are uncertain,
  // and it is simply not formed when one modality is missing / stale.
  _xmodUpdate() {
    const C = this.cal;
    if (!C || !this.xmodEnabled) { this._xmodReset(); return; }
    const dt = Math.max(1e-3, this.cadence_s);
    let zg = NaN, zt = NaN, zp = NaN, zr = NaN, zdc = NaN, yPdep = NaN, yAdep = NaN;
    const g0 = 1 + PWV_PER_MMHG * (C.map0 - MAP_REF_MMHG);
    const liveArr = this.holdArr * dt <= XMOD_MAX_HOLD_S && !this.arrayInvalid;
    const livePpg = this.holdPpg * dt <= XMOD_MAX_HOLD_S && C.ppgQuality > 0;
    const live = liveArr && livePpg;
    const ea = this.estCap, ep = this.estPpg, f = this.fs;
    // (1) ESTIMATE level — the two MAP log-ratios γ, each scaled by its OWN posterior SD. A contact fault also
    // inflates the array's posterior SD and DILUTES this z, so it is OR-ed with the cue-level channel (2).
    if (ea && ep && live && !ea.recalRequired) {
      const ga = 1 + PWV_PER_MMHG * (ea.map - MAP_REF_MMHG), gp = 1 + PWV_PER_MMHG * (ep.map - MAP_REF_MMHG);
      if (ga > 0 && gp > 0 && g0 > 0) {
        const sa = ea.mapSd_mmHg * PWV_PER_MMHG / ga, sp = ep.mapSd_mmHg * PWV_PER_MMHG / gp, sm = XMOD_GAMMA_MODEL_MMHG * PWV_PER_MMHG / g0;
        const den = Math.sqrt(sa * sa + sp * sp + sm * sm);
        if (den > 0) zg = (Math.log(ga / g0) - Math.log(gp / g0)) / den;
      }
    }
    // (2)–(4) CUE level: identities of the estimator's own laws that must hold EXACTLY between the two modalities.
    // Not diluted by a fault's own SD inflation and not fed back by any gate this detector applies.
    if (f && live) {
      // (2) reflection TIMING: ln((t0+T_PK)/(t+T_PK)) = a + b + γ for BOTH
      const t0 = C.tRefl0, t = f.tRefl_ms, pt0 = C.ppgTRefl0, pt = f.ppgTRefl_ms;
      if (t0 != null && t != null && pt0 != null && pt != null && t + T_PK_MS > 1 && pt + T_PK_MS > 1) {
        const sa = this._cueSigma(2, this.spanArr), sp = this._cueSigma(5, this.spanPpg);
        const den = Math.sqrt(sa * sa + sp * sp + XMOD_REFL_MODEL_LN * XMOD_REFL_MODEL_LN);
        if (den > 0) zt = (Math.log((t0 + T_PK_MS) / (t + T_PK_MS)) - Math.log((pt0 + T_PK_MS) / (pt + T_PK_MS))) / den;
      }
      // (3) reflection INDEX: ln(RI/RI0) = 0.7(a+b) for BOTH — the ΔC-shape law test of §6.17 C
      if (C.ri0 > 0 && C.ppgRi0 > 0 && f.ri > 0 && f.ppgRi > 0) {
        const sa = this._cueSigma(1, this.spanRi), sp = this._cueSigma(4, this.spanPpgRi);
        const den = Math.sqrt(sa * sa + sp * sp + XMOD_RI_MODEL_LN * XMOD_RI_MODEL_LN);
        if (den > 0) zr = (Math.log(f.ri / C.ri0) - Math.log(f.ppgRi / C.ppgRi0)) / den;
      }
      // (4) AMPLITUDE: (y_P − y_A) − (a + 2b + 2γ) at the ARRAY-ONLY solution = π_P − π_A, gate-free
      const ya = C.amp0 > 0 && f.amp != null ? Math.log(f.amp / C.amp0) : null;
      const yp = C.ppg0 > 0 && f.ppgAcDc != null ? Math.log(f.ppgAcDc / C.ppg0) : null;
      if (ya != null && yp != null && ea && ea.tone > 0 && ea.stiff > 0 && ea.m > 0 && g0 > 0) {
        yAdep = ya; yPdep = yp;
        const a = Math.log(ea.tone), b = Math.log(ea.stiff), gamma = Math.log(ea.m / g0) - a - b;
        const sa = this._cueSigma(0, this.spanArr), sp = this._cueSigma(3, this.spanPpg), h = [1, 2, 2];
        let q = 0; if (this._lastCovCap) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) q += h[i] * this._lastCovCap[i][j] * h[j];
        const den = Math.sqrt(sa * sa + sp * sp + Math.max(0, q) + XMOD_PI_MODEL_LN * XMOD_PI_MODEL_LN);
        if (den > 0) zp = ((yp - ya) - (a + 2 * b + 2 * gamma)) / den;
      } else if (ya != null && yp != null) { yAdep = ya; yPdep = yp; }
    }
    // (5) optical-path test: |ln(DC/DC0)| of either wavelength against a SELF-SCALED threshold. Independent of the
    // array and of the AC/DC cue itself.
    if (f) {
      const one = (key, k, dc0) => { const dc = f[key]; if (!(dc > 0) || !(dc0 > 0)) return NaN; const thr = Math.max(PPG_DC_REL_THR, 4 * (this.sigLn[k] ?? 0)); return Math.abs(Math.log(dc / dc0)) / thr; };
      const a = one('ppgDc', 15, C.ppgDc0), b = one('ppgDcRed', 16, C.ppgDcRed0);
      zdc = !Number.isFinite(a) ? b : !Number.isFinite(b) ? a : Math.max(a, b);
    }
    this.xmodGammaZ = zg; this.xmodReflZ = zt; this.xmodPiZ = zp; this.xmodRiZ = zr; this.dcRelZ = zdc;
    const over = (z, thr) => (Number.isFinite(z) ? Math.abs(z) / thr : NaN);
    const pick = (a, b) => (!Number.isFinite(a) ? b : !Number.isFinite(b) ? a : Math.max(a, b));
    const pressureStat = pick(over(zg, XMOD_Z_GAMMA), over(zt, XMOD_Z_REFL));
    const pressureAgrees = !(Number.isFinite(pressureStat) && pressureStat > 1);
    // AMPLITUDE half: attributed to whichever modality's own amplitude cue departed from its calibration value —
    // contact (y_A collapses, y_P flat) vs optics (y_P −0.89, y_A ≈ 0) vs arm-down hydrostatics (y_A the mover and
    // the residual only z ≈ 2.2, below XMOD_Z_PI, so nothing is raised).
    const ppgIsTheMover = Number.isFinite(yPdep) && Number.isFinite(yAdep) && Math.abs(yPdep) > Math.abs(yAdep);
    const arrIsTheMover = Number.isFinite(yPdep) && Number.isFinite(yAdep) && Math.abs(yAdep) >= Math.abs(yPdep);
    const couplingStat = pick(pressureStat, arrIsTheMover ? over(zp, XMOD_Z_PI) : NaN);
    const opticsStat = pick(pressureAgrees && ppgIsTheMover ? over(zp, XMOD_Z_PI) : NaN, zdc);
    const stats = [couplingStat, opticsStat, over(zr, XMOD_Z_RI)];
    const flags = ['couplingFault', 'opticsFault', 'riLawFault'];
    for (let i = 0; i < 3; i++) {
      const v = stats[i];
      if (!Number.isFinite(v)) { this._dwell[i] = 0; this._clear[i] += dt; }
      else if (v > 1) { this._dwell[i] += dt; this._clear[i] = 0; }
      else { this._dwell[i] = Math.max(0, this._dwell[i] - dt); if (v < 0.5) this._clear[i] += dt; else this._clear[i] = 0; }
      if (this._dwell[i] >= XMOD_DWELL_S) this[flags[i]] = true;
      else if (this._clear[i] >= XMOD_CLEAR_S) this[flags[i]] = false;
    }
  }

  // 7th pass (docs/CLINICAL_AUDIT.md §6.24) — the PPG-INTERNAL (array-free) optics channel. Mirror of rust
  // `ppg_optics_update`. It exists because the §6.17 amplitude channel of `opticsFault` needs the ARRAY to
  // attribute the disagreement (§6.17 (G) 4): without an array only the DC test survives and DC is blind to the
  // perfusion/temperature axis, so a PPG-only device still reported −15.6/+9.5 mmHg at confidence 0.49 after a
  // 33 → 22 °C cooling (measured on this build, §6.24 (1)).
  //
  // The statistic is an AMPLITUDE-ONLY CLAIM: the AC/DC row asks for π̂ = ln(AC/DC ÷ (AC/DC)0) + ln τ̂ of pulse
  // pressure while every other PPG observable (reflection timing, reflection index, heart rate) is statistically
  // unchanged. Under the estimator's own laws π is free, so this is NOT a residual of a law — it is an explicit
  // physiological prior ([모델 가정], PPG_PI_ALONE_LN).
  //
  // It therefore NEVER gates a cue and never changes a BP: the two hypotheses are provably not separable inside
  // the PPG (the AC/DC row is its only PP observer), so "perfusion fell 59 %" and "PP really fell 59 % at constant
  // MAP/HR/tone" are the SAME observation. The honest action for an unresolvable ambiguity is to declare it —
  // confidence × OPTICS_CONF and recalRequired; a cuff reading resolves it.
  _ppgOpticsUpdate() {
    this.ppgPerfSigma = this._perfSigmaGain();
    const C = this.cal;
    if (!(this.ppgOpt & PPG_OPT_INTERNAL) || !C) {
      this.ppgPiZ = NaN; this.ppgStillZ = NaN; this._dwell[3] = 0; this._clear[3] = 0; this.opticsUnverified = false; return;
    }
    const dt = Math.max(1e-3, this.cadence_s);
    const livePpg = this.holdPpg * dt <= XMOD_MAX_HOLD_S && C.ppgQuality > 0;
    const f = this.fs, ep = this.estPpg;
    let zpi = NaN, still = NaN;
    if (f && ep && livePpg) {
      // π̂ — GATE-FREE from the smoothed cue so that no gating decision feeds back into it
      if (f.ppgAcDc > 0 && C.ppg0 > 0 && ep.tone > 0) {
        const piHat = Math.log(f.ppgAcDc / C.ppg0) + Math.log(ep.tone);
        const sp = this._cueSigma(3, this.spanPpg);
        const sa = this._lastCovPpg ? Math.max(0, this._lastCovPpg[0][0]) : 0;
        const den = Math.sqrt(sp * sp + sa + PPG_PI_ALONE_LN * PPG_PI_ALONE_LN);
        if (den > 0) zpi = piHat / den;
      }
      // STILLNESS — the PPG's own non-amplitude observables against their calibration values, each in units of
      // its own threshold; `still` = the largest of them (≤ 1 ⇒ nothing else moved).
      let sMax = 0, any = false;
      if (C.ppgTRefl0 != null && f.ppgTRefl_ms != null && f.ppgTRefl_ms + T_PK_MS > 1) {
        const sg = this._cueSigma(5, this.spanPpg), den = Math.sqrt(sg * sg + XMOD_REFL_MODEL_LN * XMOD_REFL_MODEL_LN);
        if (den > 0) { sMax = Math.max(sMax, Math.abs(Math.log((C.ppgTRefl0 + T_PK_MS) / (f.ppgTRefl_ms + T_PK_MS))) / den / XMOD_Z_REFL); any = true; }
      }
      if (C.ppgRi0 > 0 && f.ppgRi > 0) {
        const sg = this._cueSigma(4, this.spanPpgRi), den = Math.sqrt(sg * sg + XMOD_RI_MODEL_LN * XMOD_RI_MODEL_LN);
        if (den > 0) { sMax = Math.max(sMax, Math.abs(Math.log(f.ppgRi / C.ppgRi0)) / den / XMOD_Z_RI); any = true; }
      }
      if (f.ppgHr > 0 && C.ppgHr0 > 0) {
        const thr = Math.max(PPG_HR_STILL_LN, 4 * (this.sigLn[14] ?? 0)); // self-scaled like the DC test
        sMax = Math.max(sMax, Math.abs(Math.log(f.ppgHr / C.ppgHr0)) / thr);
      }
      if (any) still = sMax;
    }
    this.ppgPiZ = zpi; this.ppgStillZ = still;
    const lone = Number.isFinite(still) && still <= 1 && Number.isFinite(zpi) ? Math.abs(zpi) / XMOD_Z_PI : NaN;
    const floorStat = (this.ppgOpt & PPG_OPT_PI_FLOOR) && f && f.ppgAcDc > 0 ? PPG_PI_FLOOR / f.ppgAcDc : NaN;
    const stat = !Number.isFinite(lone) ? floorStat : !Number.isFinite(floorStat) ? lone : Math.max(lone, floorStat);
    if (!Number.isFinite(stat)) { this._dwell[3] = 0; this._clear[3] += dt; }
    else if (stat > 1) { this._dwell[3] += dt; this._clear[3] = 0; }
    else { this._dwell[3] = Math.max(0, this._dwell[3] - dt); if (stat < 0.5) this._clear[3] += dt; else this._clear[3] = 0; }
    if (this._dwell[3] >= XMOD_DWELL_S) this.opticsUnverified = true;
    else if (this._clear[3] >= XMOD_CLEAR_S) this.opticsUnverified = false;
  }

  // Stamp the faults on an estimate and apply their confidence multipliers (mirror of rust `apply_faults`).
  // `arr` = array-anchored (coupling / RI-law), `ppg` = uses the PPG AC/DC cue (optics).
  _applyFaults(e, arr, ppg) {
    if (arr && this.couplingFault) { e.couplingFault = true; e.confidence *= COUPLING_CONF; }
    if (arr && this.riLawFault) { e.riLawFault = true; e.confidence *= RI_LAW_CONF; }
    if (ppg && this.opticsFault) e.opticsFault = true;
    // 7th pass (§6.24): the PPG-INTERNAL ambiguity. Both statements can be true; the confidence multiplier is
    // applied ONCE so an estimate that already carries the 6th-pass multiplier is not penalised twice.
    if (ppg && this.opticsUnverified) e.opticsUnverified = true;
    if (ppg && (this.opticsFault || this.opticsUnverified)) {
      e.confidence *= OPTICS_CONF;
      // ROADMAP piece ②: the optical operating point moved away from where the calibration was taken → ask for a
      // new cuff reading. It is the ONLY action the internal channel can take (it cannot attribute the move).
      if (this.ppgOpt & PPG_OPT_RECAL) e.recalRequired = true;
    }
    return e;
  }

  // Log-uncertainty of the smoothed cue k: per-window dispersion / √(effective windows, capped) ⊕ calibration-baseline uncertainty
  _cueSigma(k, span) {
    const sW = Math.max(SIGMA_FLOOR_LN, this.sigLn[k] ?? 0.05), nEff = Math.min(N_EFF_MAX, Math.max(1, Math.min(span, Math.max(1, this.seg[k])) / this._winCorr())), sNow = sW / Math.sqrt(nEff);
    const sCal = this.cal && this.cal.sigma0Ln ? (this.cal.sigma0Ln[k] ?? 0) : 0;
    return Math.sqrt(sNow * sNow + sCal * sCal);
  }
  // 7th pass (§6.24): the AC/DC row additionally carries the PERFUSION σ-gain — the same realised dispersion buys
  // less information at a lower perfusion index. Applied HERE and not in `_cueSigma` on purpose: `_cueSigma` is
  // also the denominator of the fault detectors and the gain is proportional to the very departure they test
  // (AC/DC fell ⇒ σ grows ⇒ the residual shrinks), which measurably slowed the §6.17 optics detection from
  // 7.3 s to 10.5 s when it was applied there. Weights: yes. Detectors: no.
  _cueWeight(k, span) { const s = this._cueSigma(k, span) * (k === 3 ? this._perfSigmaGain() : 1); return 1 / (s * s); }
  // Residual sanity gate of the reflection-index rows (5th pass): the fusion rule is the inverse variance of the
  // SMOOTHED cue (`_cueSigma`), this only removes a cue whose own σ says it carries nothing. The 4th-pass hard gate
  // on the PER-WINDOW dispersion was closed 100 % of the time under the measured patch noise (estimator.rs `ri_gate`).
  _riGate(k, span) {
    if (this.riGateMode === 'legacy') { // 4th pass: RAW per-window dispersion, no credit for the span's averaging
      const sW = this.sigLn[k] ?? 0.05, sCal = this.cal && this.cal.sigma0Ln ? (this.cal.sigma0Ln[k] ?? 0) : 0;
      return clamp((RI_SIGMA_LEGACY_MAX_LN - Math.max(sW, 1.5 * sCal)) / (0.5 * RI_SIGMA_LEGACY_MAX_LN), 0, 1);
    }
    const s = this._cueSigma(k, span);
    const [soft, hi] = this.riGateMode === 'open' ? [RI_SIGMA_SOFT_OPEN_LN, RI_SIGMA_MAX_OPEN_LN] : [RI_SIGMA_SOFT_LN, RI_SIGMA_MAX_LN];
    return clamp((hi - s) / (hi - soft), 0, 1);
  }

  // Weighted LS (HᵀWH + P)θ = HᵀWy with priors diag(1/σa², 1/σb², 0); returns {a, b, gamma, sdGamma} or null
  static invert(rows, sigmaA = PRIOR_SIGMA_TONE_LN, sigmaB = PRIOR_SIGMA_STIFF_LN) {
    const M = [[1 / (sigmaA * sigmaA), 0, 0], [0, 1 / (sigmaB * sigmaB), 0], [0, 0, 0]], V = [0, 0, 0]; let anyGamma = false;
    for (const r of rows) { if (!(r.w > 0) || !isFinite(r.y)) continue; if (r.h[2] !== 0) anyGamma = true; for (let i = 0; i < 3; i++) { V[i] += r.w * r.h[i] * r.y; for (let j = 0; j < 3; j++) M[i][j] += r.w * r.h[i] * r.h[j]; } }
    if (!anyGamma) return null;
    const m = M, det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    if (!(Math.abs(det) >= 1e-18) || !isFinite(det)) return null;
    const inv = [
      [(m[1][1] * m[2][2] - m[1][2] * m[2][1]) / det, (m[0][2] * m[2][1] - m[0][1] * m[2][2]) / det, (m[0][1] * m[1][2] - m[0][2] * m[1][1]) / det],
      [(m[1][2] * m[2][0] - m[1][0] * m[2][2]) / det, (m[0][0] * m[2][2] - m[0][2] * m[2][0]) / det, (m[0][2] * m[1][0] - m[0][0] * m[1][2]) / det],
      [(m[1][0] * m[2][1] - m[1][1] * m[2][0]) / det, (m[0][1] * m[2][0] - m[0][0] * m[2][1]) / det, (m[0][0] * m[1][1] - m[0][1] * m[1][0]) / det],
    ];
    const th = [0, 1, 2].map((i) => inv[i][0] * V[0] + inv[i][1] * V[1] + inv[i][2] * V[2]);
    if (th.some((x) => !isFinite(x))) return null;
    return { a: th[0], b: th[1], gamma: th[2], sdGamma: Math.sqrt(Math.max(0, inv[2][2])), cov: inv };
  }

  // Assemble the estimate from the inversion + amplitude rows → π, with clamps and confidence
  _finish(C, ampRows, inv, qWin, qCal, hold, extra) {
    const g0 = 1 + PWV_PER_MMHG * (C.map0 - MAP_REF_MMHG);
    const a = clamp(inv.a, -1, 1), b = clamp(inv.b, -1, 1), gamma = inv.gamma, th = [a, b, gamma];
    let map = MAP_REF_MMHG + (g0 * Math.exp(gamma) - 1) / PWV_PER_MMHG;
    let sp = 0, sw = 0; const hbar = [0, 0, 0];
    for (const [h, y, w] of ampRows) { if (!(w > 0) || !isFinite(y)) continue; sp += w * (y + h[0] * th[0] + h[1] * th[1] + h[2] * th[2]); sw += w; for (let i = 0; i < 3; i++) hbar[i] += w * h[i]; }
    const pi = sw > 0 ? sp / sw : 0;
    // 6th pass: posterior SD of π = ln(PP/PP0) — 1/Σw (the amplitude rows' own noise) ⊕ h̄ᵀ·Cov(θ)·h̄ (what they
    // inherit from the (a, b, γ) solution), h̄ = the weighted-mean coefficient vector. Mirror of rust `finish`.
    let ppSdLn = PP_SD_LN_NONE;
    if (sw > 0) { for (let i = 0; i < 3; i++) hbar[i] /= sw; let q = 0; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) q += hbar[i] * (inv.cov ? inv.cov[i][j] : 0) * hbar[j]; ppSdLn = Math.min(PP_SD_LN_NONE, Math.sqrt(1 / sw + Math.max(0, q))); }
    let pp = C.pp0 * Math.exp(clamp(pi, -2, 2)), clamped = false;
    // no usable information (posterior MAP SD ≥ SHRINK_SD_LO): shrink toward the calibration state
    const mapSd = inv.sdGamma * g0 * Math.min(3, Math.exp(gamma)) / PWV_PER_MMHG;
    const keep = 1 - clamp((mapSd - SHRINK_SD_LO_MMHG) / (SHRINK_SD_HI_MMHG - SHRINK_SD_LO_MMHG), 0, 1);
    map = C.map0 + keep * (map - C.map0); pp = C.pp0 + keep * (pp - C.pp0);
    if (!(map >= MAP_MIN && map <= MAP_MAX)) { map = clamp(map, MAP_MIN, MAP_MAX); clamped = true; }
    if (!(pp >= PP_MIN && pp <= PP_MAX)) { pp = clamp(pp, PP_MIN, PP_MAX); clamped = true; }
    let sbp = map + (2 / 3) * pp, dbp = map - pp / 3;
    if (!(sbp >= SBP_MIN && sbp <= SBP_MAX) || !(dbp >= DBP_MIN && dbp <= DBP_MAX)) { sbp = clamp(sbp, SBP_MIN, SBP_MAX); dbp = clamp(dbp, DBP_MIN, DBP_MAX); clamped = true; }
    const cNoise = 1 / (1 + (mapSd / CONF_SD_REF_MMHG) ** 2), cSqi = 0.5 + 0.5 * clamp(qWin, 0, 1), cCal = 0.5 + 0.5 * clamp(qCal, 0, 1), cHold = Math.exp(-(hold * this.cadence_s) / 8), cClamp = clamped ? 0.3 : 1;
    return { sbp, dbp, map, pp, tone: Math.exp(a), stiff: Math.exp(b), x: Math.exp(a + b), m: g0 * Math.exp(a + b + gamma), confidence: clamp(cNoise * cSqi * cCal * cHold * cClamp, 0, 1), mapSd_mmHg: mapSd, recalRequired: false, ppSdLn, couplingFault: false, opticsFault: false, riLawFault: false, opticsUnverified: false, ...extra };
  }
  _ema(slot, raw) {
    if (!raw || !isFinite(raw.sbp) || !isFinite(raw.dbp)) return this[slot];
    const al = this._outAlpha();
    if (!this[slot]) this[slot] = { ...raw };
    else for (const k of Object.keys(raw)) { if (k === 'confidence' || k === 'mapSd_mmHg' || k === 'recalRequired' || k === 'ppSdLn' || k === 'couplingFault' || k === 'opticsFault' || k === 'riLawFault' || k === 'opticsUnverified') { this[slot][k] = raw[k]; continue; } if (raw[k] != null && isFinite(raw[k])) this[slot][k] = this[slot][k] == null ? raw[k] : this[slot][k] + al * (raw[k] - this[slot][k]); }
    return this[slot];
  }
  _hold(slot, hold) { const C = this.cal; const e = this[slot] || { sbp: C.sbp0, dbp: C.dbp0, map: C.map0, pp: C.pp0, tone: 1, stiff: 1, x: 1, confidence: 0.05, mapSd_mmHg: 99, recalRequired: false, ppSdLn: PP_SD_LN_NONE, couplingFault: false, opticsFault: false, riLawFault: false, opticsUnverified: false }; return { ...e, confidence: e.confidence * Math.exp(-(hold * this.cadence_s) / 8) }; }
  // Held array-anchored estimate while the attachment is invalid (sheet shifted / detached): not updated, confidence × 0.1, recalRequired
  _heldInvalid(slot) { const C = this.cal; const e = this[slot] || { sbp: C.sbp0, dbp: C.dbp0, map: C.map0, pp: C.pp0, tone: 1, stiff: 1, x: 1, confidence: 0.05, mapSd_mmHg: 99, ppSdLn: PP_SD_LN_NONE, couplingFault: false, opticsFault: false, riLawFault: false, opticsUnverified: false }; return { ...e, confidence: Math.min(0.1, e.confidence * 0.1), recalRequired: true }; }
  _reflRow(t0, t, k, span) { return t0 != null && t != null && t + T_PK_MS > 1 ? { h: [1, 1, 1], y: Math.log((t0 + T_PK_MS) / (t + T_PK_MS)), w: this._cueWeight(k, span) } : null; }
  _riRow(ri, ri0, k, span) { return ri != null && ri0 != null && ri0 > 0 ? { h: [RI_EXP, RI_EXP, 0], y: Math.log(Math.max(0.05, ri / ri0)), w: this._riGate(k, span) * this._cueWeight(k, span) } : null; }

  // Fusion estimator (array + PPG): all cues; the amplitude pair (A, P) identifies tone.
  estimate(featuresRaw) {
    const C = this.cal; if (!C) return null;
    if (this.arrayInvalid) return this._heldInvalid('est');
    if (!featuresRaw || !(featuresRaw.amp > 0)) return null;
    const f = this._smoothFeatures(featuresRaw);
    const rows = [], ampRows = [];
    const push = (r) => { if (r) rows.push(r); };
    push(this._riRow(f.ri, C.ri0, 1, this.spanRi)); push(this._riRow(f.ppgRi, C.ppgRi0, 4, this.spanPpgRi));
    push(this._reflRow(C.tRefl0, f.tRefl_ms, 2, this.spanArr)); push(this._reflRow(C.ppgTRefl0, f.ppgTRefl_ms, 5, this.spanPpg));
    const wp = clamp(this.pwvWeight, 0, 1);
    if (C.pwv0 > 0 && f.pwvLocal > 0 && wp > 0) rows.push({ h: [WT_WRIST, WS_WRIST, 1], y: Math.log(f.pwvLocal / C.pwv0), w: wp * this._cueWeight(8, this.spanArr) });
    if (C.ptt0 > 1 && f.pttWF_ms > 1) rows.push({ h: [WT_WF, WS_WF, 1], y: Math.log(C.ptt0 / f.pttWF_ms), w: this._cueWeight(6, this.spanPtt) });
    // 6th pass (§6.17 B): with the optics flagged the AC/DC cue's calibration is void — the row is dropped from BOTH
    // its uses (the tone-identifying pair and the π estimate), not merely down-weighted.
    // 7th pass (§6.24): the absolute perfusion floor drops the row as well. `opticsUnverified` does NOT — it cannot
  // attribute the move, so it only lowers the confidence and asks for a recalibration.
  const ya = C.amp0 > 0 && f.amp != null ? Math.log(f.amp / C.amp0) : null, yp = C.ppg0 > 0 && f.ppgAcDc != null && !this.opticsFault && !this._ppgPerfLow() ? Math.log(f.ppgAcDc / C.ppg0) : null;
    if (ya != null && yp != null) rows.push({ h: [1, 2, 2], y: yp - ya, w: 1 / (1 / this._cueWeight(0, this.spanArr) + 1 / this._cueWeight(3, this.spanPpg)) });
    if (ya != null) ampRows.push([[2, 2, 2], ya, this._cueWeight(0, this.spanArr)]);
    if (yp != null) ampRows.push([[1, 0, 0], yp, this._cueWeight(3, this.spanPpg)]);
    const inv = BpEstimator.invert(rows); if (!inv) return this._hold('est', Math.max(this.holdArr, this.holdPpg));
    const raw = this._finish(C, ampRows, inv, 0.5 * (this.qWinArr + this.qWinPpg), 0.5 * (C.quality * C.reflQuality + C.ppgQuality * C.ppgReflQuality), Math.max(this.holdArr, this.holdPpg), { pwvLocal: f.pwvLocal, pttWF_ms: f.pttWF_ms, tRefl_ms: f.tRefl_ms, ri: f.ri, hr: f.hr });
    if (this.contactWarn) raw.confidence *= CONTACT_CONF;
    this._applyFaults(raw, true, true);
    return this._ema('est', raw);
  }
}

// (A) Capacitive array only: RI, reflection timing, local PWV (measurability-weighted) → (a, b, γ); A ∝ PP·D, D ∝ 1/(τ·s·g)² → PP.
BpEstimator.prototype.estimateCap = function (featuresRaw) {
  const C = this.cal; if (!C) return null;
  if (this.arrayInvalid) return this._heldInvalid('estCap');
  if (!featuresRaw) return null;
  if (!(featuresRaw.amp > 0) && !this.estCap) return null;
  const f = this._smoothFeatures(featuresRaw);
  const rows = [], ampRows = [];
  const r1 = this._riRow(f.ri, C.ri0, 1, this.spanRi); if (r1) rows.push(r1);
  const r2 = this._reflRow(C.tRefl0, f.tRefl_ms, 2, this.spanArr); if (r2) rows.push(r2);
  const wp = clamp(this.pwvWeight, 0, 1);
  if (C.pwv0 > 0 && f.pwvLocal > 0 && wp > 0) rows.push({ h: [WT_WRIST, WS_WRIST, 1], y: Math.log(f.pwvLocal / C.pwv0), w: wp * this._cueWeight(8, this.spanArr) });
  if (C.amp0 > 0 && f.amp != null) ampRows.push([[2, 2, 2], Math.log(f.amp / C.amp0), this._cueWeight(0, this.spanArr)]);
  const inv = BpEstimator.invert(rows); if (!inv) return this._hold('estCap', this.holdArr);
  this._lastCovCap = inv.cov;
  const raw = this._finish(C, ampRows, inv, this.qWinArr, C.quality * C.reflQuality, this.holdArr, { pwvLocal: f.pwvLocal, tRefl_ms: f.tRefl_ms, ri: f.ri, hr: f.hr });
  if (this.contactWarn) raw.confidence *= CONTACT_CONF;
  this._applyFaults(raw, true, false);
  return this._ema('estCap', raw);
};

// (B) Finger PPG only: PPG RI, PPG reflection timing → (a, b, γ) (prior-regularised split); AC/DC ∝ PP/τ → PP. PPG sensor alone.
BpEstimator.prototype.estimatePpg = function (featuresRaw) {
  const C = this.cal; if (!C || !featuresRaw) return null;
  if (!(featuresRaw.ppgAcDc > 0) && !this.estPpg) return null;
  const f = this._smoothFeatures(featuresRaw);
  const rows = [], ampRows = [];
  const r1 = this._riRow(f.ppgRi, C.ppgRi0, 4, this.spanPpgRi); if (r1) rows.push(r1);
  const r2 = this._reflRow(C.ppgTRefl0, f.ppgTRefl_ms, 5, this.spanPpg); if (r2) rows.push(r2);
  // 6th pass (§6.17 B): the AC/DC row is the PPG's ONLY observer of PP. With the optics flagged its calibration is
  // void, so it is gated and the estimator reports the calibration PP at OPTICS_CONF × confidence — the honest
  // degradation. (Re-anchoring it on the array would make the PPG-only estimator depend on the array.)
  if (C.ppg0 > 0 && f.ppgAcDc != null && !this.opticsFault && !this._ppgPerfLow()) ampRows.push([[1, 0, 0], Math.log(f.ppgAcDc / C.ppg0), this._cueWeight(3, this.spanPpg)]);
  const inv = BpEstimator.invert(rows); if (!inv) return this._hold('estPpg', this.holdPpg);
  this._lastCovPpg = inv.cov;
  const raw = this._finish(C, ampRows, inv, this.qWinPpg, C.ppgQuality * C.ppgReflQuality, this.holdPpg, { tRefl_ms: f.ppgTRefl_ms, ri: f.ppgRi, hr: f.ppgHr ?? f.hr });
  this._applyFaults(raw, false, true);
  return this._ema('estPpg', raw);
};

// Estimator diagnostics (mirror of the Rust `estimator` result field)
BpEstimator.prototype.diag = function () {
  const K = BpEstimator.KEYS;
  return { cadence_s: this.cadence_s, spanArr: this.spanArr, spanPpg: this.spanPpg, spanRi: this.spanRi, spanPtt: this.spanPtt,
    pttBeats: Math.min(this.spanPtt, Math.max(1, this.seg[6])) * this.cadence_s * Math.max(30, (this.fs && this.fs.hr) || 72) / 60, sigLn: K.slice(0, 9).map((_, k) => this.sigLn[k] ?? null), qWinArr: this.qWinArr, qWinPpg: this.qWinPpg, smoothed: this.fs ? K.slice(0, 9).map((k) => this.fs[k] ?? null) : [],
    segRi: this.seg[1], segArr: this.seg[2], calQuality: this.cal ? this.cal.quality * this.cal.reflQuality : 0,
    riSigmaLn: this.cal ? this._cueSigma(1, this.spanRi) : NaN, riGate: this.cal ? this._riGate(1, this.spanRi) : NaN,
    riSigma0Ln: this.cal && this.cal.sigma0Ln ? (this.cal.sigma0Ln[1] ?? NaN) : NaN,
    xmodGammaZ: this.xmodGammaZ, xmodReflZ: this.xmodReflZ, xmodPiZ: this.xmodPiZ, xmodRiZ: this.xmodRiZ, dcRelZ: this.dcRelZ,
    couplingFault: this.couplingFault, opticsFault: this.opticsFault, riLawFault: this.riLawFault,
    ppgPiZ: this.ppgPiZ, ppgStillZ: this.ppgStillZ, ppgPerfSigma: this.ppgPerfSigma, opticsUnverified: this.opticsUnverified, ppgPerfLow: this._ppgPerfLow() };
};

// SpO2 the way a pulse-oximeter computes it: ratio-of-ratios from the Red/IR waveforms over a window.
export function spo2FromPpg(red, ir) {
  if (!red || !ir || red.length < 50) return null;
  const dcR = mean(red), dcI = mean(ir);
  const acR = std(red), acI = std(ir);
  if (!(acI > 0) || !(dcR > 0) || !(dcI > 0)) return null;
  const R = (acR / dcR) / (acI / dcI);
  return { spo2: Math.max(70, Math.min(100, 110 - 25 * R)), R };
}
