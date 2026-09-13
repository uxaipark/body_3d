// Cardiac model: generates a central (aortic root) pressure waveform over time
// for different rhythm states (normal sinus, tachycardia, bradycardia, AFib, PVC).
// Beat morphology = weighted sum of Gaussian pulses (systolic peak, reflected wave,
// dicrotic notch) on a late-systolic plateau with an exponential diastolic run-off,
// mapped between DBP and SBP — a standard synthetic PPG/ABP construction approach,
// not a fluid-dynamics solution. All numeric constants below are MODEL ASSUMPTIONS
// (stylised, chosen to land in literature ranges), see docs/CLINICAL_AUDIT.md §1.
//
// SBP/DBP themselves come from a two-element (RC) Windkessel LAYER driven by stroke volume,
// total peripheral resistance and arterial compliance (ROADMAP §2.1-1, audit §6.13). Two drive
// modes, identical physics, opposite direction:
//   drive = 'bp'   (DEFAULT, backward compatible) — setBP(sbp, dbp) fixes the pressures and the layer
//                  SOLVES for the (SV, TPR) that reproduce them at the current HR and compliance.
//                  Nothing downstream changes → bit-identical to the pre-§6.13 twin.
//   drive = 'hemo' — setHemodynamics({sv, tpr}) fixes the drivers and SBP/DBP are DERIVED, so HR now
//                  moves blood pressure (MAP ∝ CO = SV·HR).
// Respiration (ROADMAP §2.1-6) is a single shared phase source (RespirationModel) consumed by the RSA
// term of HRV, by the pulsus-paradoxus SV/PP modulation, by the venous pump (engine.js) and by the PPG /
// capacitive baseline terms — so RR shortening on inspiration and the SBP dip are phase-consistent.

import { ARTERIAL_PATH, segmentWeights, pwvPressureGain } from './anatomy.js';

function gaussian(x, mu, sigma) {
  const d = (x - mu) / sigma;
  return Math.exp(-0.5 * d * d);
}

// Deterministic pseudo-random noise (stable across frames) for jitter/HRV.
function hashNoise(seed) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x); // [0,1)
}

