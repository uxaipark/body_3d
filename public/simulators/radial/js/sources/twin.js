// ⑥ TwinSource — the simulator as a SignalSource (ROADMAP §4.5-1).
//
// DELIBERATELY A PASS-THROUGH. The twin's frames are produced by the Worker-hosted EngineRuntime
// (js/engineWorker.js) and reach the UI thread inside the render packet; `EngineClient.pump(dt)`
// consumes the packets and `takeFrames()` drains the frames. This class does exactly those two calls
// in exactly that order and forwards the very same objects — no copy, no re-ordering, no re-timing —
// so wrapping the twin in the source abstraction cannot change one sample.
//   proof: server/dt_bridge_test.mjs `twin identity` — SHA-256 over the concatenated frame payloads of
//   a deterministic 6 s run, EngineClient直 vs through TwinSource, must be the SAME hash.
//
// The engine object itself stays reachable (`src.engine`) because main.js reads a lot of engine
// CONFIGURATION synchronously (geometry, cardiac set-points, posture…). Hiding that behind the source
// would mean rewriting the engine client, which this task explicitly does not do.

import { SignalSource } from './base.js';

export class TwinSource extends SignalSource {
  constructor(engineClient) {
    super({ kind: 'twin', label: '트윈 시뮬레이터' });
    this.engine = engineClient;
    this._pending = [];
  }

  configure(_cfg) { /* the twin is configured through the engine client itself (main.js) */ }

  async start() { this.engine.start(); this._setStatus('connected'); }
  stop() { this._setStatus('closed'); }

  // One display frame. Same two calls, same order as the pre-source main.js loop.
  pump(dtSeconds) {
    this.engine.pump(dtSeconds);
    const frames = this.engine.takeFrames();
    for (const fr of frames) { this._pending.push(fr); this._emitFrame(fr, null); }
    return frames.length;
  }

  take() { const f = this._pending; this._pending = []; return f; }

  describe() {
    return { ...super.describe(), live: true, hasTruth: true, label: this.label, engineMode: this.engine.mode,
      notes: '시뮬레이터가 생성한 프레임 — 기준 맥파(ref)·오라클 결합이 함께 들어오므로 진 SNR/오차 계산이 가능하다.' };
  }
}
