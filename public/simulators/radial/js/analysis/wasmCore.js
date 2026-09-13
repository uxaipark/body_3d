// WasmAnalysisCore — JS glue for the Rust analysis core (rust/dt-core → dt_core.wasm, plain C ABI).
// Same API as the JS AnalysisCore: configure(cfg) · push(frame) · analyze() → result | null ·
// calibrate(sbp, dbp) · reset() · sampleAgo(ch, ago). Works in Workers, the main thread and Node.
//
//   const core = await WasmAnalysisCore.load(url);   // url: dt_core.wasm (or {bytes} in Node)
//
// Result transport: dt_core_analyze() leaves a compact BINARY record in linear memory (flat f64 word
// stream, 8-byte aligned; header word 0 = magic "DTR1" | schema version, word 1 = word count) which
// `decodeResult` turns into the SAME object shape the old JSON path produced. The field order is a
// fixed table mirrored in rust/dt-core/src/serialize.rs (`write_result`) — adding a field = one line
// there + one line here. `core.resultFormat = 'json'` (worker ?fmt=json) keeps the JSON debug path.

const DEFAULT_WASM_URL = new URL('./dt_core.wasm', import.meta.url);

// ---- binary result decoder (schema v7: + multi-fiducial / beat-accumulated wrist→finger PTT, 2026-08-25,
//      ROADMAP §2.2-10 / audit §6.19 — features.pttWFSd_ms/pttWFNBeats; estimator.spanPtt/pttBeats;
//      v6: + cross-modality fault observability, 2026-08-25, audit §6.17 —
//      features.ppgDcRed; estimate.ppSdLn/couplingFault/opticsFault/riLawFault; estimator.xmodGammaZ/
//      xmodReflZ/xmodPiZ/xmodRiZ/dcRelZ + the same three flags;
//   v8 (2026-08-30, audit §6.24 — PPG-internal optics observability): estimate.opticsUnverified;
//      estimator.ppgPiZ/ppgStillZ/ppgPerfSigma/opticsUnverified/ppgPerfLow;
//      v5: + estimator RI cue budget riSigmaLn/riGate/riSigma0Ln, 2026-08-24;
//      v4: + beam per-cluster block clusters/clusterXHat/clusterSnr_db/interClusterDt_ms/interClusterDtSd_ms/
//      interClusterPwv/clusterDist_mm/pwvConsistency) — mirror of rust/dt-core/src/serialize.rs ----
export const RESULT_MAGIC = 0x31525444; // "DTR1"
export const RESULT_SCHEMA = 8;
const ENGINE_CODES = ['rust', 'js'];
// RI-cue gate evaluation switch — index = code passed to dt_core_set_ri_gate_mode (estimator.rs RiGateMode)
export const RI_GATE_MODES = ['legacy', 'narrow', 'open'];
// wrist→finger PTT fiducial evaluation switch — index = code passed to dt_core_set_ptt_fiducial
// (features.rs PttFiducial; ROADMAP §2.2-10, docs/CLINICAL_AUDIT.md §6.19)
export const PTT_FIDUCIALS = ['legacy', 'maxslope', 'tangent', 'deriv2', 'taylor', 'combo'];

class Reader {
  constructor(f64, off, end) { this.a = f64; this.pos = off; this.end = end; }
  // f64 (NaN → null, like serde_json) · int · bool · Option<struct> presence flag
  n() { const v = this.a[this.pos++]; return v !== v ? null : v; }
  i() { return this.a[this.pos++] | 0; }
  b() { return this.a[this.pos++] !== 0; }
  some() { return this.a[this.pos++] !== 0; }
  // skip_serializing_if field: set key only when present (NaN = absent)
  opt(o, k) { const v = this.a[this.pos++]; if (v === v) o[k] = v; }
  // [len][v..] → plain Array (copied out of linear memory; NaN elements → null); len −1 → null
  arr() {
    const n = this.a[this.pos++]; if (n < 0) return null;
    const out = new Array(n); for (let j = 0; j < n; j++) { const v = this.a[this.pos++]; out[j] = v !== v ? null : v; }
    return out;
  }
  done() { return this.pos === this.end; }
}

