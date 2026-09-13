// EngineClient / EngineRuntime — the UI's only handle on the signal-generation engine.
// (ROADMAP §2.3-15: 48채널 16 kHz 생성을 Web Worker 로 분리)
//
// The twin generates every stream on a 16 kHz master clock (js/engine.js). Doing that on the UI
// thread means the browser cannot paint while a frame's samples are being produced. This module
// moves the generation into `js/engineWorker.js` and leaves the UI thread with nothing but
// render-ready, DECIMATED buffers.
//
//   EngineRuntime   the transport-independent half: owns a TwinEngine, advances it on a FIXED
//                   step, and packs one render packet (decimated scope windows + decimated
//                   capacitive channels + `latest` + the 16 kHz analysis frame). The worker and
//                   the in-thread fallback run the SAME code, so both paths are bit-identical.
//   EngineClient    the UI-side handle. Runs the runtime in a Worker (default) or in-thread
//                   (`?inline=1`, no Worker support, or a worker boot failure — same hook the
//                   analysis core already uses). Either way the API is identical.
//
// MIRROR MODEL. main.js reads a lot of engine CONFIGURATION synchronously (capArray geometry,
// cardiac set-points, PPG optics, posture, body…). In worker mode the client therefore keeps a
// local TwinEngine as a CONFIGURATION MIRROR: it never generates a sample, but every mutating
// command is applied to it AND forwarded to the worker, so `client.capArray`, `client.cardiac`
// … stay valid, synchronous reads. Quantities the mirror cannot know because they are derived
// inside `step()` (pwvGain, reflection gain/timing, the derived SBP/DBP of the 'hemo' drive,
// the capacitive model's transmural/distensibility state) travel back in every render packet's
// `sync` block and are written onto the mirror. In inline mode the "mirror" IS the engine.
//
// MESSAGE CONTRACT (mirrors js/analysis/worker.js in style)
//   → worker : {type:'call', path, args}        method call on the engine object graph
//              {type:'set', path, value}        property write on the engine object graph
//              {type:'run', speed, paused, replay}   free-running clock mode + playback speed
//              {type:'advance', dt}             deterministic single advance (manual mode)
//              {type:'renderOpts', waveExag}    display-only options the packet is built with
//              {type:'reset'}                   resetBuffers() + restart the analysis frame cursor
//              {type:'warm', t}                 pre-run the simulation to sim time t (?warm=)
//              {type:'ingest', fr, capFs}       replay: write a recorded frame into the buffers
//              {type:'ack', seq}                UI thread consumed packet `seq` (flow control)
//   ← client : {type:'ready'} · {type:'render', …packet} · {type:'error', message}
//
// FIXED STEP. The engine is advanced in quanta of FIXED_STEP_S seconds of WALL clock; each
// quantum advances SIM time by FIXED_STEP_S × speed, i.e. exactly what one 62.5 Hz display frame
// used to advance at that playback speed. 256 = FIXED_STEP_S × 16 kHz is an integer, so no
// sample-count rounding drift accumulates. Determinism: the produced stream depends only on the
// NUMBER of quanta and the command order — never on how the wall clock chopped them up.

import { TwinEngine, SAMPLE_RATE } from './engine.js';
import { MUSCLES } from './emg.js';

export const FIXED_STEP_S = 256 / SAMPLE_RATE; // 0.016 s = 256 master samples per step
const MAX_STEPS_PER_ADVANCE = 6;               // burst cap on tab wake (≈0.096 s, matches engine.step's 0.1 s clamp)

// Render windows posted to the UI thread: name → [seconds, decimation]. Each yields ~1500 points,
// which is already more than any scope canvas can show (Scope.draw strides down to ~1 px/sample).
// The UI thread therefore never sees a 16 kHz array for charting.
export const RENDER_WINDOWS = {
  aorticP: [3, 32], brachialP: [3, 32], radialP: [3, 32], fingerP: [3, 32],
  radialV: [3, 32], venousV: [3, 32],
  ppgRed: [3, 32], ppgIr: [3, 32], spo2: [4, 48],
  accX: [3, 32], accY: [3, 32], accZ: [3, 32],
  gyrX: [3, 32], gyrY: [3, 32], gyrZ: [3, 32],
};
for (const m of Object.keys(MUSCLES)) RENDER_WINDOWS[m] = [1.5, 16];
export const CHAN_WINDOW = [3, 32]; // per-electrode capacitive strips + the MRC-combined trace

