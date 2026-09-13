// ⑤ Sensor-frame recording (export) and replay — shared by the UI and Node.
//
// File format `.dtrec` (binary, little-endian):
//   "DTREC" (5 bytes) · version u8 (1 or 2) · u16 reserved · u32 headerLen · header JSON (UTF-8)
//   then frames, each starting at an 8-byte boundary:
//     f64 t0 · u32 n · u32 imuN · u32 nOracle · u32 flags(bit0 = hasRef, bit1 = hasEcg — v2 only)
//     f32[nCh·n] cap (channel-major) · f32[n] red · f32[n] ir · f32[n] ref (if hasRef)
//     · f32[n] ecg (if hasEcg, v2 only) · f32[6·imuN] imu · f32[nOracle] oracleGains
// Header: { version, masterFs, nCh, capFs, rows, cols, spacingMm, sheetLateral_mm, sheetAlong_mm, layout|null,
//           imuFs, createdAt, scenario{…}, durationS, nFrames, notes }
// The frame objects are exactly the AnalysisClient/engine.frameSince() contract, so a recording can be
// pushed straight into the analysis core (Node or browser) or written back into the engine buffers.
//
// VERSION 2 (2026-08-29) — optional single-lead ECG stream, back-compatible both ways:
//   * v1 = everything up to and including 2026-08-24 (eval/samples/*.dtrec, eval/samples/measured/*.dtrec).
//     v1 frames have NO ecg field and only ever wrote flags ∈ {0,1}; the reader accepts them unchanged.
//   * v2 adds `f32[n] ecg` between `ref` and `imu`, gated by flags bit1. `n` is the frame's capacitance
//     sample count, i.e. the ECG is stored at the SAME rate as the capacitance stream (`header.storedFs`)
//     and is zero-order-held with it by `holdFrame` — the twin has no separate ECG clock.
//   * The WRITER DOWNGRADES: `encodeRecording` stamps version 1 whenever no frame carries an ECG, so the
//     twin's own recordings and everything else that never sets `fr.ecg` keep producing byte-identical v1
//     files that older copies of this reader still load. Version 2 appears only when ECG data exists.
//   * The READER accepts 1…CURRENT_VERSION and forces hasEcg = false on v1 regardless of the flag word, so
//     a v1 file can never be mis-parsed even if some other writer had set a reserved bit.
//   Header side-cars that go with an ECG stream (all optional, all written by eval/convert_measured.py):
//     `hasEcg`, `ecg:{ column, units, lead, fs, contact{…}, leakage{…} }`, `reference:{…}` (discrete cuff
//     readings — NOT a truth waveform, so deliberately NOT the `ref` stream), `placement:{…}`.

const MAGIC = 'DTREC';
export const CURRENT_VERSION = 2;   // highest version this writer can emit / this reader understands
export const MIN_VERSION = 1;       // oldest version this reader accepts
export const F_REF = 1, F_ECG = 2;  // frame flag bits

function align8(n) { return (n + 7) & ~7; }

export function frameByteLength(fr, nCh) {
  const n = fr.n | 0, imuN = fr.imuN | 0, nOr = fr.oracleGains ? fr.oracleGains.length : 0, hasRef = !!fr.ref, hasEcg = !!fr.ecg;
  return align8(24 + 4 * (nCh * n + 2 * n + (hasRef ? n : 0) + (hasEcg ? n : 0) + 6 * imuN + nOr));
}

// The file version needed by this frame set: 2 only if an ECG stream is actually present (see the header note).
export function recordingVersion(frames) {
  for (const fr of frames) if (fr && fr.ecg && fr.ecg.length) return 2;
  return 1;
}

