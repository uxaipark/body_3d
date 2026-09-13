// Analysis Core — framework-independent real-time analysis engine.
//
// Consumes sensor FRAMES (capacitive channels, PPG red/IR, optional simulator reference),
// keeps its own ring buffers, and produces RESULTS at a window cadence:
//   beamforming (MRC) · artery beam-search · two-beam local PTT/PWV · per-electrode Δt map ·
//   waveform features · BP/tone/stiffness estimators (array-only, PPG-only, fusion) · SpO₂.
// No DOM, no rendering — runs identically in a Web Worker, in the main thread, or in Node.
//
// Message contract (plain objects; typed arrays are transferable):
//   configure({ rows, cols, spacingMm, sheetLateral_mm, capFs, masterFs })
//   push({ t0, n, cap: Float32Array(nCh*n) channel-major, red: Float32Array(n), ir: Float32Array(n),
//          ref?: Float32Array(n) (true radial pulse, simulator only), oracleGains?: number[] })
//   analyze() → result | null
//   calibrate(sbp, dbp) / reset()

import { analyze as beamformAnalyze, beamSearch, rowBeam } from '../beamform.js';
import { BpEstimator, spo2FromPpg } from '../bpEstimator.js';
import { AttachmentMonitor, MOTION_PRON_DPS, MOTION_ACC_G } from './attach.js';

const DEFAULT_FS = 16000;
const BUFFER_SECONDS = 4;
const BEAM_HP_S = 1.5; // box high-pass (s) of the 500 Hz beamforming channels (rust core: core::BEAM_HP_S)
// ⑤ per-cluster beamforming — mirrors rust/dt-core/src/beamform.rs (same constants, same rule):
// a row gap above max(FLOOR, min(ABS, K × median row pitch)) splits the array into along-artery clusters.
const CLUSTER_GAP_ABS_MM = 8, CLUSTER_GAP_PITCH_K = 3, CLUSTER_GAP_FLOOR_MM = 4;
// ⑤ blind-MRC template-seed hysteresis (beamform.rs SeedLock)
const SEED_SWITCH_MARGIN = 1.25, SEED_SWITCH_WINDOWS = 3;

function varOfArr(a) { let m = 0; for (let i = 0; i < a.length; i++) m += a[i]; m /= a.length || 1; let v = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - m; v += d * d; } return a.length ? v / a.length : 0; }

function detectClusters(positions) {
  const nRows = Math.max(...positions.map((p) => p.r)) + 1;
  const sum = new Array(nRows).fill(0), cnt = new Array(nRows).fill(0);
  for (const p of positions) { sum[p.r] += p.along_mm; cnt[p.r]++; }
  const centre = sum.map((v, r) => (cnt[r] ? v / cnt[r] : 0));
  const gaps = centre.slice(1).map((v, i) => Math.abs(v - centre[i]));
  const pitch = gaps.length ? [...gaps].sort((a, b) => a - b)[gaps.length >> 1] : 0;
  const thr = gaps.length ? Math.max(CLUSTER_GAP_FLOOR_MM, Math.min(CLUSTER_GAP_ABS_MM, CLUSTER_GAP_PITCH_K * pitch)) : Infinity;
  const groups = [[0]];
  for (let r = 1; r < nRows; r++) { if (gaps[r - 1] > thr) groups.push([r]); else groups[groups.length - 1].push(r); }
  return groups.map((rows) => {
    const mem = positions.filter((p) => rows.includes(p.r));
    return { rows, chans: mem.map((p) => p.k), along_mm: mem.length ? mem.reduce((a, p) => a + p.along_mm, 0) / mem.length : 0 };
  });
}