// Deterministic standard-normal deviate (Box–Muller on two hashNoise draws).
function hashGauss(seed) {
  const u1 = Math.max(1e-9, hashNoise(seed));
  const u2 = hashNoise(seed + 0.37);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// Heart-rate variability (sinus rhythms): structured RR modulation, fraction of mean RR.
//   • RSA  (respiratory sinus arrhythmia) at the model breathing rate 0.25 Hz (shared with
//          kinematics BREATH_V / engine venous pump), amplitude 4.5 % of RR at rest
//   • LF   (baroreflex / Mayer-wave band) at 0.10 Hz, amplitude 3.5 % of RR
//   • random beat-to-beat term, σ = 1.8 % of RR (seeded Gaussian)
// → SDNN ≈ √(0.045²/2 + 0.035²/2 + 0.018²)·RR ≈ 0.044·RR ≈ 37 ms at HR 72 (target 30–50 ms,
//   Task Force 1996 normal range). Per-rhythm `hrv` scales the whole pattern: sinus tachycardia
//   (vagal withdrawal) 0.45, sinus bradycardia (high vagal tone) 1.2. Model assumptions.
// (rsaHz is now the DEFAULT of the shared RespirationModel below — the RSA term reads
//  `this.respiration.rate_Hz`/`signal(t)`, not a private oscillator, so it stays in phase with the
//  pulsus-paradoxus SBP dip and the sensor-side respiration terms. audit §6.13)
const HRV = { rsaFrac: 0.045, rsaHz: 0.25, lfFrac: 0.035, lfHz: 0.10, randFrac: 0.018 };

// Atrial fibrillation: RR ~ log-normal with σ_ln = 0.24 → CV ≈ 0.23–0.24 (Tateno & Glass 2001 report
// RR coefficient of variation ≈ 0.2–0.25 in AF); beats independent, clamped to [0.30, 1.9] s.
const AF_RR_SIGMA_LN = 0.24;
// AF beat-to-beat pulse-pressure variation (pulse deficit): a short preceding RR → less filling →
// smaller stroke volume → lower PP. amp = clamp(0.55 + 0.45·RR_prev/RR_mean, 0.5, 1.15) — model
// assumption (Frank–Starling-like linearisation; ≈ −45 % PP for RR_prev = 0, +15 % cap after pauses).
const AF_PP = { base: 0.55, slope: 0.45, min: 0.5, max: 1.15 };
// Ventricular ectopy: coupling interval 0.62·RR (early), compensatory pause so that
// N–PVC–N = 2·RR (1.38·RR); PVC pulse ≈ 45 % of normal PP (reduced filling, dyssynchrony);
// post-extrasystolic potentiation: the beat after the PVC has PP ×1.12 (≈ +10–15 %). Model assumptions.
const PVC = { coupling: 0.62, pause: 1.38, amp: 0.45, pespAmp: 1.12 };
// Diastolic run-off time constant (Windkessel RC), s — model assumption.
const TAU_DIAST = 0.30;

// ---------------------------------------------------------------------------------------------------
// Respiration — ONE shared phase source for every respiration-coupled term in the twin (audit §6.13).
// signal(t) = sin(2π·f·t): +1 = peak inspiration, −1 = peak expiration (same sign convention the RSA
// term and kinematics' breathing lift already used). `depth` = tidal-volume scalar (1 = nominal); it
// scales the CARDIAC couplings (RSA amplitude, pulsus paradoxus) only — the sensor-side respiration
// terms (PPG breathMod, capacitive baseline wander) keep their own fitted amplitudes and consume only
// the shared RATE/phase, so their default output is unchanged. Model assumptions.
// ---------------------------------------------------------------------------------------------------
export class RespirationModel {
  constructor() {
    this.rate_Hz = 0.25; // 15 breaths/min — the twin's historical breathing rate (shared everywhere)
    this.depth = 1.0;    // 0.2–2.0, 1 = nominal tidal volume
  }
  get rate_bpm() { return this.rate_Hz * 60; }
  setRate_bpm(bpm) { this.rate_Hz = Math.max(0.05, Math.min(0.75, bpm / 60)); } // 3–45 breaths/min
  setDepth(d) { this.depth = Math.max(0, Math.min(2.5, d)); }
  signal(t) { return Math.sin(2 * Math.PI * this.rate_Hz * t); } // +1 peak inspiration
}

// ---------------------------------------------------------------------------------------------------
// LONG-HORIZON VASCULAR DRIFT (ROADMAP §2.2 item 11, audit §6.20). ALL constants are MODEL ASSUMPTIONS
// (모델 가정 — 문헌 보정 필요). No citation is claimed for any number below.
//
// WHAT IT IS. Everything else in the twin lives on the beat/breath/second time scale. This model adds the
// HOURS-TO-WEEKS scale that a cuffless device actually has to survive between cuff calibrations: vasomotor
// tone and arterial stiffness are no longer constants but a documented stochastic process of PHYSIOLOGICAL
// time, and (optionally) the sensor interface creeps with them.
//
//   ln tone(t)  = A_d · d(t)                       diurnal   (24 h + 12 h harmonic; nocturnal dip)
//                 + OU(t; τ = 36 h, σ_ln = 0.06)   day-to-day vasomotor wander
//   ln stiff(t) = β · t/week                       slow remodelling trend (days–weeks)
//                 + OU(t; τ = 14 d, σ_ln = 0.03)   slow stiffness wander
//
// TRUE-BP COUPLING (`bpCoupling`, on when the drift model is enabled). A vascular-state change is only half
// the story: part of it shows up as a real blood-pressure change, which the estimator is SUPPOSED to track.
// The split is a documented model assumption, NOT a physiological derivation:
//   MAP(t) = MAP₀ · tone(t)^κ_map   (κ_map = 0.6 — the rest is taken to be autoregulated / compensated)
//   PP(t)  = PP₀  · stiff(t)^κ_pp   (κ_pp  = 0.8 — stiffer wall ⇒ wider pulse pressure at the same SV)
// and SBP/DBP follow the twin's own convention SBP = MAP + 2·PP/3, DBP = MAP − PP/3. In the 'hemo' drive the
// same tone factor is applied to TPR instead (MAP ∝ TPR), which is the physically equivalent statement there.
// With κ_map = 0.6 and A_d = 0.10 the diurnal MAP swing is ≈ 12 % peak-to-trough — the "nocturnal dip" the
// awake→asleep scenario steps through by hand, now as a continuous process.
//
// SENSOR-INTERFACE DRIFT (`sensorDrift`). The short-term attachment/contact effects already live in
// js/capacitiveArray.js; what is missing is the slow creep. Two bounded terms, both 모델 가정:
//   contact(t)  = contact₀ − 0.15·(1 − e^{−t/5 d})     strap relaxation toward a looser asymptote
//   sheet_x(t)  = sheet_x₀ + OU(t; τ = 7 d, σ = 0.6 mm) slow lateral migration of the patch
// There is NO re-donning / re-calibration model: the patch is assumed worn continuously (see §6.20 caveats).
//
// ACCELERATED TIME (`driftClock ×N`, `setScale`). The twin runs in real time, so a 4-week trajectory has to be
// simulatable in minutes. `scale` is a pure TIME-SCALE FACTOR on the drift process ONLY:
//     t_phys = epoch + (t_sim − t_sim@enable) · scale
// and NOTHING else in the twin sees it — the 16 kHz master clock, the beat timeline, respiration, HRV, the
// noise generators and every sensor model keep running on real simulation time. Scaling those too would be
// physically wrong (it would change beat morphology, RSA phase and noise bandwidth).
// SEPARABILITY. Every drift quantity is an ANALYTIC FUNCTION of t_phys — the OU terms are synthesised as
// random-phase sums with a Lorentzian (OU) spectrum instead of being integrated step-by-step — so the
// trajectory contains no step-size state at all and `stateAt(t_phys)` is bit-identical for any `scale`.
// (`eval/drift_eval.mjs --separability` runs the end-to-end proof at ×1 / ×60 / ×3600.)
// ---------------------------------------------------------------------------------------------------
const HOUR_S = 3600, DAY_S = 86400, WEEK_S = 604800;
export const DRIFT_DEFAULTS = {
  // ---- diurnal (fast component) ----
  diurnalAmp_ln: 0.10,        // half peak-to-trough of the diurnal log-tone swing (→ ≈12 % MAP swing at κ_map 0.6)
  diurnalPeakHour: 10,        // clock hour of the daytime tone maximum (trough ≈ 22 h later → nocturnal dip)
  diurnalHarmonic: 0.20,      // 12 h harmonic, relative to the 24 h term (morning surge / flatter night trough)
  // ---- vasomotor wander (hours → days) ----
  toneTau_h: 36, toneSigma_ln: 0.06,
  // ---- stiffness (days → weeks) ----
  stiffTrend_lnPerWeek: 0.004, // ≈ +0.4 %/week — a remodelling/"vascular ageing" trend, not a measured rate
  stiffTau_d: 14, stiffSigma_ln: 0.03,
  // ---- vascular state → TRUE blood pressure ----
  mapExp: 0.6, ppExp: 0.8,
  // ---- sensor interface creep ----
  contactRelax: 0.15, contactTau_d: 5,   // strap loosens by 0.15 (of the 0–1 contact index) with τ = 5 d
  sheetTau_d: 7, sheetSigma_mm: 0.6,     // lateral patch migration, OU, σ = 0.6 mm
  // ---- spectral synthesis of the OU terms ----
  modes: 12,                  // random-phase components per OU term (log-spaced over [τ/64… 8/τ])
};

// One OU-equivalent term, synthesised as a random-phase sum with a Lorentzian spectrum
// S(f) ∝ 1/(1 + (2πfτ)²). Log-spaced knots ⇒ Δf = f·Δln f, so the per-mode amplitude weight is
// √(f/(1+(2πfτ)²)), normalised so that Σ a_k²/2 = σ² (the stationary variance of the OU process).
// The result is a deterministic, closed-form function of time: no integration state, hence exactly
// invariant under the drift-clock acceleration.
function ouModes(tau_s, sigma, seed, K) {
  const fLo = 1 / (64 * tau_s), fHi = 8 / tau_s;
  const dlog = Math.log(fHi / fLo) / Math.max(1, K - 1);
  const f = new Float64Array(K), w = new Float64Array(K), ph = new Float64Array(K);
  let norm = 0;
  for (let k = 0; k < K; k++) {
    f[k] = fLo * Math.exp(k * dlog);
    w[k] = Math.sqrt(f[k] / (1 + (2 * Math.PI * f[k] * tau_s) ** 2));
    norm += w[k] * w[k];
    ph[k] = 2 * Math.PI * hashNoise(seed + 7.13 * k);
  }
  const g = sigma * Math.sqrt(2 / Math.max(1e-30, norm));
  for (let k = 0; k < K; k++) w[k] *= g;
  return { f, w, ph, K };
}
function ouEval(m, t) { let s = 0; for (let k = 0; k < m.K; k++) s += m.w[k] * Math.sin(2 * Math.PI * m.f[k] * t + m.ph[k]); return s; }

export class VascularDriftModel {
  constructor(cfg = {}) {
    this.cfg = { ...DRIFT_DEFAULTS, ...cfg };
    this.enabled = false;
    this.scale = 1;            // driftClock ×N — 1 s of SIMULATION = N s of PHYSIOLOGICAL drift time
    this.epoch_s = 9 * HOUR_S; // physiological time (= wall-clock hour × 3600) at which the clock is started
    this.startSim_s = 0;       // simulation time at enable
    this.seed = 20260825;
    this.bpCoupling = true;    // vascular state → true BP (see the header)
    this.sensorDrift = true;   // contact creep + patch migration
    this.base = null;          // snapshot taken on the first step after enable
    this.last = null;          // most recent state (read-outs)
    this._needBase = false;
    this._modes = null;
    this._diurnalNorm = 1;
    this._rebuild();
  }

  _rebuild() {
    const c = this.cfg, K = Math.max(2, c.modes | 0);
    this._modes = {
      tone: ouModes(c.toneTau_h * HOUR_S, c.toneSigma_ln, this.seed + 0.11, K),
      stiff: ouModes(c.stiffTau_d * DAY_S, c.stiffSigma_ln, this.seed + 0.37, K),
      sheet: ouModes(c.sheetTau_d * DAY_S, c.sheetSigma_mm, this.seed + 0.59, K),
    };
    // normalise the diurnal shape to half peak-to-trough = 1 (so `diurnalAmp_ln` IS that half-swing)
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 480; i++) { const v = this._diurnalRaw((i / 480) * DAY_S); if (v < lo) lo = v; if (v > hi) hi = v; }
    this._diurnalNorm = 2 / Math.max(1e-9, hi - lo);
    this._diurnalMid = 0.5 * (hi + lo);
  }

  // Configuration. `setConfig` accepts any subset of DRIFT_DEFAULTS; `setSeed` re-draws the OU phases.
  setConfig(patch = {}) { this.cfg = { ...this.cfg, ...patch }; this._rebuild(); return this.cfg; }
  setSeed(s) { this.seed = s; this._rebuild(); }
  // driftClock ×N. Changing it mid-run RE-ANCHORS the clock so physiological time is continuous:
  // the trajectory already produced is kept and only the rate at which it is traversed changes.
  setScale(n, sim_s = null) {
    const v = Math.max(0, isFinite(n) ? n : 1);
    if (this.enabled && sim_s != null) { this.epoch_s = this.physTime(sim_s); this.startSim_s = sim_s; }
    this.scale = v;
  }
  physTime(sim_s) { return this.epoch_s + (sim_s - this.startSim_s) * this.scale; }

  // Turn the drift clock on. Plain-object options only (this call is forwarded over postMessage).
  //   { scale, epochHours, seed, bpCoupling, sensorDrift, config }
  enable(opts = {}) {
    if (opts.config) this.setConfig(opts.config);
    if (opts.seed != null) this.setSeed(opts.seed);
    if (opts.scale != null) this.scale = Math.max(0, opts.scale);
    if (opts.bpCoupling != null) this.bpCoupling = !!opts.bpCoupling;
    if (opts.sensorDrift != null) this.sensorDrift = !!opts.sensorDrift;
    // Physiological time is measured from clock-midnight: t_phys/3600 IS the clock hour (mod 24), so
    // `epochHours` = the wall-clock hour at which the drift clock (and therefore the calibration) starts.
    this.epoch_s = (opts.epochHours != null ? opts.epochHours : 9) * HOUR_S;
    this.enabled = true;
    this._needBase = true;   // the baseline snapshot is taken on the next engine.step()
    return true;
  }
  // Turn it off and put the drifted quantities back where they were (so a UI toggle is reversible).
  disable(engine = null) {
    if (engine && this.base) this._restore(engine);
    this.enabled = false; this._needBase = false; this.base = null; this.last = null;
  }

  _diurnalRaw(t) {
    const c = this.cfg;
    const p = 2 * Math.PI * (t / HOUR_S - c.diurnalPeakHour) / 24;
    return Math.cos(p) + c.diurnalHarmonic * Math.cos(2 * p);
  }
  _diurnal(t) { return (this._diurnalRaw(t) - this._diurnalMid) * this._diurnalNorm; }

  // The whole drift trajectory as a CLOSED-FORM function of physiological time (seconds).
  // This is the function the acceleration-separability proof exercises: it never sees `scale`.
  stateAt(tPhys) {
    const c = this.cfg;
    const lnTone = c.diurnalAmp_ln * this._diurnal(tPhys) + ouEval(this._modes.tone, tPhys);
    const lnStiff = c.stiffTrend_lnPerWeek * (tPhys / WEEK_S) + ouEval(this._modes.stiff, tPhys);
    const days = tPhys / DAY_S;
    return {
      tPhys_s: tPhys, lnTone, lnStiff,
      tone: Math.exp(lnTone), stiff: Math.exp(lnStiff),
      mapF: Math.exp(c.mapExp * lnTone), ppF: Math.exp(c.ppExp * lnStiff),
      contactDelta: -c.contactRelax * (1 - Math.exp(-Math.max(0, days) / c.contactTau_d)),
      sheetDelta_mm: ouEval(this._modes.sheet, tPhys),
    };
  }

  // Snapshot of everything the drift model is going to move, so that it acts MULTIPLICATIVELY on
  // whatever the scenario/UI had configured at the moment the clock was started.
  // `st0` = the trajectory evaluated AT the enable instant; everything the model applies is the RATIO to it,
  // so the drift factors are exactly 1 at t = enable (no jump when the clock is switched on) and the whole
  // metric reads as "drift SINCE the cuff calibration".
  _capture(engine) {
    const c = engine.cardiac, pp = Math.max(1, c.sbp - c.dbp);
    this.base = {
      map: c.dbp + pp / 3, pp, drive: c.drive, tpr: c.tpr,
      contact: engine.capArray.contactPressure,
      sheetLateral_mm: engine.capArray.sheetLateral_mm,
      st0: this.stateAt(this.epoch_s),
    };
    this._needBase = false;
  }
  // The applied (relative-to-calibration) drift factors at physiological time `tPhys`.
  relative(st) {
    const z = this.base ? this.base.st0 : this.stateAt(this.epoch_s);
    return { tone: st.tone / z.tone, stiff: st.stiff / z.stiff, mapF: st.mapF / z.mapF, ppF: st.ppF / z.ppF,
      contactDelta: st.contactDelta - z.contactDelta, sheetDelta_mm: st.sheetDelta_mm - z.sheetDelta_mm };
  }
  _restore(engine) {
    const b = this.base;
    if (this.bpCoupling) { if (b.drive === 'hemo') engine.cardiac.setHemodynamics({ tpr: b.tpr }); else engine.cardiac.setBP(b.map + (2 / 3) * b.pp, b.map - (1 / 3) * b.pp); }
    if (this.sensorDrift) { engine.capArray.setContactPressure(b.contact); engine.capArray.setSheetOffset(b.sheetLateral_mm, null); }
  }
  // Re-anchor the baseline at the CURRENT state (a scenario that deliberately moves the BP set-point or the
  // strap mid-drift calls this so the move is not immediately overwritten by the next drift application).
  rebase(engine) { this._capture(engine); }

  // Called once per engine.step(). Returns { tone, stiff } multipliers for the vascular state and, as a
  // side effect, writes the coupled true-BP / sensor-interface state. `sim_s` is SIMULATION time.
  step(engine, sim_s) {
    if (this._needBase) { this.startSim_s = sim_s; this._capture(engine); }
    const abs = this.stateAt(this.physTime(sim_s));
    const st = this.relative(abs);
    st.tPhys_s = abs.tPhys_s;
    this.last = st;
    const b = this.base;
    if (this.bpCoupling && b) {
      if (engine.cardiac.drive === 'hemo') engine.cardiac.setHemodynamics({ tpr: b.tpr * st.mapF });
      else { const map = b.map * st.mapF, pp = b.pp * st.ppF; engine.cardiac.setBP(map + (2 / 3) * pp, map - (1 / 3) * pp); }
    }
    if (this.sensorDrift && b) {
      engine.capArray.setContactPressure(b.contact + st.contactDelta);
      engine.capArray.setSheetOffset(b.sheetLateral_mm + st.sheetDelta_mm, null);
    }
    return st;
  }

  // Compact read-out for `engine.latest` / the UI (plain, structured-cloneable).
  readout() {
    if (!this.enabled || !this.last) return null;
    const s = this.last;
    return { scale: this.scale, tPhys_s: s.tPhys_s, tPhys_h: s.tPhys_s / HOUR_S, tPhys_d: s.tPhys_s / DAY_S,
      elapsed_h: (s.tPhys_s - this.epoch_s) / HOUR_S, clockHour: (s.tPhys_s / HOUR_S) % 24,
      tone: s.tone, stiff: s.stiff, mapF: s.mapF, ppF: s.ppF, contactDelta: s.contactDelta, sheetDelta_mm: s.sheetDelta_mm,
      bpCoupling: this.bpCoupling, sensorDrift: this.sensorDrift };
  }
}