export function encodeRecording(header, frames) {
  const enc = new TextEncoder();
  const nCh = header.nCh | 0;
  const version = recordingVersion(frames);
  const hdrBytes = enc.encode(JSON.stringify({ ...header, version, nFrames: frames.length }));
  let total = align8(12 + hdrBytes.length);
  for (const fr of frames) total += frameByteLength(fr, nCh);
  const buf = new ArrayBuffer(total), dv = new DataView(buf), u8 = new Uint8Array(buf);
  for (let i = 0; i < 5; i++) u8[i] = MAGIC.charCodeAt(i);
  u8[5] = version; dv.setUint16(6, 0, true); dv.setUint32(8, hdrBytes.length, true);
  u8.set(hdrBytes, 12);
  let off = align8(12 + hdrBytes.length);
  for (const fr of frames) {
    const n = fr.n | 0, imuN = fr.imuN | 0, nOr = fr.oracleGains ? fr.oracleGains.length : 0, hasRef = !!fr.ref, hasEcg = !!fr.ecg;
    dv.setFloat64(off, fr.t0, true); dv.setUint32(off + 8, n, true); dv.setUint32(off + 12, imuN, true); dv.setUint32(off + 16, nOr, true);
    dv.setUint32(off + 20, (hasRef ? F_REF : 0) | (hasEcg ? F_ECG : 0), true);
    let p = off + 24;
    const put = (arr, count) => { const v = new Float32Array(buf, p, count); if (arr) v.set(arr.subarray ? arr.subarray(0, count) : arr.slice(0, count)); p += 4 * count; };
    put(fr.cap, nCh * n); put(fr.red, n); put(fr.ir, n); if (hasRef) put(fr.ref, n); if (hasEcg) put(fr.ecg, n); put(fr.imu, 6 * imuN);
    if (nOr) { const v = new Float32Array(buf, p, nOr); for (let i = 0; i < nOr; i++) v[i] = fr.oracleGains[i]; p += 4 * nOr; }
    off += frameByteLength(fr, nCh);
  }
  return buf;
}

// Zero-order-hold a frame stored at `storedFs` up to the header's masterFs (factor = masterFs / storedFs, integer).
// Measured recordings (eval/convert_measured.py) store the native capacitance rate (250 Hz for
// data_version1/2, 1000 Hz for data_with_ecg1) and declare masterFs 2000 (the smallest master clock the
// core's 500 Hz / 2 kHz decimators accept) — same ZOH convention as the twin's capacitance front-end
// (capFs → master clock). The ECG rides on the same clock and is held with it. IMU samples carry their own rate.
export function holdFrame(fr, k) {
  const n = fr.n, m = n * k, nCh = fr.nCh;
  const up = (src, ch) => { const o = new Float32Array(m); if (!src) return o; for (let i = 0; i < n; i++) { const v = src[ch * n + i]; const b = i * k; for (let j = 0; j < k; j++) o[b + j] = v; } return o; };
  const cap = new Float32Array(nCh * m);
  for (let ch = 0; ch < nCh; ch++) cap.set(up(fr.cap, ch), ch * m);
  return { ...fr, n: m, cap, red: fr.red ? up(fr.red, 0) : null, ir: fr.ir ? up(fr.ir, 0) : null, ref: fr.ref ? up(fr.ref, 0) : null, ecg: fr.ecg ? up(fr.ecg, 0) : null };
}

// options.expand (default true): frames stored below masterFs (header.storedFs) are zero-order-held to masterFs
// so every consumer sees the documented contract (cap = nCh × n at masterFs). `expand:false` returns the raw frames.
export function decodeRecording(buf, { expand = true } = {}) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  let magic = ''; for (let i = 0; i < 5; i++) magic += String.fromCharCode(u8[i]);
  if (magic !== MAGIC) throw new Error('not a DTREC file');
  // Accept every version this reader knows: v1 (no ECG stream) and v2 (optional ECG stream, flags bit1).
  const version = u8[5];
  if (version < MIN_VERSION || version > CURRENT_VERSION) throw new Error(`unsupported DTREC version ${version} (this reader handles ${MIN_VERSION}…${CURRENT_VERSION})`);
  const hdrLen = dv.getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(u8.subarray(12, 12 + hdrLen)));
  const nCh = header.nCh | 0;
  const masterFs = header.masterFs || 16000, storedFs = header.storedFs || masterFs;
  const k = expand && storedFs !== masterFs ? Math.round(masterFs / storedFs) : 1;
  if (expand && storedFs !== masterFs && (k < 1 || Math.abs(masterFs / storedFs - k) > 1e-9)) throw new Error(`DTREC storedFs ${storedFs} does not divide masterFs ${masterFs}`);
  const frames = [];
  let off = align8(12 + hdrLen);
  while (off + 24 <= buf.byteLength) {
    const t0 = dv.getFloat64(off, true), n = dv.getUint32(off + 8, true), imuN = dv.getUint32(off + 12, true), nOr = dv.getUint32(off + 16, true), flags = dv.getUint32(off + 20, true);
    const hasRef = (flags & F_REF) === F_REF;
    // v1 never had an ECG stream: ignore bit1 there so a v1 file can never be mis-parsed.
    const hasEcg = version >= 2 && (flags & F_ECG) === F_ECG;
    if (n === 0) break;
    let p = off + 24;
    const take = (count) => { const v = new Float32Array(buf.slice(p, p + 4 * count)); p += 4 * count; return v; };
    const cap = take(nCh * n), red = take(n), ir = take(n), ref = hasRef ? take(n) : null, ecg = hasEcg ? take(n) : null, imu = take(6 * imuN);
    const oracleGains = nOr ? Array.from(take(nOr)) : null;
    const fr = { t0, n, nCh, cap, red: header.hasPpg === false ? null : red, ir: header.hasPpg === false ? null : ir, ref, ecg, oracleGains, imu, imuN, imuFs: header.imuFs || 1000 };
    frames.push(k > 1 ? holdFrame(fr, k) : fr);
    off += align8(24 + 4 * (nCh * n + 2 * n + (hasRef ? n : 0) + (hasEcg ? n : 0) + 6 * imuN + nOr));
  }
  return { header, frames };
}