function decodeAnalysis(rd) {
  const a = {};
  a.weights = rd.arr();
  a.trueSnr_db = rd.arr();
  a.mrcSnr_db = rd.n();
  a.bestSnr_db = rd.n();
  a.oracleSnr_db = rd.n();
  a.corrMrc = rd.n();
  a.bestIdx = rd.i();
  a.combinedGain = rd.n();
  a.oracleGain = rd.n();
  a.chanDelay_samples = rd.arr();
  a.mrcSnrPlain_db = rd.n();
  a.delayComp = rd.b();
  return a;
}
function decodeBeam(rd) {
  const b = {};
  b.xHat = rd.n();
  b.betweenCols = [rd.n(), rd.n()];
  b.sigma = rd.n();
  b.xTrack = rd.n();
  b.xImuStep_mm = rd.n();
  b.pronRate_dps = rd.n();
  b.clusters = rd.i(); // ⑤ rust serialize.rs write_beam: clusters (1 = single contiguous array)
  b.clusterXHat = rd.arr(); // clusterXHat (null when 1 cluster)
  b.clusterSnr_db = rd.arr(); // clusterSnr_db
  rd.opt(b, 'interClusterDt_ms'); // interClusterDt_ms (key absent when not measurable)
  rd.opt(b, 'interClusterDtSd_ms'); // interClusterDtSd_ms
  rd.opt(b, 'interClusterPwv'); // interClusterPwv
  rd.opt(b, 'clusterDist_mm'); // clusterDist_mm
  rd.opt(b, 'pwvConsistency'); // pwvConsistency
  return b;
}
function decodeFeatures(rd) {
  const f = {};
  f.hr = rd.n();
  f.amp = rd.n();
  f.ri = rd.n();
  f.tRefl_ms = rd.n();
  f.ppgAc = rd.n();
  f.ppgDc = rd.n();
  f.ppgDcRed = rd.n(); // v6
  f.ppgAcDc = rd.n();
  f.ppgRi = rd.n();
  f.ppgTRefl_ms = rd.n();
  f.pttWF_ms = rd.n();
  rd.opt(f, 'pttWFSd_ms'); // v7 (key absent on the legacy ensemble path)
  f.pttWFNBeats = rd.i(); // v7
  f.pttLocal_ms = rd.n();
  f.pwvLocal = rd.n();
  f.rowDelays_ms = rd.arr();
  f.chanDelays_ms = rd.arr();
  f.nBeats = rd.i();
  rd.opt(f, 'notchRi');
  rd.opt(f, 'ppgNotchRi');
  rd.opt(f, 'ppgBetaRaw');
  rd.opt(f, 'ppgRho');
  rd.opt(f, 'ppgHr');
  f.ppgNBeats = rd.i();
  f.sqi = rd.n();
  rd.opt(f, 'ppgSqi');
  f.ensSnr_db = rd.n();
  rd.opt(f, 'ppgEnsSnr_db');
  f.nBeatsRej = rd.i();
  f.morphFit = rd.b();
  f.ppgMorphFit = rd.b();
  return f;
}
function decodeEstimate(rd) {
  const e = {};
  e.sbp = rd.n();
  e.dbp = rd.n();
  e.map = rd.n();
  e.pp = rd.n();
  rd.opt(e, 'tone');
  rd.opt(e, 'stiff');
  rd.opt(e, 'x');
  rd.opt(e, 'm');
  rd.opt(e, 'pwvLocal');
  rd.opt(e, 'pttWF_ms');
  rd.opt(e, 'tRefl_ms');
  rd.opt(e, 'ri');
  rd.opt(e, 'hr');
  e.confidence = rd.n();
  e.mapSd_mmHg = rd.n();
  e.recalRequired = rd.b();
  e.ppSdLn = rd.n(); // v6
  e.couplingFault = rd.b(); // v6
  e.opticsFault = rd.b(); // v6
  e.riLawFault = rd.b(); // v6
  e.opticsUnverified = rd.b(); // v8 — PPG-internal optics ambiguity (audit §6.24)
  return e;
}
// attachment monitor block (rust/dt-core/src/attach.rs `AttachOut`, written by serialize.rs `write_attach`)
export const ATTACH_STATES = ['uncalibrated', 'stable', 'transient', 'shifted', 'detached'];
function decodeAttach(rd) {
  const a = {};
  a.state = ATTACH_STATES[rd.i()] || 'uncalibrated';
  a.shiftScore = rd.n();
  a.lateralShift_mm = rd.n();
  a.baselineStep = rd.n();
  a.patternSim = rd.n();
  a.ampRatio = rd.n();
  a.sinceEvent_s = rd.n();
  a.recalRequired = rd.b();
  a.motion = rd.b();
  a.contactIdx = rd.n(); // rust serialize.rs write_attach: contactIdx (NaN → null)
  a.contactChange = rd.b(); // contactChange
  a.xThr_mm = rd.n(); // xThr_mm
  a.simThr = rd.n(); // simThr
  return a;
}
function decodeEstimator(rd) {
  const d = {};
  d.cadence_s = rd.n();
  d.spanArr = rd.i();
  d.spanPpg = rd.i();
  d.spanRi = rd.i();
  d.spanPtt = rd.i(); // v7
  d.pttBeats = rd.n(); // v7
  d.sigLn = rd.arr();
  d.qWinArr = rd.n();
  d.qWinPpg = rd.n();
  d.smoothed = rd.arr();
  d.segRi = rd.i(); // rust serialize.rs write_estimator: segRi
  d.segArr = rd.i(); // segArr
  d.calQuality = rd.n(); // calQuality
  d.riSigmaLn = rd.n(); // riSigmaLn (v5)
  d.riGate = rd.n(); // riGate (v5)
  d.riSigma0Ln = rd.n(); // riSigma0Ln (v5)
  d.xmodGammaZ = rd.n(); // v6 — cross-modality residuals (audit §6.17)
  d.xmodReflZ = rd.n();
  d.xmodPiZ = rd.n();
  d.xmodRiZ = rd.n();
  d.dcRelZ = rd.n();
  d.couplingFault = rd.b();
  d.opticsFault = rd.b();
  d.riLawFault = rd.b();
  d.ppgPiZ = rd.n(); // v8 — PPG-INTERNAL optics channel (audit §6.24)
  d.ppgStillZ = rd.n();
  d.ppgPerfSigma = rd.n();
  d.opticsUnverified = rd.b();
  d.ppgPerfLow = rd.b();
  return d;
}