// Blind-MRC seed lock: a challenger must beat the incumbent's pulsatile energy by SEED_SWITCH_MARGIN on
// SEED_SWITCH_WINDOWS consecutive windows before the template seed moves (real-data MRC lock stability).
class SeedLock {
  constructor() { this.idx = null; this.cand = null; this.count = 0; }
  reset() { this.idx = null; this.cand = null; this.count = 0; }
  update(energy) {
    const n = energy.length;
    if (!n) { this.reset(); return null; }
    let top = 0; for (let i = 1; i < n; i++) if (energy[i] > energy[top]) top = i;
    if (this.idx == null || this.idx >= n) { this.idx = top; this.cand = null; this.count = 0; return this.idx; }
    const cur = this.idx;
    if (top === cur || !(energy[top] > SEED_SWITCH_MARGIN * Math.max(0, energy[cur]))) { this.cand = null; this.count = 0; return this.idx; }
    if (this.cand === top) this.count++; else { this.cand = top; this.count = 1; }
    if (this.count >= SEED_SWITCH_WINDOWS) { this.idx = top; this.cand = null; this.count = 0; }
    return this.idx;
  }
}

// Centred moving-average high-pass, baseline held within win/2 of the edges (same as dsp::highpass / bpEstimator.js).
function highpassBox(x, win) {
  const n = x.length, out = new Float32Array(n), half = Math.floor(win / 2), cs = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + x[i];
  for (let i = 0; i < n; i++) { const c = Math.min(Math.max(i, half), Math.max(0, n - half - 1)), a = Math.max(0, c - half), b = Math.min(n, c + half + 1); out[i] = x[i] - (cs[b] - cs[a]) / (b - a); }
  return out;
}

export class AnalysisCore {
  constructor({ masterFs = DEFAULT_FS, maxCh = 48 } = {}) {
    this.fs = masterFs;
    this.len = masterFs * BUFFER_SECONDS;
    this.maxCh = maxCh;
    this.cfg = { rows: 3, cols: 3, spacingMm: 4, sheetLateral_mm: 12, capFs: 1000, attachGate: true }; // attachGate false = diagnostic: the estimator ignores the attachment monitor (mirror of rust Config.attach_gate)
    this.capCh = Array.from({ length: maxCh }, () => new Float32Array(this.len));
    this.red = new Float32Array(this.len);
    this.ir = new Float32Array(this.len);
    this.ref = new Float32Array(this.len);
    this.hasRef = false;
    this.writeIdx = 0; this.total = 0; this.t = 0;
    this.oracleGains = null;
    this.est = new BpEstimator();
    this.attach = new AttachmentMonitor(); // sheet re-placement monitor (mirror of rust attach.rs)
    // ③ wrist IMU (mirror of the Rust core): integrated pronation → lateral artery offset, and the
    // accelerometer-magnitude statistics since the last analyze() → the attachment monitor's motion gate.
    // Until 2026-08-25 the JS mirror ignored `frame.imu` entirely and passed `motion: false` / `xImu_mm: 0`
    // as constants, so its motion gate never fired in ANY window (found by the N = 300 cohort sweep) — a
    // parity gap the wasm_parity harness cannot see (it does not compare the `attach` block).
    this.imuPronDeg = 0; this.imuFs = 1000; this.imuPronAtLast = 0; this.imuSamplesSince = 0;
    this.imuGainMmPerDeg = 3.2 * Math.PI / 180; // twin: 3.2·sin(pron) mm → 0.056 mm/deg near 0 (rust core.rs)
    this.imuAccSum = 0; this.imuAccSq = 0; this.imuAccN = 0;
    this.winCount = 0;
    this.seedLock = new SeedLock(); this.clusterSeeds = []; // ⑤ MRC lock hysteresis
    this.last = { analysis: null, chans: null, beam: null, features: null, estimates: null, spo2: null };
  }