// ---------------------------------------------------------------------------------------------------
// Windkessel hemodynamic layer (ROADMAP §2.1 item 1). ALL constants are MODEL ASSUMPTIONS.
//
// Two-element (RC) Windkessel with an idealised RECTANGULAR ejection of SV over LVET, solved
// analytically for the steady-state cycle:
//     C·dP/dt = Q(t) − P/R,   Q = SV/LVET on [0, LVET), 0 on [LVET, RR),   τ = R·C
//   a = e^{−LVET/τ},  b = e^{−(RR−LVET)/τ},  E = a·b = e^{−RR/τ}
//   P_sys = R·(SV/LVET)·(1−a)/(1−E),   P_dia = b·P_sys,   PP = (SV/C)·Φ,
//     Φ(RR, LVET, τ) = (τ/LVET)·(1−a)(1−b)/(1−E)      ← the HR / run-off dependence of PP
//   MAP  = R·Q̄ = TPR·SV/RR                             ← exact cycle-mean of the same RC system
// The layer reports MAP and PP; SBP/DBP are then written with the twin's OWN mean-pressure convention
//   SBP = MAP + 2·PP/3,  DBP = MAP − PP/3    (i.e. MAP = DBP + PP/3, the formula engine.js and the
// estimators already use). The raw RC waveform's own form factor is ≈0.49, so this mapping is a
// DELIBERATE simplification kept for internal consistency, not a second physical claim (audit §6.13).
//
// Compliance is NOT a new stiffness axis: it reuses the twin's existing Bramwell–Hill law (D ∝ 1/PWV²,
// audit B-2) at the AORTIC ROOT, whose tone/stiffness exponents come from anatomy.js segmentWeights()
// (root: ws = 1.0, wt = 0.1 — age stiffening acts on the elastic aorta, vasomotor tone hardly at all):
//     M_root = tone^wt · stiff^ws · pwvPressureGain(MAP),   C = C_REF / M_root²
// so raising `ageStiffness` raises PP exactly as it raises the root PWV — one axis, two consequences.
// (The `mismatch` knob of engine.js is deliberately NOT applied here: it is a propagation/sensor
// mismatch device, not a cardiac one.)
//
// Units: SV mL · TPR mmHg·s/mL · C mL/mmHg · CO L/min. TPR excludes central venous pressure (P_v = 0
// assumed), so TPR ≈ SVR/80 + ~0.06 versus the clinical dyn·s·cm⁻⁵ convention.
// Reference operating point: C_REF 1.05 mL/mmHg at tone = stiff = 1 → at 118/76 mmHg, HR 72 the solve
// returns SV ≈ 71 mL, TPR ≈ 1.06 mmHg·s/mL (CO ≈ 5.1 L/min, SVR ≈ 1410 dyn·s·cm⁻⁵) — literature-plausible.
const WK = {
  C_REF: 1.05,      // systemic arterial compliance at the reference vascular state (mL/mmHg)
  SV_MIN: 10, SV_MAX: 220,
  TPR_MIN: 0.2, TPR_MAX: 5.0,
  MAP_MIN: 30, MAP_MAX: 220,   // clamps on the DERIVED pressures (hemo drive) — keep the twin numerically sane
  PP_MIN: 5, PP_MAX: 140,
  SOLVE_ITERS: 16, SOLVE_TOL: 1e-10,
};

