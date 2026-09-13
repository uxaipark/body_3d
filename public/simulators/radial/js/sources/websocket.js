// ⑥ WebSocketSource — a LIVE sensor stream as a SignalSource (ROADMAP §3-5, §4.3 단계 2).
//
// Connects to a `ws://…` endpoint (a device bridge — server/dt_bridge.mjs, or a real driver process),
// decodes DTSTM binary messages (js/sources/wire.js) and hands the analysis core exactly the frame
// contract the twin hands it. The algorithm side is untouched: same `{t0, n, nCh, cap, red, ir, imu…}`.
//
// WHAT THIS CLASS IS ACTUALLY FOR — everything that is NOT true of the simulator:
//
//  · RECONNECT.  A socket dies. We retry with exponential backoff (250 ms → 5 s, unbounded attempts)
//    and require a fresh STREAM HEADER before accepting frames again, because the new socket may be a
//    different device/configuration. Every reconnect raises a GAP: the sample history now has a hole,
//    so the app must drop its analysis windows rather than let one window straddle the hole.
//
//  · BACKPRESSURE.  The socket delivers whenever the OS says so; the UI drains once per display frame.
//    The queue is bounded (`maxQueue` frames ≈ 2 s of stream). Over that we DROP THE OLDEST and count
//    it — the newest samples are the ones the estimator needs, and an unbounded queue would silently
//    turn into seconds of latency. Dropping raises a GAP for the same reason a reconnect does.
//
//  · LATE / OUT-OF-ORDER FRAMES.  `seq` is monotonic on the wire. seq ≤ lastSeq → the frame is late or
//    duplicated: DROPPED and counted (`late`). Feeding it in would write old samples over new ones in
//    the core's ring buffer. seq > lastSeq+1 → frames were lost in transit: counted (`lost`), and the
//    gap is NOT interpolated — the core simply receives fewer samples, which is the honest signal.
//
//  · RATE MISMATCH.  Every frame header carries its own `fs`. If it disagrees with the stream header's
//    `capFs` (or with what the app configured), the frame is DROPPED and `mismatch` is raised. We never
//    resample: a silent resample would move every Δt/PTT/PWV number the core produces.
//
//  · STALL.  No frame for `stallMs` → status `stalled`, with the elapsed time. The core keeps its last
//    window; nothing is fabricated to fill the silence.
//
// LATENCY. Two numbers, because they answer different questions and only one of them is trustworthy
// across machines:
//   `latencyMs`  = arrival wall clock − the sender's `tHost`. Valid when sender and receiver share a
//                  clock (localhost bridge — the intended deployment). Suppressed (null, `clockSuspect`)
//                  if it comes out negative or absurd, rather than reported as a fake number.
//   `driftMs`    = (arrival − first arrival) − (t0 − first t0). Clock-INDEPENDENT: how far the stream
//                  has fallen behind the real time it claims to represent. This is the one that grows
//                  when a device or a bridge cannot keep up.

import { SignalSource, nowMs } from './base.js';
import { decodeMessage } from './wire.js';

const DEFAULTS = {
  maxQueue: 64,        // frames buffered between UI drains (≈ 6 s at 10 fps chunks)
  stallMs: 1500,       // no frame for this long → `stalled`
  backoffMs: 250,      // first reconnect delay
  maxBackoffMs: 5000,
  reconnect: true,
};

export class WebSocketSource extends SignalSource {
  constructor(url, opts = {}) {
    super({ kind: 'ws', label: url });
    this.url = String(url);
    this.opt = { ...DEFAULTS, ...opts };
    this.ws = null;
    this.queue = [];
    this.want = null;            // what the app configured: { capFs, nCh, layoutId }
    this.mismatch = [];          // human-readable mismatch notes (rate / channels / layout)
    this._lastSeq = -1;
    this._attempt = 0;
    this._timer = null; this._watch = null;
    this._closing = false;
    this._t0First = null; this._arrFirst = null; this._lastT0 = 0;
    this._gapCbs = []; this._headerCbs = [];
    this.stats.driftMs = 0; this.stats.clockSuspect = false; this.stats.resultLatencyMs = null;
    this.stats.stallMs = 0; this.stats.mismatched = 0; this.stats.lastMismatch = null;
    this._lastPushTHost = 0;
  }

  // What the app wants the stream to be. A live source cannot be told what to send, so this only
  // records the expectation — `describe().mismatch` is what the UI shows when the device disagrees.
  configure(cfg) { this.want = cfg ? { capFs: cfg.capFs, nCh: cfg.nCh, layoutId: cfg.layoutId } : null; this._checkHeader(); }