// Path resolution on the engine object graph ("capArray.artifacts.hum"). Rejects prototype keys:
// the path arrives over postMessage, so it is treated as untrusted input.
const BAD_KEY = /^(__proto__|prototype|constructor)$/;
function resolvePath(root, path) {
  const parts = String(path).split('.');
  let obj = root;
  for (let i = 0; i < parts.length - 1; i++) {
    if (BAD_KEY.test(parts[i])) throw new Error(`bad path ${path}`);
    obj = obj[parts[i]];
    if (obj == null || (typeof obj !== 'object' && typeof obj !== 'function')) throw new Error(`bad path ${path}`);
  }
  const key = parts[parts.length - 1];
  if (BAD_KEY.test(key)) throw new Error(`bad path ${path}`);
  return { obj, key };
}

// ---------------------------------------------------------------------------------------------
// EngineRuntime — engine + fixed-step clock + render packing. No DOM, no postMessage.
// ---------------------------------------------------------------------------------------------
export class EngineRuntime {
  constructor() {
    this.engine = new TwinEngine();
    this.acc = 0;             // unspent wall-clock time (s)
    this.speed = 1;           // playback speed (sim seconds per wall second)
    this.paused = false;
    this.replay = false;      // replay mode: frames are ingested, the engine is not stepped
    this.waveExag = 100;      // display-only propagation exaggeration (see main.js displayGrid)
    this.lastSentTotal = 0;   // analysis-frame cursor (engine.totalSamples at the last packet)
    this.stepMs = 0;          // time spent inside engine.step() since the last packet
    this.steps = 0;           // fixed steps taken since the last packet
  }

  // Advance the engine by `dtReal` seconds of WALL clock. Returns the number of fixed steps taken.
  advance(dtReal) {
    if (this.paused || this.replay) { this.acc = 0; return 0; }
    const dt = Math.max(0, Math.min(1, dtReal || 0));
    this.acc += dt;
    let n = Math.floor(this.acc / FIXED_STEP_S);
    if (n <= 0) return 0;
    if (n > MAX_STEPS_PER_ADVANCE) { n = MAX_STEPS_PER_ADVANCE; this.acc = 0; } else this.acc -= n * FIXED_STEP_S;
    const simStep = FIXED_STEP_S * this.speed;
    const t0 = now();
    for (let i = 0; i < n; i++) this.engine.step(simStep);
    this.stepMs += now() - t0;
    this.steps += n;
    return n;
  }

  warm(target) { const e = this.engine; let guard = 0; while (e.t < target && guard++ < 20000) e.step(0.1); }

  // Replay mode: the engine stops generating and the recording drives its buffers. If the engine has
  // never run (a `?replay=` deep link starts the recording before the first frame), take ONE step
  // first so `engine.latest` carries the posture/angles/torso block the UI needs to render at all —
  // then drop those samples, so a recording never has 16 ms of live signal glued to its head.
  setReplay(on) {
    if (on && !this.replay && this.engine.totalSamples === 0) {
      this.engine.step(FIXED_STEP_S);
      this.engine.resetBuffers();
      this.lastSentTotal = 0;
    }
    this.replay = !!on; this.acc = 0;
  }

  reset() { this.engine.resetBuffers(); this.lastSentTotal = 0; }

  ingest(fr, capFs) { this.engine.ingestFrame(fr, capFs); }

  call(path, args) { const { obj, key } = resolvePath(this.engine, path); return obj[key](...(args || [])); }
  set(path, value) { const { obj, key } = resolvePath(this.engine, path); obj[key] = value; }

  // Per-electrode display value for the exaggerated C(x,t) snapshot: channel k sampled
  // `delay(k)` samples in the past, where delay follows the array's own row-to-row transit time
  // multiplied by the display exaggeration. Identical maths to the pre-worker main.js.
  _capDisplay(nCh) {
    const ca = this.engine.capArray, out = new Float32Array(nCh);
    if (!(this.waveExag > 1)) return out; // exag ≤ 1 → main.js uses latest.capLast instead
    const pwv = ca._localPWV();
    if (ca.layout) {
      const es = ca.layout.electrodes;
      let yMin = Infinity; for (const e of es) if (e.y < yMin) yMin = e.y;
      for (let k = 0; k < nCh && k < es.length; k++) out[k] = this.engine.sampleAgo(k, Math.round(((es[k].y - yMin) / 1000) / pwv * this.waveExag * SAMPLE_RATE));
    } else {
      const rowDelay = (ca.spacingMm / 1000) / pwv;
      for (let r = 0; r < ca.rows; r++) {
        const d = Math.round(r * rowDelay * this.waveExag * SAMPLE_RATE);
        for (let c = 0; c < ca.cols; c++) { const k = r * ca.cols + c; if (k < nCh) out[k] = this.engine.sampleAgo(k, d); }
      }
    }
    return out;
  }

