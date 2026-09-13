// Sheet re-placement / attachment-state monitor — JS mirror of rust/dt-core/src/attach.rs (`AttachmentMonitor`, 2nd design
// 2026-08-24). Same inputs, thresholds, evidence, state machine and output keys as the Rust core (the operating core); this
// mirror exists so the JS reference core (`?core=js`, eval/wasm_parity.mjs) emits the same `attach` block and
// `recalRequired` / `contactChange` flags. (2026-08-25: the JS core DOES feed the IMU now — pronation-compensated x̂ and
// the motion gate are mirrored; before that it passed `motion: false` / `xImu_mm: 0` as constants and the gate never
// fired in any window. The Rust core subtracts 0.056 mm/deg · ∫gyroY and suspends evaluation
// during bursts); the array-ingest gate lags the Rust core by one window (see core.js).
//
// Evidence — every threshold RELATIVE to the session's own variability (max(design floor, K_SIG × robust scale of the cue
// over the clean windows of the calibration window; scale = max(1.4826·MAD, ½(q90 − q10)), tracked while stable):
//   ex = |Δx̂| / max(1.5 mm, K·s_x)                                          PRIMARY (calibration-anchored)
//   ep = (sim_ref − cos(pattern, pattern_ref)) / max(0.1, K·s_sim)          corroborating ≤ 0.5 (pattern_ref = medoid of the
// 3rd tuning pass (2026-08-24, attach.rs header + docs/CLINICAL_AUDIT.md §6.12): the self-scaled thresholds were
// self-fulfilling on a sparse patch (a 20 s scale window sits inside one blind-MRC lock dwell, and the scale stopped
// learning as soon as the monitor left `stable`). Now: SCALE_S = 60 s horizon, DETRENDED robust scale (a lock switch
// still widens, a slow creep does not), session HIGH-WATER thresholds, and the pattern scale learns in every state
// upward-only. Real-data standard alarms 9/10 → 8/10, shifted dwell 32 % → 26.5 %, synthetic latencies unchanged.
//        clean calibration-window patterns, sim_ref = their median similarity to it)
//   ea = |ln(A/A0) + 2·ln(M/M0)| / ln 1.6 (amplitude residual after the estimator's own distensibility state; PP cannot
//        be separated from coupling by the array alone → corroborating ≤ 0.25)
//   eb = DC step / 6 A (corroborating ≤ 0.25)
//   shiftScore = min(1, ex + 0.5·min(1, ep) + 0.25·min(1, ea) + 0.25·min(1, eb))
// stable → transient (raw step: DC ≥ 3 A / in-window excursion / |Δx̂| ≥ x_thr / |amp residual| ≥ ln 2.5, sustained 1.5 s) →
// stable (score < 0.5 for 1.5 s) | shifted (score ≥ 1 for 4.5 s, or ≥ 0.75 with ex ≥ 0.5 after 12 s; an undecided transient
// re-anchors the EPOCH references: pattern medoid + level, pre-event DC — never x̂ / A0); detached when A/A0 < 0.15 or no
// beats for 2 s, or beat SNR < 3 dB for 4 s; shifted/detached latch recalRequired until calibrate(). Contact index: drift-
// compensated common-mode DC change over 4 s (A units); |c| ≥ max(0.1 A, K·s_cm) for 3 s latches contactChange (warn only).
// Reference: x̂ = shorth (mode) of the clean calibration-window x̂, pattern = medoid; < MIN_REF_N clean windows = IMMATURE
// (no x̂/pattern/amplitude evidence) until re-taken from the first MIN_REF_N clean windows after the calibration.

