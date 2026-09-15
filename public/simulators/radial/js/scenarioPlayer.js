
import {t as translateUI} from '../../../i18n/locale.js';
// Scenario presets + timeline scrubber (ROADMAP §2.3-13).
//
// A scenario is a TIMELINE OF KEYFRAMES over the twin's own setters — nothing new is
// simulated here. Every field is one of the knobs the UI already drives:
//   sbp, dbp, hr        → engine.cardiac.setBP / setHR          (심장 / 혈압 카드)
//   sv, tpr             → engine.cardiac.setHemodynamics        (윈드케셀 구동, §6.13)
//   tone, stiff         → engine.arteryToneScalar / ageStiffness
//   respRate, respDepth, pulsus → engine.cardiac.respiration / pulsusParadoxus_mmHg
//   contact             → engine.capArray.setContactPressure    (§6.15)
//   posture, arm        → engine.posture (자세 프리셋, 이산 값 = 계단 적용)
// Numeric fields are interpolated between the keyframes that define them (linear, or a
// smoothstep when the target keyframe says `ease: 'smooth'`); non-numeric fields step at
// their keyframe. Fields are interpolated INDEPENDENTLY, so a scenario may leave a knob
// untouched for its whole length and the user keeps control of it.
//
// ⚠ HONEST SCRUBBING. The twin is a real-time simulator with 4 s of ring-buffer history:
// there is no stored past to rewind into and no cheap way to re-generate minutes of 16 kHz
// signal on a scrub. So a jump **RE-SEEDS**: the scenario state at the target time is applied
// instantly, and the caller resets the sample history + analysis windows (`onReseed`). The
// estimator therefore has to re-accumulate its windows after every jump — that is shown in
// the bar ("스크럽 = 재시드") and is why the numbers blank for a few seconds after a scrub.
// Playing forward at ×1 (or any SIM_SPEED) is the only path that is continuous in the physics.

