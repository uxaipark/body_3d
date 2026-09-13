// Web Worker host for the signal-generation engine (ROADMAP §2.3-15).
//
// Everything at 16 kHz — cardiac/segment pressures, PPG/SpO₂, the 48-channel capacitive array,
// EMG and the IMU — is produced HERE, off the UI thread. The worker runs its own fixed-step clock
// (js/engineClient.js `EngineRuntime`) and posts one render packet per display frame containing
// only decimated, render-ready buffers plus the 16 kHz analysis frame, whose typed arrays are
// TRANSFERRED (moved, not copied) so no 16 kHz block is ever duplicated on the way out.
//
// Message contract: see the header of js/engineClient.js. The in-thread fallback (`?inline=1`)
// drives the very same EngineRuntime, so both paths are bit-identical for the same command
// sequence and the same number of advances.
//
// FLOW CONTROL. The UI thread acks every packet it consumes. While more than MAX_UNACKED packets
// are outstanding (a busy or hidden tab) the worker neither posts NOR advances the clock — the
// same behaviour the pre-worker twin had when requestAnimationFrame stopped firing, and it keeps
// a hidden tab from waking up with seconds of un-analysed samples in the ring buffer.

import { EngineRuntime, FIXED_STEP_S } from './engineClient.js';

const MAX_UNACKED = 2;

const runtime = new EngineRuntime();
// The clock starts only when the UI thread says so ({type:'auto', on:true} — EngineClient.start()),
// so page-setup commands are applied before the first sample is ever produced.
let seq = 0, unacked = 0, auto = false, timer = null, lastTick = now();

function now() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }

function post() {
  try {
    const { packet, transfer } = runtime.renderPacket(seq++);
    unacked++;
    self.postMessage(packet, transfer);
  } catch (e) { self.postMessage({ type: 'error', message: String((e && e.stack) || e) }); }
}

function tick() {
  const t = now();
  if (unacked >= MAX_UNACKED) { lastTick = t; return; } // UI thread is behind — freeze the clock
  const dt = (t - lastTick) / 1000; lastTick = t;
  try { runtime.advance(dt); } catch (e) { self.postMessage({ type: 'error', message: String((e && e.stack) || e) }); }
  post();
}

function schedule() {
  if (timer) { clearInterval(timer); timer = null; }
  if (auto) { lastTick = now(); timer = setInterval(tick, Math.round(FIXED_STEP_S * 1000)); }
}

self.onmessage = (ev) => {
  const m = ev.data;
  try {
    switch (m.type) {
      case 'call': runtime.call(m.path, m.args); break;
      case 'set': runtime.set(m.path, m.value); break;
      case 'run':
        if (m.speed != null) runtime.speed = m.speed;
        if (m.paused != null) runtime.paused = !!m.paused;
        if (m.replay != null) runtime.setReplay(m.replay);
        break;
      case 'renderOpts': if (m.waveExag != null) runtime.waveExag = m.waveExag; break;
      case 'reset': runtime.reset(); break;
      case 'warm': runtime.warm(m.t); break;
      case 'ingest': runtime.ingest(m.fr, m.capFs); break;
      case 'ack': unacked = Math.max(0, unacked - (m.n | 0 || 1)); break;
      // Deterministic drive: the internal clock is switched off and every advance is explicit
      // (identical-output proof, headless harnesses).
      case 'auto': auto = !!m.on; unacked = 0; schedule(); break;
      case 'advance': runtime.advance(m.dt); post(); break;
      default: break;
    }
  } catch (e) { self.postMessage({ type: 'error', message: `${m && m.type}: ${(e && e.message) || e}` }); }
};

self.postMessage({ type: 'ready' });
schedule();