export const ATTACH_STATES = ['uncalibrated', 'stable', 'transient', 'shifted', 'detached'];
const X_THR_MM = 1.5, SIM_DEV_FLOOR = 0.1, K_SIG = 3.0, MIN_REF_N = 8, SCALE_TAU_S = 10.0;
const AMP_HI = 1.6, AMP_OPEN = 2.5, PAT_MAX_SCORE = 0.5, AMP_MAX_SCORE = 0.25, BASE_MAX_SCORE = 0.25;
const BASE_OPEN_A = 3.0, BASE_SCALE_A = 6.0;
const DETACH_AMP = 0.15, DETACH_SNR_DB = 3.0, DETACH_S = 2.0, DETACH_SNR_ONLY_S = 4.0, REATTACH_AMP = 0.3, REATTACH_SNR_DB = 6.0;
const CONTACT_MIN_A = 0.05, CONTACT_K = 3.0, CONTACT_HOLD_S = 3.0, CONTACT_DT_S = 4.0, CONTACT_COMP_S = 10.0;
const SHORT_S = 1.5, CONFIRM_S = 4.5, CALM_S = 1.5, SETTLE_MAX_S = 12.0, TOL = 0.5, SETTLE_SCORE = 0.75, SETTLE_EX = 0.5, REF_S = 16.0, HIST_S = 20.0, MOTION_SETTLE_S = 1.0;
// motion-burst gate (mirror of attach.rs MOTION_PRON_DPS / MOTION_ACC_G) — exported because the JS core now feeds
// the IMU (until 2026-08-25 it passed `motion: false` as a constant and the gate never fired, audit §6.17 (D))
export const MOTION_PRON_DPS = 20.0, MOTION_ACC_G = 0.05;
// 5th pass: horizon (s) of the x̂ / pattern SCALE estimate and of the history retention — a 20 s window sits inside one
// blind-MRC lock dwell on a sparse patch, so the threshold collapsed to its floor between switches (attach.rs SCALE_S)
const SCALE_S = 60.0;
const Q_GATE = 0.15;

const median = (v) => { const s = v.filter((x) => Number.isFinite(x)).sort((a, b) => a - b), m = s.length; if (!m) return null; return m % 2 ? s[m >> 1] : 0.5 * (s[m / 2 - 1] + s[m / 2]); };
const quantileSorted = (s, q) => { const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
// mode estimate (shorth: midpoint of the shortest interval holding half the values) — a bimodal cue anchors on ONE mode
const shorth = (v) => { const s = v.filter((x) => Number.isFinite(x)).sort((a, b) => a - b), n = s.length; if (!n) return null; const h = (n + 1) >> 1; if (h < 2) return s[n >> 1]; let best = Infinity, bi = 0; for (let i = 0; i + h - 1 < n; i++) { const w = s[i + h - 1] - s[i]; if (w < best) { best = w; bi = i; } } return 0.5 * (s[bi] + s[bi + h - 1]); };
// robust scale max(1.4826·MAD, ½(q90 − q10)); 0 with fewer than MIN_REF_N values (floors only)
const robustScale = (v) => { const s = v.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); if (s.length < MIN_REF_N) return 0; const med = quantileSorted(s, 0.5); const dev = s.map((x) => Math.abs(x - med)).sort((a, b) => a - b); return Math.max(1.4826 * quantileSorted(dev, 0.5), 0.5 * (quantileSorted(s, 0.9) - quantileSorted(s, 0.1))); };
// Robust scale over the LONG horizon after removing the half-span-median linear trend: a lock SWITCH (step) still
// widens the threshold, a slow sheet CREEP (ramp) does not (attach.rs `detrended_scale`).
const detrendedScale = (v) => {
  const f = v.filter((x) => Number.isFinite(x)); const m = f.length;
  if (m < MIN_REF_N) return 0;
  if (m < 8) return robustScale(f);
  const m1 = median(f.slice(0, m >> 1)), m2 = median(f.slice(m >> 1));
  if (m1 == null || m2 == null) return robustScale(f);
  const half = m / 2, d = m2 - m1;
  return robustScale(f.map((x, i) => x - d * (i - half) / half));
};
const cosine = (a, b) => { if (!a || !b || a.length !== b.length || !a.length) return null; let ab = 0, aa = 0, bb = 0; for (let i = 0; i < a.length; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; } return aa > 0 && bb > 0 ? Math.max(-1, Math.min(1, ab / Math.sqrt(aa * bb))) : null; };
const medianVec = (vs) => { if (!vs.length) return null; const n = vs[0].length, out = new Array(n); for (let k = 0; k < n; k++) { const col = []; for (const v of vs) if (v.length === n) col.push(v[k]); const m = median(col); if (m == null) return null; out[k] = m; } return out; };
// medoid: the member with the largest mean cosine to the others (< 3 members → the first)
const medoid = (vs) => { if (!vs.length) return null; if (vs.length < 3) return vs[0].slice(); let best = -Infinity, bi = 0; for (let i = 0; i < vs.length; i++) { let s = 0; for (let j = 0; j < vs.length; j++) if (i !== j) s += cosine(vs[i], vs[j]) ?? 0; if (s > best) { best = s; bi = i; } } return vs[bi].slice(); };

