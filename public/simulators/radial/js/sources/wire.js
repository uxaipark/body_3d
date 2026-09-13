// ⑥ DTSTM — the live sensor STREAM wire format (ROADMAP §3-5 / §4.2–4.4).
//
// One binary WebSocket message = one DTSTM message. Two kinds share an 8-byte prefix so a receiver can
// dispatch before it knows anything else:
//
//   off 0  u8[5]  magic  'D','T','S','T','M'
//   off 5  u8     version (= 1)
//   off 6  u8     kind    0 = STREAM HEADER (JSON), 1 = FRAME
//   off 7  u8     flags   (kind 1 only — see below; 0 for kind 0)
//
// KIND 0 — STREAM HEADER. Bytes 8… are UTF-8 JSON. Sent as the FIRST message on every connection
// (and again whenever the sender's configuration changes), because a receiver that reconnects has no
// memory of the previous socket. The field names are deliberately the SAME as a `.dtrec` header
// (js/recording.js) so the two formats stay legible together — a bridge can copy a recording header
// through almost verbatim:
//   { version, stream:1, nCh, capFs, masterFs, storedFs, rows, cols, spacingMm, sheetLateral_mm,
//     sheetAlong_mm, layout|null, imuFs, hasPpg, hasRef, hasImu, units, scale_pF_per_count,
//     sampleFormat:'f32'|'i32', layoutId, source, device, notes, chunkMs, tHostEpochMs, measured{…} }
// `masterFs`/`storedFs` are the .dtrec ZOH convention (§MEASURED_REPLAY 3); for a live stream
// `capFs` IS the wire rate and `storedFs` is redundant but accepted.
//
// KIND 1 — FRAME. A 56-byte binary header, then the payload. Little-endian throughout, like `.dtrec`.
//   off  0  u8[5] magic · u8 version · u8 kind(=1) · u8 flags
//                 flags bit0 = payload carries a `ref` block (simulator/bench truth only)
//                       bit1 = samples are int32 (raw ADC/CDC codes) instead of float32
//                       bit2 = payload carries PPG red/ir blocks
//   off  8  u32   seq      monotonic frame counter — a gap IS the frame loss, a repeat IS a late frame
//   off 12  u32   nCh
//   off 16  u32   n        samples per channel in this frame
//   off 20  u32   imuN     6-axis IMU samples (ax,ay,az,gx,gy,gz interleaved)
//   off 24  f32   fs       sample rate of the capacitive payload (Hz) — MUST equal the header's capFs;
//                          a receiver flags a mismatch and DROPS the frame (never resamples silently)
//   off 28  f32   imuFs
//   off 32  f32   scale    payload × scale → the header's `units` (e.g. pF/count for a 24-bit CDC)
//   off 36  u32   layoutId 32-bit id/hash of the electrode layout the sender used (0 = "as in the header")
//   off 40  f64   t0       stream time of the first sample (s, sender's own clock)
//   off 48  f64   tHost    sender wall clock at send (ms since Unix epoch) — the latency reference
//   off 56  payload:  f32|i32 [nCh·n] cap (CHANNEL-MAJOR, exactly like .dtrec)
//                     f32|i32 [n] red · [n] ir            (only if flags bit2)
//                     f32|i32 [n] ref                     (only if flags bit0)
//                     f32     [6·imuN] imu                (always float32 — g and deg/s)
//
// 56 is 8-byte aligned, so the payload can be viewed in place with no copy.
//
// WHY int32. The hardware target of ROADMAP §3-5 is a 24-bit capacitance-to-digital front-end at
// 1–2 kHz: its codes are integers and the pF scale is a calibration constant. Sending codes + `scale`
// keeps the wire exact and lets the receiver do the (single) conversion — the same decision
// eval/convert_measured.py made for the real 10-bit patch recordings (`--scale raw`).

export const WIRE_MAGIC = 'DTSTM';
export const WIRE_VERSION = 1;
export const KIND_HEADER = 0;
export const KIND_FRAME = 1;
export const FRAME_HEADER_BYTES = 56;
export const FLAG_REF = 1, FLAG_INT32 = 2, FLAG_PPG = 4;