  onGap(cb) { this._gapCbs.push(cb); return () => { const i = this._gapCbs.indexOf(cb); if (i >= 0) this._gapCbs.splice(i, 1); }; }
  onHeader(cb) { this._headerCbs.push(cb); return () => { const i = this._headerCbs.indexOf(cb); if (i >= 0) this._headerCbs.splice(i, 1); }; }
  _gap(reason) { for (const cb of this._gapCbs) cb(reason); }

  async start() {
    this._closing = false;
    this._open();
    if (!this._watch) this._watch = setInterval(() => this._tickWatchdog(), 250);
    return new Promise((resolve) => {
      if (this.status === 'connected') return resolve(this);
      const off = this.onStatus((s) => { if (s === 'connected' || s === 'error') { off(); resolve(this); } });
    });
  }

  stop() {
    this._closing = true;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    if (this._watch) { clearInterval(this._watch); this._watch = null; }
    if (this.ws) { try { this.ws.close(); } catch (_) {} this.ws = null; }
    this.queue.length = 0;
    this._setStatus('closed');
  }

  // Pull-mode drain: the UI loop takes whatever arrived since the last display frame.
  take() {
    if (!this.queue.length) return [];
    const out = this.queue; this.queue = [];
    const last = out[out.length - 1];
    this._lastPushTHost = last.meta.tHost;
    return out.map((q) => q.frame);
  }
  takeWithMeta() { const out = this.queue; this.queue = []; if (out.length) this._lastPushTHost = out[out.length - 1].meta.tHost; return out; }

  // Called by the app when an analysis RESULT lands, to close the loop bridge → result.
  noteResult() {
    if (!this._lastPushTHost || this.stats.clockSuspect) return;
    const d = Date.now() - this._lastPushTHost;
    if (d < -50 || d > 60000) return;
    this.stats.resultLatencyMs = this.stats.resultLatencyMs == null ? d : 0.7 * this.stats.resultLatencyMs + 0.3 * d;
  }

  pump() {}

  describe() {
    const h = this.header || {};
    return { ...super.describe(), live: true, hasTruth: false, url: this.url,
      capFs: h.capFs, nCh: h.nCh, units: h.units, device: h.device, sampleFormat: h.sampleFormat,
      mismatch: this.mismatch.slice(), queued: this.queue.length,
      notes: '라이브 센서 스트림 — 커프 기준값이 없으므로 진값 대비 오차는 계산하지 않는다(수동 캘리브레이션만).' };
  }

