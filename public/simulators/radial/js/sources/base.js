// ⑥ SignalSource — the one interface every source of sensor FRAMES implements (ROADMAP §4.2/§4.5-1).
//
// The analysis core already has a fixed contract (js/analysis/client.js): `configure(cfg)`,
// `pushFrame(frame)`, `calibrate(sbp,dbp)`, `reset()`, `onResult(cb)`, with
//   frame = { t0, n, nCh, cap: Float32Array(nCh·n) CHANNEL-MAJOR, red, ir, ref?, imu, imuN, imuFs, oracleGains? }
// This module adds the mirror image on the INPUT side, so the twin, a `.dtrec` replay and a real
// device stream are interchangeable and the algorithm never learns which one it is talking to:
//
//   src.configure(cfg)      what the app wants (array geometry, capFs); a live source may REFUSE and
//                           report back what the device actually sends — see `describe().mismatch`
//   await src.start()       begin producing
//   src.stop()
//   src.onFrame(cb)         cb(frame, meta) for every frame (meta: seq/latency/flags, may be null)
//   src.onStatus(cb)        cb(status) whenever the connection/quality state changes
//   src.take()              pull-mode drain (the UI loop uses this; push sources buffer internally)
//   src.pump(dtSeconds)     per-display-frame hook for sources that own a clock (twin, replay)
//   src.describe()          { kind, label, live, hasTruth, header, status, stats, notes }
//
// `hasTruth` is the property the UI keys the "진값 없음" treatment off: only a source that IS the
// simulator (or a recording MADE by the simulator) carries a reference BP/pulse. A live device never
// does — even when the wire happens to carry a `ref` block, no cuff reading exists for it.
//
// A source NEVER interpolates over a gap. Loss, lateness and rate mismatch are reported in `stats`
// and surfaced by the UI; punching zeros or holding samples into the analysis window would turn a
// transport fault into a physiological artefact.

export const SOURCE_STATUS = {
  idle: '대기',
  connecting: '연결 중',
  connected: '연결됨',
  reconnecting: '재연결 중',
  stalled: '스트림 정지',
  error: '오류',
  closed: '종료됨',
};

export class SignalSource {
  constructor({ kind = 'unknown', label = '' } = {}) {
    this.kind = kind; this.label = label;
    this.status = 'idle';
    this.header = null;          // stream/recording header, once known
    this._frameCbs = []; this._statusCbs = [];
    this.stats = { frames: 0, samples: 0, lost: 0, late: 0, dropped: 0, bad: 0, reconnects: 0, bytes: 0, latencyMs: null, lastFrameAt: 0 };
  }

  // ---- lifecycle (overridden; the defaults make a source that produces nothing but is legal) ----
  configure(_cfg) {}
  async start() { this._setStatus('connected'); }
  stop() { this._setStatus('closed'); }
  pump(_dtSeconds) {}
  take() { return []; }

  // ---- observers ----
  onFrame(cb) { this._frameCbs.push(cb); return () => { const i = this._frameCbs.indexOf(cb); if (i >= 0) this._frameCbs.splice(i, 1); }; }
  onStatus(cb) { this._statusCbs.push(cb); return () => { const i = this._statusCbs.indexOf(cb); if (i >= 0) this._statusCbs.splice(i, 1); }; }

  describe() {
    return { kind: this.kind, label: this.label, live: false, hasTruth: true, status: this.status, statusText: SOURCE_STATUS[this.status] || this.status, header: this.header, stats: { ...this.stats } };
  }

  // ---- internals for subclasses ----
  _emitFrame(frame, meta = null) {
    this.stats.frames++; this.stats.samples += frame.n | 0; this.stats.lastFrameAt = nowMs();
    for (const cb of this._frameCbs) cb(frame, meta);
  }
  _setStatus(s, detail = null) {
    if (this.status === s && !detail) return;
    this.status = s; this.detail = detail;
    for (const cb of this._statusCbs) cb(s, detail);
  }
}

export const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.timeOrigin + performance.now() : Date.now());