/** Decode a binary result record at `ptr` (byte offset, 8-aligned) of `bytes` bytes in `buffer`.
 *  Everything is copied out (plain numbers / Arrays) — the WASM memory may detach on growth. */
export function decodeResult(buffer, ptr, bytes) {
  if (bytes < 16 || (ptr & 7) !== 0 || (bytes & 7) !== 0) throw new Error(`dt_core result: bad record (ptr ${ptr}, ${bytes} bytes)`);
  const hdr = new Uint32Array(buffer, ptr, 4);
  if (hdr[0] !== RESULT_MAGIC) throw new Error(`dt_core result: bad magic 0x${hdr[0].toString(16)}`);
  if (hdr[1] !== RESULT_SCHEMA) throw new Error(`dt_core result: schema v${hdr[1]}, decoder expects v${RESULT_SCHEMA} (rebuild wasm / update decoder)`);
  const words = hdr[2];
  if (words * 8 !== bytes) throw new Error(`dt_core result: length mismatch (${words} words vs ${bytes} bytes)`);
  const rd = new Reader(new Float64Array(buffer, ptr, words), 2, words);
  const r = {};
  r.t = rd.n();
  r.nCh = rd.i();
  r.rows = rd.i();
  r.cols = rd.i();
  r.analysis = rd.some() ? decodeAnalysis(rd) : null;
  r.beam = rd.some() ? decodeBeam(rd) : null;
  r.features = rd.some() ? decodeFeatures(rd) : null;
  r.estimates = {};
  r.estimates.fusion = rd.some() ? decodeEstimate(rd) : null;
  r.estimates.cap = rd.some() ? decodeEstimate(rd) : null;
  r.estimates.ppg = rd.some() ? decodeEstimate(rd) : null;
  r.spo2 = rd.n();
  r.calibrated = rd.b();
  r.engine = ENGINE_CODES[rd.i()] || 'rust';
  r.estimator = decodeEstimator(rd);
  r.attach = decodeAttach(rd);
  if (!rd.done()) throw new Error(`dt_core result: decoder consumed ${rd.pos} of ${words} words (field table out of sync?)`);
  return r;
}

