// Web Worker wrapper around the analysis core. The core is the Rust/WASM engine (dt_core.wasm) by
// default; `worker.js?core=js` selects the JavaScript reference implementation; `?fmt=json` makes the
// WASM core use its JSON debug result path instead of the binary record (see wasmCore.js).
// Messages:
//   {type:'configure', cfg} · {type:'frame', ...frame} · {type:'calibrate', sbp, dbp} · {type:'reset'}
//   {type:'cadence', ms}  — analysis period (default 250 ms) · {type:'analyzeNow'}
// Posts: {type:'ready', engine} · {type:'result', result} · {type:'ack', what} · {type:'error', message}

import { AnalysisCore } from './core.js';
import { WasmAnalysisCore } from './wasmCore.js';

const params = new URLSearchParams(self.location.search);
const wantCore = params.get('core') || 'wasm';
const wantFmt = params.get('fmt') || 'binary';

let core = null;
let period = 250, timer = null, busy = false;
const queue = []; // messages received before the core is ready

async function boot() {
  if (wantCore === 'wasm') {
    try { core = await WasmAnalysisCore.load(); if (wantFmt === 'json') core.resultFormat = 'json'; }
    catch (e) { self.postMessage({ type: 'error', message: 'WASM core unavailable, using JS core: ' + (e && e.message || e) }); }
  }
  if (!core) { core = new AnalysisCore(); core.engine = 'js'; }
  self.postMessage({ type: 'ready', engine: core.engine });
  for (const m of queue) handle(m);
  queue.length = 0;
  schedule();
}

function tick() {
  if (busy || !core) return;
  busy = true;
  try {
    const r = core.analyze();
    if (r) {
      if (!r.engine) r.engine = core.engine || 'js';
      const transfer = [];
      if (r.analysis && r.analysis.combined && r.analysis.combined.buffer) transfer.push(r.analysis.combined.buffer);
      if (r.analysis && r.analysis.refDemeaned && r.analysis.refDemeaned.buffer) transfer.push(r.analysis.refDemeaned.buffer);
      if (r.chans) for (const c of r.chans) transfer.push(c.buffer);
      self.postMessage({ type: 'result', result: r }, transfer);
    }
  } catch (e) { self.postMessage({ type: 'error', message: String(e && e.stack || e) }); }
  busy = false;
}
function schedule() { if (timer) clearInterval(timer); timer = setInterval(tick, period); }

function handle(m) {
  switch (m.type) {
    case 'configure': core.configure(m.cfg); self.postMessage({ type: 'ack', what: 'configure' }); break;
    case 'frame': core.push(m); break;
    case 'calibrate': self.postMessage({ type: 'ack', what: 'calibrate', ok: core.calibrate(m.sbp, m.dbp) }); break;
    case 'reset': core.reset(); self.postMessage({ type: 'ack', what: 'reset' }); break;
    case 'cadence': period = Math.max(50, m.ms | 0); schedule(); break;
    case 'analyzeNow': tick(); break;
  }
}

self.onmessage = (ev) => {
  const m = ev.data;
  if (m.type === 'cadence') { period = Math.max(50, m.ms | 0); if (core) schedule(); return; }
  if (!core) { if (m.type === 'frame' && queue.length > 600) queue.shift(); queue.push(m); return; }
  handle(m);
};

boot();
