// ⑥ ReplaySource — a `.dtrec` recording as a SignalSource (ROADMAP §4.5-1/§4.5-5).
//
// Thin adapter over js/recording.js `Replayer`: it owns the playback clock and hands out the SAME
// frame objects the file decoded to (the Replayer loops over them, so they are re-read every pass and
// must never be transferred). `hold` is the ZOH factor from the recording's master clock to the
// engine's 16 kHz grid — the identical rule js/main.js already applied for measured recordings
// (docs/MEASURED_REPLAY.md §3); the expansion itself stays in main.js so replay behaviour is unchanged.
//
// `hasTruth` is false exactly when the recording says `source: 'measured'` — a real patch recording
// has no cuff reading and no reference pulse, so every truth-dependent field must read "진값 없음".

import { SignalSource } from './base.js';
import { Replayer } from '../recording.js';

const MASTER_FS = 16000;

export class ReplaySource extends SignalSource {
  constructor(recording, { name = 'recording', loop = true, masterFs = MASTER_FS } = {}) {
    super({ kind: 'replay', label: name });
    this.rec = recording;
    this.header = recording.header;
    this.replayer = new Replayer(recording);
    this.replayer.loop = loop;
    this.measured = recording.header.source === 'measured';
    this.hold = Math.max(1, Math.round(masterFs / (recording.header.masterFs || masterFs)));
    this.speed = 1;
    this._pending = [];
  }

  get duration() { return this.replayer.duration; }
  get position() { return this.replayer.position; }

  async start() { this._setStatus('connected'); }
  stop() { this._setStatus('closed'); }

  pump(dtSeconds) {
    const frames = this.replayer.next(dtSeconds * this.speed);
    for (const fr of frames) { this._pending.push(fr); this._emitFrame(fr, null); }
    return frames.length;
  }

  take() { const f = this._pending; this._pending = []; return f; }

  describe() {
    const h = this.header || {};
    return { ...super.describe(), live: false, hasTruth: !this.measured, measured: this.measured,
      capFs: h.capFs, nCh: h.nCh, hold: this.hold, duration: this.duration, position: this.position,
      notes: this.measured ? '실측 패치 기록 — 기준 BP·기준 맥파 없음(정성 평가 전용)' : '트윈이 만든 기록 — 시나리오 설정값이 진값이다.' };
  }
}