const MAGIC_BYTES = [0x44, 0x54, 0x53, 0x54, 0x4d]; // 'DTSTM'

function putPrefix(u8, dv, kind, flags) {
  for (let i = 0; i < 5; i++) u8[i] = MAGIC_BYTES[i];
  u8[5] = WIRE_VERSION; u8[6] = kind; u8[7] = flags & 0xff;
}

/** True if `buf` (ArrayBuffer / typed array) starts with a DTSTM prefix of a version we understand. */
export function isWireMessage(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength);
  if (u8.length < 8) return false;
  for (let i = 0; i < 5; i++) if (u8[i] !== MAGIC_BYTES[i]) return false;
  return true;
}

export function encodeStreamHeader(header) {
  const json = new TextEncoder().encode(JSON.stringify({ ...header, version: WIRE_VERSION, stream: 1 }));
  const buf = new ArrayBuffer(8 + json.length), u8 = new Uint8Array(buf);
  putPrefix(u8, new DataView(buf), KIND_HEADER, 0);
  u8.set(json, 8);
  return buf;
}

/**
 * Encode one frame. `frame` is the analysis-frame contract (js/recording.js / engine.frameSince):
 *   { t0, n, nCh, cap, red?, ir?, ref?, imu?, imuN?, imuFs? }
 * opts: { seq, fs, scale = 1, int32 = false, layoutId = 0, tHost = Date.now(), hasPpg = auto }
 * With `int32` the caller is responsible for `cap` already holding integer CODES (scale converts back).
 */
export function encodeFrame(frame, opts = {}) {
  const n = frame.n | 0, nCh = frame.nCh | 0, imuN = frame.imuN | 0;
  const int32 = !!opts.int32;
  const hasPpg = opts.hasPpg != null ? !!opts.hasPpg : !!(frame.red || frame.ir);
  const hasRef = !!frame.ref;
  const flags = (hasRef ? FLAG_REF : 0) | (int32 ? FLAG_INT32 : 0) | (hasPpg ? FLAG_PPG : 0);
  const nSamp = nCh * n + (hasPpg ? 2 * n : 0) + (hasRef ? n : 0);
  const bytes = FRAME_HEADER_BYTES + 4 * nSamp + 4 * 6 * imuN;
  const buf = new ArrayBuffer(bytes), u8 = new Uint8Array(buf), dv = new DataView(buf);
  putPrefix(u8, dv, KIND_FRAME, flags);
  dv.setUint32(8, opts.seq >>> 0, true);
  dv.setUint32(12, nCh, true);
  dv.setUint32(16, n, true);
  dv.setUint32(20, imuN, true);
  dv.setFloat32(24, opts.fs || 0, true);
  dv.setFloat32(28, frame.imuFs || opts.imuFs || 0, true);
  dv.setFloat32(32, opts.scale == null ? 1 : opts.scale, true);
  dv.setUint32(36, (opts.layoutId || 0) >>> 0, true);
  dv.setFloat64(40, frame.t0 || 0, true);
  dv.setFloat64(48, opts.tHost == null ? Date.now() : opts.tHost, true);
  let p = FRAME_HEADER_BYTES;
  const view = int32 ? new Int32Array(buf, FRAME_HEADER_BYTES, nSamp) : new Float32Array(buf, FRAME_HEADER_BYTES, nSamp);
  let w = 0;
  const put = (src, count) => { if (src) for (let i = 0; i < count; i++) view[w + i] = src[i]; w += count; };
  put(frame.cap, nCh * n);
  if (hasPpg) { put(frame.red, n); put(frame.ir, n); }
  if (hasRef) put(frame.ref, n);
  p += 4 * nSamp;
  if (imuN) { const iv = new Float32Array(buf, p, 6 * imuN); if (frame.imu) iv.set(frame.imu.subarray ? frame.imu.subarray(0, 6 * imuN) : frame.imu.slice(0, 6 * imuN)); }
  return buf;
}