export const SCENARIOS = {
  orthostatic: {
    label: '기립성 저혈압 (누운 자세 → 기립)',
    note: '누운 자세 25 s 기준선 → 기립 → SBP 하강 + 반사성 빈맥 → 부분 회복. 압수용체 반사는 별도 모델이 아니라 대본화된 궤적(모델 가정).',
    keys: [
      { t: 0, posture: 'lying', arm: 'heart_level', sbp: 118, dbp: 76, hr: 62, tone: 1.0 },
      { t: 25, sbp: 118, dbp: 76, hr: 62, tone: 1.0 },
      { t: 26, posture: 'standing' },
      { t: 33, sbp: 92, dbp: 62, hr: 98, tone: 0.88, ease: 'smooth' },
      { t: 48, sbp: 104, dbp: 70, hr: 88, tone: 0.94, ease: 'smooth' },
      { t: 90, sbp: 114, dbp: 75, hr: 78, tone: 1.0, ease: 'smooth' },
    ],
  },
  'exercise-recovery': {
    label: '운동 후 회복 (HR·BP 지수 감쇠)',
    note: '운동 직후(HR 132 · 158/78 · 혈관확장 tone 0.82 · 호흡 26/분)에서 안정값으로 감쇠. 감쇠 시간상수는 대본 값(모델 가정)이며 자율신경 모델이 아님.',
    keys: [
      { t: 0, posture: 'standing', arm: 'heart_level', hr: 132, sbp: 158, dbp: 78, tone: 0.82, respRate: 26, respDepth: 1.4 },
      { t: 40, hr: 104, sbp: 140, dbp: 78, tone: 0.87, respRate: 21, respDepth: 1.2, ease: 'smooth' },
      { t: 100, hr: 84, sbp: 126, dbp: 77, tone: 0.94, respRate: 17, respDepth: 1.05, ease: 'smooth' },
      { t: 180, hr: 72, sbp: 118, dbp: 76, tone: 1.0, respRate: 15, respDepth: 1.0, ease: 'smooth' },
    ],
  },
  'nocturnal-dipping': {
    label: '야간 dipping (BP 10–20 % 완만 하강)',
    note: '누운 자세에서 126/82 → 104/66 (SBP −17 %) · HR 68 → 54 · 호흡 15 → 11/분. 실제 야간 dipping은 수 시간에 걸치며 여기서는 4분으로 압축한 대본(시간 압축 = 모델 가정).',
    keys: [
      { t: 0, posture: 'lying', arm: 'heart_level', sbp: 126, dbp: 82, hr: 68, respRate: 15, respDepth: 1.0, tone: 1.0 },
      { t: 30, sbp: 126, dbp: 82, hr: 68 },
      { t: 150, sbp: 112, dbp: 72, hr: 58, respRate: 12, respDepth: 1.15, tone: 0.95, ease: 'smooth' },
      { t: 240, sbp: 104, dbp: 66, hr: 54, respRate: 11, respDepth: 1.2, tone: 0.92, ease: 'smooth' },
    ],
  },
  'calibration-drift': {
    label: '커프 캘리브레이션 드리프트 데모',
    note: '중심 BP는 122/78로 고정한 채 혈관 긴장도 1.00 → 0.86 · 경직도 1.00 → 1.34만 서서히 이동 — 캘리브레이션 시점의 단서-압력 관계가 무너지면서 추정치가 진값에서 멀어지는 것을 보는 데모. 커프 재캘리브레이션 전까지 자동 보정 없음.',
    keys: [
      { t: 0, posture: 'sitting', arm: 'heart_level', sbp: 122, dbp: 78, hr: 74, tone: 1.0, stiff: 1.0 },
      { t: 30, tone: 1.0, stiff: 1.0 },
      { t: 200, tone: 0.86, stiff: 1.34, ease: 'smooth' },
      { t: 240, tone: 0.86, stiff: 1.34 },
    ],
  },
  'arm-position': {
    label: '자세 변화 (팔 심장높이 → 내림 → 거상)',
    note: '중심 BP 고정, 팔 위치만 계단 변화 — 손목 정수압 오프셋(±10 mmHg 급)과 국소 PWV·팽창성 변화가 추정치에 어떻게 들어오는지 보는 대본.',
    keys: [
      { t: 0, posture: 'standing', arm: 'heart_level', sbp: 120, dbp: 78, hr: 72 },
      { t: 25, arm: 'down' },
      { t: 60, arm: 'raised' },
      { t: 95, arm: 'table_height' },
      { t: 125, arm: 'heart_level' },
    ],
  },
  'contact-loss': {
    label: '접촉 저하 데모 (접촉압 0.5 → 0.35)',
    note: '§6.15/§6.5 홀드아웃 케이스: 측방 이동 없이 접촉압만 0.5 → 0.35로 떨어뜨린다. 재배치 감지기는 이 변화를 (경고 수준 이상으로) 잡지 못하고 어레이 BP는 경보 없이 이동한다 — 알려진 미해결 한계를 재현하는 데모.',
    keys: [
      { t: 0, posture: 'sitting', arm: 'heart_level', sbp: 118, dbp: 76, hr: 72, contact: 0.5 },
      { t: 30, contact: 0.5 },
      { t: 50, contact: 0.35, ease: 'smooth' },
      { t: 120, contact: 0.35 },
    ],
  },
};

export const SCENARIO_FIELDS = ['sbp', 'dbp', 'hr', 'sv', 'tpr', 'tone', 'stiff', 'contact', 'respRate', 'respDepth', 'pulsus', 'posture', 'arm'];

function tracksOf(sc) {
  const tr = {};
  for (const f of SCENARIO_FIELDS) {
    const pts = [];
    for (const k of sc.keys) if (k[f] !== undefined) pts.push({ t: k.t, v: k[f], ease: k.ease || 'linear' });
    if (pts.length) tr[f] = pts;
  }
  return tr;
}
function trackAt(pts, t) {
  if (t <= pts[0].t) return pts[0].v;
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i].t) {
      const a = pts[i - 1], b = pts[i];
      if (typeof a.v !== 'number' || typeof b.v !== 'number') return a.v; // discrete → step at the keyframe
      const span = b.t - a.t;
      if (span <= 0) return b.v;
      let u = (t - a.t) / span;
      if (b.ease === 'smooth') u = u * u * (3 - 2 * u);
      return a.v + (b.v - a.v) * u;
    }
  }
  return pts[pts.length - 1].v;
}

export function scenarioDuration(sc) { return sc.duration != null ? sc.duration : sc.keys[sc.keys.length - 1].t; }

/**
 * Timeline player. `update(dtSim)` is called from the main loop with the SAME dt the engine
 * gets (real dt × SIM_SPEED), so slow-motion playback slows the scenario identically.
 */