export class AttachmentMonitor {
  constructor() { this.reset(); }
  reset() {
    this.state = 'uncalibrated'; this.reference = null;
    this.hist = []; this.sX = 0; this.sSim = 0; this.sCm = 0; this.sXMax = 0; this.sSimMax = 0;
    this.dcPre = null; this.pendingSince = null; this.eventT = null;
    // accumulated EVALUABLE time (s; clean / un-bumped windows only — a bump in the window or a motion burst pauses the decision)
    this.holdAcc = 0; this.calmAcc = 0; this.detachAcc = 0; this.detachAmpAcc = 0; this.reattachAcc = 0; this.detachStart = null;
    this.motionUntil = -Infinity; this.latched = false; this.contactAcc = 0; this.contactLatched = false; this.calT = NaN; this.lastT = NaN;
    this.out = AttachmentMonitor.empty();
  }
  static empty() { return { state: 'uncalibrated', shiftScore: 0, lateralShift_mm: null, baselineStep: 0, patternSim: null, ampRatio: null, sinceEvent_s: null, recalRequired: false, motion: false, contactIdx: null, contactChange: false, xThr_mm: X_THR_MM, simThr: SIM_DEV_FLOOR }; }

  // CONTACT component of the per-channel DC change between two windows (6th pass, audit §6.17 (D); mirror of
  // rust attach.rs `contact_component`). The window mean of a channel is `baseline_k + ⟨p⟩·A_k` and each channel's
  // pulse amplitude A_k ∝ its coupling gain pattern_k, so a tone drift / exercise PP rise moves the MEDIAN channel
  // DC by ≈ 0.2 A — the size of a real contact step. Fitting `Δdc_k = α + β·pattern_k` across channels puts the
  // amplitude change in β and a uniform contact/pressure change in α; the index is α.
  static _contactComponent(now, then) {
    const n = Math.min(now.dcWin.length, then.dcWin.length, now.pattern.length, then.pattern.length);
    const d = [], p = [];
    for (let k = 0; k < n; k++) { d.push(now.dcWin[k] - then.dcWin[k]); p.push(0.5 * (now.pattern[k] + then.pattern[k])); }
    if (n >= 3) {
      const pm = p.reduce((a, b) => a + b, 0) / n, dm = d.reduce((a, b) => a + b, 0) / n;
      let spp = 0, spd = 0;
      for (let k = 0; k < n; k++) { spp += (p[k] - pm) * (p[k] - pm); spd += (p[k] - pm) * (d[k] - dm); }
      if (spp > 1e-18) return dm - (spd / spp) * pm;
    }
    return median(d) ?? 0;
  }
  // contact-component change over CONTACT_DT_S for every window at t ≥ t0 with a partner ≥ CONTACT_DT_S earlier
  _cmDiffs(t0) {
    const v = this.hist, out = []; let j = 0;
    for (let i = 0; i < v.length; i++) {
      const t = v[i].t; if (t < t0) continue;
      while (j + 1 < i && v[j + 1].t <= t - CONTACT_DT_S) j++;
      if (v[j].t <= t - CONTACT_DT_S && j < i) out.push({ t, d: AttachmentMonitor._contactComponent(v[i], v[j]) });
    }
    return out;
  }
  // epoch reference from the clean windows of the last `span` s: {pattern (medoid), simLevel, x, amp, dc, sX, sSim, sCm}
  _epoch(t, span) {
    const t0 = t - span, win = this.hist.filter((s) => s.t >= t0); if (!win.length) return null;
    const clean = win.filter((s) => s.clean);
    const pats = clean.map((s) => s.pattern).filter((p) => p.some((v) => v > 0));
    const pattern = medoid(pats) || medianVec(win.map((s) => s.pattern)) || win[win.length - 1].pattern.slice();
    const sims = clean.map((s) => cosine(s.pattern, pattern)).filter((v) => v != null);
    const simLevel = median(sims) ?? 1;
    const xs = clean.map((s) => s.x).filter((v) => v != null);
    const amps = clean.map((s) => s.amp).filter((a) => a != null && a > 0);
    const dc = medianVec(win.map((s) => s.dcShort)) || [];
    const cms = this._cmDiffs(t0).map((q) => q.d);
    return { pattern, simLevel, x: shorth(xs), amp: median(amps) ?? 0, dc, sX: robustScale(xs), sSim: robustScale(sims), sCm: robustScale(cms), nClean: clean.length };
  }