// Pulsus paradoxus (ROADMAP §2.1 item 6). Inspiration → intrathoracic pressure falls → RV filling rises
// but LV preload falls (pulmonary pooling + septal shift) → LV stroke volume, and therefore PP, dips.
// `pulsusParadoxus_mmHg` = the PEAK-TO-TROUGH respiratory swing of SBP (normal 3–8 mmHg; > 10–12 is the
// clinical "pulsus paradoxus" of tamponade/severe asthma). It is applied as a per-beat PP multiplier on
// the SAME `amp` channel the AF pulse deficit and PVC already use, so DBP stays at the beat-onset level —
// a documented simplification (a full Windkessel would move DBP by ≈ PP/3 of the swing too).
// LAG: the SBP dip follows the inspiratory pressure change by ~1–2 beats because the reduced pulmonary
// venous return needs a pulmonary transit time to reach the LV — modelled as RESP_LAG_BEATS·RR. Model
// assumption (the literature gives the phase relation, not a lag constant).
const RESP_LAG_BEATS = 1.5;
const PULSUS_DEFAULT_MMHG = 3.0; // low end of the normal 3–8 mmHg range

export const RHYTHMS = {
  normal: { label: '정상동리듬 (NSR)', hrRange: [60, 90], hrv: 1.0, irregular: false },
  tachycardia: { label: '동성빈맥', hrRange: [100, 150], hrv: 0.45, irregular: false },
  bradycardia: { label: '동성서맥', hrRange: [40, 58], hrv: 1.2, irregular: false },
  afib: { label: '심방세동 (AFib)', hrRange: [70, 130], hrv: 0, irregular: true, rrCV: AF_RR_SIGMA_LN },
  pvc: { label: '조기심실수축 (PVC) 삽입', hrRange: [65, 85], hrv: 1.0, irregular: false, ectopicEvery: 6 },
};