  configure(cfg) {
    const key = (c, l) => `${c.rows}x${c.cols}@${c.spacingMm}/${c.capFs}/${l ? l.map((p) => `${p.lateral_mm},${p.along_mm}`).join(';') : 'grid'}`;
    const before = key(this.cfg, this.layout);
    Object.assign(this.cfg, cfg);
    // EVALUATION SWITCH (docs/CLINICAL_AUDIT.md §6.12): which RI-cue gate the estimator applies (mirror of
    // dt_core_set_ri_gate_mode). Absent = the build's own default.
    if (cfg.riGateMode != null) this.est.riGateMode = cfg.riGateMode;
    // EVALUATION SWITCH (docs/CLINICAL_AUDIT.md §6.17): cross-modality fault detectors off/on (mirror of
    // dt_core_set_xmod). Default on; never false in the product path.
    if (cfg.xmod != null) this.est.xmodEnabled = cfg.xmod !== false;
    // EVALUATION SWITCH (§6.24, mirror of dt_core_set_ppg_opt): PPG-internal optics layer bitmask.
    // 0 = the 6th-pass build, bit-identically. Absent = the build's own default (PPG_OPT_DEFAULT).
    if (cfg.ppgOpt != null) this.est.ppgOpt = cfg.ppgOpt >>> 0;
    // EVALUATION SWITCH (ROADMAP §2.2-10, docs/CLINICAL_AUDIT.md §6.19): which upstroke fiducial the
    // wrist→finger PTT uses (mirror of dt_core_set_ptt_fiducial). Any non-legacy value also turns the PTT
    // beat-accumulation span on; `pttAccum` overrides that afterwards.
    if (cfg.pttFiducial != null) { this.est.pttFiducial = cfg.pttFiducial; this.est.pttAccum = cfg.pttFiducial !== 'legacy'; }
    if (cfg.pttAccum != null) this.est.pttAccum = cfg.pttAccum !== false;
    if ('layout' in cfg) this.layout = cfg.layout && cfg.layout.length ? cfg.layout.map((p, k) => ({ ...p, k })) : null; // custom electrode positions (sheet-relative mm)
    const after = key(this.cfg, this.layout);
    if (before !== after) this.reset(); // structural change → history is meaningless
  }

  reset() {
    for (const b of this.capCh) b.fill(0);
    this.red.fill(0); this.ir.fill(0); this.ref.fill(0);
    this.writeIdx = 0; this.total = 0;
    this.est.reset(); this.attach.reset(); this.winCount = 0;
    this.imuPronDeg = 0; this.imuPronAtLast = 0; this.imuSamplesSince = 0; this.imuAccSum = 0; this.imuAccSq = 0; this.imuAccN = 0;
    this.seedLock.reset(); this.clusterSeeds = [];
    this.last = { analysis: null, chans: null, beam: null, features: null, estimates: null, spo2: null };
  }

  calibrate(sbp, dbp) {
    if (this.last.features) { this.est.calibrate(this.last.features, sbp, dbp); this.attach.snapshot(); this.est.arrayInvalid = false; return true; }
    return false;
  }

  nCh() { return Math.min(this.maxCh, this.layout ? this.layout.length : this.cfg.rows * this.cfg.cols); }

  // Append a frame: cap is channel-major Float32Array(nCh * n).
  push(frame) {
    const n = frame.n | 0; if (n <= 0) return;
    const nCh = this.nCh();
    if (frame.oracleGains) this.oracleGains = frame.oracleGains;
    if (frame.ref) this.hasRef = true;
    for (let i = 0; i < n; i++) {
      const idx = (this.writeIdx + i) % this.len;
      for (let ch = 0; ch < nCh; ch++) this.capCh[ch][idx] = frame.cap[ch * n + i];
      this.red[idx] = frame.red ? frame.red[i] : 0;
      this.ir[idx] = frame.ir ? frame.ir[i] : 0;
      this.ref[idx] = frame.ref ? frame.ref[i] : 0;
    }
    this.writeIdx = (this.writeIdx + n) % this.len;
    this.total += n;
    this.t = frame.t0 + n / this.fs;
    if (frame.imu && frame.imuN > 0) this.pushImu(frame.imu, frame.imuN, frame.imuFs || 1000);
  }