  // ---------------------------------------------------------------------------------------------
  _open() {
    this._setStatus(this._attempt ? 'reconnecting' : 'connecting');
    let ws;
    try { ws = new WebSocket(this.url); } catch (e) { this._fail(e && e.message || String(e)); return; }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      if (this._attempt) { this.stats.reconnects++; this._gap('reconnect'); }
      this._attempt = 0; this._lastSeq = -1; this._t0First = null; this._arrFirst = null; this._lastT0 = 0;
      this.stats.lastFrameAt = nowMs();
      this._setStatus('connected');
    };
    ws.onmessage = (ev) => { if (this.ws === ws) this._onMessage(ev.data); };
    ws.onerror = () => { /* onclose always follows; the event carries nothing useful in browsers */ };
    ws.onclose = (ev) => { if (this.ws === ws) this._fail(`소켓 종료 (code ${ev && ev.code})`); };
  }

  _fail(msg) {
    this.ws = null;
    if (this._closing) return;
    if (!this.opt.reconnect) { this._setStatus('error', msg); return; }
    this._attempt++;
    const wait = Math.min(this.opt.maxBackoffMs, this.opt.backoffMs * Math.pow(2, this._attempt - 1));
    this._setStatus('reconnecting', `${msg} — ${(wait / 1000).toFixed(1)} s 후 재시도 #${this._attempt}`);
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => { this._timer = null; if (!this._closing) this._open(); }, wait);
  }

  _tickWatchdog() {
    if (this.status !== 'connected') return;
    const since = nowMs() - this.stats.lastFrameAt;
    this.stats.stallMs = since;
    if (since > this.opt.stallMs) this._setStatus('stalled', `${(since / 1000).toFixed(1)} s 무입력`);
  }

  _onMessage(data) {
    let msg;
    try { msg = decodeMessage(data instanceof ArrayBuffer ? data : new Uint8Array(data)); }
    catch (e) { this.stats.bad++; this._setStatus(this.status, `잘못된 프레임: ${e.message}`); return; }
    if (msg.kind === 'header') { this._onHeader(msg.header); return; }
    this._onFrame(msg.frame, msg.meta, (data.byteLength || msg.meta.bytes) | 0);
  }

  _onHeader(header) {
    const before = this.header;
    this.header = header;
    // A different configuration on the same socket is a structural change: the core's windows are void.
    if (before && (before.capFs !== header.capFs || before.nCh !== header.nCh || before.layoutId !== header.layoutId)) this._gap('configure');
    this._checkHeader();
    for (const cb of this._headerCbs) cb(header);
    this._setStatus('connected');
  }

  _checkHeader() {
    const h = this.header, w = this.want;
    this.mismatch = [];
    if (!h) return;
    if (!(h.capFs > 0)) this.mismatch.push('스트림 헤더에 capFs 없음');
    if (w) {
      if (w.capFs && h.capFs && Math.abs(w.capFs - h.capFs) > 1e-6) this.mismatch.push(`샘플레이트 불일치: 스트림 ${h.capFs} Hz ≠ 설정 ${w.capFs} Hz`);
      if (w.nCh && h.nCh && w.nCh !== h.nCh) this.mismatch.push(`채널 수 불일치: 스트림 ${h.nCh} ≠ 설정 ${w.nCh}`);
      if (w.layoutId && h.layoutId && w.layoutId !== h.layoutId) this.mismatch.push('전극 레이아웃 id 불일치');
    }
  }

  _onFrame(frame, meta, bytes) {
    const arr = nowMs();
    this.stats.bytes += bytes;
    if (!this.header) { this.stats.bad++; this._setStatus('connected', '스트림 헤더보다 프레임이 먼저 도착 — 무시'); return; }
    // --- rate mismatch: drop, never resample ---
    const hFs = this.header.capFs;
    if (hFs > 0 && meta.fs > 0 && Math.abs(meta.fs - hFs) > 1e-3) {
      this.stats.mismatched++;
      this.stats.lastMismatch = `프레임 샘플레이트 ${meta.fs} Hz ≠ 헤더 ${hFs} Hz — 프레임 폐기(보간 없음)`;
      this._setStatus('connected', this.stats.lastMismatch);
      return;
    }
    if (this.want && this.want.capFs && meta.fs > 0 && Math.abs(meta.fs - this.want.capFs) > 1e-3) {
      this.stats.mismatched++;
      if (!this.mismatch.length) this._checkHeader();
      return; // the app's core is buffered at another rate — the mismatch note is already on screen
    }
    // --- late / out-of-order / lost ---
    if (this._lastSeq >= 0) {
      if (meta.seq <= this._lastSeq) { this.stats.late++; this._setStatus('connected', `지연/중복 프레임 seq ${meta.seq} ≤ ${this._lastSeq} — 폐기`); return; }
      const gap = meta.seq - this._lastSeq - 1;
      if (gap > 0) { this.stats.lost += gap; this._gap('loss'); }
    }
    this._lastSeq = meta.seq;
    // --- latency / drift ---
    // Re-baseline when stream time goes BACKWARDS: a bridge replaying a file in a loop rewinds `t0`,
    // and without this the loop length would be booked as "the stream is falling behind" every pass.
    if (this._t0First == null || frame.t0 < this._lastT0) { this._t0First = frame.t0; this._arrFirst = arr; }
    this._lastT0 = frame.t0;
    this.stats.driftMs = (arr - this._arrFirst) - (frame.t0 - this._t0First) * 1000;
    const lat = Date.now() - meta.tHost;
    if (lat < -50 || lat > 60000) { this.stats.clockSuspect = true; this.stats.latencyMs = null; }
    else this.stats.latencyMs = this.stats.latencyMs == null ? lat : 0.8 * this.stats.latencyMs + 0.2 * lat;
    // --- backpressure ---
    this.queue.push({ frame, meta });
    if (this.queue.length > this.opt.maxQueue) {
      const over = this.queue.length - this.opt.maxQueue;
      this.queue.splice(0, over);
      this.stats.dropped += over;
      this._gap('backpressure');
    }
    this.stats.lastFrameAt = arr; this.stats.stallMs = 0;
    if (this.status === 'stalled') this._setStatus('connected', '스트림 재개');
    this._emitFrame(frame, meta);
  }
}