export class CardiacModel {
  constructor() {
    this.rhythm = 'normal';
    this.hr = 72; // bpm, mean
    this.sbp = 118;
    this.dbp = 76;
    this.reflectionGain = 1.0; // wave-reflection amplitude multiplier (stiffer/constricted vessels → larger reflection)
    this.reflectionTiming = 1.0; // total PWV multiplier (tone·stiffness·pressure): faster PWV → the reflected wave returns earlier

    // ---- Windkessel layer (see WK above) ----
    this.drive = 'bp';            // 'bp' = setBP fixes SBP/DBP, (SV, TPR) are solved (DEFAULT, backward compatible)
                                  // 'hemo' = setHemodynamics fixes (SV, TPR), SBP/DBP are derived
    this.arteryToneScalar = 1.0;  // mirrors engine.arteryToneScalar (set by engine.setVascularState)
    this.ageStiffness = 1.0;      // mirrors engine.ageStiffness
    this.complianceRef_mL_mmHg = WK.C_REF;
    this.sv_mL = 70;              // stroke volume — read-out in 'bp' drive, driver in 'hemo' drive
    this.tpr = 1.07;              // total peripheral resistance, mmHg·s/mL — ditto
    this.compliance_mL_mmHg = WK.C_REF; // derived arterial compliance C
    this.map_mmHg = 90;           // derived mean arterial pressure (= dbp + pp/3)

    // ---- Respiration (shared phase source) ----
    this.respiration = new RespirationModel();
    this.pulsusParadoxus_mmHg = PULSUS_DEFAULT_MMHG; // peak-to-trough respiratory SBP swing (0 = off, 0–20)
    this.respLagBeats = RESP_LAG_BEATS;

    this._beatCache = new Map(); // beatIndex -> {onset, rr, ectopic, amp}
    this._lastBeatIndexComputed = -1;
    this._cumTime = [0]; // cumulative beat onset times
    this._normCache = new Map(); // `${rr}|${g}|${M}` -> {lo, hi} for per-beat shape normalisation
  }