  // ③ Decimated 6-axis IMU (interleaved ax,ay,az,gx,gy,gz; gyro deg/s, Y = pronation) — mirror of the Rust
  // core's `push_imu`. Integrates pronation (→ lateral artery offset) and accumulates |a| statistics for the
  // attachment monitor's motion gate.
  pushImu(imu, n, fs) {
    if (!(n > 0) || !(fs > 0)) return;
    this.imuFs = fs;
    const dt = 1 / fs;
    for (let j = 0; j < n; j++) {
      const gy = imu[6 * j + 4]; if (gy != null) this.imuPronDeg += gy * dt;
      const ax = imu[6 * j], ay = imu[6 * j + 1], az = imu[6 * j + 2];
      if (ax != null && ay != null && az != null) { const m = Math.sqrt(ax * ax + ay * ay + az * az); this.imuAccSum += m; this.imuAccSq += m * m; this.imuAccN++; }
    }
    this.imuSamplesSince += n;
  }

  _window(src, seconds, decim) {
    const n = Math.min(this.len, Math.round(seconds * this.fs), this.total);
    const m = Math.floor(n / decim), out = new Float32Array(m);
    let start = (this.writeIdx - n + this.len) % this.len;
    for (let i = 0; i < m; i++) out[i] = src[(start + i * decim) % this.len];
    return out;
  }

  _positions() {
    if (this.layout) {
      // rows = along-clusters (0.5 mm tolerance, proximal → distal), c = order within the row (ulnar → thumb)
      const els = this.layout.map((e, k) => ({ k, lateral_mm: e.lateral_mm, along_mm: e.along_mm }));
      const order = els.map((e) => e.k).sort((a, b) => els[a].along_mm - els[b].along_mm || els[a].lateral_mm - els[b].lateral_mm);
      const rowsIdx = []; let cur = null, mean = 0;
      for (const i of order) { const y = els[i].along_mm; if (!cur || Math.abs(y - mean) > 0.5) { cur = []; rowsIdx.push(cur); mean = y; } cur.push(i); mean = cur.reduce((s, j) => s + els[j].along_mm, 0) / cur.length; }
      rowsIdx.forEach((row, r) => { row.sort((a, b) => els[a].lateral_mm - els[b].lateral_mm); row.forEach((i, c) => { els[i].r = r; els[i].c = c; }); });
      return els;
    }
    const { rows, cols, spacingMm } = this.cfg, p = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
      p.push({ k: r * cols + c, r, c, lateral_mm: (c - (cols - 1) / 2) * spacingMm, along_mm: (r - (rows - 1) / 2) * spacingMm }); // sheet-relative
    return p;
  }

  // Value of channel `ch` `ago` samples before the newest sample (used for display-side wave exaggeration).
  sampleAgo(ch, ago) {
    const src = this.capCh[ch]; if (!src) return 0;
    const a = Math.max(0, Math.min(this.len - 1, this.total - 1, ago | 0));
    return src[(this.writeIdx - 1 - a + 2 * this.len) % this.len];
  }