// Accumulates frames (COPIES — the originals are transferred to the Worker) during a live run.
export class Recorder {
  constructor() { this.frames = []; this.header = null; this.bytes = 0; this.active = false; this.startT = 0; this.maxSeconds = 180; }
  start(header) { this.frames = []; this.bytes = 0; this.header = { ...header, createdAt: new Date().toISOString() }; this.active = true; this.startT = null; }
  push(fr) {
    if (!this.active) return;
    if (this.startT == null) this.startT = fr.t0;
    if (fr.t0 - this.startT > this.maxSeconds) { this.active = false; return; }
    const copy = { t0: fr.t0, n: fr.n, nCh: fr.nCh, cap: new Float32Array(fr.cap), red: fr.red ? new Float32Array(fr.red) : null, ir: fr.ir ? new Float32Array(fr.ir) : null, ref: fr.ref ? new Float32Array(fr.ref) : null, ecg: fr.ecg ? new Float32Array(fr.ecg) : null,
      oracleGains: fr.oracleGains ? Array.from(fr.oracleGains) : null, imu: fr.imu ? new Float32Array(fr.imu) : new Float32Array(0), imuN: fr.imuN | 0, imuFs: fr.imuFs || 1000 };
    this.frames.push(copy); this.bytes += frameByteLength(copy, this.header.nCh);
  }
  seconds() { return this.frames.length ? this.frames[this.frames.length - 1].t0 + this.frames[this.frames.length - 1].n / (this.header.masterFs || 16000) - this.frames[0].t0 : 0; }
  stop() { this.active = false; const header = { ...this.header, durationS: this.seconds(), nFrames: this.frames.length }; return { header, frames: this.frames, buffer: encodeRecording(header, this.frames) }; }
}

// Plays frames back on a wall-clock: next(dtSeconds) → frames whose t0 falls inside the advanced window.
export class Replayer {
  constructor(rec) { this.rec = rec; this.idx = 0; this.clock = rec.frames.length ? rec.frames[0].t0 : 0; this.loop = true; this.done = false; }
  get header() { return this.rec.header; }
  get duration() { const f = this.rec.frames; return f.length ? f[f.length - 1].t0 + f[f.length - 1].n / (this.rec.header.masterFs || 16000) - f[0].t0 : 0; }
  get position() { const f = this.rec.frames; return f.length ? this.clock - f[0].t0 : 0; }
  reset() { this.idx = 0; this.clock = this.rec.frames.length ? this.rec.frames[0].t0 : 0; this.done = false; }
  next(dt) {
    const out = [];
    this.clock += dt;
    const f = this.rec.frames;
    while (this.idx < f.length && f[this.idx].t0 <= this.clock) out.push(f[this.idx++]);
    if (this.idx >= f.length) { if (this.loop) { this.reset(); } else this.done = true; }
    return out;
  }
}

export function recordingFilename(prefix = 'recording') {
  const d = new Date(), z = (v) => String(v).padStart(2, '0');
  return `${prefix}_${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}.dtrec`;
}