  // Everything the UI thread needs for one painted frame. `transfer` lists the buffers that are
  // moved (not copied) to the UI thread; the runtime never re-reads them afterwards.
  // One decimated render window, by the name main.js asks for.
  window_(name) { const spec = RENDER_WINDOWS[name]; return spec ? this.engine.getWindowDecimated(name, spec[0], spec[1]) : EMPTY; }
  chanWindows() { return this.engine.getChannelWindows(CHAN_WINDOW[0], CHAN_WINDOW[1]); }
  capDisplay() { return this._capDisplay(Math.min(this.engine.MAX_CH, this.engine.capArray.channelCount())); }

  // `lazy` (in-thread fallback only): leave the render buffers out of the packet — the client can
  // pull them straight off this runtime, and only the ones the frame actually draws. Over a message
  // boundary that is not an option, so the worker path always packs them (and transfers them).
  renderPacket(seq, { lazy = false } = {}) {
    const e = this.engine, ca = e.capArray, c = e.cardiac, transfer = [];
    let win = null, chans = null, capDisplay = null;
    if (!lazy) {
      win = {};
      for (const [name, [sec, dec]] of Object.entries(RENDER_WINDOWS)) {
        const a = e.getWindowDecimated(name, sec, dec);
        win[name] = a; if (a.buffer.byteLength) transfer.push(a.buffer);
      }
      chans = this.chanWindows();
      for (const a of chans) if (a.buffer.byteLength) transfer.push(a.buffer);
      capDisplay = this.capDisplay();
      transfer.push(capDisplay.buffer);
    }
    const BL = SAMPLE_RATE * 4;
    const lastRadialP = e.totalSamples > 0 ? e.buf.radialP[(e.writeIdx - 1 + BL) % BL] : c.dbp;

    let frame = null;
    if (e.totalSamples < this.lastSentTotal) this.lastSentTotal = 0;
    const startTotal = this.lastSentTotal;
    frame = e.frameSince(this.lastSentTotal);
    if (frame) {
      frame.startTotal = startTotal; // global sample index of the frame's first sample (raw export grid)
      this.lastSentTotal = e.totalSamples;
      transfer.push(frame.cap.buffer);
      for (const k of ['red', 'ir', 'ref']) if (frame[k]) transfer.push(frame[k].buffer);
      if (frame.imu && frame.imu.length) transfer.push(frame.imu.buffer);
    }

    const packet = {
      type: 'render', seq,
      t: e.t, totalSamples: e.totalSamples, startTotal,
      latest: e.latest, win, chans, capDisplay, lastRadialP, frame,
      stepMs: this.stepMs, steps: this.steps,
      // Derived per-step state the configuration mirror cannot recompute on its own.
      sync: {
        pwvGain: e.pwvGain, pwvGainWrist: e.pwvGainWrist, hydroWrist_mmHg: e.hydroWrist_mmHg,
        cardiac: { sbp: c.sbp, dbp: c.dbp, drive: c.drive, reflectionGain: c.reflectionGain, reflectionTiming: c.reflectionTiming,
          sv_mL: c.sv_mL, tpr: c.tpr, compliance_mL_mmHg: c.compliance_mL_mmHg, map_mmHg: c.map_mmHg,
          arteryToneScalar: c.arteryToneScalar, ageStiffness: c.ageStiffness },
        capArray: { pwvGain: ca.pwvGain, arteryToneScalar: ca.arteryToneScalar, ageStiffness: ca.ageStiffness,
          transmuralOffset_mmHg: ca.transmuralOffset_mmHg, distensibilityScale: ca.distensibilityScale, breathRate_Hz: ca.breathRate_Hz },
        ppg: { pwvGain: e.ppg.pwvGain, arteryToneScalar: e.ppg.arteryToneScalar, ageStiffness: e.ppg.ageStiffness, lastPerfusionIndex: e.ppg.lastPerfusionIndex },
      },
    };
    this.stepMs = 0; this.steps = 0;
    return { packet, transfer };
  }
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ---------------------------------------------------------------------------------------------
// EngineClient — UI-side handle. Worker by default, in-thread fallback on `?inline=1`.
// ---------------------------------------------------------------------------------------------
export class EngineClient {
  constructor({ useWorker = true } = {}) {
    this.mode = 'inline';
    this.worker = null;
    this.runtime = null;        // inline mode only
    this.mirror = new TwinEngine(); // worker mode: configuration mirror (never generates a sample)
    this.latest = {};
    this.win_ = null; this.chans_ = null; this.capDisplay_ = null; this._lazyWin = {};
    this.lastRadialP = 0;
    this.t = 0; this.totalSamples = 0;
    this.frames = [];           // analysis frames not yet drained by the UI
    this.seq = -1;              // newest packet consumed
    this.pending = [];          // packets received but not yet consumed by pump()
    this.unacked = 0;
    this.stepMs = 0; this.steps = 0; this.packets = 0;
    this._advanceWaiters = [];
    this._speed = 1; this._paused = false; this._replay = false; this._waveExag = 100;
    this._started = false;

    if (useWorker && typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('./engineWorker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = (ev) => this._onMessage(ev.data);
        this.worker.onerror = (e) => { console.warn('[engine worker] failed, falling back inline:', e && e.message); this._fallback(); };
        this.mode = 'worker';
      } catch (e) { console.warn('[engine worker] unavailable, running in-thread:', e && e.message); this._fallback(); }
    } else this._fallback();
  }