export class WasmAnalysisCore {
  static async load({ url = DEFAULT_WASM_URL, bytes = null, masterFs = 16000, maxCh = 48 } = {}) {
    let instance;
    if (bytes) ({ instance } = await WebAssembly.instantiate(bytes, {}));
    else if (typeof fetch === 'function') {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`dt_core.wasm fetch failed: ${resp.status}`);
      try { ({ instance } = await WebAssembly.instantiateStreaming(resp, {})); }
      catch (_) { ({ instance } = await WebAssembly.instantiate(await (await fetch(url)).arrayBuffer(), {})); }
    } else throw new Error('no fetch / bytes');
    return new WasmAnalysisCore(instance, { masterFs, maxCh });
  }

  constructor(instance, { masterFs = 16000, maxCh = 48 } = {}) {
    this.x = instance.exports;
    this.mem = this.x.memory;
    this.h = this.x.dt_core_new(masterFs, maxCh);
    this.fs = masterFs; this.maxCh = maxCh;
    this.cfg = { rows: 3, cols: 3, spacingMm: 4, sheetLateral_mm: 12, capFs: 1000, delayComp: true, attachGate: true };
    this.t = 0;
    this._scratch = { ptr: 0, len: 0 }; // reusable input buffer (bytes)
    this._dec = new TextDecoder();
    this.engine = 'rust';
    this.version = this.x.dt_version();
    this.resultFormat = 'binary'; // 'binary' (default) | 'json' (debug: dt_core_result_json)
    const schema = this.x.dt_result_schema ? this.x.dt_result_schema() : 0;
    if (schema !== RESULT_SCHEMA) throw new Error(`dt_core.wasm result schema v${schema} ≠ decoder v${RESULT_SCHEMA} (rebuild with ./rust/build.sh)`);
    this.lastAnalyzeMs = 0;
  }
  configure(cfg) {
    Object.assign(this.cfg, cfg);
    const c = this.cfg;
    this.x.dt_core_configure(this.h, c.rows | 0, c.cols | 0, +c.spacingMm, +c.sheetLateral_mm, +c.capFs, c.delayComp === false ? 0 : 1, c.attachGate === false ? 0 : 1); // attachGate false = diagnostic (estimator ignores the attachment monitor)
    // EVALUATION SWITCH (docs/CLINICAL_AUDIT.md §6.12): which RI-cue gate the estimator applies. Absent = the
    // build's own default; the eval harnesses set it so all candidates run on one build.
    if (c.riGateMode != null && this.x.dt_core_set_ri_gate_mode) this.x.dt_core_set_ri_gate_mode(this.h, RI_GATE_MODES.indexOf(c.riGateMode) < 0 ? 1 : RI_GATE_MODES.indexOf(c.riGateMode));
    // EVALUATION SWITCH (docs/CLINICAL_AUDIT.md §6.17): cross-modality fault detectors off/on (default on).
    if (c.xmod != null && this.x.dt_core_set_xmod) this.x.dt_core_set_xmod(this.h, c.xmod === false ? 0 : 1);
    // EVALUATION SWITCH (§6.24): PPG-internal optics layer bitmask (0 = the 6th-pass build, bit-identically)
    if (c.ppgOpt != null && this.x.dt_core_set_ppg_opt) this.x.dt_core_set_ppg_opt(this.h, c.ppgOpt >>> 0);
    // EVALUATION SWITCH (ROADMAP §2.2-10, docs/CLINICAL_AUDIT.md §6.19): wrist→finger PTT fiducial (any
    // non-legacy value also turns the PTT beat accumulation on) and its independent override.
    if (c.pttFiducial != null && this.x.dt_core_set_ptt_fiducial) this.x.dt_core_set_ptt_fiducial(this.h, Math.max(0, PTT_FIDUCIALS.indexOf(c.pttFiducial)));
    if (c.pttAccum != null && this.x.dt_core_set_ptt_accum) this.x.dt_core_set_ptt_accum(this.h, c.pttAccum === false ? 0 : 1);
    // Custom electrode layout (patch designer): sheet-relative positions [lateral, along] per electrode
    if (this.x.dt_core_set_layout) {
      const L = c.layout && c.layout.length ? c.layout : null;
      if (L) {
        const n = Math.min(L.length, this.maxCh), bytes = n * 16;
        this._ensureScratch(bytes);
        const f64 = new Float64Array(this.mem.buffer, this._scratch.ptr, n * 2);
        for (let i = 0; i < n; i++) { f64[2 * i] = +L[i].lateral_mm; f64[2 * i + 1] = +L[i].along_mm; }
        this.x.dt_core_set_layout(this.h, this._scratch.ptr, n);
      } else this.x.dt_core_clear_layout(this.h);
    }
  }
  nCh() { return Math.min(this.maxCh, this.cfg.layout && this.cfg.layout.length ? this.cfg.layout.length : this.cfg.rows * this.cfg.cols); }
  reset() { this.x.dt_core_reset(this.h); }
  calibrate(sbp, dbp) { return !!this.x.dt_core_calibrate(this.h, +sbp, +dbp); }
  sampleAgo(ch, ago) { return this.x.dt_core_sample_ago(this.h, ch | 0, ago | 0); }

  _ensureScratch(bytes) {
    if (this._scratch.len >= bytes) return;
    if (this._scratch.ptr) this.x.dt_free(this._scratch.ptr, this._scratch.len);
    const len = Math.max(bytes, 1 << 16);
    this._scratch = { ptr: this.x.dt_alloc(len), len };
  }

  // frame: { t0, n, cap: Float32Array(nCh*n) channel-major, red?, ir?, ref?, oracleGains? }
  push(frame) {
    const n = frame.n | 0; if (n <= 0) return;
    const nCh = this.nCh();
    const capLen = nCh * n;
    const nOr = frame.oracleGains ? frame.oracleGains.length : 0;
    // layout: cap (f32) | red | ir | ref | oracle (f64, 8-aligned)
    const f32Bytes = (capLen + 3 * n) * 4;
    const orOff = (f32Bytes + 7) & ~7;
    const total = orOff + nOr * 8;
    this._ensureScratch(total);
    const base = this._scratch.ptr;
    const f32 = new Float32Array(this.mem.buffer, base, capLen + 3 * n);
    if (frame.cap.length >= capLen) f32.set(frame.cap.subarray(0, capLen), 0); else { f32.fill(0, 0, capLen); f32.set(frame.cap, 0); }
    const redOff = capLen, irOff = capLen + n, refOff = capLen + 2 * n;
    if (frame.red) f32.set(frame.red.subarray(0, n), redOff); else f32.fill(0, redOff, redOff + n);
    if (frame.ir) f32.set(frame.ir.subarray(0, n), irOff); else f32.fill(0, irOff, irOff + n);
    if (frame.ref) f32.set(frame.ref.subarray(0, n), refOff);
    let orPtr = 0;
    if (nOr) { const f64 = new Float64Array(this.mem.buffer, base + orOff, nOr); for (let i = 0; i < nOr; i++) f64[i] = frame.oracleGains[i]; orPtr = base + orOff; }
    this.x.dt_core_push(this.h, +frame.t0, n, base, base + redOff * 4, base + irOff * 4, frame.ref ? base + refOff * 4 : 0, orPtr, nOr);
    // ③ wrist IMU (decimated, interleaved 6-axis) → pronation-rate prediction of the artery position
    if (frame.imu && frame.imuN > 0 && this.x.dt_core_push_imu) {
      const bytes = frame.imuN * 6 * 4;
      this._ensureScratch(bytes);
      new Float32Array(this.mem.buffer, this._scratch.ptr, frame.imuN * 6).set(frame.imu.subarray(0, frame.imuN * 6));
      this.x.dt_core_push_imu(this.h, this._scratch.ptr, frame.imuN, +frame.imuFs || 1000);
    }
    this.t = frame.t0 + n / this.fs;
  }

  analyze() {
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const len = this.x.dt_core_analyze(this.h);
    if (!len) return null;
    let r;
    if (this.resultFormat === 'json') { // debug fallback: serde_json of the same result
      const jl = this.x.dt_core_result_json(this.h);
      r = JSON.parse(this._dec.decode(new Uint8Array(this.mem.buffer, this.x.dt_core_json_ptr(this.h), jl)));
    } else r = decodeResult(this.mem.buffer, this.x.dt_core_out_ptr(this.h), len);
    // JS-contract niceties: NaN for "not available" numeric metrics in blind mode
    if (r.analysis) { if (r.analysis.mrcSnr_db == null) r.analysis.mrcSnr_db = NaN; if (r.analysis.corrMrc == null) r.analysis.corrMrc = NaN; }
    r.chans = null; // waveforms are rendered from the UI's own buffers (not shipped over the API)
    this.lastAnalyzeMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    r.analyzeMs = this.lastAnalyzeMs;
    return r;
  }
}