  // Run one analysis pass over the current windows. Returns a result object (typed arrays inside).
  analyze() {
    if (this.total < this.fs * 1.5) return null;
    const nCh = this.nCh();
    const positionsAll = this._positions();
    const rows = this.layout ? Math.max(...positionsAll.map((p) => p.r)) + 1 : this.cfg.rows, cols = this.layout ? Math.max(...positionsAll.map((p) => p.c)) + 1 : this.cfg.cols;
    const spacingMm = this.layout ? (() => { const xs = [...new Set(positionsAll.map((p) => p.lateral_mm))].sort((a, b) => a - b); const g = xs.slice(1).map((v, i) => v - xs[i]).sort((a, b) => a - b); return g[g.length >> 1] || this.cfg.spacingMm; })() : this.cfg.spacingMm;
    // --- 500 Hz windows for beamforming / SNR ---
    // channels (and the reference, identically) high-passed with a 1.5 s box so that drift / posture-event tails /
    // wander cannot bias the MRC template or the beam search (mirror of the Rust core, BEAM_HP_S)
    const DEC1 = this.fs / 500, chans = [], HP500 = Math.round(BEAM_HP_S * 500);
    for (let ch = 0; ch < nCh; ch++) chans.push(highpassBox(this._window(this.capCh[ch], 3, DEC1), HP500));
    const ref500 = this.hasRef ? highpassBox(this._window(this.ref, 3, DEC1), HP500) : null;
    // --- ⑤ layout clusters + blind-MRC seed hysteresis (mirror of the Rust core) ---
    const clusters = detectClusters(positionsAll);
    const multi = clusters.length >= 2;
    const energies = chans.map(varOfArr);
    const seed = this.seedLock.update(energies);
    let analysis = null;
    if (ref500 && ref500.length > 50) analysis = beamformAnalyze(chans, ref500, this.oracleGains, seed);
    else analysis = blindAnalyze(chans, seed); // no truth available (real sensor): blind MRC only
    // ⑤ ≥ 2 clusters: blind MRC inside each cluster (own seed / own weights) → cluster beams → a second
    // blind MRC over them. NOTE the JS mirror has no per-channel delay compensation at all, so it also
    // does not delay-align the cluster beams before the second MRC (the Rust core does); the
    // cluster-to-cluster delay itself is still measured on the beams for the local-PWV cue. `mrcSnr_db`
    // (simulator-truth diagnostic) is likewise left at the first-pass global value here, while the Rust
    // core re-fits it against the re-combined output — not compared by the parity harness.
    let clusterW = null, clusterSnr = null;
    if (multi) {
      if (this.clusterSeeds.length !== clusters.length) this.clusterSeeds = clusters.map(() => new SeedLock());
      clusterW = []; clusterSnr = [];
      const beams = [];
      clusters.forEach((cl, ci) => {
        const sub = cl.chans.map((k) => chans[k]);
        const sLocal = this.clusterSeeds[ci].update(cl.chans.map((k) => energies[k]));
        const a = blindAnalyze(sub, sLocal == null ? null : sLocal);
        clusterW.push(a.weights); clusterSnr.push(a.bestSnr_db); beams.push(a.combined);
      });
      const a2 = blindAnalyze(beams, null);
      const w = new Array(nCh).fill(0);
      clusters.forEach((cl, ci) => cl.chans.forEach((k, i) => { w[k] = a2.weights[ci] * clusterW[ci][i]; }));
      analysis.weights = w;
      analysis.combined = a2.combined;
    }
    // --- artery beam search (sheet-relative positions) ---
    const positions = positionsAll;
    const nLat = new Set(positions.map((p) => Math.round(p.lateral_mm * 4))).size;
    const beam = nLat >= 2 ? beamSearch(chans, positions, { spacingMm }) : null;
    // --- 2 kHz windows for features ---
    const DEC2 = this.fs / 2000, FS2 = 2000, WIN = 3.8;
    const ch2k = []; for (let ch = 0; ch < nCh; ch++) ch2k.push(this._window(this.capCh[ch], WIN, DEC2));
    const L = ch2k[0].length;
    const mrc = new Float32Array(L);
    for (let i = 0; i < nCh; i++) { const w = analysis.weights[i]; if (!w) continue; const x = ch2k[i]; for (let s = 0; s < L; s++) mrc[s] += w * x[s]; }
    let rowSignals = null, rowProx = null, rowDist = null, rowDist_m = 0;
    if (rows >= 2) {
      rowSignals = [];
      for (let r = 0; r < rows; r++) {
        let b = beam ? rowBeam(ch2k, positions, r, beam.xHat, beam.sigma) : null;
        if (!b) { const mem = positions.filter((p) => p.r === r); b = new Float32Array(L); for (const p of mem) { const a = ch2k[p.k]; for (let s = 0; s < L; s++) b[s] += a[s] / mem.length; } }
        rowSignals.push(b);
      }
      rowProx = rowSignals[0]; rowDist = rowSignals[rows - 1];
      const rowMean = (r) => { const m = positions.filter((p) => p.r === r); return m.reduce((s, p) => s + p.along_mm, 0) / m.length; };
      rowDist_m = (rowMean(rows - 1) - rowMean(0)) / 1000;
    }
    // ⑤ cluster beams at the feature rate (per-cluster weights; the cluster-to-cluster delay is left IN
    // them — that is what computeFeatures measures) + the centroid baselines
    let cluster2k = null, clusterDist_m = null;
    if (multi && clusterW) {
      cluster2k = clusters.map((cl, ci) => { const y = new Float32Array(L); cl.chans.forEach((k, i) => { const w = clusterW[ci][i]; if (!w) return; const x = ch2k[k]; for (let s = 0; s < L; s++) y[s] += w * x[s]; }); return y; });
      clusterDist_m = clusters.map((c) => (c.along_mm - clusters[0].along_mm) / 1000);
    }
    const ir2k = this._window(this.ir, WIN, DEC2), red2k = this._window(this.red, WIN, DEC2);
    this.winCount++;
    // host time of the window (the estimator measures the analysis cadence from it) and the notch-learning cadence (every 4th window).
    // The attachment monitor's array-ingest gate (transient / detached) is applied with ONE window of lag here: the JS
    // feature extractor ingests inside computeFeatures, before this window's monitor update (the Rust core gates the same window).
    const features = this.est.computeFeatures({ mrc, ppgIr: ir2k, ppgRed: red2k, rowProx, rowDist, rowDist_m, rowSignals, chanSignals: ch2k, clusterSignals: cluster2k, clusterDist_m, fs: FS2, capFs: this.cfg.capFs, t: this.t, learnNotch: !this.est.cal || this.winCount % 4 === 1, arrayOk: !(this.cfg.attachGate !== false && this.attach.gateArrayIngest()) });
    // --- attachment monitor: per-channel DC statistics over the 3.8 s window + the channel coupling pattern (LS gain of each
    // demeaned channel onto the MRC output); no IMU in the JS core (xImu = 0, motion = false) ---
    const attach = (() => {
      const nSeg = Math.round(0.5 * FS2), dcShort = new Array(nCh).fill(0), dcLong = new Array(nCh).fill(0), dcRange = new Array(nCh).fill(0), dcWin = new Array(nCh).fill(0);
      const meanOf = (a, s, e) => { let v = 0; for (let i = s; i < e; i++) v += a[i]; return e > s ? v / (e - s) : 0; };
      // contact-index DC level over an INTEGER number of beats (largest k·RR ≤ window, this window's HR) — mirror of rust core.rs
      const hrW = features && features.hr > 30 && Number.isFinite(features.hr) ? features.hr : null;
      const spanW = hrW ? Math.min(WIN, Math.max(1, Math.floor(WIN / (60 / hrW))) * (60 / hrW)) : WIN;
      const nWin = Math.max(1, Math.min(L, Math.round(spanW * FS2)));
      for (let k = 0; k < nCh; k++) {
        const c = ch2k[k];
        dcWin[k] = meanOf(c, L - nWin, L);
        if (L > 2 * nSeg) {
          dcShort[k] = meanOf(c, L - nSeg, L); dcLong[k] = meanOf(c, 0, L - nSeg);
          let lo = Infinity, hi = -Infinity; for (let e = L; e >= nSeg; e -= nSeg) { const m = meanOf(c, e - nSeg, e); lo = Math.min(lo, m); hi = Math.max(hi, m); }
          dcRange[k] = hi - lo;
        } else { const m = meanOf(c, 0, L); dcShort[k] = m; dcLong[k] = m; }
      }
      const comb = analysis.combined, X = analysis.channelsDemeaned || chans.map((a) => { const m = meanOf(a, 0, a.length), o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] - m; return o; });
      let cc = 0; for (let i = 0; i < comb.length; i++) cc += comb[i] * comb[i];
      const pattern = X.map((x) => { if (!(cc > 0)) return 0; let s = 0; for (let i = 0; i < comb.length; i++) s += x[i] * comb[i]; return Math.max(0, s / cc); });
      // ③ IMU: pronation rate over the elapsed window and the accelerometer-magnitude SD → motion burst gate
      const dPron = this.imuPronDeg - this.imuPronAtLast, imuDt = this.imuSamplesSince / this.imuFs;
      const pronRate = imuDt > 0 ? dPron / imuDt : 0;
      this.imuPronAtLast = this.imuPronDeg; this.imuSamplesSince = 0;
      let accStd = 0;
      if (this.imuAccN >= 4) { const m = this.imuAccSum / this.imuAccN; accStd = Math.sqrt(Math.max(0, this.imuAccSq / this.imuAccN - m * m)); }
      this.imuAccSum = 0; this.imuAccSq = 0; this.imuAccN = 0;
      const motion = Math.abs(pronRate) > MOTION_PRON_DPS || accStd > MOTION_ACC_G;
      // part of ln(A/A0) the estimator's own state explains (−2·ln(M/M0) from the PREVIOUS window's array estimate)
      return this.attach.update({ t: this.t, xHat: beam ? beam.xHat : null, xImu_mm: this.imuGainMmPerDeg * this.imuPronDeg, pattern, dcShort, dcLong, dcRange, dcWin, amp: features && features.amp > 0 ? features.amp : null, ampExplainedLn: this.est.ampExplainedLn(), ensSnr_db: features ? features.ensSnr_db : null, sqi: features ? features.sqi : 0, motion });
    })();
    this.est.arrayInvalid = this.cfg.attachGate !== false && this.attach.arrayInvalid();
    this.est.contactWarn = this.cfg.attachGate !== false && this.attach.contactChange(); // warn only: confidence × CONTACT_CONF
    const estimates = { fusion: this.est.estimate(features), cap: this.est.estimateCap(features), ppg: this.est.estimatePpg(features) };
    const spo2 = spo2FromPpg(red2k, ir2k);
    // ⑤ per-cluster block on `beam` — same shape as the Rust core's BeamOut (serialize.rs write_beam)
    const beamOut = beam ? { xHat: beam.xHat, betweenCols: beam.betweenCols, sigma: beam.sigma, clusters: clusters.length } : null;
    if (beamOut && multi) {
      beamOut.clusterXHat = clusters.map((cl) => { const b = beamSearch(cl.chans.map((k) => chans[k]), cl.chans.map((k) => positions[k]), { spacingMm }); return b ? b.xHat : NaN; });
      beamOut.clusterSnr_db = clusterSnr;
      const dt = features && features.interClusterDt_ms ? features.interClusterDt_ms[features.interClusterDt_ms.length - 1] : null;
      if (dt != null) beamOut.interClusterDt_ms = dt;
      if (features && features.interClusterPwv != null) beamOut.interClusterPwv = features.interClusterPwv;
      if (clusterDist_m) beamOut.clusterDist_mm = clusterDist_m[clusterDist_m.length - 1] * 1000;
      // two-scale check: cluster PWV / the row PWV inside the first cluster with ≥ 2 rows
      const rowMeanOf = (r) => { const m = positions.filter((p) => p.r === r); return m.length ? m.reduce((a, p) => a + p.along_mm, 0) / m.length : 0; };
      let intraPwv = null;
      if (features && features.rowDelays_ms) {
        const cl = clusters.find((c) => c.rows.length >= 2);
        if (cl) {
          const d0 = features.rowDelays_ms[cl.rows[0]], d1 = features.rowDelays_ms[cl.rows[cl.rows.length - 1]];
          if (d0 != null && d1 != null) { const dt2 = d1 - d0, dm = Math.abs(rowMeanOf(cl.rows[cl.rows.length - 1]) - rowMeanOf(cl.rows[0])) / 1000; if (dt2 > 0.05 && dm > 0) { const v = dm / (dt2 / 1000); if (v >= 3 && v <= 25) intraPwv = v; } }
        }
      }
      if (features && features.interClusterPwv != null && intraPwv) beamOut.pwvConsistency = features.interClusterPwv / intraPwv;
    }
    this.last = { analysis, chans, beam: beamOut, features, estimates, spo2: spo2 ? spo2.spo2 : null };
    return {
      t: this.t, nCh, rows, cols,
      analysis: analysis && {
        weights: analysis.weights, trueSnr_db: analysis.trueSnr_db, mrcSnr_db: analysis.mrcSnr_db, bestSnr_db: analysis.bestSnr_db,
        oracleSnr_db: analysis.oracleSnr_db, corrMrc: analysis.corrMrc, bestIdx: analysis.bestIdx,
        combined: analysis.combined, refDemeaned: analysis.refDemeaned, oracle: analysis.oracle, combinedGain: analysis.combinedGain, oracleGain: analysis.oracleGain,
      },
      chans, beam: this.last.beam, features, estimates, spo2: this.last.spo2, calibrated: !!this.est.cal, estimator: this.est.diag(), attach,
    };
  }
}