  setRhythm(name) {
    if (!RHYTHMS[name]) return;
    this.rhythm = name;
    const [lo, hi] = RHYTHMS[name].hrRange;
    this.hr = Math.round((lo + hi) / 2);
    this._resetTimeline();
    this.updateHemodynamics();
  }

  // In the 'bp' drive this only re-solves the (SV, TPR) read-outs; in the 'hemo' drive it MOVES the
  // blood pressure (MAP = TPR·SV·HR/60), which is the physiological behaviour ROADMAP §2.1-1 asked for.
  setHR(bpm) {
    this.hr = bpm;
    this._resetTimeline();
    this.updateHemodynamics();
  }

  // Backward-compatible pressure drive: SBP/DBP are the set-points, (SV, TPR) are solved from them.
  // Every existing scenario, slider and stored result keeps its exact meaning.
  setBP(sbp, dbp) {
    this.drive = 'bp';
    this.sbp = sbp;
    this.dbp = dbp;
    this.updateHemodynamics();
  }

  // Direct hemodynamic drive (ROADMAP §2.1-1): SBP/DBP become DERIVED quantities and HR moves BP.
  //   setHemodynamics({ sv, tpr })  — mL, mmHg·s/mL; omitted fields keep their current value.
  setHemodynamics({ sv = null, tpr = null } = {}) {
    this.drive = 'hemo';
    if (sv != null && isFinite(sv)) this.sv_mL = Math.max(WK.SV_MIN, Math.min(WK.SV_MAX, sv));
    if (tpr != null && isFinite(tpr)) this.tpr = Math.max(WK.TPR_MIN, Math.min(WK.TPR_MAX, tpr));
    this.updateHemodynamics();
  }

  // Switch to the hemodynamic drive AT the currently solved (SV, TPR) — the BP does not jump, but from
  // now on HR/SV/TPR changes move it. This is how the eval scenarios enter 'hemo' mode.
  useSolvedHemodynamics() {
    this.updateHemodynamics();          // make sure sv/tpr reflect the present SBP/DBP
    return this.setHemodynamics({ sv: this.sv_mL, tpr: this.tpr });
  }

  // Vascular state mirror (called by engine.step): tone / stiffness feed the compliance law.
  setVascularState(toneScalar = 1, ageStiffness = 1) {
    this.arteryToneScalar = toneScalar;
    this.ageStiffness = ageStiffness;
  }

  // Mean systolic ejection time for the mean RR — same Weissler regression the beat shape uses.
  _meanLvet(rr) {
    const hr = 60 / Math.max(0.3, rr);
    return Math.max(0.2, Math.min(0.45, Math.min(0.413 - 0.0017 * hr, 0.7 * rr)));
  }

  // Arterial compliance from the twin's own Bramwell–Hill law at the aortic root (see WK header).
  _compliance(map_mmHg) {
    const w = segmentWeights(ARTERIAL_PATH[0]); // aortic root → ws = 1.0, wt = 0.1
    const M = Math.pow(Math.max(0.05, this.arteryToneScalar), w.wt)
            * Math.pow(Math.max(0.05, this.ageStiffness), w.ws)
            * pwvPressureGain(map_mmHg);
    return this.complianceRef_mL_mmHg / Math.max(1e-6, M * M);
  }

  // Φ(RR, LVET, τ): the RC-Windkessel pulse-pressure factor, PP = (SV/C)·Φ (derivation in the WK header).
  _ppFactor(rr, lvet, tau) {
    const t = Math.max(0.05, tau), L = Math.max(0.05, Math.min(lvet, 0.95 * rr));
    const a = Math.exp(-L / t), b = Math.exp(-(rr - L) / t), E = a * b;
    return (t / L) * (1 - a) * (1 - b) / Math.max(1e-9, 1 - E);
  }

  // Recompute the Windkessel state. 'bp' drive: solve (SV, TPR) for the current SBP/DBP (read-outs only —
  // SBP/DBP are untouched, so the produced signals are bit-identical to the pre-§6.13 twin).
  // 'hemo' drive: MAP = TPR·SV/RR and PP = (SV/C)·Φ give SBP/DBP.
  updateHemodynamics() {
    const rr = 60 / Math.max(20, Math.min(240, this.hr));
    const lvet = this._meanLvet(rr);
    if (this.drive === 'hemo') {
      const map = Math.max(WK.MAP_MIN, Math.min(WK.MAP_MAX, this.tpr * this.sv_mL / rr));
      const C = this._compliance(map);
      const pp = Math.max(WK.PP_MIN, Math.min(WK.PP_MAX, (this.sv_mL / C) * this._ppFactor(rr, lvet, this.tpr * C)));
      this.map_mmHg = map;
      this.compliance_mL_mmHg = C;
      this.sbp = map + (2 / 3) * pp;
      this.dbp = map - (1 / 3) * pp;
    } else {
      const pp = Math.max(1, this.sbp - this.dbp);
      const map = this.dbp + pp / 3;
      const C = this._compliance(map);
      // Fixed point on SV: TPR = MAP·RR/SV and SV = PP·C/Φ(τ = TPR·C). Converges in a few iterations.
      let sv = pp * C;
      for (let i = 0; i < WK.SOLVE_ITERS; i++) {
        const tpr = map * rr / Math.max(1e-6, sv);
        const next = pp * C / Math.max(1e-9, this._ppFactor(rr, lvet, tpr * C));
        const done = Math.abs(next - sv) < WK.SOLVE_TOL;
        sv = next;
        if (done) break;
      }
      this.map_mmHg = map;
      this.compliance_mL_mmHg = C;
      this.sv_mL = Math.max(WK.SV_MIN, Math.min(WK.SV_MAX, sv));
      this.tpr = Math.max(WK.TPR_MIN, Math.min(WK.TPR_MAX, map * rr / Math.max(1e-6, this.sv_mL)));
    }
  }

