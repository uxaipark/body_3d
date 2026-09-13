// ⑥ js/sources — signal SOURCES for the analysis core (ROADMAP §3-5 / §4.2 3계층 중 왼쪽 칸).
//
//   SignalSource      the interface (js/sources/base.js)
//   TwinSource        the simulator engine            — pass-through, byte-identical
//   ReplaySource      a `.dtrec` recording            — file clock
//   WebSocketSource   a live device / bridge stream   — DTSTM binary frames over ws://
//   DTSTM wire format js/sources/wire.js              — see docs/LIVE_STREAM.md
//
// All three deliver the SAME frame object the analysis core has always eaten, so switching source
// changes nothing downstream: `js/analysis/*`, `js/bpEstimator.js` and the Rust core are untouched.

export { SignalSource, SOURCE_STATUS } from './base.js';
export { TwinSource } from './twin.js';
export { ReplaySource } from './replay.js';
export { WebSocketSource } from './websocket.js';
export * from './wire.js';

import { WebSocketSource } from './websocket.js';

/**
 * `?source=` deep link. Accepted forms:
 *   ?source=ws://localhost:8787/stream   explicit URL
 *   ?source=ws                           → ws://localhost:8787/stream (the bridge's default)
 *   ?source=twin                         → the simulator (the default; returns null)
 * Anything else returns null and the app stays on the twin.
 */
export const DEFAULT_BRIDGE_URL = 'ws://localhost:8787/stream';

export function liveUrlFromParam(value) {
  if (!value) return null;
  const v = String(value).trim();
  if (v === 'twin' || v === 'sim') return null;
  if (v === 'ws' || v === 'live' || v === '1') return DEFAULT_BRIDGE_URL;
  if (/^wss?:\/\//i.test(v)) return v;
  if (/^[\w.-]+:\d+(\/.*)?$/.test(v)) return 'ws://' + v;
  return null;
}

export function createLiveSource(url, opts) { return new WebSocketSource(url, opts); }