// Blind fallback when no reference truth is available: MRC weights from a data-driven template,
// SNR reported relative to the MRC output (not to truth).
function blindAnalyze(channels, seed = null) {
  const n = channels.length, L = channels[0].length;
  const mean = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length; };
  const X = channels.map((a) => { const m = mean(a), o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] - m; return o; });
  const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
  let tIdx = 0, tVar = -1; for (let i = 0; i < n; i++) { const v = dot(X[i], X[i]); if (v > tVar) { tVar = v; tIdx = i; } }
  if (seed != null && seed >= 0 && seed < n && dot(X[seed], X[seed]) > 0) tIdx = seed; // ⑤ seed-lock hysteresis
  let template = X[tIdx], w = new Float32Array(n), combined = new Float32Array(L);
  for (let it = 0; it < 2; it++) {
    const TT = dot(template, template); let ws = 0;
    for (let i = 0; i < n; i++) { const g = TT > 0 ? dot(X[i], template) / TT : 0; let res = 0; for (let s = 0; s < L; s++) { const e = X[i][s] - g * template[s]; res += e * e; } res /= L; w[i] = Math.max(0, res > 0 ? g / res : 0); ws += w[i]; }
    if (ws > 0) for (let i = 0; i < n; i++) w[i] /= ws;
    combined.fill(0); for (let i = 0; i < n; i++) { const wi = w[i]; if (!wi) continue; for (let s = 0; s < L; s++) combined[s] += wi * X[i][s]; }
    template = combined;
  }
  const CC = dot(combined, combined) / L;
  const snr = Array.from({ length: n }, (_, i) => { const g = dot(X[i], combined) / (CC * L || 1); let res = 0; for (let s = 0; s < L; s++) { const e = X[i][s] - g * combined[s]; res += e * e; } res /= L; return 10 * Math.log10(Math.max(1e-12, (g * g * CC) / Math.max(1e-12, res))); });
  let bestIdx = 0; for (let i = 1; i < n; i++) if (snr[i] > snr[bestIdx]) bestIdx = i;
  return { n, L, weights: Array.from(w), trueSnr_db: snr, combined, refDemeaned: null, oracle: null, combinedGain: 1, oracleGain: 0, mrcSnr_db: NaN, oracleSnr_db: null, bestIdx, bestSnr_db: snr[bestIdx], corrMrc: NaN, channelsDemeaned: X };
}