export class ScenarioPlayer {
  constructor({ apply, onReseed, onChange } = {}) {
    this.applyFn = apply || (() => {});
    this.onReseed = onReseed || (() => {});
    this.onChange = onChange || (() => {});
    this.name = null; this.sc = null; this.tracks = null;
    this.t = 0; this.duration = 0; this.playing = false; this.loop = false;
    this.lastReseed = null;
  }
  get active() { return !!this.sc; }
  load(name, { autoplay = true } = {}) {
    const sc = SCENARIOS[name];
    if (!sc) return false;
    this.name = name; this.sc = sc; this.tracks = tracksOf(sc);
    this.duration = scenarioDuration(sc);
    this.t = 0; this.playing = autoplay;
    this._applyAt(0, true);
    this.onChange();
    return true;
  }
  stop() { this.name = null; this.sc = null; this.tracks = null; this.playing = false; this.t = 0; this.onChange(); }
  play() { if (this.sc) { this.playing = true; this.onChange(); } }
  pause() { this.playing = false; this.onChange(); }
  toggle() { if (this.sc) { this.playing = !this.playing; this.onChange(); } }
  /** Jump to `t` seconds. This RE-SEEDS the twin (see the header note). */
  seek(t) {
    if (!this.sc) return;
    this.t = Math.max(0, Math.min(this.duration, t));
    this._applyAt(this.t, true);
    this.lastReseed = { t: this.t, at: Date.now() };
    this.onReseed(this.t);
    this.onChange();
  }
  update(dtSim) {
    if (!this.sc || !this.playing) return;
    this.t += Math.max(0, dtSim || 0);
    if (this.t >= this.duration) {
      if (this.loop) this.t = this.t % this.duration;
      else { this.t = this.duration; this.playing = false; this.onChange(); }
    }
    this._applyAt(this.t, false);
  }
  /** Values of every field the scenario drives, at time `t`. */
  valuesAt(t) {
    const out = {};
    if (!this.tracks) return out;
    for (const [f, pts] of Object.entries(this.tracks)) out[f] = trackAt(pts, t);
    return out;
  }
  _applyAt(t, jump) { this.applyFn(this.valuesAt(t), { jump, t, name: this.name }); }
  /** Distinct keyframe times (for the scrubber ticks). */
  keyTimes() { return this.sc ? [...new Set(this.sc.keys.map((k) => k.t))].sort((a, b) => a - b) : []; }
}

// ---------------------------------------------------------------------------
// Timeline scrubber UI — a full-width bar directly under the menubar.
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = translateUI(text); return e; };
const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