  // Calibration reference snapshot (clean windows of the last REF_S); false without history. An IMMATURE reference
  // (< MIN_REF_N clean windows) carries no x̂ / pattern / amplitude evidence and is re-taken from the first MIN_REF_N clean
  // windows after the calibration (the monitor's own reference — the BP calibration is not touched).
  snapshot() {
    const t = this.lastT; if (!isFinite(t) || !this.hist.length) return false;
    const e = this._epoch(t, REF_S); if (!e) return false;
    this.reference = { x: e.x, pattern: e.pattern, simLevel: e.simLevel, amp: e.amp, mature: e.nClean >= MIN_REF_N };
    this.sX = e.sX; this.sSim = e.sSim; this.sCm = e.sCm; this.sXMax = e.sX; this.sSimMax = e.sSim; this.calT = t;
    this.dcPre = e.dc.slice(); this.pendingSince = null; this.eventT = null; this.holdAcc = 0; this.calmAcc = 0;
    this.detachAcc = 0; this.detachAmpAcc = 0; this.reattachAcc = 0; this.detachStart = null; this.latched = false; this.contactAcc = 0; this.contactLatched = false; this.state = 'stable';
    this.out = { state: 'stable', shiftScore: 0, lateralShift_mm: 0, baselineStep: 0, patternSim: e.simLevel, ampRatio: 1, sinceEvent_s: null, recalRequired: false, motion: this.out.motion, contactIdx: 0, contactChange: false, xThr_mm: Math.max(X_THR_MM, K_SIG * this.sXMax), simThr: Math.max(SIM_DEV_FLOOR, K_SIG * this.sSimMax) };
    return true;
  }
  // re-anchor the EPOCH references (pattern medoid + level, pre-event DC) after an undecided transient settled as stable
  _reanchorEpoch(t) { const e = this._epoch(t, REF_S); if (!e || !this.reference) return; this.reference.pattern = e.pattern; this.reference.simLevel = e.simLevel; this.sSim = Math.max(e.sSim, this.sSim * 0.5); this.sSimMax = Math.max(this.sSimMax, this.sSim); this.dcPre = e.dc.slice(); }
  // immature reference → re-taken from the clean windows seen since the calibration once there are MIN_REF_N of them
  _matureReference(t) {
    let n = 0; for (const s of this.hist) if (s.t > this.calT && s.clean) n++;
    if (n < MIN_REF_N) return;
    const e = this._epoch(t, Math.min(REF_S, Math.max(1e-3, t - this.calT)));
    if (e && e.nClean >= MIN_REF_N) { this.reference = { x: e.x, pattern: e.pattern, simLevel: e.simLevel, amp: e.amp, mature: true }; this.sX = e.sX; this.sSim = e.sSim; this.sCm = e.sCm; this.sXMax = e.sX; this.sSimMax = e.sSim; this.dcPre = e.dc.slice(); }
  }
  _trim(t) { const t0 = t - Math.max(SCALE_S, HIST_S); while (this.hist.length && this.hist[0].t < t0) this.hist.shift(); }
  _shortMedians(t, ref) {
    const t0 = t - SHORT_S, xs = [], ss = [], aa = []; let n = 0;
    for (let i = this.hist.length - 1; i >= 0; i--) {
      const s = this.hist[i]; if (s.t < t0) break; if (!s.clean) continue; n++;
      if (s.x != null) xs.push(s.x);
      const c = cosine(s.pattern, ref.pattern); if (c != null) ss.push(c);
      if (s.amp != null && ref.amp > 0) aa.push(Math.log(s.amp / ref.amp) - (s.ampExpl ?? 0));
    }
    return { x: median(xs), sim: median(ss), ares: median(aa), n };
  }