/**
 * Decode one DTSTM message.
 *   → { kind: 'header', header }
 *   → { kind: 'frame', frame, meta }   frame = the analysis-frame contract (Float32Array, scaled)
 *                                      meta  = { seq, fs, scale, int32, layoutId, tHost, bytes }
 * Throws on a bad magic / unsupported version / truncated payload — the caller decides what a
 * malformed message means (the WebSocketSource counts it and keeps the socket).
 */
export function decodeMessage(input) {
  const ab = input instanceof ArrayBuffer ? input : input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  const u8 = new Uint8Array(ab), dv = new DataView(ab);
  if (u8.length < 8) throw new Error('DTSTM message too short');
  for (let i = 0; i < 5; i++) if (u8[i] !== MAGIC_BYTES[i]) throw new Error('not a DTSTM message');
  const version = u8[5];
  if (version !== WIRE_VERSION) throw new Error(`unsupported DTSTM version ${version}`);
  const kind = u8[6], flags = u8[7];
  if (kind === KIND_HEADER) return { kind: 'header', header: JSON.parse(new TextDecoder().decode(u8.subarray(8))) };
  if (kind !== KIND_FRAME) throw new Error(`unknown DTSTM kind ${kind}`);
  if (u8.length < FRAME_HEADER_BYTES) throw new Error('DTSTM frame header truncated');
  const seq = dv.getUint32(8, true), nCh = dv.getUint32(12, true), n = dv.getUint32(16, true), imuN = dv.getUint32(20, true);
  const fs = dv.getFloat32(24, true), imuFs = dv.getFloat32(28, true), scale = dv.getFloat32(32, true);
  const layoutId = dv.getUint32(36, true), t0 = dv.getFloat64(40, true), tHost = dv.getFloat64(48, true);
  const int32 = (flags & FLAG_INT32) !== 0, hasRef = (flags & FLAG_REF) !== 0, hasPpg = (flags & FLAG_PPG) !== 0;
  if (!(n > 0) || !(nCh > 0)) throw new Error(`DTSTM frame with n=${n} nCh=${nCh}`);
  const nSamp = nCh * n + (hasPpg ? 2 * n : 0) + (hasRef ? n : 0);
  const need = FRAME_HEADER_BYTES + 4 * nSamp + 4 * 6 * imuN;
  if (u8.length < need) throw new Error(`DTSTM frame truncated: ${u8.length} < ${need} B`);
  const view = int32 ? new Int32Array(ab, FRAME_HEADER_BYTES, nSamp) : new Float32Array(ab, FRAME_HEADER_BYTES, nSamp);
  const k = scale && isFinite(scale) ? scale : 1;
  let r = 0;
  const take = (count) => { const o = new Float32Array(count); for (let i = 0; i < count; i++) o[i] = view[r + i] * k; r += count; return o; };
  const cap = take(nCh * n);
  const red = hasPpg ? take(n) : null, ir = hasPpg ? take(n) : null;
  const ref = hasRef ? take(n) : null;
  const imu = imuN ? new Float32Array(ab.slice(FRAME_HEADER_BYTES + 4 * nSamp, FRAME_HEADER_BYTES + 4 * nSamp + 24 * imuN)) : new Float32Array(0);
  return {
    kind: 'frame',
    frame: { t0, n, nCh, cap, red, ir, ref, imu, imuN, imuFs: imuFs || 0, oracleGains: null },
    meta: { seq, fs, scale: k, int32, layoutId, tHost, hasPpg, hasRef, bytes: u8.length },
  };
}

/** Stable 32-bit id of an electrode layout, so a receiver can tell "the sender re-arranged the pads". */
export function layoutIdOf(layout) {
  const els = layout && layout.electrodes ? layout.electrodes : layout;
  if (!els || !els.length) return 0;
  let h = 2166136261 >>> 0; // FNV-1a over the rounded (lateral, along) pairs, 0.01 mm resolution
  const s = els.map((e) => `${Math.round((e.x != null ? e.x : e.lateral_mm) * 100)},${Math.round((e.y != null ? e.y : e.along_mm) * 100)}`).join(';');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