export function buildScenarioBar({ player, speeds, getSpeed, setSpeed, enhance }) {
  const bar = el('div', 'scen-bar hidden'); bar.id = 'scenarioBar';

  const selWrap = el('span', 'scen-sel');
  const sel = document.createElement('select'); sel.id = 'scenarioSel'; sel.title = translateUI('시나리오 프리셋 — 트윈의 기존 노브를 시간축으로 구동하는 키프레임 대본');
  const o0 = document.createElement('option'); o0.value = ''; o0.textContent = translateUI('시나리오 없음 (수동 조작)'); sel.appendChild(o0);
  for (const [k, v] of Object.entries(SCENARIOS)) { const o = document.createElement('option'); o.value = k; o.textContent = translateUI(v.label); sel.appendChild(o); }
  selWrap.appendChild(sel);

  const play = el('button', 'btn play', '▶ 재생'); play.type = 'button';
  const time = el('span', 'scen-time', '0:00.0 / 0:00.0');
  const track = el('div', 'scen-track'); track.setAttribute('role', 'slider'); track.tabIndex = 0;
  track.title = translateUI('타임라인 스크러버 — 클릭/드래그로 시각 이동. 점프는 재시드입니다(아래 칩 설명 참고).');
  const rail = el('div', 'rail'), fill = el('div', 'fill'), head = el('div', 'head');
  track.append(rail, fill, head);
  const ticks = [];

  const spdWrap = el('span', 'scen-sel'); spdWrap.style.minWidth = '108px'; spdWrap.style.maxWidth = '132px';
  const spd = document.createElement('select'); spd.id = 'scenarioSpeed'; spd.title = translateUI('재생 속도 — 어레이 카드의 재생 속도와 같은 SIM_SPEED 집합(시뮬레이션 시간 자체가 느려짐)');
  for (const [k, v] of Object.entries(speeds)) { const o = document.createElement('option'); o.value = k; o.textContent = translateUI(`속도 ×${v}`); spd.appendChild(o); }
  spdWrap.appendChild(spd);

  const chip = el('span', 'scen-chip warn', '스크럽 = 재시드');
  chip.title = translateUI('이 트윈은 실시간 시뮬레이터이고 링버퍼에 4 s 이력만 남습니다 — 되감기도, 수 분치 16 kHz 신호를 즉석에서 다시 만드는 것도 하지 않습니다. 스크러버로 점프하면 그 시각의 시나리오 상태를 즉시 적용하고 신호 이력·분석 창을 리셋(재시드)합니다. 커프 캘리브레이션은 유지되지만 추정 창은 다시 쌓입니다.');
  const state = el('span', 'scen-state', '');
  const close = el('button', 'btn', '종료'); close.type = 'button'; close.title = translateUI('시나리오 종료 — 현재 값 그대로 두고 수동 조작으로 복귀');
  const note = el('span', 'scen-note', '');

  bar.append(selWrap, play, time, track, spdWrap, chip, close, state, note);

  // --- wiring
  sel.addEventListener('change', () => { if (sel.value) player.load(sel.value); else player.stop(); });
  play.addEventListener('click', () => player.toggle());
  close.addEventListener('click', () => { player.stop(); sel.value = ''; sel._dd?.refresh(); });
  spd.addEventListener('change', () => setSpeed(spd.value));
  const seekAt = (ev) => {
    const r = track.getBoundingClientRect();
    const u = Math.max(0, Math.min(1, (ev.clientX - r.left) / Math.max(1, r.width)));
    player.seek(u * player.duration);
  };
  let dragging = false;
  track.addEventListener('pointerdown', (ev) => { if (!player.active) return; dragging = true; track.setPointerCapture(ev.pointerId); seekAt(ev); ev.preventDefault(); });
  track.addEventListener('pointermove', (ev) => { if (dragging) seekAt(ev); });
  const endDrag = () => { dragging = false; };
  track.addEventListener('pointerup', endDrag); track.addEventListener('pointercancel', endDrag);
  track.addEventListener('keydown', (ev) => {
    if (!player.active) return;
    const step = ev.shiftKey ? 10 : 2;
    if (ev.key === 'ArrowRight') { player.seek(player.t + step); ev.preventDefault(); }
    else if (ev.key === 'ArrowLeft') { player.seek(player.t - step); ev.preventDefault(); }
    else if (ev.key === ' ') { player.toggle(); ev.preventDefault(); }
  });

  function rebuildTicks() {
    for (const t of ticks) t.remove(); ticks.length = 0;
    if (!player.active) return;
    for (const kt of player.keyTimes()) {
      const d = el('div', 'tick'); d.style.left = `${(kt / Math.max(1e-6, player.duration)) * 100}%`; d.title = translateUI(`키프레임 t = ${kt.toFixed(0)} s`);
      d._t = kt; track.appendChild(d); ticks.push(d);
    }
  }
  function refresh() {
    const on = player.active;
    bar.classList.toggle('hidden', !on && bar.dataset.forceShow !== '1');
    play.textContent = translateUI(player.playing ? '⏸ 일시정지' : '▶ 재생');
    play.disabled = !on; track.classList.toggle('disabled', !on);
    time.textContent = translateUI(`${fmt(player.t)} / ${fmt(player.duration)}`);
    const u = on && player.duration > 0 ? player.t / player.duration : 0;
    fill.style.width = `${u * 100}%`; head.style.left = `${u * 100}%`;
    for (const t of ticks) t.classList.toggle('on', player.t >= t._t - 0.01);
    note.textContent = translateUI(on ? player.sc.note : '시나리오를 선택하면 트윈의 기존 노브를 대본대로 구동합니다.');
    note.title = translateUI(note.textContent);
    if (sel.value !== (player.name || '')) { sel.value = player.name || ''; sel._dd?.refresh(); }
  }
  function setState(text) { state.textContent = translateUI(text); state.title = translateUI(text); }
  function tick() { // cheap per-frame update (progress only)
    if (!player.active) return;
    const u = player.duration > 0 ? player.t / player.duration : 0;
    fill.style.width = `${u * 100}%`; head.style.left = `${u * 100}%`;
    time.textContent = translateUI(`${fmt(player.t)} / ${fmt(player.duration)}`);
    for (const t of ticks) t.classList.toggle('on', player.t >= t._t - 0.01);
  }
  function show(on) { bar.dataset.forceShow = on ? '1' : '0'; bar.classList.toggle('hidden', !on && !player.active); }

  player.onChange = () => { rebuildTicks(); refresh(); };
  if (enhance) { enhance(sel); enhance(spd); }
  const cur = Object.entries(speeds).find(([, v]) => v === getSpeed());
  if (cur) { spd.value = cur[0]; spd._dd?.refresh(); }
  refresh();
  return { bar, refresh, tick, setState, show, sel, speedSel: spd };
}