  // Derived read-outs for the UI / evaluation harnesses.
  hemodynamics() {
    return {
      drive: this.drive,
      sv_mL: this.sv_mL,
      tpr: this.tpr,
      co_L_min: this.sv_mL * this.hr / 1000,
      compliance_mL_mmHg: this.compliance_mL_mmHg,
      map_mmHg: this.map_mmHg,
      pp_mmHg: this.sbp - this.dbp,
      sbp: this.sbp, dbp: this.dbp,
      resp_bpm: this.respiration.rate_bpm,
      respDepth: this.respiration.depth,
      pulsusParadoxus_mmHg: this.pulsusParadoxus_mmHg,
    };
  }

  // Per-beat respiratory PP multiplier (pulsus paradoxus), evaluated at the beat ONSET and lagged by
  // respLagBeats·RR (pulmonary transit). Peak inspiration → PP (and therefore SBP) at its minimum.
  _respPPFactor(onset, rr) {
    const A = this.pulsusParadoxus_mmHg * this.respiration.depth;
    if (!(A > 0)) return 1;
    const pp = Math.max(1, this.sbp - this.dbp);
    const lagged = onset - this.respLagBeats * rr;
    return Math.max(0.2, 1 - 0.5 * (A / pp) * this.respiration.signal(lagged));
  }

  _resetTimeline() {
    this._beatCache.clear();
    this._cumTime = [0];
  }

  // Lazily extend the beat-onset timeline up to time t (seconds).
  // Each cached beat carries: onset, rr (interval from this onset to the next), ectopic flag and
  // `amp` = pulse-pressure multiplier applied in pressureAt (1.0 for normal beats → SBP exact).
  _ensureTimelineUntil(t) {
    let idx = this._cumTime.length - 1;
    while (this._cumTime[idx] < t + 2) {
      const rhythmDef = RHYTHMS[this.rhythm];
      const meanRR = 60 / this.hr;
      const onset = this._cumTime[idx];
      const prev = idx > 0 ? this._beatCache.get(idx - 1) : null;
      const rrPrev = prev ? prev.rr : meanRR;
      let rr = meanRR;
      let ectopic = false;
      let amp = 1.0;

      if (rhythmDef.irregular) {
        // AFib: irregularly irregular RR — independent log-normal draws, CV ≈ rrCV (≈0.23)
        const s = rhythmDef.rrCV || AF_RR_SIGMA_LN;
        rr = meanRR * Math.exp(s * hashGauss(idx * 3.17 + 0.5) - 0.5 * s * s);
        rr = Math.max(0.30, Math.min(1.9, rr));
        // Pulse deficit: PP of this beat depends on the preceding (filling) interval
        amp = Math.max(AF_PP.min, Math.min(AF_PP.max, AF_PP.base + AF_PP.slope * (rrPrev / meanRR)));
      } else {
        // Sinus rhythms: RSA + LF + random, evaluated at the beat onset time (deterministic)
        const k = rhythmDef.hrv || 0;
        // RSA is phase-locked to the SHARED respiration signal (audit §6.13) — the same oscillator that
        // drives the pulsus-paradoxus SBP dip, the venous pump and the PPG/capacitive baseline terms.
        // depth = 1 and rate = 0.25 Hz reproduce the historical term exactly.
        const rsa = -HRV.rsaFrac * this.respiration.depth * this.respiration.signal(onset); // inspiration (lift +) → RR shortens
        const lf = HRV.lfFrac * Math.sin(2 * Math.PI * HRV.lfHz * onset + 1.1);
        const rnd = HRV.randFrac * hashGauss(idx * 1.91 + 0.11);
        rr = meanRR * (1 + k * (rsa + lf + rnd));
      }

      if (rhythmDef.ectopicEvery) {
        const n = rhythmDef.ectopicEvery;
        if (idx > 0 && idx % n === 0) {
          // This beat is the PVC: its pulse is small, and the interval to the next (normal) beat is the
          // compensatory pause (N–PVC–N = 2·RR).
          rr = meanRR * PVC.pause;
          ectopic = true;
          amp = PVC.amp;
        } else if ((idx + 1) % n === 0) {
          // Normal beat cut short by the coupling interval of the upcoming PVC.
          rr = meanRR * PVC.coupling;
        } else if (idx > 0 && (idx - 1) % n === 0) {
          // Post-extrasystolic potentiation of the beat following the pause.
          amp = PVC.pespAmp;
        }
      }

      this._cumTime.push(onset + rr);
      this._beatCache.set(idx, { onset, rr, ectopic, amp });
      idx++;
    }
  }