  // inp: { t, xHat (mm|null), xImu_mm, pattern[], dcShort[], dcLong[], dcRange[], dcWin[], amp (>0|null), ampExplainedLn (|null), ensSnr_db (|null), sqi, motion }
  update(inp) {
    const t = inp.t; const dt = isFinite(this.lastT) ? Math.min(1, Math.max(0, t - this.lastT)) : 0; this.lastT = t; this._trim(t);
    if (inp.motion) this.motionUntil = t + MOTION_SETTLE_S;
    const gated = t < this.motionUntil;
    const nCh = Math.min(inp.dcShort.length, inp.dcLong.length, inp.dcRange.length, inp.dcWin.length);
    const ampRef = this.reference && this.reference.amp > 0 ? this.reference.amp : null;
    let stepMax = 0, rangeMax = 0; const wins = [];
    for (let k = 0; k < nCh; k++) { stepMax = Math.max(stepMax, Math.abs(inp.dcShort[k] - inp.dcLong[k])); rangeMax = Math.max(rangeMax, inp.dcRange[k]); wins.push(inp.dcWin[k]); }
    const cmWin = median(wins) ?? 0;
    const stepWinA = ampRef ? stepMax / ampRef : 0, rangeWinA = ampRef ? rangeMax / ampRef : 0;
    const bumped = rangeWinA >= BASE_OPEN_A;
    const clean = !gated && !bumped && inp.sqi >= Q_GATE && inp.amp != null && inp.amp > 0;
    const xComp = inp.xHat != null ? inp.xHat - (inp.xImu_mm || 0) : null;
    const ampOk = inp.amp != null && inp.amp > 0 && inp.sqi >= Q_GATE ? inp.amp : null;
    let sim = null, ampRatio = null;
    if (this.reference) { sim = cosine(inp.pattern, this.reference.pattern); ampRatio = ampOk != null && this.reference.amp > 0 ? ampOk / this.reference.amp : null; }
    const ampExpl = inp.ampExplainedLn != null && isFinite(inp.ampExplainedLn) ? inp.ampExplainedLn : null;
    this.hist.push({ t, x: xComp, pattern: Array.from(inp.pattern), amp: ampOk, ampExpl, dcShort: Array.from(inp.dcShort).slice(0, nCh), dcWin: Array.from(inp.dcWin).slice(0, nCh), cmWin, clean });
    if (!this.reference) { this.out = { ...AttachmentMonitor.empty(), motion: gated }; return this.out; }
    if (!this.reference.mature && this.state === 'stable' && this.pendingSince == null) this._matureReference(t);
    const ref = this.reference, amp0 = ref.amp, mature = ref.mature;
    // Running robust scales (clean windows of the last HIST_S). x̂ / common-mode learn only while stable and with
    // nothing pending (a step in them IS the event). The PATTERN scale learns in EVERY state but UPWARD ONLY
    // (5th pass, see attach.rs): its threshold describes what the patch can resolve, not what the monitor believes,
    // and restricting it to `stable` made it self-fulfilling on a sparse real patch whose MRC lock dwells in one pad
    // group for tens of seconds. Upward-only ⇒ the monitor can only become more conservative, never more sensitive.
    if (!gated) {
      const t0 = t - SCALE_S, cw = this.hist.filter((s) => s.t >= t0 && s.clean);
      const al = 1 - Math.exp(-dt / SCALE_TAU_S);
      const learnX = this.state === 'stable' && this.pendingSince == null;
      const sims = cw.map((s) => cosine(s.pattern, ref.pattern)).filter((v) => v != null);
      if (sims.length >= MIN_REF_N) { const r = detrendedScale(sims); const next = this.sSim + al * (r - this.sSim); this.sSim = learnX ? next : Math.max(this.sSim, next); this.sSimMax = Math.max(this.sSimMax, r); }
      if (learnX) {
        const xs = cw.map((s) => s.x).filter((v) => v != null), cms = this._cmDiffs(t0).map((q) => q.d);
        if (xs.length >= MIN_REF_N) { const r = detrendedScale(xs); this.sX += al * (r - this.sX); this.sXMax = Math.max(this.sXMax, r); }
        if (cms.length >= MIN_REF_N && this.contactAcc === 0 && !this.contactLatched) this.sCm += al * (robustScale(cms) - this.sCm); // must not learn a contact event in progress
      }
    }
    const xThr = Math.max(X_THR_MM, K_SIG * this.sXMax), simThr = Math.max(SIM_DEV_FLOOR, K_SIG * this.sSimMax);
    let baselineStep = stepWinA;
    if (this.dcPre && (this.pendingSince != null || this.eventT != null) && amp0 > 0) { let m = 0; for (let k = 0; k < Math.min(nCh, this.dcPre.length); k++) m = Math.max(m, Math.abs(inp.dcShort[k] - this.dcPre[k])); baselineStep = m / amp0; }
    const sm = this._shortMedians(t, ref);
    const dx = sm.x != null && ref.x != null ? sm.x - ref.x : null;
    // (an immature reference carries no x̂ / pattern / amplitude evidence)
    const ex = mature && dx != null ? Math.abs(dx) / xThr : 0, ep = mature && sm.sim != null ? Math.max(0, (ref.simLevel - sm.sim) / simThr) : 0, ea = mature && sm.ares != null ? Math.abs(sm.ares) / Math.log(AMP_HI) : 0;
    const eb = Math.min(1, baselineStep / BASE_SCALE_A);
    const score = Math.min(1, ex + PAT_MAX_SCORE * Math.min(1, ep) + AMP_MAX_SCORE * Math.min(1, ea) + BASE_MAX_SCORE * eb), evaluable = sm.n > 0;
    // detach evidence: amplitude collapse / no beats (strong) vs SNR-only (weak: longer hold)
    const detachEval = !bumped && !gated, snr = inp.ensSnr_db;
    const ampGone = ampRatio != null ? mature && ampRatio < DETACH_AMP : inp.amp == null;
    const snrLow = snr != null && snr < DETACH_SNR_DB;
    const noSignal = ampGone || snrLow || (ampRatio == null && snr == null);
    const signalBack = ampRatio != null && snr != null && ampRatio >= REATTACH_AMP && snr >= REATTACH_SNR_DB;
    if (detachEval) { if (noSignal) { if (this.detachStart == null) this.detachStart = t; this.detachAcc += dt; if (ampGone || (ampRatio == null && snr == null)) this.detachAmpAcc += dt; } else { this.detachAcc = 0; this.detachAmpAcc = 0; this.detachStart = null; } }
    const detachNow = this.detachAmpAcc >= DETACH_S || this.detachAcc >= DETACH_SNR_ONLY_S;
    // contact index: drift-compensated common-mode DC change over CONTACT_DT_S (A units)
    const cThrRaw = Math.max(CONTACT_MIN_A * amp0, CONTACT_K * this.sCm);
    let contactIdx = null;
    if (amp0 > 0) {
      const diffs = this._cmDiffs(t - CONTACT_COMP_S), lastD = diffs.length ? diffs[diffs.length - 1] : null;
      if (lastD && Math.abs(lastD.t - t) < 1e-9) {
        const med = diffs.length >= 4 ? (median(diffs.map((q) => q.d)) ?? 0) : 0, c = lastD.d - med;
        contactIdx = c / amp0;
        if (!this.contactLatched) {
          if (Math.abs(c) >= cThrRaw) { if (!bumped) this.contactAcc += dt; if (this.contactAcc >= CONTACT_HOLD_S) this.contactLatched = true; }
          else if (Math.abs(c) < 0.5 * cThrRaw) this.contactAcc = 0;
        }
      }
    }
    const rawStep = stepWinA >= BASE_OPEN_A || bumped
      || (mature && clean && xComp != null && ref.x != null && Math.abs(xComp - ref.x) >= xThr)
      || (mature && clean && ampRatio != null && Math.abs(Math.log(ampRatio) - (ampExpl ?? 0)) >= Math.log(AMP_OPEN));
    let state = this.state;
    if (state === 'stable') {
      if (rawStep && !gated) { if (this.pendingSince == null) { this.pendingSince = t; this.dcPre = Array.from(inp.dcLong).slice(0, nCh); } }
      else if (!gated) { this.pendingSince = null; this.dcPre = Array.from(inp.dcLong).slice(0, nCh); }
      if (this.pendingSince != null && evaluable) { if (score >= 1) this.holdAcc += dt; else this.holdAcc = 0; } else if (this.pendingSince == null) this.holdAcc = 0;
      if (this.pendingSince != null && t - this.pendingSince >= SHORT_S) { state = 'transient'; this.eventT = this.pendingSince; this.pendingSince = null; this.calmAcc = 0; }
    } else if (state === 'transient') {
      const since = t - (this.eventT ?? t);
      // calm = evidence within tolerance, OR the event has passed (no raw step any more) and no lateral evidence to speak of
      const calmNow = score < TOL || (ex < 0.5 * SETTLE_EX && !rawStep);
      if (evaluable) {
        if (score >= 1) { this.holdAcc += dt; this.calmAcc = 0; }
        else if (calmNow) { this.calmAcc += dt; this.holdAcc = 0; }
        else { this.holdAcc = 0; this.calmAcc = 0; }
      }
      let settled = false;
      if (this.holdAcc >= CONFIRM_S) state = 'shifted';
      else if (this.calmAcc >= CALM_S) { state = 'stable'; settled = score >= TOL; }
      else if (since >= SETTLE_MAX_S && evaluable) { state = score >= SETTLE_SCORE && ex >= SETTLE_EX ? 'shifted' : 'stable'; settled = state === 'stable'; }
      if (state === 'stable') { this.eventT = null; this.dcPre = Array.from(inp.dcLong).slice(0, nCh); this.holdAcc = 0; this.calmAcc = 0; if (settled) this._reanchorEpoch(t); }
      if (state === 'shifted') this.latched = true;
    } else if (state === 'detached') {
      if (detachEval) { if (signalBack) this.reattachAcc += dt; else this.reattachAcc = 0; }
      if (this.reattachAcc >= DETACH_S) { state = 'shifted'; this.eventT = t; this.reattachAcc = 0; this.detachAcc = 0; this.detachAmpAcc = 0; this.detachStart = null; }
    }
    if (state !== 'uncalibrated' && state !== 'detached' && detachNow) {
      state = 'detached'; this.eventT = this.detachStart ?? t; this.latched = true; this.pendingSince = null; this.holdAcc = 0; this.calmAcc = 0; this.reattachAcc = 0;
    }
    this.state = state;
    this.out = { state, shiftScore: score, lateralShift_mm: dx, baselineStep, patternSim: sm.sim ?? sim, ampRatio, sinceEvent_s: this.eventT != null ? t - this.eventT : null, recalRequired: this.latched, motion: gated, contactIdx, contactChange: this.contactLatched, xThr_mm: xThr, simThr };
    return this.out;
  }
  gateArrayIngest() { return this.state === 'transient' || this.state === 'detached'; }
  arrayInvalid() { return this.state === 'shifted' || this.state === 'detached'; }
  contactChange() { return this.contactLatched; }
}