  // In-thread path. The MIRROR BECOMES THE ENGINE, so a late worker failure (the worker booted,
  // took some configuration commands, then died) keeps every setting that was already applied —
  // the mirror has seen exactly the same command sequence.
  _fallback() {
    if (this.worker) { try { this.worker.terminate(); } catch (_) {} this.worker = null; }
    this.mode = 'inline';
    if (!this.runtime) this.runtime = new EngineRuntime();
    this.runtime.engine = this.mirror;
    this.runtime.speed = this._speed; this.runtime.paused = this._paused;
    this.runtime.setReplay(this._replay); this.runtime.waveExag = this._waveExag;
    this.runtime.lastSentTotal = 0;
  }

  // ---- reads the UI does synchronously (served by the mirror / the newest packet) ----
  get engine() { return this.mirror; }
  get cardiac() { return this.mirror.cardiac; }
  get capArray() { return this.mirror.capArray; }
  get ppg() { return this.mirror.ppg; }
  get posture() { return this.mirror.posture; }
  get emg() { return this.mirror.emg; }
  get imu() { return this.mirror.imu; }
  get body() { return this.mirror.body; }
  get wristIdx() { return this.mirror.wristIdx; }
  get fingerIdx() { return this.mirror.fingerIdx; }
  get arteryToneScalar() { return this.mirror.arteryToneScalar; }
  get ageStiffness() { return this.mirror.ageStiffness; }
  get pwvGain() { return this.mirror.pwvGain; }
  describeAnatomy() { return this.mirror.describeAnatomy(); }
  // Render buffers. Worker mode: they arrived in the packet. In-thread mode: they are built HERE,
  // on demand and cached for this frame, so the fallback keeps the pre-worker behaviour of only
  // computing the windows the current frame actually draws.
  win(name) {
    if (this.win_) return this.win_[name] || EMPTY;
    if (!this.runtime) return EMPTY;
    return this._lazyWin[name] || (this._lazyWin[name] = this.runtime.window_(name));
  }
  get chans() { return this.chans_ || (this.runtime ? (this.chans_ = this.runtime.chanWindows()) : []); }
  get capDisplay() { return this.capDisplay_ || (this.runtime ? (this.capDisplay_ = this.runtime.capDisplay()) : EMPTY); }

  // ---- mutating commands: applied to the mirror AND forwarded to the worker ----
  call(path, ...args) {
    let out;
    try { out = (() => { const { obj, key } = resolvePath(this.mirror, path); return obj[key](...args); })(); }
    catch (e) { console.warn('[engine] call failed on mirror:', path, e && e.message); }
    if (this.worker) this.worker.postMessage({ type: 'call', path, args });
    return out;
  }
  set(path, value) {
    try { const { obj, key } = resolvePath(this.mirror, path); obj[key] = value; }
    catch (e) { console.warn('[engine] set failed on mirror:', path, e && e.message); }
    if (this.worker) this.worker.postMessage({ type: 'set', path, value });
  }
  setBody(height_cm, weight_kg) { return this.call('setBody', height_cm, weight_kg); }

  reset() {
    this.frames.length = 0;
    if (this.worker) this.worker.postMessage({ type: 'reset' }); else this.runtime.reset();
    // The mirror keeps no samples, but resetting it keeps `totalSamples`-style reads honest.
    if (this.mode === 'worker') this.mirror.resetBuffers();
    this.totalSamples = 0;
  }
  warm(seconds) { if (this.worker) this.worker.postMessage({ type: 'warm', t: seconds }); else this.runtime.warm(seconds); }