  // Returns { beatIndex, phase (0..1 within beat), rr, ectopic, amp } for time t.
  _beatStateAt(t) {
    this._ensureTimelineUntil(t);
    let lo = 0, hi = this._cumTime.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this._cumTime[mid] <= t) lo = mid + 1; else hi = mid;
    }
    const beatIndex = Math.max(0, lo - 1);
    const onset = this._cumTime[beatIndex];
    const meta = this._beatCache.get(beatIndex) || { rr: 60 / this.hr, ectopic: false, amp: 1 };
    const phase = meta.rr > 0 ? (t - onset) / meta.rr : 0;
    return { beatIndex, onset, phase: Math.max(0, Math.min(1, phase)), rr: meta.rr, ectopic: !!meta.ectopic, amp: meta.amp ?? 1 };
  }

  // Single-beat shape, defined in ABSOLUTE time (s from beat onset) and normalised per beat so that
  // min = 0 (DBP) and max = 1 (SBP) exactly. Components (audit 2026-08-23, B-1):
  //   • systolic peak         Gaussian at 0.12 s (σ 0.04 s), tail-corrected so it is exactly 0 at onset
  //   • late-systolic plateau 0.62·(1 − e^{−t/0.04}) up to end-systole LVET, then exponential diastolic
  //                           run-off with τ = 0.30 s (Windkessel-like RC decay) RESCALED so that it reaches
  //                           the onset level (0) exactly at t = RR: no step at the beat boundary
  //                           (decay(t) = 0.62·(e^{−(t−LVET)/τ} − e^{−(RR−LVET)/τ}) / (1 − e^{−(RR−LVET)/τ}));
  //                           form factor ≈ 0.35–0.4
  //   • reflected wave        0.35·g · Gaussian at tR = 0.33 s / M (return time ∝ 1/PWV multiplier; σ 0.05 s),
  //                           windowed to 0 within the last ~50 ms of the beat (short RR / early next beat)
  //   • dicrotic notch        −0.10 · Gaussian at LVET (σ 18 ms); LVET = 0.413 − 0.0017·HR (Weissler)
  // Ectopic (PVC) beat: broad low systolic hump at 0.14 s (σ 50 ms) + slow diastolic hump at 0.30 s
  // (σ 140 ms), max 1 (the PVC's reduced PP is applied by `amp`), also 0 at the boundaries.
  // Constants are model assumptions (not literature values); see docs/CLINICAL_AUDIT.md.
  // `rr` MUST be the rr of the beat that contains the evaluated time (see _beatStateAt), so that the
  // per-beat normalisation follows the actual beat even when pressureAt(t − delay) crosses into the
  // previous beat.
  _beatShape(phase, ectopic, rr = 60 / this.hr) {
    const t = phase * rr;
    const edge = 1 - Math.exp(-(((rr - t) / 0.05) ** 2)); // → 0 at t = RR (boundary window)
    if (ectopic) {
      // tails at t = 0 removed (Gaussian − value at onset) so the PVC beat starts exactly at 0
      const p0 = gaussian(0, 0.14, 0.05), h0 = gaussian(0, 0.30, 0.14);
      const peak = Math.max(0, gaussian(t, 0.14, 0.05) - p0) / (1 - p0);
      const hump = 0.45 * Math.max(0, gaussian(t, 0.30, 0.14) - h0) / (1 - h0);
      return Math.max(0, Math.min(1, Math.max(peak, hump) * edge));
    }
    const g = this.reflectionGain;
    const M = Math.max(0.5, Math.min(2.2, this.reflectionTiming));
    const hr = 60 / Math.max(0.3, rr);
    const lvet = Math.max(0.2, Math.min(0.45, Math.min(0.413 - 0.0017 * hr, 0.7 * rr)));
    const tR = Math.max(0.16, Math.min(0.48, 0.33 / M)); // reflected (diastolic) wave: 330 ms after onset at M=1 (peripheral-type timing, clear of the notch), ∝ 1/M
    const G0 = gaussian(0, 0.12, 0.04); // systolic Gaussian tail at onset (≈0.011) — removed so shape(0) = 0
    const eEnd = Math.exp(-(rr - lvet) / TAU_DIAST);
    const raw = (tt) => {
      const peak = Math.max(0, gaussian(tt, 0.12, 0.04) - G0) / (1 - G0);
      const plateau = tt < lvet
        ? 0.62 * (1 - Math.exp(-tt / 0.04))
        : 0.62 * (Math.exp(-(tt - lvet) / TAU_DIAST) - eEnd) / Math.max(1e-6, 1 - eEnd);
      const w = 1 - Math.exp(-(((rr - tt) / 0.05) ** 2));
      const reflected = 0.35 * g * gaussian(tt, tR, 0.05) * w;
      const notch = -0.10 * gaussian(tt, lvet, 0.018) * w;
      return peak + plateau + reflected + notch;
    };
    // min/max over the beat (cached per rr/g/M) so DBP and SBP are exact
    const key = `${rr.toFixed(3)}|${g.toFixed(3)}|${M.toFixed(3)}`;
    let nm = this._normCache.get(key);
    if (!nm) {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i <= 200; i++) { const v = raw((i / 200) * rr); if (v < lo) lo = v; if (v > hi) hi = v; }
      nm = { lo, hi: Math.max(hi, lo + 1e-6) };
      if (this._normCache.size > 64) this._normCache.clear();
      this._normCache.set(key, nm);
    }
    return Math.max(0, Math.min(1, (raw(t) - nm.lo) / (nm.hi - nm.lo)));
  }

  // Aortic root pressure (mmHg) at time t (seconds).
  // Normal beats: DBP + PP·shape (DBP and SBP exact). AF beats (pulse deficit) and ectopic /
  // post-extrasystolic beats carry a per-beat `amp` multiplier on PP, so their SBP may fall short of,
  // or exceed, the nominal SBP — physiological; DBP stays the beat-onset level.
  // Respiratory (pulsus paradoxus) modulation multiplies the same per-beat PP channel.
  pressureAt(t) {
    const { phase, ectopic, rr, amp, onset } = this._beatStateAt(t);
    const shape = this._beatShape(phase, ectopic, rr);
    const pp = (this.sbp - this.dbp) * amp * this._respPPFactor(onset, rr);
    return this.dbp + shape * pp;
  }

  // Per-beat pulse-pressure multiplier in effect at time t (1.0 for normal beats without respiration coupling).
  beatAmplitudeAt(t) {
    const { amp, onset, rr } = this._beatStateAt(t);
    return amp * this._respPPFactor(onset, rr);
  }

  // Instantaneous heart rate estimate (bpm) at time t, from local RR interval.
  instantHR(t) {
    const { rr } = this._beatStateAt(t);
    return rr > 0 ? 60 / rr : this.hr;
  }

  beatEventsInWindow(t0, t1) {
    this._ensureTimelineUntil(t1);
    const events = [];
    for (const [idx, meta] of this._beatCache) {
      if (meta.onset >= t0 && meta.onset <= t1) events.push({ idx, ...meta });
    }
    return events.sort((a, b) => a.onset - b.onset);
  }
}
