// AnalysisClient — the UI's only handle on the analysis system. Runs the analysis core in a Web
// Worker when available (default), or in-thread as a fallback; same API either way:
//   client.configure(cfg) · client.pushFrame(frame) · client.calibrate(sbp, dbp) · client.reset()
//   client.onResult(cb)   — called with each result
//   client.last           — most recent result · client.engine — 'rust' | 'js' (once ready)
// Options: { useWorker, cadenceMs, core: 'wasm' | 'js', fmt: 'binary' | 'json' }  (core default: 'wasm' =
// Rust engine; fmt default: 'binary' result record, or the page URL's `?fmt=json` → JSON debug path)

import { AnalysisCore } from './core.js';
import { WasmAnalysisCore } from './wasmCore.js';

const pageFmt = () => { try { return new URLSearchParams(self.location.search).get('fmt'); } catch (_) { return null; } };

export class AnalysisClient {
  constructor({ useWorker = true, cadenceMs = 250, core = 'wasm', fmt = pageFmt() || 'binary' } = {}) {
    this.last = null; this._cbs = []; this.mode = 'inline'; this.engine = null; this.coreKind = core; this.fmt = fmt;
    this._queue = []; // inline mode: frames/commands before the async core is ready
    if (useWorker && typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL(`./worker.js?core=${core}&fmt=${fmt}`, import.meta.url), { type: 'module' });
        this.worker.onmessage = (ev) => {
          const m = ev.data;
          if (m.type === 'result') { this.engine = m.result.engine || this.engine; this._emit(m.result); }
          else if (m.type === 'ready') this.engine = m.engine;
          else if (m.type === 'error') console.warn('[analysis worker]', m.message);
        };
        this.worker.onerror = (e) => { console.warn('[analysis worker] failed, falling back inline:', e.message); this._fallback(cadenceMs); };
        this.worker.postMessage({ type: 'cadence', ms: cadenceMs });
        this.mode = 'worker';
      } catch (e) { this._fallback(cadenceMs); }
    } else this._fallback(cadenceMs);
  }
  _fallback(cadenceMs) {
    if (this.worker) { try { this.worker.terminate(); } catch (_) {} this.worker = null; }
    this.mode = 'inline'; this.core = null;
    const start = (core) => {
      this.core = core; this.engine = core.engine || 'js';
      for (const q of this._queue) q(core); this._queue.length = 0;
      this._timer = setInterval(() => { const r = this.core.analyze(); if (r) { if (!r.engine) r.engine = this.engine; this._emit(r); } }, cadenceMs);
    };
    if (this.coreKind === 'wasm') WasmAnalysisCore.load().then((c) => { if (this.fmt === 'json') c.resultFormat = 'json'; start(c); }).catch((e) => { console.warn('[analysis] WASM core unavailable, using JS core:', e.message); const c = new AnalysisCore(); c.engine = 'js'; start(c); });
    else { const c = new AnalysisCore(); c.engine = 'js'; start(c); }
  }
  _emit(r) { this.last = r; for (const cb of this._cbs) cb(r); }
  onResult(cb) { this._cbs.push(cb); }
  _inline(fn) { if (this.core) fn(this.core); else { if (this._queue.length > 600) this._queue.shift(); this._queue.push(fn); } }
  configure(cfg) { if (this.worker) this.worker.postMessage({ type: 'configure', cfg }); else this._inline((c) => c.configure(cfg)); }
  // frame: { t0, n, cap: Float32Array(nCh*n), red, ir, ref?, oracleGains? } — typed arrays are transferred
  pushFrame(frame) {
    if (this.worker) {
      const transfer = [frame.cap.buffer]; if (frame.red) transfer.push(frame.red.buffer); if (frame.ir) transfer.push(frame.ir.buffer); if (frame.ref) transfer.push(frame.ref.buffer); if (frame.imu && frame.imu.length) transfer.push(frame.imu.buffer);
      this.worker.postMessage({ type: 'frame', ...frame }, transfer);
    } else this._inline((c) => c.push(frame));
  }
  calibrate(sbp, dbp) { if (this.worker) this.worker.postMessage({ type: 'calibrate', sbp, dbp }); else this._inline((c) => c.calibrate(sbp, dbp)); }
  reset() { this.last = null; if (this.worker) this.worker.postMessage({ type: 'reset' }); else this._inline((c) => c.reset()); }
}