  // Replay: a recorded frame is written into the engine's ring buffers as if it had just been
  // simulated. The typed arrays are NOT transferred — the Replayer loops over the same frames.
  ingestFrame(fr, capFs = null) {
    if (this.worker) this.worker.postMessage({ type: 'ingest', fr, capFs });
    else this.runtime.ingest(fr, capFs);
  }

  setRun({ speed, paused, replay } = {}) {
    if (speed != null) this._speed = speed;
    if (paused != null) this._paused = !!paused;
    if (replay != null) this._replay = !!replay;
    const m = { type: 'run', speed: this._speed, paused: this._paused, replay: this._replay };
    if (this.worker) this.worker.postMessage(m);
    else { this.runtime.speed = this._speed; this.runtime.paused = this._paused; this.runtime.setReplay(this._replay); }
  }
  setWaveExag(v) {
    this._waveExag = v;
    if (this.worker) this.worker.postMessage({ type: 'renderOpts', waveExag: v });
    else this.runtime.waveExag = v;
  }
  // Start the free-running clock. The engine deliberately does NOT run before this is called, so
  // every configuration command issued during page setup is applied to a still-idle engine — which
  // is also what makes the worker and the in-thread path bit-identical from sample 0.
  start() {
    if (this._started) return;
    this._started = true;
    if (this.worker) this.worker.postMessage({ type: 'auto', on: true });
  }
  // Deterministic drive (identical-output proof / headless harnesses): `start()` is never called and
  // every advance is an explicit command. Resolves when the resulting packet has arrived.
  advance(dt) {
    if (this.worker) {
      this.worker.postMessage({ type: 'advance', dt });
      return new Promise((res) => this._advanceWaiters.push(res)).then(() => { this._drain(); });
    }
    this.runtime.advance(dt);
    this._consume(this.runtime.renderPacket(++this.seq, { lazy: true }).packet);
    return Promise.resolve();
  }

  // ---- per-animation-frame pump ----
  // worker mode: consume every packet that arrived since the last frame (the newest one supplies
  // the render buffers, every one of them supplies its analysis frame, so no sample is dropped).
  // inline mode: advance the engine and build the packet right here — same code, same output.
  pump(dtReal) {
    if (!this._started) return false;
    if (this.worker) return this._drain();
    this.runtime.advance(dtReal);
    this._consume(this.runtime.renderPacket(++this.seq, { lazy: true }).packet);
    return true;
  }

  // Consume every packet that arrived since the last call and ack them in one message.
  _drain() {
    if (!this.pending.length) return false;
    const list = this.pending; this.pending = [];
    for (const p of list) this._consume(p);
    if (this.unacked) { this.worker.postMessage({ type: 'ack', n: this.unacked }); this.unacked = 0; }
    return true;
  }

  takeFrames() { const f = this.frames; this.frames = []; return f; }

  _consume(p) {
    this.t = p.t; this.totalSamples = p.totalSamples; this.seq = p.seq;
    this.latest = p.latest || this.latest;
    if (p.win) { this.win_ = p.win; this.chans_ = p.chans; this.capDisplay_ = p.capDisplay; }
    else { this.win_ = null; this.chans_ = null; this.capDisplay_ = null; } // inline: pulled lazily below
    this._lazyWin = {};
    this.lastRadialP = p.lastRadialP;
    this.stepMs = p.stepMs; this.steps = p.steps; this.packets++;
    if (p.frame) this.frames.push(p.frame);
    if (this.mode === 'worker' && p.sync) this._applySync(p.sync);
  }

  // Write the per-step derived state back onto the configuration mirror so that the synchronous
  // reads main.js makes (cardiac.pressureAt, capArray._localPWV, contactState, hemodynamics…)
  // agree with the engine that actually produced the samples.
  _applySync(s) {
    const m = this.mirror;
    m.t = this.t; m.totalSamples = this.totalSamples;
    m.pwvGain = s.pwvGain; m.pwvGainWrist = s.pwvGainWrist; m.hydroWrist_mmHg = s.hydroWrist_mmHg;
    Object.assign(m.cardiac, s.cardiac);
    Object.assign(m.capArray, s.capArray);
    Object.assign(m.ppg, s.ppg);
  }

  _onMessage(m) {
    if (m.type === 'render') {
      this.pending.push(m); this.unacked++;
      if (this.pending.length > 8) this.pending.splice(0, this.pending.length - 8); // pathological stall: keep the newest
      const w = this._advanceWaiters; if (w.length) { this._advanceWaiters = []; for (const r of w) r(); }
    } else if (m.type === 'ready') { this.ready = true; }
    else if (m.type === 'error') console.warn('[engine worker]', m.message);
  }
}

const EMPTY = new Float32Array(0);
