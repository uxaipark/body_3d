import {readQualityPreference,resolveQuality,qualitySettings} from '../bridge/soma-bridge.js';
import {getLanguage,localizeDOM} from '../../../i18n/locale.js';
document.documentElement.lang=getLanguage();
localizeDOM(document.body);
document.title=translateUI(document.title);

import {t as translateUI,html as localizeHTML} from '../../../i18n/locale.js';
import { SAMPLE_RATE } from './engine.js';
import { EngineClient, RENDER_WINDOWS, CHAN_WINDOW } from './engineClient.js';
// 렌더 창의 실제 샘플 간격(초) — 스캔바 x 매핑에 쓴다(배열 길이에서 유도하면 초기에 늘어난다).
const winDt = (name) => (RENDER_WINDOWS[name] ? RENDER_WINDOWS[name][1] / SAMPLE_RATE : null);
const CHAN_DT = CHAN_WINDOW[1] / SAMPLE_RATE;
import { RHYTHMS } from './cardiac.js';
import { ARM_POSITIONS, BODY_POSTURES } from './kinematics.js';
import { MUSCLES } from './emg.js';
import { cumulativeDelay_s, findSegmentIndex } from './anatomy.js';
import { Scope, MultiChannelScope, TimingGrid } from './charts.js';
import { ArrayViz } from './arrayViz.js';
import * as simPresets from './simPresets.js';
import { Avatar } from './avatar.js';
import { WristView } from './wristView.js';
import { AnalysisClient } from './analysis/client.js';
import { WRIST_ANATOMY, defaultSheetAlong_mm } from './capacitiveArray.js';
import { deriveWristCrossSection, BODY_PRESETS, WRIST_ASPECT, WRIST_WIDTH_REF_MM } from './anthropometry.js';
import { enhanceAllSelects } from './dropdown.js';
import { initScrollbars } from './scrollbars.js';
import { initMenubar } from './menubar.js';
import { initPatchDesigner } from './patchDesigner.js';
import { loadLayouts, getLayout, PRESETS, layoutKey } from './electrodeLayout.js';
import { enhanceSelect } from './dropdown.js';
import { Recorder, Replayer, decodeRecording, recordingFilename, holdFrame } from './recording.js';
import { initTheme } from './theme.js';
import { SCENARIOS, ScenarioPlayer, buildScenarioBar } from './scenarioPlayer.js';
import { ExportBuffer, openExportDialog } from './exportData.js';
// ⑥ 신호 소스 추상화 (ROADMAP §3-5 / §4.2): 트윈 · .dtrec 재생 · 라이브 WebSocket 스트림이 같은
// 프레임 계약을 쓴다. TwinSource 는 순수 통과 어댑터라 트윈 경로는 비트 동일하다 (server/dt_bridge_test.mjs).
import { TwinSource } from './sources/twin.js';
import { WebSocketSource } from './sources/websocket.js';
import { liveUrlFromParam, DEFAULT_BRIDGE_URL } from './sources/index.js';
import { layoutIdOf } from './sources/wire.js';

const $ = (id) => document.getElementById(id);

// Theme (dark / light / system) — applied before anything is measured so no card is laid out twice.
// index.html sets data-theme inline to avoid a flash; this re-applies it and wires the OS listener.
initTheme();
const twinHeader=$('twinHeader'),twinHeaderToggle=$('twinHeaderToggle');
function setOverviewCollapsed(collapsed){
 twinHeader.classList.toggle('collapsed',collapsed);
 twinHeaderToggle.setAttribute('aria-expanded',String(!collapsed));
 twinHeaderToggle.textContent=translateUI(collapsed?'펼치기 ▾':'접기 ▴');
 try{localStorage.setItem('dt.overviewCollapsed',collapsed?'1':'0');}catch(_){}
}
try{setOverviewCollapsed(localStorage.getItem('dt.overviewCollapsed')==='1');}catch(_){}
twinHeaderToggle.addEventListener('click',()=>setOverviewCollapsed(!twinHeader.classList.contains('collapsed')));

// ---------- Signal-generation engine (Worker-hosted TwinEngine; falls back in-thread) ----------
// 48채널 16 kHz 생성은 js/engineWorker.js 에서 수행되고, UI 스레드에는 데시메이션된 렌더 버퍼와
// 분석용 프레임만 넘어온다 (ROADMAP §2.3-15). `?inline=1` → 예전처럼 UI 스레드에서 생성 (분석
// 코어와 동일한 훅). 두 경로는 같은 EngineRuntime 을 구동하므로 같은 명령·스텝 수에서 비트 동일하다.
const _qp = new URLSearchParams(location.search);
const engine = new EngineClient({ useWorker: !_qp.has('inline') });
// ⑥ 분석 코어로 들어가는 프레임의 유일한 출구. 트윈이든, 기록 재생이든, 라이브 스트림이든 화면은 엔진의
// 링버퍼에서 그려지므로(재생/라이브 프레임은 `ingestFrame` 으로 그 버퍼에 써 넣는다) 프레임 스트림도 항상
// 여기 한 곳에서 나온다 — 소스가 바뀌어도 분석 코어는 자기가 무엇을 먹는지 알지 못한다.
const twinSource = new TwinSource(engine);
// Pause only offscreen 3D work. The acquisition worker keeps its sample clock.
const viewVisible={avatar:true,wrist3d:true};
const viewObserver=new IntersectionObserver(entries=>{for(const e of entries)viewVisible[e.target.id]=e.isIntersecting;});
viewObserver.observe($('avatar'));viewObserver.observe($('wrist3d'));
let avatar = null;
try {
  avatar = new Avatar($('avatar'));
} catch (err) {
  console.warn('3D avatar disabled (WebGL unavailable):', err);
  $('avatar').innerHTML = localizeHTML('<div class="avatar-fallback">WebGL을 사용할 수 없어 3D 아바타를 표시할 수 없습니다.<br/>신호 시뮬레이션은 계속 동작합니다.</div>');
}
let wristView = null;
try {
  wristView = new WristView($('wrist3d'));
} catch (err) {
  console.warn('Wrist 3D view disabled:', err);
}

// 손목 3D 손 모델 선택 (0 현행 / A 해부 단면 / E 실사 GLB 손 — js/wrist3d/models.js).
// **화면 상태**이므로 시뮬레이션 프리셋에서는 제외하고(`data-no-preset`, js/simPresets.js 정책)
// localStorage 'dt.wrist3d' 에 따로 기억한다. `?wrist3d=0|A|E` 가 있으면 URL 이 이기고, 다른 URL
// 훅들과 같이 그 값을 localStorage 에도 되써 준다.
// E안은 CC BY-NC 4.0 자산(deep3dstudio)이라 켜져 있는 동안 푸터에 저작자 표시가 뜬다.
const HAND_MODELS = ['0', 'A', 'S', 'T'];
if (wristView && $('handModel')) {
  const sel = $('handModel'), creditRow = $('handCreditRow'), note = $('handNote');
  const urlMode = (_qp.get('wrist3d') || '').toUpperCase();
  let mode = HAND_MODELS.includes(urlMode) ? urlMode : (localStorage.getItem('dt.wrist3d') || '0');
  if (!HAND_MODELS.includes(mode)) mode = '0';
  const applyHandModel = async (want) => {
    sel.disabled = true;                       // E안 GLB 를 받는 동안 연타를 막는다
    if (sel._dd) sel._dd.refresh();
    // 실패하면 setHandModel 이 '0' 을 돌려주고 handModelError 에 사유를 담는다 (뷰가 비지 않는다).
    const active = await wristView.setHandModel(want);
    sel.disabled = false;
    sel.value = active;                        // 실패해 0안으로 되돌아갔으면 선택기도 따라간다
    if (sel._dd) sel._dd.refresh();            // js/dropdown.js 로 갈아 끼운 라벨/비활성 상태 동기화
    if (creditRow) creditRow.hidden = active !== 'E';
    if (note) note.textContent = translateUI(wristView.handModelError || '');
    try { localStorage.setItem('dt.wrist3d', active); } catch (_) { /* private mode */ }
  };
  sel.value = mode;
  sel.addEventListener('change', () => { applyHandModel(sel.value); });
  applyHandModel(mode);
}

// ---------- Analysis system (Worker-hosted AnalysisCore; falls back to in-thread) ----------
// Engine: Rust/WASM core (rust/dt-core) by default; ?core=js → JavaScript reference core; ?inline=1 → run in the UI thread; ?nodc=1 → disable ③ delay-compensated beamforming
// (`?inline=1` puts BOTH the analysis core and the signal-generation engine back on the UI thread.)
const analysis = new AnalysisClient({ useWorker: !_qp.has('inline'), cadenceMs: 120, core: _qp.get('core') === 'js' ? 'js' : 'wasm' });
const analysisCfg = () => ({ rows: engine.capArray.rows, cols: engine.capArray.cols, spacingMm: engine.capArray.spacingMm, sheetLateral_mm: engine.capArray.sheetLateral_mm, capFs: engine.capArray.sampleRate_Hz, delayComp: !_qp.has('nodc'),
  layout: engine.capArray.layout ? engine.capArray.layout.electrodes.map((e) => ({ lateral_mm: e.x, along_mm: e.y })) : null });
let lastEngine = null, lastAnalyzeMs = null;
let uiWeights = null; // EMA-smoothed beamformer weights used for the live combined trace
analysis.configure(analysisCfg());

// ---------- Populate selects ----------
function fillSelect(sel, obj) {
  sel.innerHTML = localizeHTML('');
  for (const [k, v] of Object.entries(obj)) {
    const o = document.createElement('option'); o.value = k; o.textContent = translateUI(v.label); sel.appendChild(o);
  }
}
fillSelect($('rhythm'), RHYTHMS);
fillSelect($('armPos'), ARM_POSITIONS);
fillSelect($('bodyPosture'), BODY_POSTURES);
$('rhythm').value = 'normal'; $('armPos').value = 'heart_level'; $('bodyPosture').value = 'standing';
const qualitySelect=$('renderQuality');
if(window.parent!==window)qualitySelect.parentElement.hidden=true;
window.addEventListener('message',event=>{if(event.source!==window.parent||event.origin!==location.origin||event.data?.type!=='soma-quality-change'||!['auto','low','balanced','high'].includes(event.data.choice))return;qualitySelect.value=event.data.choice;applyQuality(event.data.choice)});
const qualityNames=getLanguage()==='en'?{auto:'Auto',low:'Low-power',balanced:'Balanced',high:'High detail'}:{auto:'자동',low:'저사양',balanced:'균형',high:'고화질'};
for(const option of qualitySelect.options)option.textContent=qualityNames[option.value];
qualitySelect.parentElement.firstChild.textContent=getLanguage()==='en'?'Performance ':'성능 모드 ';
qualitySelect.setAttribute('aria-label',getLanguage()==='en'?'Rendering quality':'렌더링 품질');
function applyQuality(choice){
 avatar?.view.setQuality(choice);avatar?.view.externalBudget.reset();
 wristView?.setQuality(choice);
}
qualitySelect.value=readQualityPreference();applyQuality(qualitySelect.value);
qualitySelect.addEventListener('change',()=>{try{localStorage.setItem('soma.body.quality',qualitySelect.value)}catch{}applyQuality(qualitySelect.value)});
setInterval(()=>{
 const tier=avatar?.view.qualityTier;
 if(qualitySelect.value==='auto'&&(tier==='low'||wristView?.qualityTier==='low')){
  if(avatar&&tier!=='low'){avatar.view.qualityTier='low';avatar.view.renderer.setPixelRatio(Math.min(devicePixelRatio,qualitySettings.low.dpr));avatar.view.resize();avatar.view.updateLod()}
  if(wristView?.qualityTier!=='low')wristView?.setQuality('auto','low');
 }
 if(window.parent!==window)window.parent.postMessage({type:'soma-quality-status',tier:wristView?.qualityTier||tier||resolveQuality(qualitySelect.value)},location.origin);
 $('renderQualityStatus').textContent=qualityNames[wristView?.qualityTier||tier||resolveQuality(qualitySelect.value)];
},1000);
enhanceAllSelects(); // custom dropdowns (native <select> kept hidden as the data model)
const menubar = initMenubar({ actions: {
  // 시뮬레이션 설정 프리셋 (js/simPresets.js) — 저장 / 불러오기 / 삭제 / 기본값 초기화
  openPresets: (btn) => simPresets.openPresetDialog(btn),
  listPresets: () => simPresets.listPresets(),
  presetTitle: (n) => { const it = simPresets.presetInfo(n); return it ? `저장 ${new Date(it.at).toLocaleString()} · 항목 ${Object.keys(it.v).length}개` : ''; },
  savePreset: () => {
    const suggested = new Date().toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const name = window.prompt(translateUI('프리셋 이름을 입력하세요 (같은 이름이면 덮어씁니다)'), `설정 ${suggested}`);
    if (name == null) return;
    const r = simPresets.savePreset(name);
    menubar.setStatus(r.ok ? `프리셋 저장: ${r.name} (${r.count}개 항목)` : `저장 실패 — ${r.error}`);
  },
  loadPreset: (n) => { const r = simPresets.loadPreset(n); menubar.setStatus(r.ok ? `프리셋 적용: ${n} (${r.applied}개 변경)` : `불러오기 실패 — ${r.error}`); },
  deletePreset: () => {
    const names = simPresets.listPresets();
    const name = window.prompt(translateUI(`삭제할 프리셋 이름:\n\n${names.join('\n')}`), names[0] || '');
    if (name == null) return;
    const r = simPresets.deletePreset(name.trim());
    menubar.setStatus(r.ok ? `프리셋 삭제: ${name}` : `삭제 실패 — ${r.error}`);
  },
  resetSettings: () => {
    if (!window.confirm(translateUI('모든 시뮬레이션 설정을 문서 기본값으로 되돌립니다. 계속할까요?\n(카드 접힘·순서·테마와 커프 캘리브레이션 결과는 그대로입니다)'))) return;
    const n = simPresets.resetToDocumentDefaults();
    menubar.setStatus(`설정 초기화 — ${n}개 항목 복원`);
  },
  collapseAll: (on) => { for (const c of document.querySelectorAll('.card.collapsible, .card.wide2, .card.spo2, .panel.controls')) { c.classList.toggle('collapsed', on); const h = c.querySelector(':scope > h2, :scope > h3'); if (h) { const key = (c.classList.contains('panel') ? 'dt.panel.' : 'dt.card.') + h.textContent.trim().slice(0, c.classList.contains('panel') ? 200 : 40); try { localStorage.setItem(key, on ? '1' : '0'); } catch (_) {} } } },
  resetOrder: () => { try { localStorage.removeItem('dt.cardOrder'); } catch (_) {} location.reload(); },
  resetCollapse: () => { try { for (const k of Object.keys(localStorage)) if (k.startsWith('dt.card.') || k.startsWith('dt.panel.')) localStorage.removeItem(k); } catch (_) {} for (const c of document.querySelectorAll('.card.collapsed, .panel.collapsed')) c.classList.remove('collapsed'); },
  openCalibration: () => { const b = document.getElementById('calib'); if (b) b.click(); },
  togglePause: () => { const b = document.getElementById('pause'); if (b) b.click(); },
  openDesigner: () => patchDesigner.open(),
  closeDesigner: () => patchDesigner.close(),
  toggleRecording: () => toggleRecording(),
  openReplay: () => openReplayPicker(),
  stopReplay: () => stopReplay(),
  isRecording: () => recorder.active,
  isReplaying: () => !!replayer,
  // 시나리오 프리셋 / 타임라인 (§2.3-13) · 데이터 내보내기 (§2.3-14)
  loadScenario: (name) => loadScenario(name),
  stopScenario: () => { scenario.stop(); scenarioBar.show(true); },
  activeScenario: () => scenario.name,
  toggleScenarioBar: () => scenarioBar.show(scenarioBar.bar.classList.contains('hidden')),
  scenarioBarShown: () => !scenarioBar.bar.classList.contains('hidden'),
  openExport: () => openExport(),
  // ⑥ 라이브 센서 스트림 (ROADMAP §3-5) — URL ?source=ws://host:port/stream
  openLive: () => promptLive(),
  stopLive: () => stopLive('메뉴'),
  isLive: () => !!liveSource,
} });
const scrollbars = initScrollbars(); // custom thick scrollbars with per-card shortcut icons (left + right columns)
window.__scrollbars = scrollbars;

// ---------- Scopes ----------
const scopes = {
  pressure: new Scope($('c-pressure'), { traces: [
    { name: '대동맥', color: '#f87171' }, { name: '위팔', color: '#fb923c' }, { name: '요골(손목)', color: '#facc15' }, { name: '손가락', color: '#a3e635' },
  ], yMin: 40, yMax: 180, unit: 'mmHg', windowSec: 3 , sweep: true }),
  velocity: new Scope($('c-velocity'), { traces: [ { name: '요골동맥 유속', color: '#f472b6' }, { name: '정맥 환류', color: '#60a5fa' } ], yMin: 0, yMax: 80, unit: 'cm/s' , sweep: true }),
  ppg: new Scope($('c-ppg'), { traces: [ { name: 'Red', color: '#ef4444' }, { name: 'IR', color: '#a78bfa' } ], yMin: 0.97, yMax: 1.06, unit: 'a.u.', autoScale: true , sweep: true }),
  spo2: new Scope($('c-spo2'), { traces: [ { name: 'SpO₂ 시뮬레이터 진값', color: 'rgba(52,211,153,0.8)' }, { name: 'SpO₂ R-ratio 재계산 (동일 경험식 · 파형 추출 검증용, 정확도 검증 아님)', color: '#fbbf24' } ], yMin: 85, yMax: 100, unit: '%', windowSec: 4, sweep: [true, false] }),  // 진값만 스캔바, 재계산 추세는 기존 표시
  emg: new Scope($('c-emg'), { traces: [
    { name: '이두', color: '#f87171' }, { name: '삼각근', color: '#fbbf24' }, { name: '손목굽힘근', color: '#60a5fa' }, { name: '원엎침근', color: '#c084fc' },
  ], yMin: -0.9, yMax: 0.9, unit: 'mV', windowSec: 1.5  }), // zero-mean band-limited sEMG (20–450 Hz)
  acc: new Scope($('c-acc'), { traces: [ { name: 'X', color: '#f87171' }, { name: 'Y', color: '#4ade80' }, { name: 'Z', color: '#60a5fa' } ], yMin: -1.3, yMax: 1.3, unit: 'g' , sweep: true }),
  gyr: new Scope($('c-gyr'), { traces: [ { name: 'X', color: '#f87171' }, { name: 'Y', color: '#4ade80' }, { name: 'Z', color: '#60a5fa' } ], yMin: -40, yMax: 40, unit: 'dps' , sweep: true }),
};
const multiScope = new MultiChannelScope($('c-cap'));
const timingGrid = new TimingGrid($('c-timing'));
const arrayViz = new ArrayViz($('c-heat'), $('c-heat3d'));
for (const r of document.querySelectorAll('input[name="arrayViz"]')) {
  r.addEventListener('change', (e) => { if (e.target.checked) arrayViz.setMode(e.target.value); });
}
// Playback speed of the whole simulation (slow-motion viewing): 빠르게 = real time,
// 중간 = ×0.1, 느리게 = ×0.01. Everything (waveforms, beamforming, avatar, gait) follows sim time.
const SIM_SPEED = { x1: 1.0, x05: 0.5, x025: 0.25, x01: 0.1, x005: 0.05 };
let simSpeed = SIM_SPEED.x1;
// The engine now owns its own clock, so the playback speed is a COMMAND (one fixed step advances
// sim time by FIXED_STEP_S × speed — exactly what one display frame advanced before).
const setSimSpeed = (v) => { simSpeed = v; engine.setRun({ speed: v }); };
for (const r of document.querySelectorAll('input[name="vizSmooth"]')) {
  r.addEventListener('change', (e) => { if (e.target.checked) setSimSpeed(SIM_SPEED[e.target.value] ?? 1); });
}
// Propagation exaggeration (display only): the true row-to-row arrival delay is pitch/PWV ≈ 0.4–0.6 ms,
// invisible at any watchable playback speed (a beat would take minutes). Instead the snapshot shows
// row r delayed by N × its true delay, so the pulse front visibly rolls across the array while the
// beat itself plays at real time. The analysis (beamforming / PTT / BP) always uses the raw data.
let waveExag = 100; // default ×100 (URL ?exag= overrides)
// The delayed per-electrode sampling this drives happens inside the engine (Worker), so the value
// has to travel with it — `setWaveExag` is display-only and never touches the generated signal.
const setWaveExag = (v) => { waveExag = v; engine.setWaveExag(v); };
setWaveExag(waveExag);
for (const r of document.querySelectorAll('input[name="waveExag"]')) {
  r.addEventListener('change', (e) => { if (e.target.checked) setWaveExag(parseFloat(e.target.value) || 1); });
}
// Custom layouts: the snapshot is a dense field (1 mm cells over the sheet) interpolated from the
// electrode values (inverse-distance weighting); the pads are drawn on top at their true positions.
const CUSTOM_CELL_MM = 1.0;
let lastCustomVals = null; // per-electrode display values (pF) of the latest custom snapshot
function customViz() {
  const L = engine.capArray.layout; if (!L) return null;
  return { electrodes: L.electrodes, sheetW: L.sheetW, sheetH: L.sheetH, cellMm: CUSTOM_CELL_MM, id: L.id, values: lastCustomVals };
}
// Per-electrode display values. The exaggerated (waveExag > 1) row-delayed sampling is done in the
// engine (js/engineClient.js `_capDisplay`) and arrives ready-made as `engine.capDisplay`, so the UI
// thread never reaches into a 16 kHz ring buffer for it.
function displayValues(n) {
  const src = waveExag <= 1 ? engine.latest.capLast : engine.capDisplay;
  if (!src || !src.length) return null;
  const out = new Array(n);
  for (let k = 0; k < n; k++) out[k] = k < src.length ? src[k] : 5;
  return out;
}
function displayGridCustom() {
  const L = engine.capArray.layout;
  const cols = Math.max(2, Math.round(L.sheetW / CUSTOM_CELL_MM)), rows = Math.max(2, Math.round(L.sheetH / CUSTOM_CELL_MM));
  const vals = displayValues(L.electrodes.length);
  if (!vals) return null;
  lastCustomVals = vals;
  const g = new Array(rows);
  for (let r = 0; r < rows; r++) {
    g[r] = new Array(cols);
    const y = -L.sheetH / 2 + (r + 0.5) * CUSTOM_CELL_MM;
    for (let c = 0; c < cols; c++) {
      const x = -L.sheetW / 2 + (c + 0.5) * CUSTOM_CELL_MM;
      let num = 0, den = 0;
      for (let k = 0; k < L.electrodes.length; k++) { const e = L.electrodes[k]; const dx = Math.max(0, Math.abs(x - e.x) - e.w / 2), dy = Math.max(0, Math.abs(y - e.y) - e.h / 2); const d2 = dx * dx + dy * dy; const w = 1 / (d2 + 0.35); num += w * vals[k]; den += w; }
      g[r][c] = den ? num / den : 5;
    }
  }
  return g;
}
function displayGrid() {
  if (engine.capArray.layout) return displayGridCustom();
  const rows = engine.capArray.rows, cols = engine.capArray.cols;
  const vals = displayValues(rows * cols);
  if (!vals) return null;
  const g = new Array(rows);
  for (let r = 0; r < rows; r++) { g[r] = new Array(cols); for (let c = 0; c < cols; c++) g[r][c] = vals[r * cols + c]; }
  return g;
}
// Display scale for the snapshot (heatmap / contour / 3D surface): NOT per-frame min/max (which
// stretches diastolic noise to full height and makes the surface jump) but a peak-hold range that
// tracks the recent beats — rises instantly, decays slowly (~3 s) — so heights/colours ∝ true ΔC.
const vizScale = { lo: null, hi: null };
// Fixed absolute range (pF): baseline 5.0 pF, arterial swing up to ~2 pF at best coupling → 4.7–7.2 pF.
const FIXED_SCALE = { vMin: 4.9, vMax: 5.75 }; // default gain 0.9 pF/42 mmHg → all-channel range ≈ 4.95–5.85 pF; peaks saturate red on purpose for contrast
let scaleMode = 'fixed';
for (const r of document.querySelectorAll('input[name="vizScale"]')) {
  r.addEventListener('change', (e) => { if (e.target.checked) scaleMode = e.target.value; });
}
function snapshotScale(grid) {
  if (scaleMode === 'fixed') return FIXED_SCALE;
  let lo = Infinity, hi = -Infinity;
  for (const r of grid) for (const v of r) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (vizScale.lo == null) { vizScale.lo = lo; vizScale.hi = hi; }
  const decay = 0.01; // per frame (~60 fps → ~1.7 s time constant)
  vizScale.lo = lo < vizScale.lo ? lo : vizScale.lo + (lo - vizScale.lo) * decay;
  vizScale.hi = hi > vizScale.hi ? hi : vizScale.hi + (hi - vizScale.hi) * decay;
  const minSpan = 0.15; // pF — never zoom into pure noise
  if (vizScale.hi - vizScale.lo < minSpan) { const mid = (vizScale.hi + vizScale.lo) / 2; return { vMin: mid - minSpan / 2, vMax: mid + minSpan / 2 }; }
  return { vMin: vizScale.lo, vMax: vizScale.hi };
}


// ---------- Controls ----------
function bindRange(id, outId, fmt, onChange) {
  const el = $(id), out = $(outId);
  const apply = () => { const v = parseFloat(el.value); out.textContent = translateUI(fmt(v)); onChange(v); };
  el.addEventListener('input', apply); apply();
}

$('rhythm').addEventListener('change', (e) => { engine.call('cardiac.setRhythm', e.target.value); $('hr').value = engine.cardiac.hr; $('hrOut').textContent = translateUI(engine.cardiac.hr + ' bpm'); syncHemoUi(); });
bindRange('hr', 'hrOut', (v) => v + ' bpm', (v) => { engine.call('cardiac.setHR', v); syncHemoUi(); });
bindRange('sbp', 'sbpOut', (v) => v + ' mmHg', (v) => { engine.call('cardiac.setBP', v, engine.cardiac.dbp); syncHemoUi(); });
bindRange('dbp', 'dbpOut', (v) => v + ' mmHg', (v) => { engine.call('cardiac.setBP', engine.cardiac.sbp, v); syncHemoUi(); });

// ---------- Windkessel hemodynamic layer + shared respiration (ROADMAP §2.1 items 1·6, audit §6.13) ----------
// 'bp' drive (default) = the historical behaviour: SBP/DBP are the set-points and (SV, TPR) are SOLVED from
// them, shown as read-outs. 'hemo' drive = SV·TPR are the drivers and SBP/DBP are derived, so HR moves BP.
// Switching to 'hemo' starts from the currently solved (SV, TPR), so the pressure does not jump.
function syncHemoUi() {
  const c = engine.cardiac, h = c.hemodynamics(), hemo = h.drive === 'hemo';
  for (const el of document.querySelectorAll('.row.bp-drive')) el.classList.toggle('disabled', hemo);
  for (const el of document.querySelectorAll('.row.hemo-drive')) el.classList.toggle('disabled', !hemo);
  if (!hemo) { $('sv').value = h.sv_mL.toFixed(0); $('svOut').textContent = translateUI(`${h.sv_mL.toFixed(0)} mL (역산)`); $('tpr').value = h.tpr.toFixed(2); $('tprOut').textContent = translateUI(`${h.tpr.toFixed(2)} (역산)`); }
  else {
    $('sbp').value = Math.round(h.sbp); $('sbpOut').textContent = translateUI(`${h.sbp.toFixed(0)} mmHg (유도)`);
    $('dbp').value = Math.round(h.dbp); $('dbpOut').textContent = translateUI(`${h.dbp.toFixed(0)} mmHg (유도)`);
    $('svOut').textContent = translateUI(`${h.sv_mL.toFixed(0)} mL`); $('tprOut').textContent = translateUI(h.tpr.toFixed(2));
  }
  $('hemoDerived').textContent = translateUI(`윈드케셀(모델 가정): CO ${h.co_L_min.toFixed(2)} L/min · SV ${h.sv_mL.toFixed(1)} mL · TPR ${h.tpr.toFixed(2)} mmHg·s/mL · 동맥 유순도 C ${h.compliance_mL_mmHg.toFixed(3)} mL/mmHg · MAP ${h.map_mmHg.toFixed(1)} · PP ${h.pp_mmHg.toFixed(1)} mmHg`);
}
$('hemoDrive').addEventListener('change', (e) => {
  if (e.target.value === 'hemo') { engine.call('cardiac.useSolvedHemodynamics'); $('sv').value = engine.cardiac.sv_mL.toFixed(0); $('tpr').value = engine.cardiac.tpr.toFixed(2); }
  else engine.call('cardiac.setBP', Math.round(engine.cardiac.sbp), Math.round(engine.cardiac.dbp));
  $('hemoDriveOut').textContent = translateUI(e.target.value === 'hemo' ? 'HR이 혈압을 움직임' : '');
  syncHemoUi();
});
bindRange('sv', 'svOut', (v) => v + ' mL', (v) => { if (engine.cardiac.drive === 'hemo') { engine.call('cardiac.setHemodynamics', { sv: v }); syncHemoUi(); } });
bindRange('tpr', 'tprOut', (v) => v.toFixed(2), (v) => { if (engine.cardiac.drive === 'hemo') { engine.call('cardiac.setHemodynamics', { tpr: v }); syncHemoUi(); } });
bindRange('respRate', 'respRateOut', (v) => v + ' 회/분', (v) => engine.call('cardiac.respiration.setRate_bpm', v));
bindRange('respDepth', 'respDepthOut', (v) => v.toFixed(2) + '×', (v) => engine.call('cardiac.respiration.setDepth', v));
bindRange('pulsus', 'pulsusOut', (v) => v.toFixed(1) + ' mmHg', (v) => { engine.set('cardiac.pulsusParadoxus_mmHg', v); });

// ---------- 장기 혈관 드리프트 시계 (ROADMAP §2.2-11, audit §6.20) ----------
// The twin's hours→weeks drift process (js/cardiac.js VascularDriftModel) with its OWN accelerated clock.
// OFF by default — the twin's output is then bit-identical to the pre-§6.20 build. The ×N factor scales
// the DRIFT PROCESS ONLY: the beat, respiration, HRV and noise clocks keep running in real time.
// The row is built here rather than in index.html so this feature owns exactly one file.
const DRIFT_SPEEDS = [
  ['0', '끔 (드리프트 없음)'],
  ['60', '×60 (1 s = 1 분)'],
  ['3600', '×3600 (1 s = 1 시간)'],
  ['86400', '×86400 (1 s = 1 일)'],
  ['604800', '×604800 (1 s = 1 주)'],
];
const driftUi = (() => {
  const card = $('pulsus').closest('.panel');
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = localizeHTML('<label title="혈관 긴장도·경직도·(결합된) 참 혈압·스트랩 접촉압이 시간~주 규모로 표류하는 확률과정. 가속 배율은 드리프트 과정에만 적용되고 박동·호흡·잡음 시계는 실시간 그대로다. 계수는 전부 모델 가정(문헌 보정 필요) — docs/CLINICAL_AUDIT.md §6.20">혈관 드리프트 시계</label><select id="driftClock"></select><output id="driftClockOut"></output>');
  const hint = document.createElement('p');
  hint.className = 'hint'; hint.id = 'driftHint';
  hint.title = translateUI('일주기(24 h + 12 h 조화, 야간 하강) + 혈관운동 OU(τ 36 h) + 경직도 추세/OU(τ 14 d) + 스트랩 크리프(τ 5 d) + 패치 측방 이동 OU(τ 7 d). 모든 계수는 모델 가정 — docs/CLINICAL_AUDIT.md §6.20');
  const anchor = $('hemoDerived');
  anchor.parentNode.insertBefore(row, anchor);
  anchor.parentNode.insertBefore(hint, anchor);
  const sel = row.querySelector('#driftClock');
  for (const [v, label] of DRIFT_SPEEDS) { const o = document.createElement('option'); o.value = v; o.textContent = translateUI(label); sel.appendChild(o); }
  sel.value = '0';
  sel._dd?.refresh?.();
  return { sel, out: row.querySelector('#driftClockOut'), hint, card };
})();
driftUi.sel.addEventListener('change', (ev) => {
  const n = parseFloat(ev.target.value);
  if (!(n > 0)) { engine.call('disableDrift'); driftUi.out.textContent = translateUI(''); driftUi.hint.textContent = translateUI(''); return; }
  // Starting the clock at the CURRENT state: every drift factor is exactly 1 at that instant, so nothing jumps.
  if (!engine.latest.drift) engine.call('enableDrift', { scale: n, epochHours: 9 });
  else engine.call('setDriftScale', n);
  driftUi.out.textContent = translateUI(`1 s = ${n >= 604800 ? '1 주' : n >= 86400 ? '1 일' : n >= 3600 ? '1 시간' : '1 분'} 생리 시간`);
});
function updateDriftUi() {
  const d = engine.latest && engine.latest.drift;
  if (!d) { if (driftUi.hint.textContent) driftUi.hint.textContent = translateUI(''); return; }
  const el = d.elapsed_h;
  const t = el >= 48 ? `${(el / 24).toFixed(2)} 일` : el >= 1 ? `${el.toFixed(2)} 시간` : `${(el * 60).toFixed(1)} 분`;
  driftUi.hint.textContent = translateUI(`드리프트(모델 가정): 경과 생리 시간 ${t} · 벽시계 ${String(Math.floor(d.clockHour)).padStart(2, '0')}:${String(Math.floor((d.clockHour % 1) * 60)).padStart(2, '0')}`
    + ` · 긴장도 ×${d.tone.toFixed(3)} · 경직도 ×${d.stiff.toFixed(3)} · MAP ×${d.mapF.toFixed(3)} · PP ×${d.ppF.toFixed(3)}`
    + ` · 접촉압 ${d.contactDelta >= 0 ? '+' : ''}${d.contactDelta.toFixed(3)} · 시트 Δx ${d.sheetDelta_mm >= 0 ? '+' : ''}${d.sheetDelta_mm.toFixed(2)} mm`);
}
function applyPostureUi(name) {
  const def = BODY_POSTURES[name] || {};
  $('armPos').disabled = !def.armSelectable;
  $('armPos').closest('.row').classList.toggle('disabled', !def.armSelectable);
  $('idleArm').closest('.row').classList.toggle('hidden', !def.armIdle);
  $('idleBody').closest('.row').classList.toggle('hidden', !def.bodyIdle);
  $('armPos')._dd?.refresh();
}
$('bodyPosture').addEventListener('change', (e) => { engine.call('posture.setBodyPosture', e.target.value); avatar?.setBodyPosture(e.target.value); applyPostureUi(e.target.value); });
applyPostureUi($('bodyPosture').value);
$('armPos').addEventListener('change', (e) => engine.call('posture.setArmPosition', e.target.value));

// URL presets for reproducible scenarios, e.g. ?posture=sitting&arm=down&rhythm=afib
{
  const q = new URLSearchParams(location.search);
  const apply = (id, key) => { const v = q.get(key); if (v && [...$(id).options].some((o) => o.value === v)) { $(id).value = v; $(id).dispatchEvent(new Event('change')); } };
  apply('bodyPosture', 'posture'); apply('armPos', 'arm'); apply('rhythm', 'rhythm');
  if (avatar && q.get('cam') === 'front') { avatar.orbit.theta = 0; avatar.orbit.phi = Math.PI / 2; }
  if (avatar && q.get('cam') === 'side') { avatar.orbit.theta = -Math.PI / 2; avatar.orbit.phi = Math.PI / 2; } // viewing the instrumented right side
  const sheet = q.get('sheet'); // e.g. ?sheet=8,-10  (lateral_mm, along_mm)
  if (sheet) { const [a, b] = sheet.split(',').map(parseFloat); if (isFinite(a)) applySheet(a, isFinite(b) ? b : 0, false); }
  // Debug/reproducibility: ?warm=2.7 (pre-run the sim to this sim-time), ?speed=0.01 (playback), ?exag=300
  const warm = parseFloat(q.get('warm'));
  if (warm > 0) engine.warm(warm);
  const sp = parseFloat(q.get('speed'));
  if (isFinite(sp) && sp >= 0) setSimSpeed(sp);
  const ex = parseFloat(q.get('exag'));
  if (isFinite(ex) && ex >= 1) { setWaveExag(ex); const r = document.querySelector(`input[name="waveExag"][value="${ex}"]`); if (r) r.checked = true; }
  // ?collapsed=array,motion → start with those cards collapsed (class names of the cards)
  const col = q.get('collapsed');
  if (col) for (const name of col.split(',')) { const c = document.querySelector(`.card.${CSS.escape(name.trim())}`); if (c) c.classList.add('collapsed'); }
  const viz = q.get('viz');
  if (viz && ['heatmap', 'contour', 'bars', 'surface'].includes(viz)) { const r = document.querySelector(`input[name="arrayViz"][value="${viz}"]`); if (r) { r.checked = true; r.dispatchEvent(new Event('change')); } }
}
bindRange('idleArm', 'idleArmOut', (v) => v.toFixed(2), (v) => engine.call('posture.setArmIdleIntensity', v));
bindRange('idleBody', 'idleBodyOut', (v) => v.toFixed(2), (v) => engine.call('posture.setBodyIdleIntensity', v));
// 체형(신장·체중) → 손목 조직 파라미터 (js/anthropometry.js — 계수는 모델 가정(문헌 보정 필요)).
// 170 cm/70 kg 기준 대비 차분으로 적용되므로 기본값은 기존 동작과 비트 동일. (다른 슬라이더처럼 새로고침 시 초기화 — 저장 없음)
// 손목 단면 기하(폭·깊이·볼라 곡률) — ROADMAP §2.1-4, docs/CLINICAL_AUDIT.md §6.16.
// 3D 손목 뷰는 **기준 체형 대비 배율**로 받으므로 170/70에서는 배율이 정확히 1 → 픽셀 동일.
let wristGeom = deriveWristCrossSection({ height_cm: 170, weight_kg: 70 });
function applyBody() {
  const h = parseFloat($('height').value), w = parseFloat($('weight').value);
  const b = engine.setBody(h, w);
  const effDepth = WRIST_ANATOMY.ARTERY_BASE_DEPTH_MM + engine.capArray.arteryDepthOffset_mm;
  $('bodyDerived').textContent = translateUI(`체형 유도(모델 가정): BMI ${b.bmi.toFixed(1)} · 피하지방 ${b.skinFat_mm.toFixed(2)} mm · 동맥 깊이 ${effDepth.toFixed(2)} mm · 맥파 결합 ×${engine.capArray.arterialAttenGain.toFixed(3)}`);
  wristGeom = deriveWristCrossSection({ height_cm: h, weight_kg: w });
  const g = wristGeom;
  if ($('bodyGeom')) $('bodyGeom').textContent = translateUI(`손목 단면(모델 가정): 폭 ${g.width_mm.toFixed(1)} mm × 깊이 ${g.depth_mm.toFixed(1)} mm (종횡비 ${WRIST_ASPECT.toFixed(2)} 고정) · 볼라 곡률반지름 ${g.volarRadius_mm.toFixed(1)} mm · 둘레 ${g.wristCirc_mm.toFixed(0)} mm · 기준 대비 ×${g.widthScale.toFixed(3)}`);
  wristView?.setWristGeometry(g);
  // 체형 프리셋 버튼 하이라이트: 현재 슬라이더 값과 정확히 일치하는 프리셋만 활성
  for (const [key, btn] of Object.entries(bodyPresetBtns)) {
    const p = BODY_PRESETS.find((q) => q.key === key);
    btn.classList.toggle('primary', !!p && p.height_cm === h && p.weight_kg === w);
  }
}
const bodyPresetBtns = {};
{
  const host = $('bodyPresets');
  if (host) for (const p of BODY_PRESETS) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.textContent = translateUI(p.label);
    const g = deriveWristCrossSection(p);
    b.title = translateUI(`${p.height_cm} cm / ${p.weight_kg} kg — ${p.hint} · 손목 폭 ${g.width_mm.toFixed(1)} mm · 깊이 ${g.depth_mm.toFixed(1)} mm · 볼라 곡률 ${g.volarRadius_mm.toFixed(1)} mm (모델 가정)`);
    b.addEventListener('click', () => {
      $('height').value = p.height_cm; $('weight').value = p.weight_kg;
      $('height').dispatchEvent(new Event('input')); $('weight').dispatchEvent(new Event('input'));
    });
    host.appendChild(b); bodyPresetBtns[p.key] = b;
  }
}
bindRange('height', 'heightOut', (v) => v.toFixed(0) + ' cm', applyBody);
bindRange('weight', 'weightOut', (v) => v.toFixed(0) + ' kg', applyBody);
// Structural changes: restart the sample history so no window mixes old/new configurations
function structuralReset() {
  engine.reset();
  lastAnalysis = null; lastChans = null; lastBeamSearch = null; lastFeat = null; lastEst = null; lastEstCap = null; lastEstPpg = null;
  spo2HistN = 0;
  analysis.reset(); analysis.configure(analysisCfg()); // core re-buffers under the new configuration (calibration kept)
}
$('capFs').addEventListener('change', (e) => { engine.call('capArray.setSampleRate', parseInt(e.target.value, 10)); structuralReset(); });
engine.call('capArray.setSampleRate', parseInt($('capFs').value, 10));
bindRange('tone', 'toneOut', (v) => v.toFixed(2) + '×', (v) => { engine.set('arteryToneScalar', v); });
bindRange('stiff', 'stiffOut', (v) => v.toFixed(2) + '×', (v) => { engine.set('ageStiffness', v); });
// ---- 센서 순방향 물리 (ROADMAP §2.1 항목 2·5·4-기계, docs/CLINICAL_AUDIT.md §6.15) ----
// 접촉압 0.5 · ζ 0 · 순응도 1 = 이 트윈의 기존 동작과 **비트 동일**한 중립점.
function updateCapPhysics() {
  const el = $('capContactOut'); if (!el) return;
  const ca = engine.capArray, c = ca.contactState(ca.contactPressure, engine.cardiac.sbp, engine.cardiac.dbp);
  const peak = ca._softKnee(1, c.knee);
  const R = ca.wristRadius_mm();
  const half = Math.max(...ca.electrodePositions_mm().map((p) => Math.abs(p.lateral_mm - ca.sheetLateral_mm)));
  const gapEdge = ca.padGap_mm(half), gEdge = ca.padStandoffGain(half);
  const zeta = ca.nonlinZeta_perMmHg;
  const nl = zeta > 0 ? `비선형 ζ ${zeta.toFixed(3)} → 맥압당 진폭 ×${(ca.distendingPulse_mmHg(engine.cardiac.sbp, engine.cardiac.dbp) / Math.max(1, engine.cardiac.sbp - engine.cardiac.dbp)).toFixed(3)} (선형 대비 고압일수록 감소)` : '비선형 ζ 0 (선형 — 기존 동작)';
  el.textContent = translateUI(`유도값(모델 가정 ⚠): 압착 ${c.hold_mmHg.toFixed(0)} mmHg · 압평 이득 ×${c.app.toFixed(2)} · 폐색 ×${c.occ.toFixed(2)} · 수축기 첨두 ×${(c.gain * peak).toFixed(2)} · 정맥 울혈 구동 ${(100 * c.venDrive).toFixed(0)} % · 볼라 곡률반지름 ${R.toFixed(1)} mm → 최외곽 패드(${half.toFixed(1)} mm) 간극 ${gapEdge.toFixed(2)} mm → 결합 ×${gEdge.toFixed(2)} · ${nl}`);
}
bindRange('contact', 'contactOut', (v) => v.toFixed(2) + (v === 0.5 ? ' (기준)' : ''), (v) => { engine.call('capArray.setContactPressure', v); updateCapPhysics(); });
bindRange('capNonlin', 'capNonlinOut', (v) => (v === 0 ? '0 (선형·기존)' : v.toFixed(3) + ' /mmHg' + (Math.abs(v - 0.012) < 1e-9 ? ' (PWV 법칙 정합)' : '')), (v) => { engine.set('capArray.nonlinZeta_perMmHg', v); updateCapPhysics(); });
bindRange('patchConform', 'patchConformOut', (v) => v.toFixed(2) + (v === 1 ? ' (완전 순응·기존)' : ''), (v) => { engine.set('capArray.curvatureConformity', v); updateCapPhysics(); });
// Noise/artefact model of the capacitive front-end: synthetic (default) | measured (fitted from the real v1 patch recordings)
if ($('capNoiseModel')) {
  const applyNoiseModel = () => { engine.set('capArray.noiseModel', $('capNoiseModel').value === 'measured' ? 'measured' : 'synthetic'); if ($('capNoiseModelOut')) $('capNoiseModelOut').textContent = translateUI(engine.capArray.noiseModel === 'measured' ? '실측 피팅' : ''); };
  $('capNoiseModel').addEventListener('change', applyNoiseModel);
  applyNoiseModel();
}
// Electrode budget: rows × cols ≤ MAX_ELECTRODES. Moving one slider automatically lowers the other.
const MAX_ELECTRODES = 20;
function setArray(rows, cols) {
  engine.call('capArray.configure', { rows, cols });
  // reflect any auto-adjustment back into the sliders
  $('rows').value = engine.capArray.rows; $('rowsOut').textContent = translateUI(engine.capArray.rows + '');
  $('cols').value = engine.capArray.cols; $('colsOut').textContent = translateUI(engine.capArray.cols + '');
  $('arrayCount') && ($('arrayCount').textContent = translateUI(`${engine.capArray.rows}×${engine.capArray.cols} = ${engine.capArray.channelCount()} / ${MAX_ELECTRODES}`));
  syncSheetUi(); structuralReset();
}
bindRange('rows', 'rowsOut', (v) => v + '', (v) => {
  if (engine.capArray.rows === v) return;
  const cols = Math.min(engine.capArray.cols, Math.max(1, Math.floor(MAX_ELECTRODES / v)));
  setArray(v, cols);
});
bindRange('cols', 'colsOut', (v) => v + '', (v) => {
  if (engine.capArray.cols === v) return;
  const rows = Math.min(engine.capArray.rows, Math.max(1, Math.floor(MAX_ELECTRODES / v)));
  setArray(rows, v);
});
bindRange('spacing', 'spacingOut', (v) => v + ' mm', (v) => { if (engine.capArray.spacingMm !== v) { engine.call('capArray.configure', { spacingMm: v }); syncSheetUi(); structuralReset(); } });
function syncSheetUi() { if (typeof applySheet === 'function' && $('sheetAlong')) applySheet(engine.capArray.sheetLateral_mm, engine.capArray.sheetAlong_mm, false); }

// ---- Electrode layout: regular grid (sliders) or a user-designed patch (design tool) ----
let activeLayoutName = 'grid';
function applyLayout(layout, name) {
  engine.call('capArray.setLayout', layout || null);
  activeLayoutName = layout ? (name || layout.name) : 'grid';
  const custom = !!engine.capArray.layout;
  for (const id of ['rows', 'cols', 'spacing']) { const row = $(id).closest('.row'); if (row) row.classList.toggle('disabled', custom); }
  $('arrayCount') && ($('arrayCount').textContent = translateUI(custom ? `사용자 레이아웃 ${engine.capArray.channelCount()} / ${MAX_ELECTRODES} (행 ${engine.capArray.rowCount()})` : `${engine.capArray.rows}×${engine.capArray.cols} = ${engine.capArray.channelCount()} / ${MAX_ELECTRODES}`));
  if ($('layoutSel').value !== activeLayoutName) { $('layoutSel').value = activeLayoutName; enhanceSelect($('layoutSel')); }
  syncSheetUi(); structuralReset();
}
function refreshLayoutOptions() {
  const sel = $('layoutSel'); const cur = activeLayoutName; sel.innerHTML = localizeHTML('');
  const add = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = translateUI(t); sel.appendChild(o); };
  add('grid', '규칙 격자 (슬라이더)');
  for (const n of Object.keys(loadLayouts())) add(n, n);
  for (const n of Object.keys(PRESETS)) add(n, n);
  sel.value = [...sel.options].some((o) => o.value === cur) ? cur : 'grid';
  enhanceSelect(sel);
}
$('layoutSel').addEventListener('change', () => {
  const v = $('layoutSel').value;
  if (v === 'grid') applyLayout(null);
  else { const L = PRESETS[v] ? PRESETS[v]() : getLayout(v); if (L) applyLayout(L, v); else applyLayout(null); }
});
const patchDesigner = initPatchDesigner({
  // `wrist`: 체형에서 유도된 손목 단면 기하 — 설계도구의 손 사진 정합(px/mm)과 가이드 선이 이 폭을 따른다
  // (기본 체형 → 폭 정확히 58.0 mm = 기존 정합값). ROADMAP §2.1-4 / docs/CLINICAL_AUDIT.md §6.16.
  getCurrent: () => ({ ...(engine.capArray.layout ? { ...engine.capArray.layout, name: activeLayoutName } : { grid: { rows: engine.capArray.rows, cols: engine.capArray.cols, pitch: engine.capArray.spacingMm } }), sheet: { lateral_mm: engine.capArray.sheetLateral_mm, along_mm: engine.capArray.sheetAlong_mm }, wrist: { width_mm: wristGeom.width_mm, depth_mm: wristGeom.depth_mm, volarRadius_mm: wristGeom.volarRadius_mm, widthRef_mm: WRIST_WIDTH_REF_MM } }),
  onApply: (layout, opts) => { refreshLayoutOptions(); if (opts && opts.savedOnly) return; if (layout) { applyLayout(layout, layout.name); refreshLayoutOptions(); } else applyLayout(null); },
});
$('openDesigner').addEventListener('click', () => patchDesigner.open());
refreshLayoutOptions();
// URL deep links (deferred to after module initialisation — applyLayout() resets analysis state declared below)
queueMicrotask(() => {
  if (_qp.get('noise') === 'measured' || _qp.get('noise') === 'synthetic') { engine.set('capArray.noiseModel', _qp.get('noise')); const sel = document.getElementById('capNoiseModel'); if (sel) { sel.value = _qp.get('noise'); sel._dd?.refresh(); } }
  if (_qp.get('collapseAll')) for (const c of document.querySelectorAll('.card.collapsible, .card.wide2, .card.spo2, .panel.controls')) c.classList.add('collapsed');
  if (_qp.get('replay')) fetch(_qp.get('replay'), { cache: 'no-store' }).then((r) => r.arrayBuffer()).then((b) => startReplay(decodeRecording(b), _qp.get('replay').split('/').pop())).catch((e) => setStatus('재생 실패: ' + e.message));
  if (_qp.get('layout')) { const v = _qp.get('layout'); const L = PRESETS[v] ? PRESETS[v]() : getLayout(v); if (L) applyLayout(L, v); }
  if (_qp.get('modal') === 'designer') patchDesigner.open();
  // ?scenario=<name> — 시나리오 프리셋 자동 로드 (§2.3-13). ?scenbar=1 로 바만 표시.
  if (_qp.get('scenario')) { if (!loadScenario(_qp.get('scenario'))) setStatus(`알 수 없는 시나리오: ${_qp.get('scenario')}`); }
  else if (_qp.get('scenbar')) scenarioBar.show(true);
  if (_qp.get('modal') === 'export') openExport();
  // ⑥ ?source=ws://localhost:8787/stream (또는 ?source=ws 로 브리지 기본 주소) — 라이브 스트림으로 시작
  if (_qp.get('source')) {
    const u = liveUrlFromParam(_qp.get('source'));
    if (u) startLive(u); else if (!['twin', 'sim'].includes(_qp.get('source'))) setStatus(`알 수 없는 소스: ${_qp.get('source')}`);
  }
});

// Sensor noise / artifact toggles (sensor-waveform card)
const bindCheck = (id, fn) => { const el = $(id); if (el) el.addEventListener('change', () => fn(el.checked)); };
bindCheck('capHum', (v) => { engine.set('capArray.artifacts.hum', v); });
bindCheck('capWander', (v) => { engine.set('capArray.artifacts.wander', v); });
bindCheck('capMotion', (v) => { engine.set('capArray.artifacts.motionGain', v ? 3 : 1); });
bindCheck('capNoise', (v) => { engine.set('capArray.artifacts.noiseGain', v ? 3 : 1); });
bindCheck('ppgAmbient', (v) => { engine.set('ppg.artifacts.ambient', v); });
bindCheck('ppgWander', (v) => { engine.set('ppg.artifacts.wander', v); });
bindCheck('ppgMotion', (v) => { engine.set('ppg.artifacts.motionGain', v ? 3 : 1); });
bindCheck('ppgLowPerf', (v) => { engine.set('ppg.artifacts.lowPerf', v); updatePpgOptics(); });
// ---- PPG 피부 광학 · 관류 (ROADMAP §2.1-3, js/ppgSpo2.js) ----
// ⚠ 전부 **모델 가정(문헌 보정 필요)**. 표시되는 SpO₂ 편향은 이 트윈의 시뮬레이션 가정이며
// 임상적으로 검증된 정확도 추정치가 아니다 — 어디에도 임상 수치처럼 옮기지 말 것.
// 기본값(피부 톤 III–IV = 3.5, 손가락 온도 33 °C)은 기존 동작과 비트 동일한 지점이다.
const FITZ_ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
const fitzLabel = (v) => (Number.isInteger(v) ? FITZ_ROMAN[v - 1] : `${FITZ_ROMAN[Math.floor(v) - 1]}–${FITZ_ROMAN[Math.ceil(v) - 1]}`);
function updatePpgOptics() {
  const el = $('ppgOpticsOut'); if (!el) return;
  const r = engine.ppg.opticsReadout();
  const sg = (v, d = 2) => (v >= 0 ? '+' : '') + v.toFixed(d);
  // 설명(라벨)과 측정값을 분리해 표시한다 — 값은 고정 폭 칩 6개(3열 × 2행)라 숫자가 바뀌어도
  // 줄 수·카드 폭이 흔들리지 않는다(2026-08-25 사용자 요청).
  const chip = (k, v) => `<span class="kvp"><i>${k}</i><b>${v}</b></span>`;
  el.innerHTML = localizeHTML([
    chip('PI', `${r.perfusionIndex.toFixed(2)} %`),
    chip('관류', `×${r.perfusionFactor.toFixed(2)}`),
    chip('긴장도', `×${r.localToneFactor.toFixed(2)}`),
    chip('DC R/IR', `×${r.dcRed.toFixed(2)} / ×${r.dcIr.toFixed(2)}`),
    chip('광자예산', `${sg(r.snrPenalty_db, 1)} dB`),
    chip('SpO₂ 편향', `${sg(r.spo2Bias_pp)} %p`),
  ].join(''));
}
// Fitzpatrick I–VI 를 슬라이더 색으로 보여 준다 — 트랙은 전체 램프, 썸은 현재 톤.
// ⚠ 예시 색이지 보정된 피부 반사율이 아니다(모델 가정과 같은 수준의 표시용 값).
const SKIN_HEX = ['#f6e0d0', '#f0d0b8', '#e0b48f', '#c99065', '#a06a45', '#6b4530'];
const lerpHex = (a, b, t) => {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r1, g1, b1] = p(a), [r2, g2, b2] = p(b);
  const m = (x, y) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  return ;
};
const skinHex = (v) => {
  const i = Math.max(0, Math.min(4, Math.floor(v) - 1));
  return lerpHex(SKIN_HEX[i], SKIN_HEX[i + 1], Math.max(0, Math.min(1, v - (i + 1))));
};
const paintSkin = (v) => { const el = $('ppgFitz'); if (el) el.style.setProperty('--skin', skinHex(v)); };
// 손가락 온도도 열 스펙트럼으로: 20 °C(차가운 청) → 33 °C(중립 살구) → 36 °C(따뜻한 적).
// ⚠ 표시용 색이며 열화상 보정값이 아니다.
const TEMP_HEX = ['#4a7fd4', '#59a6d8', '#8fc7c2', '#dfc39a', '#e08a5a', '#d4452e'];
const tempHex = (c) => {
  const t = Math.max(0, Math.min(1, (c - 20) / 16)) * (TEMP_HEX.length - 1);
  const i = Math.max(0, Math.min(TEMP_HEX.length - 2, Math.floor(t)));
  return lerpHex(TEMP_HEX[i], TEMP_HEX[i + 1], t - i);
};
const paintTemp = (v) => { const el = $('ppgTemp'); if (el) el.style.setProperty('--skin', tempHex(v)); };
bindRange('ppgFitz', 'ppgFitzOut', (v) => fitzLabel(v), (v) => { engine.set('ppg.fitzpatrick', v); paintSkin(v); updatePpgOptics(); });
paintSkin(3.5);
bindRange('ppgTemp', 'ppgTempOut', (v) => v.toFixed(1) + ' °C', (v) => { engine.set('ppg.fingerTemp_C', v); paintTemp(v); updatePpgOptics(); });
paintTemp(33);

// Flexible sheet offset: sliders ⇄ 3D drag, both drive the capacitive model.
function applySheet(lat, along, fromView) {
  engine.call('capArray.setSheetOffset', lat, along);
  const L = engine.capArray.sheetLateral_mm, A = engine.capArray.sheetAlong_mm;
  const rng = engine.capArray.alongRange_mm();
  $('sheetAlong').min = rng.min; $('sheetAlong').max = rng.max;
  $('sheetLat').value = L; $('sheetLatOut').textContent = translateUI(L.toFixed(1) + ' mm');
  $('sheetAlong').value = A; $('sheetAlongOut').textContent = translateUI(A.toFixed(1) + ' mm');
  $('w-lat').textContent = translateUI(L.toFixed(1)); $('w-along').textContent = translateUI(A.toFixed(1));
  if (!fromView && wristView) wristView.setSheetOffset(L, A, true);
}
function applySheetAngle(degrees){
  engine.call('capArray.setSheetAngle',degrees);
  const angle=engine.capArray.sheetAngle_deg;
  $('sheetAngle').value=angle;$('sheetAngleOut').textContent=translateUI(angle.toFixed(1)+'°');
  wristView?.setSheetAngle(angle,true);applySheet(engine.capArray.sheetLateral_mm,engine.capArray.sheetAlong_mm,false);
}
$('sheetAngle').addEventListener('input',e=>applySheetAngle(Number(e.target.value)));
wristView?.onSheetAngle(applySheetAngle);
bindRange('arteryLateral','arteryLateralOut',v=>v.toFixed(2)+' mm',v=>engine.set('capArray.arteryLateralAdjust_mm',v));
bindRange('arteryDepth','arteryDepthOut',v=>v.toFixed(2)+' mm',v=>engine.set('capArray.arteryDepthAdjust_mm',v));
$('sheetLat').addEventListener('input', (e) => applySheet(parseFloat(e.target.value), engine.capArray.sheetAlong_mm, false));
$('sheetAlong').addEventListener('input', (e) => applySheet(engine.capArray.sheetLateral_mm, parseFloat(e.target.value), false));
wristView?.onSheetMove((lat, along) => applySheet(lat, along, true));
applySheet(engine.capArray.sheetLateral_mm, engine.capArray.sheetAlong_mm, false); // sync UI to model (URL preset may have set it)

let paused = false;
$('pause').addEventListener('click', () => { paused = !paused; engine.setRun({ paused }); $('pause').textContent = translateUI(paused ? '▶ 재개' : '⏸ 일시정지'); });

// Anatomy tables
function renderAnatomy() {
  const { arterial, venous } = engine.describeAnatomy();
  const a = $('anatomy-art'); a.innerHTML = localizeHTML('');
  arterial.forEach((s, i) => {
    const tr = document.createElement('tr');
    const d = (engine.latest.t != null) ? (i === 0 ? 0 : 0) : 0; // delay filled live below
    tr.innerHTML = localizeHTML(`<td>${s.label}</td><td>${s.distanceFromHeart_cm}</td><td>${s.refDiameter_mm}</td><td id="del-${s.name}">–</td>`);
    a.appendChild(tr);
  });
  const v = $('anatomy-ven'); v.innerHTML = localizeHTML('');
  venous.forEach((s) => {
    const tr = document.createElement('tr');
    tr.innerHTML = localizeHTML(`<td>${s.label}</td><td>${s.distanceFromHeart_cm}</td><td>${s.refDiameter_mm}</td><td>${s.hasValves ? '있음' : '없음'}</td>`);
    v.appendChild(tr);
  });
}
renderAnatomy();

// ---------- Main loop ----------
let lastTs = performance.now();
let frame = 0;
let lastAnalysis = null, lastChans = null, lastBeamSearch = null;
const BRACHIAL_IDX = findSegmentIndex('brachial');

// ---------- Algorithmic estimates (BP / tone / stiffness, SpO₂) ----------
let lastEst = null, lastFeat = null, lastEstCap = null, lastEstPpg = null, calibrated = false, lastAttach = null;
let lastEstimatorDiag = null; // 교차모달 고장 검출 z-점수 (분석 코어 `estimator`) — 칩 툴팁용
// Cumulative error accumulators (reset on every calibration)
const cumErr = { cap: { n: 0, s: 0, d: 0, bs: 0, bd: 0 }, ppg: { n: 0, s: 0, d: 0, bs: 0, bd: 0 } };
const resetCumErr = () => { for (const k of ['cap', 'ppg']) Object.assign(cumErr[k], { n: 0, s: 0, d: 0, bs: 0, bd: 0 }); };
function doCalibrate(sbp, dbp, source = 'cuff') { analysis.calibrate(sbp, dbp); resetCumErr(); autoCalDone = true; lastCalib = { sbp, dbp, t: +engine.t.toFixed(2), source }; }
analysis.onResult((r) => {
  lastAnalysis = r.analysis; lastChans = r.chans; lastBeamSearch = r.beam; lastFeat = r.features; lastEngine = r.engine || lastEngine; if (r.analyzeMs != null) lastAnalyzeMs = r.analyzeMs;
  lastEst = r.estimates.fusion; lastEstCap = r.estimates.cap; lastEstPpg = r.estimates.ppg; calibrated = r.calibrated; lastAttach = r.attach || null;
  lastEstimatorDiag = r.estimator || null;
  if (r.spo2 != null) { if (spo2HistN < spo2Hist.length) spo2Hist[spo2HistN++] = r.spo2; else { spo2Hist.copyWithin(0, 1); spo2Hist[spo2Hist.length - 1] = r.spo2; } }
  if (liveSource) liveSource.noteResult(); // ⑥ 종단 지연: 브리지 송신 → 이 결과 (docs/LIVE_STREAM.md §5)
  pushExportRow(r);
});
// One CSV/JSONL row per analysis window (ROADMAP §2.3-14). `true_*` = the simulator's set-point,
// i.e. a MODEL ground truth — left empty while a measured recording is being replayed.
function pushExportRow(r) {
  const f = r.features || {}, c = r.estimates || {}, L = engine.latest;
  const cap = c.cap || {}, ppg = c.ppg || {}, fus = c.fusion || {};
  exportBuf.pushWindow({
    t: r.t != null ? r.t : engine.t,
    scenario: scenario.name || '', scenarioT: scenario.active ? scenario.t : null,
    hr: f.hr, amp: f.amp, ri: f.ri, tRefl: f.tRefl_ms, pwv: f.pwvLocal, pttLocal: f.pttLocal_ms, sqi: f.sqi,
    xhat: r.beam ? r.beam.xHat : null,
    capSbp: cap.sbp, capDbp: cap.dbp, capMap: cap.map, capX: cap.x, capConf: cap.confidence, capClamped: !!cap.clamped,
    ppgSbp: ppg.sbp, ppgDbp: ppg.dbp, ppgMap: ppg.map, ppgX: ppg.x, ppgConf: ppg.confidence,
    fusSbp: fus.sbp, fusDbp: fus.dbp,
    spo2: r.spo2, spo2Model: noTruth() ? null : L.spo2,
    attach: r.attach ? r.attach.state : '', attachRecal: !!(r.attach && r.attach.recalRequired), calibrated: !!r.calibrated,
    trueSbp: noTruth() ? null : engine.cardiac.sbp, trueDbp: noTruth() ? null : engine.cardiac.dbp, trueHr: noTruth() ? null : engine.cardiac.hr,
    hydro: L.hydrostatic_mmHg, posture: $('bodyPosture').value, arm: $('armPos').value,
    contact: engine.capArray.contactPressure, tone: engine.arteryToneScalar, stiff: engine.ageStiffness,
    nCh: engine.capArray.channelCount(), capFs: engine.capArray.sampleRate_Hz,
  });
}
// 교차모달 고장 검출 칩 (§6.17): 어레이 카드 = 접촉 이상 / ΔC 형상 불일치, PPG 카드 = 광학 변화.
// 색은 기존 부착 칩과 같은 계열(bad = 붉은 알약, warn = 노란 테두리)이고, 툴팁에 z-점수를 그대로 싣는다.
const zTxt = (v) => (v == null || !isFinite(v) ? '–' : (v >= 0 ? '+' : '') + v.toFixed(2));
const FAULT_NOTE = '⚠ 이 시뮬레이션 안에서의 교차모달·PPG 내부 일관성 위반 검출기(캘리브레이션 시점 대비 z-점수)이며 임상 고장/진단 판정이 아닙니다. 임계·모델 바닥은 전부 모델 가정이고 실측 보정이 없습니다(측정 데이터셋에 PPG 채널 자체가 없습니다). 플래그가 서면 해당 추정기 신뢰도는 코어가 이미 낮춥니다 (docs/CLINICAL_AUDIT.md §6.17 · §6.24).';
function faultChip(text, cls, why) { const e = document.createElement('em'); e.className = 'att ' + cls; e.textContent = translateUI(text); e.title = translateUI(`${why}\n${FAULT_NOTE}`); return e; }
function renderFaultChips() {
  const d = lastEstimatorDiag || {};
  const z = `γ(결합) z ${zTxt(d.xmodGammaZ)} · 반사시간 z ${zTxt(d.xmodReflZ)} · π(맥압) z ${zTxt(d.xmodPiZ)} · RI z ${zTxt(d.xmodRiZ)} · PPG DC비 z ${zTxt(d.dcRelZ)} · PPG 내부 π z ${zTxt(d.ppgPiZ)} (나머지 단서 이탈 ${zTxt(d.ppgStillZ)}, σ_관류 ×${d.ppgPerfSigma != null && isFinite(d.ppgPerfSigma) ? d.ppgPerfSigma.toFixed(2) : '–'})`;
  const cap = $('m-capfault'), ppg = $('m-ppgfault');
  if (cap) {
    cap.textContent = translateUI('');
    if (lastEstCap && lastEstCap.couplingFault) cap.appendChild(faultChip('접촉 이상', 'bad', `어레이 결합/접촉이 캘리브레이션 시점과 달라졌다고 판정 (couplingFault). ${z}`));
    if (lastEstCap && lastEstCap.riLawFault) cap.appendChild(faultChip('ΔC 형상 불일치', 'warn', `어레이 RI 와 PPG RI 가 서로 다른 방향으로 움직임 — ΔC 형상 법칙 위반 (riLawFault). ${z}`));
  }
  if (ppg) {
    ppg.textContent = translateUI('');
    if (lastEstPpg && lastEstPpg.opticsFault) ppg.appendChild(faultChip('광학 변화', 'bad', `PPG 광경로/DC 가 캘리브레이션 시점과 달라졌다고 판정 — AC/DC 단서는 게이트됨 (opticsFault). ${z}`));
    // 7차(§6.24): PPG 내부만으로 본 광학 모호성. 어레이가 없어도 뜨지만 **귀속이 불가능**하므로 단서를 게이팅하지
    // 않는다 — 신뢰도만 내리고 재캘리브레이션을 요구한다. 진짜 맥압 변화와 구별되지 않는다는 점을 툴팁에 명시.
    if (lastEstPpg && lastEstPpg.opticsUnverified && !(lastEstPpg.opticsFault)) ppg.appendChild(faultChip('AC/DC 미검증', 'warn', `PPG 진폭 단서만 큰 맥압 변화를 주장하고 반사시간·RI·심박은 모두 정지 상태 (opticsUnverified). PPG 내부 정보만으로는 "관류(광학)가 변한 것"과 "맥압이 실제로 변한 것"을 구별할 수 없어 단서를 고치지 않고 신뢰도만 내리며 재캘리브레이션을 요구한다. ${z}`));
    if (d.ppgPerfLow) ppg.appendChild(faultChip('저관류', 'bad', `PPG 관류지수가 절대 하한(AC/DC ${'<'} 0.005 ≈ PI 0.45 %) 아래 — AC/DC 행을 버리고 캘리브레이션 맥압을 보고한다. ${z}`));
  }
}
const spo2Hist = new Float32Array(40); let spo2HistN = 0; // computed SpO₂ history (~10 s at 4 Hz)
let autoCalDone = false;
// --- Cuff calibration modal: THREE cuff readings → mean (± SD, 95 % CI) → calibrates BOTH algorithms ---
// Auto mode simulates an oscillometric cuff: a small per-device bias (N(0, 1.5 mmHg), fixed for the
// session) plus per-reading noise (SBP N(0, 3.5), DBP N(0, 2.5)) around the true central BP — roughly
// the repeatability of a validated device (ISO 81060-2: mean ≤ 5, SD ≤ 8 mmHg). The mean of three
// readings has SE = SD/√3, which is what makes the calibration statistically meaningful.
const CUFF = { biasS: 0, biasD: 0, sdS: 3.5, sdD: 2.5 };
{
  const randn = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  CUFF.biasS = 1.5 * randn(); CUFF.biasD = 1.5 * randn();
  const ids = [1, 2, 3];
  const fill = (sel, lo, hi) => { sel.innerHTML = localizeHTML(''); for (let v = lo; v <= hi; v++) { const o = document.createElement('option'); o.value = v; o.textContent = translateUI(`${v}`); sel.appendChild(o); } };
  for (const i of ids) { fill($(`calSbp${i}`), 80, 200); fill($(`calDbp${i}`), 40, 120); }
  enhanceAllSelects($('calibModal'));
  const readings = () => ids.map((i) => ({ s: parseInt($(`calSbp${i}`).value, 10), d: parseInt($(`calDbp${i}`).value, 10) }));
  const stats = (arr) => { const n = arr.length, m = arr.reduce((a, b) => a + b, 0) / n; const sd = Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, n - 1)); return { m, sd, se: sd / Math.sqrt(n), ci: (n === 3 ? 4.303 : n === 2 ? 12.706 : 1.96) * sd / Math.sqrt(n) }; }; // t(n−1) for tiny n (n=3 → 4.303)
  const setSel = (id, v) => { const el = $(id); el.value = String(Math.max(parseInt(el.options[0].value, 10), Math.min(parseInt(el.options[el.options.length - 1].value, 10), Math.round(v)))); el._dd?.refresh(); };
  const simulate = () => { for (const i of ids) { setSel(`calSbp${i}`, engine.cardiac.sbp + CUFF.biasS + CUFF.sdS * randn()); setSel(`calDbp${i}`, engine.cardiac.dbp + CUFF.biasD + CUFF.sdD * randn()); } };
  const updateStats = () => {
    const r = readings(); const S = stats(r.map((x) => x.s)), D = stats(r.map((x) => x.d));
    $('calStats').innerHTML = localizeHTML(`모사 커프 3회 평균 <b>${S.m.toFixed(1)}/${D.m.toFixed(1)}</b> mmHg · SD ${S.sd.toFixed(1)}/${D.sd.toFixed(1)} · 95 % CI(t, n=3) ±${S.ci.toFixed(1)}/±${D.ci.toFixed(1)} mmHg → 캘리브레이션 입력 <b>${Math.round(S.m)}/${Math.round(D.m)}</b> <span class="hint">(모사 커프 = 중심 BP + 기기 편향·잡음 모델; 실제 커프는 상완압)</span>`);
    return { sbp: S.m, dbp: D.m, S, D };
  };
  const syncMode = () => {
    const manual = $('calSource').value === 'manual';
    $('calibModal').querySelector('.modal-box').classList.toggle('manual-off', !manual);
    for (const i of ids) { $(`calSbp${i}`).disabled = !manual; $(`calDbp${i}`).disabled = !manual; $(`calSbp${i}`)._dd?.refresh(); $(`calDbp${i}`)._dd?.refresh(); }
    if (!manual) simulate();
    updateStats();
  };
  $('calSource').addEventListener('change', syncMode);
  for (const i of ids) { $(`calSbp${i}`).addEventListener('change', updateStats); $(`calDbp${i}`).addEventListener('change', updateStats); }
  const open = () => {
    if (noTruth()) {
      // Real recording / live device: the simulated cuff (drawn around the twin's set-point) would be a
      // fabricated truth → manual entry only. ⑥ 라이브 스트림도 같은 규칙 (실제 커프값을 사람이 입력).
      $('calNow').textContent = translateUI(liveSource
        ? '라이브 센서 스트림: 이 스트림에는 기준 BP(커프)가 없습니다. 실제로 측정한 커프값 3회를 직접 입력하세요 — 입력값이 없으면 추정치는 그 자리의 플레이스홀더 기준 상대 변화일 뿐 정확도를 말하지 않습니다.'
        : '실측 기록 재생 중: 이 기록에는 기준 BP(커프)가 없습니다. 입력하는 값은 플레이스홀더이며 추정치는 그 값 기준 상대 변화일 뿐 정확도를 말하지 않습니다.');
      $('calSource').value = 'manual'; $('calSource')._dd?.refresh();
    } else $('calNow').textContent = translateUI(`참고: 현재 시뮬레이션 중심 BP ${engine.cardiac.sbp}/${engine.cardiac.dbp} mmHg (커프 기기 편향 ${CUFF.biasS >= 0 ? '+' : ''}${CUFF.biasS.toFixed(1)}/${CUFF.biasD >= 0 ? '+' : ''}${CUFF.biasD.toFixed(1)} mmHg, 측정 SD ${CUFF.sdS}/${CUFF.sdD} mmHg 모사)`);
    syncMode(); $('calibModal').classList.remove('hidden');
  };
  const close = () => $('calibModal').classList.add('hidden');
  $('calib').addEventListener('click', open);
  if (new URLSearchParams(location.search).get('modal') === 'calib') setTimeout(open, 300); // debug/preview
  $('calCancel').addEventListener('click', close);
  $('calibModal').addEventListener('click', (e) => { if (e.target === $('calibModal')) close(); });
  $('calOk').addEventListener('click', () => {
    if (!lastFeat) { close(); return; }
    const { sbp, dbp } = updateStats();
    if (sbp > dbp) doCalibrate(Math.round(sbp), Math.round(dbp), $('calSource').value === 'manual' ? 'manual-3x' : 'simulated-cuff-3x');
    close();
  });
  // The automatic first calibration (t ≈ 5 s) also uses a simulated 3-reading cuff mean
  window.__autoCuffMean = () => { const s = [], d = []; for (let i = 0; i < 3; i++) { s.push(engine.cardiac.sbp + CUFF.biasS + CUFF.sdS * randn()); d.push(engine.cardiac.dbp + CUFF.biasD + CUFF.sdD * randn()); } return { sbp: Math.round(s.reduce((a, b) => a + b) / 3), dbp: Math.round(d.reduce((a, b) => a + b) / 3) }; };
}

// Inter-electrode (row-to-row) pulse delays: measured (Taylor estimator on ensembles) vs model truth
// (row spacing / local PWV). Returns a short text for the chart footer.
function rowDelayText() {
  const rows = engine.capArray.rowCount(), rowAlongs = engine.capArray.rowAlongs_mm();
  if (rows < 2) return null;
  const pwv = engine.capArray._localPWV(); // m/s
  const meas = lastFeat && lastFeat.rowDelays_ms ? lastFeat.rowDelays_ms : null;
  const parts = [];
  for (let r = 1; r < rows; r++) {
    const m = meas && meas[r] != null ? meas[r].toFixed(2) : '–';
    parts.push(`r0→r${r} ${m}/${(((rowAlongs[r] - rowAlongs[0]) / 1000) / pwv * 1000).toFixed(2)}`);
  }
  const lines = [];
  // ⑥ 진값이 없는 입력(실측 기록 재생 · 라이브 센서 스트림)에서는 오른쪽 패널의 "MRC SNR (진값 대비)" ·
  // "ρ(MRC, ideal)" · 분홍색 "시뮬레이터 진값 요골동맥 맥파" 트레이스가 참조할 기준 맥파가 없다 —
  // 비교 대상이 0으로 채워진 버퍼이므로 그 숫자·선은 읽지 말 것 (블라인드 품질 지표는 비트 SNR·SQI).
  if (noTruth()) lines.push(`⚠ 기준 맥파 없음 (${liveSource ? '라이브 스트림' : '실측 기록'}) — 우측 패널의 진값 트레이스·MRC 진 SNR·ρ 는 무의미`);
  if (lastEngine) lines.push(`엔진 ${lastEngine === 'rust' ? 'Rust/WASM' : 'JS'}${lastAnalyzeMs != null ? ` ${lastAnalyzeMs.toFixed(1)} ms` : ''}${analysis.mode === 'worker' ? ' · Worker' : ''}`);
  if (lastAnalysis && lastAnalysis.delayComp && lastAnalysis.mrcSnrPlain_db != null && isFinite(lastAnalysis.mrcSnr_db)) lines.push(`지연보상 MRC ${(lastAnalysis.mrcSnr_db - lastAnalysis.mrcSnrPlain_db) >= 0 ? '+' : ''}${(lastAnalysis.mrcSnr_db - lastAnalysis.mrcSnrPlain_db).toFixed(1)} dB`);
  if (lastEstPpg && lastEstPpg.recalRequired) lines.push(`⚠ PPG 광학 상태가 캘리브레이션 시점과 다름 → 재캘리브레이션 필요 (§6.24: ${lastEstPpg.opticsFault ? '어레이와의 진폭 불일치/DC 스텝' : 'AC/DC 단서만 이동 — 귀속 불가'})`);
  if (lastAttach && lastAttach.recalRequired) lines.push(`⚠ 시트 ${lastAttach.state === 'detached' ? '분리' : '재배치'} 감지 → 재캘리브레이션 필요${lastAttach.lateralShift_mm != null ? ` (Δx̂ ${lastAttach.lateralShift_mm >= 0 ? '+' : ''}${lastAttach.lateralShift_mm.toFixed(1)} mm)` : ''}`);
  else if (lastAttach && lastAttach.state === 'transient') lines.push(`부착 과도 — 어레이 단서 게이트 (${lastAttach.sinceEvent_s != null ? lastAttach.sinceEvent_s.toFixed(0) : '–'} s)`);
  if (lastBeamSearch) {
    const [a, b] = lastBeamSearch.betweenCols;
    const between = a != null && b != null && a !== b ? `#${a + 1}–#${b + 1}열 사이` : (a != null ? `#${a + 1}열 위` : '');
    const trueX = WRIST_ANATOMY.ARTERY_BASE_LATERAL_MM + engine.latest.arteryOffset.lateral_mm - engine.capArray.sheetLateral_mm;
    lines.push(`빔서치 동맥 x̂ ${lastBeamSearch.xHat.toFixed(2)} mm (${noTruth() ? `진값 없음 — ${liveSource ? '라이브 스트림' : '실측 기록'}` : `진값 ${trueX.toFixed(2)}`})`);
    if (lastBeamSearch.xTrack != null) lines.push(`추적 x̃ ${lastBeamSearch.xTrack.toFixed(2)} mm${lastBeamSearch.pronRate_dps != null && Math.abs(lastBeamSearch.pronRate_dps) > 2 ? ` · IMU 회내 ${lastBeamSearch.pronRate_dps.toFixed(0)}°/s` : ''}`);
    if (between) lines.push(between);
  }
  const pwvMeas = lastFeat && lastFeat.pwvLocal ? `${lastFeat.pwvLocal.toFixed(1)}` : '–';
  lines.push(`근위/원위 빔 PTT ${lastFeat && lastFeat.pttLocal_ms != null ? lastFeat.pttLocal_ms.toFixed(2) : '–'} ms`);
  lines.push(`국소 PWV ${pwvMeas} (${noTruth() ? '모델 기준 없음' : `모델 ${pwv.toFixed(1)}`}) m/s`);
  lines.push(noTruth() ? `행간 지연 추정 (ms; 모델 진값 없음)` : `행간 지연 추정/모델 진값 (ms)`);
  for (const p of parts) lines.push(`  ${noTruth() ? p.replace(/\/[-\d.]+$/, '/–') : p}`);
  return lines;
}

// Feasibility chips: can the local PWV be measured with this array geometry + capacitance sampling rate?
//   τ_total = (rows−1)·pitch / PWV (model)  vs  Ts = 1/fs_cap
//   ≥ 2·Ts  → sample-level resolution (plain peak/foot timing works)
//   ≥ 0.2·Ts → needs sub-sample estimation (beat ensemble + Taylor/parabolic), as implemented here
//   <  0.2·Ts or rows<2 → not measurable
function updatePwvChips() {
  const el = $('pwvChips'); if (!el) return;
  const rows = engine.capArray.rowCount(), baseline = engine.capArray.alongExtent_mm(), pwv = engine.capArray._localPWV();
  const fs = engine.latest.capSampleRate_Hz || engine.capArray.sampleRate_Hz, Ts = 1000 / fs; // ms
  const tau = rows >= 2 ? (baseline / 1000) / pwv * 1000 : 0; // ms
  // Result-only chips (details available in the Δt table footer and on hover)
  const chips = [];
  const detail = `기준선 ${baseline.toFixed(1)} mm · Δt ${tau.toFixed(2)} ms · 샘플 주기 ${Ts.toFixed(2)} ms (fs ${fs} Hz) · 모델 PWV ${pwv.toFixed(1)} m/s`;
  // Fixed-width chips: constant label set + fixed significant digits, tabular numerals, min-width per chip
  if (rows < 2) chips.push({ cls: 'bad w1', text: 'PWV 추정 불가 (행 1개)', title: detail });
  else if (tau >= 2 * Ts) chips.push({ cls: 'ok w1', text: 'PWV 추정 가능 (모델 기준·샘플 분해능)', title: detail + ' — 모델 PWV 기반 휴리스틱 판정' });
  else if (tau >= 0.2 * Ts) chips.push({ cls: 'warn w1', text: 'PWV 추정 가능 (모델 기준·sub-sample)', title: detail + ' — 앙상블 + sub-sample 추정 필요 (트윈: 동시 샘플링·협대역 노이즈 가정)' });
  else chips.push({ cls: 'bad w1', text: 'PWV 추정 불가 (모델 기준·분해능 부족)', title: detail });
  if (noTruth() && rows >= 2 && lastFeat && lastFeat.pttLocal_ms != null) {
    const pwvStr = lastFeat.pwvLocal ? lastFeat.pwvLocal.toFixed(1).padStart(5, ' ') : '  –  ';
    chips.push({ cls: 'warn w2', text: `추정 PWV ${pwvStr} m/s · 오차 – (진값 없음)`, title: `실측 기록: 추정 PTT ${lastFeat.pttLocal_ms.toFixed(2)} ms — 비교할 모델 진값이 없음(정성 평가 전용)` });
  } else if (rows >= 2 && lastFeat && lastFeat.pttLocal_ms != null && tau > 0) {
    const err = (lastFeat.pttLocal_ms - tau) / tau * 100;
    const cls = Math.abs(err) <= 15 ? 'ok' : Math.abs(err) <= 40 ? 'warn' : 'bad';
    const pwvStr = lastFeat.pwvLocal ? lastFeat.pwvLocal.toFixed(1).padStart(5, ' ') : '  –  ';
    const errStr = (err >= 0 ? '+' : '−') + Math.abs(err).toFixed(0).padStart(3, ' ');
    chips.push({ cls: cls + ' w2', text: `추정 PWV ${pwvStr} m/s · 오차 ${errStr} %`, title: `추정 PTT ${lastFeat.pttLocal_ms.toFixed(2)} ms vs 모델 진값 ${tau.toFixed(2)} ms` });
  }
  el.innerHTML = localizeHTML(chips.map((c) => `<span class="chip ${c.cls}" title="${c.title || ''}">${c.text}</span>`).join(''));
}

// ---------- ⑤ Recording (export) & replay ----------
const recorder = new Recorder();
// replayMeasured: the recording is REAL patch data (eval/convert_measured.py, header.source === 'measured') — no
// reference BP exists, so nothing may be compared against the twin's cardiac set-point (auto-calibration off,
// "오차/진값" fields show 기준 없음). replayHold: ZOH factor from the recording's master clock to the engine's 16 kHz.
let replayer = null, replayFile = '', replayMeasured = false, replayHold = 1;
// ⑥ 라이브 센서 스트림 (ROADMAP §3-5). liveSource 가 있으면 엔진은 생성하지 않고, 브리지/장치가 보낸
// 프레임이 재생과 똑같은 경로로 엔진 링버퍼에 들어간다. 라이브에는 커프 기준값이 절대 없으므로
// `noTruth()` 가 참이 되어 실측 기록 재생과 **동일한** "진값 없음" 처리가 적용된다.
let liveSource = null, liveHold = 1, liveUrl = '';
const noTruth = () => replayMeasured || !!liveSource;
function recordingHeader() {
  const ca = engine.capArray;
  return { masterFs: SAMPLE_RATE, nCh: ca.channelCount(), capFs: ca.sampleRate_Hz, rows: ca.rows, cols: ca.cols, spacingMm: ca.spacingMm, sheetLateral_mm: ca.sheetLateral_mm, sheetAlong_mm: ca.sheetAlong_mm, sheetAngle_deg:ca.sheetAngle_deg, arteryLateralAdjust_mm:ca.arteryLateralAdjust_mm, arteryDepthAdjust_mm:ca.arteryDepthAdjust_mm,
    layout: ca.layout ? { name: ca.layout.name, sheetW: ca.layout.sheetW, sheetH: ca.layout.sheetH, electrodes: ca.layout.electrodes.map(({ x, y, w, h, shape, label }) => ({ x, y, w, h, shape, label })) } : null, imuFs: 1000,
    scenario: { sbp: engine.cardiac.sbp, dbp: engine.cardiac.dbp, hr: engine.cardiac.hr, rhythm: $('rhythm').value, posture: $('bodyPosture').value, arm: $('armPos').value, tone: engine.arteryToneScalar, stiff: engine.ageStiffness, contact: ca.contactPressure }, notes: '' };
}
function toggleRecording() {
  if (replayer) { setStatus('재생 중에는 기록할 수 없습니다'); return; }
  if (!recorder.active) { recorder.start(recordingHeader()); setStatus('● REC 0.0 s'); return; }
  const r = recorder.stop();
  const blob = new Blob([r.buffer], { type: 'application/octet-stream' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = recordingFilename(); document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  setStatus(`기록 저장 ${r.header.durationS.toFixed(1)} s · ${(r.buffer.byteLength / 1e6).toFixed(1)} MB`);
}
function setStatus(t) { if (menubar && menubar.setStatus) menubar.setStatus(t); }
function openReplayPicker() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.dtrec,application/octet-stream';
  inp.addEventListener('change', async () => { const f = inp.files && inp.files[0]; if (!f) return; try { const buf = await f.arrayBuffer(); startReplay(decodeRecording(buf), f.name); } catch (e) { setStatus('재생 실패: ' + (e && e.message || e)); } });
  inp.click();
}
function startReplay(rec, name) {
  if (liveSource) stopLive('기록 재생 시작');
  if (recorder.active) recorder.active = false;
  const h = rec.header;
  applySheetAngle(h.sheetAngle_deg||0);setRangeFromScenario('arteryLateral',h.arteryLateralAdjust_mm||0);setRangeFromScenario('arteryDepth',h.arteryDepthAdjust_mm||0);
  // Put the model/analysis into the recording's geometry so every view matches the recorded array
  if (h.layout) applyLayout(h.layout, h.layout.name || 'recording'); else { engine.call('capArray.setLayout', null); engine.call('capArray.configure', { rows: h.rows, cols: h.cols, spacingMm: h.spacingMm }); applyLayout(null); }
  engine.call('capArray.setSampleRate', h.capFs); engine.call('capArray.setSheetOffset', h.sheetLateral_mm, h.sheetAlong_mm); syncSheetUi();
  replayMeasured = h.source === 'measured';
  replayHold = Math.max(1, Math.round(SAMPLE_RATE / (h.masterFs || SAMPLE_RATE))); // measured recordings: master 2000 Hz → ×8 ZOH into the 16 kHz engine buffers
  // Twin recordings carry their scenario BP (the simulator's set-point = ground truth); a measured recording has NO truth —
  // the cardiac model is left as is and must never be read as "진값" (metrics show 기준 없음, auto-calibration is skipped).
  if (h.scenario && !replayMeasured) { if (h.scenario.sbp && h.scenario.dbp) engine.call('cardiac.setBP', h.scenario.sbp, h.scenario.dbp); if (h.scenario.hr) engine.call('cardiac.setHR', h.scenario.hr); }
  structuralReset();
  replayer = new Replayer(rec); replayFile = name || 'recording';
  engine.setRun({ replay: true }); // the engine stops generating; the recording drives its buffers
  setStatus(replayMeasured ? `▶ 실측 기록 재생 ${replayFile} 0.0 / ${replayer.duration.toFixed(1)} s — 기준 BP 없음(정성 평가 전용)` : `▶ 재생 ${replayFile} 0.0 / ${replayer.duration.toFixed(1)} s`);
  if (replayMeasured) console.info('[replay] 실측 기록:', h.notes || '', h.measured || {});
}
function stopReplay() { if (!replayer) return; replayer = null; replayMeasured = false; replayHold = 1; engine.setRun({ replay: false }); structuralReset(); setStatus('라이브 시뮬레이션'); }
window.__replay = { start: startReplay, stop: stopReplay, recorder, isMeasured: () => replayMeasured };
window.__engine = engine; // debug / headless harnesses: mode, mirror state, per-frame engine timing

// ---------- ⑥ 라이브 센서 스트림 (ROADMAP §3-5 · docs/LIVE_STREAM.md) ----------
// 브리지(server/dt_bridge.mjs)나 실제 장치가 DTSTM 바이너리 프레임을 ws:// 로 보내면, 재생과 **똑같은**
// 경로(엔진 링버퍼 ingest → TwinSource → 분석 코어)로 흘러간다. 알고리즘·코어는 한 줄도 바뀌지 않는다.
// 라이브에는 커프 기준값이 없으므로 `noTruth()` 가 켜지고, 실측 기록 재생과 동일한 "진값 없음" 처리를 받는다.
const liveBar = (() => {
  const el = document.createElement('div'); el.className = 'livebar hidden'; el.id = 'liveBar';
  el.innerHTML = localizeHTML('<span class="lv-dot"></span><span class="lv-state">–</span><span class="lv-url mono"></span>'
    + '<span class="lv-kv" title="스트림이 선언한 채널 수 · 정전용량 샘플레이트 · 단위"><span>스트림</span><b class="lv-fmt">–</b></span>'
    + '<span class="lv-kv" title="브리지 송신 시각 → 브라우저 디코드 (전송 지연; 같은 시계일 때만 유효) / 브리지 송신 → 분석 결과 (종단 지연)"><span>지연</span><b class="lv-lat">–</b></span>'
    + '<span class="lv-kv" title="seq 간격으로 센 전송 손실 · 큐 넘침으로 버린 프레임 · 늦게/중복 도착해 버린 프레임 · 샘플레이트 불일치로 버린 프레임 (어느 것도 보간하지 않음)"><span>손실</span><b class="lv-loss">–</b></span>'
    + '<span class="lv-warn"></span><button type="button" class="btn lv-stop">중지 (트윈으로)</button>');
  el.querySelector('.lv-stop').addEventListener('click', () => stopLive('사용자 중지'));
  return el;
})();

function updateLiveBar() {
  if (!liveSource) { liveBar.classList.add('hidden'); return; }
  const s = liveSource.stats, st = liveSource.status, h = liveSource.header || {};
  liveBar.classList.remove('hidden');
  const stateTxt = { connecting: '연결 중', connected: '연결됨', reconnecting: '재연결 중', stalled: '스트림 정지', error: '오류', closed: '종료됨', idle: '대기' }[st] || st;
  liveBar.dataset.state = st;
  liveBar.querySelector('.lv-state').textContent = translateUI(st === 'stalled' ? `스트림 정지 ${(s.stallMs / 1000).toFixed(1)} s` : stateTxt);
  liveBar.querySelector('.lv-url').textContent = translateUI(liveUrl);
  liveBar.querySelector('.lv-fmt').textContent = translateUI(h.capFs ? `${h.nCh}ch · ${h.capFs} Hz · ${h.units || 'pF'}${h.sampleFormat === 'i32' ? ' · i32' : ''}` : '–');
  const lat = s.latencyMs == null ? (s.clockSuspect ? '시계 불일치' : '–') : `${s.latencyMs.toFixed(0)} ms`;
  const e2e = s.resultLatencyMs == null ? '–' : `${s.resultLatencyMs.toFixed(0)} ms`;
  liveBar.querySelector('.lv-lat').textContent = translateUI(`${lat} / ${e2e}${Math.abs(s.driftMs) > 250 ? ` (지연 누적 ${(s.driftMs / 1000).toFixed(1)} s)` : ''}`);
  liveBar.querySelector('.lv-loss').textContent = translateUI(`${s.lost} / ${s.dropped} / ${s.late}${s.mismatched ? ` / fs ${s.mismatched}` : ''}`);
  const warn = [];
  if (liveSource.mismatch && liveSource.mismatch.length) warn.push(...liveSource.mismatch);
  if (s.reconnects) warn.push(`재연결 ${s.reconnects}회`);
  if (liveSource.detail && (st === 'reconnecting' || st === 'error' || st === 'stalled')) warn.push(liveSource.detail);
  liveBar.querySelector('.lv-warn').textContent = translateUI(warn.join(' · '));
}

// The stream header decides the array geometry, the channel count and the wire rate — exactly what a
// `.dtrec` header decides for a replay. A rate that does not divide the 16 kHz master clock cannot be
// zero-order-held onto it, so it is REFUSED rather than resampled (see docs/LIVE_STREAM.md §4).
function applyStreamHeader(h) {
  const k = SAMPLE_RATE / h.capFs;
  if (!(h.capFs > 0) || Math.abs(k - Math.round(k)) > 1e-9 || k < 1) {
    setStatus(`라이브 스트림 거부: capFs ${h.capFs} Hz 는 마스터 클록 ${SAMPLE_RATE} Hz 를 정수 분주하지 않습니다 (재샘플링하지 않음)`);
    stopLive('샘플레이트 불가');
    return;
  }
  liveHold = Math.round(k);
  if (h.layout && h.layout.electrodes) applyLayout(h.layout, h.layout.name || 'live');
  else { engine.call('capArray.setLayout', null); if (h.rows && h.cols) engine.call('capArray.configure', { rows: h.rows, cols: h.cols, spacingMm: h.spacingMm || engine.capArray.spacingMm }); applyLayout(null); }
  engine.call('capArray.setSampleRate', h.capFs);
  if (h.sheetLateral_mm != null) engine.call('capArray.setSheetOffset', h.sheetLateral_mm, h.sheetAlong_mm != null ? h.sheetAlong_mm : engine.capArray.sheetAlong_mm);
  syncSheetUi();
  const ca = engine.capArray;
  liveSource.configure({ capFs: h.capFs, nCh: engine.capArray.channelCount(), layoutId: ca.layout ? layoutIdOf(ca.layout) : 0 });
  structuralReset();
  updateLiveBar();
  console.info('[live] stream header', h);
}

async function startLive(url) {
  if (replayer) stopReplay();
  if (recorder.active) recorder.active = false;
  if (liveSource) stopLive('재연결');
  liveUrl = url;
  liveSource = new WebSocketSource(url, {});
  liveSource.onHeader((h) => applyStreamHeader(h));
  // A gap (reconnect / loss / backpressure drop / re-configure) means the ring buffer no longer holds a
  // continuous stretch of signal — every analysis window that straddles the hole is void, so drop them.
  liveSource.onGap((reason) => { structuralReset(); setStatus(`라이브 스트림 불연속(${reason}) — 분석 창 재축적`); });
  liveSource.onStatus(() => updateLiveBar());
  engine.setRun({ replay: true }); // the twin stops generating; the device drives the buffers
  setStatus(`라이브 스트림 연결 중… ${url}`);
  updateLiveBar();
  await liveSource.start();
  setStatus(liveSource.status === 'connected' ? `● 라이브 스트림 ${url} — 기준 BP 없음(커프 수동 입력)` : `라이브 스트림 ${liveSource.status}: ${liveSource.detail || ''}`);
  updateLiveBar();
}

function stopLive(why = '') {
  if (!liveSource) return;
  try { liveSource.stop(); } catch (_) {}
  liveSource = null; liveHold = 1; liveUrl = '';
  liveBar.classList.add('hidden');
  if (!replayer) { engine.setRun({ replay: false }); structuralReset(); }
  setStatus(`라이브 스트림 중지${why ? ` (${why})` : ''} — 트윈 시뮬레이션으로 복귀`);
}

function promptLive() {
  const url = window.prompt(translateUI('라이브 센서 스트림 WebSocket 주소'), liveUrl || DEFAULT_BRIDGE_URL);
  if (!url) return;
  const u = liveUrlFromParam(url);
  if (!u) { setStatus(`알 수 없는 스트림 주소: ${url}`); return; }
  startLive(u);
}
window.__live = { start: startLive, stop: stopLive, source: () => liveSource, describe: () => (liveSource ? liveSource.describe() : null) };

// ---------- 시나리오 프리셋 + 타임라인 스크러버 (ROADMAP §2.3-13) ----------
// The player only drives the knobs the UI already owns (sliders/selects), so the scenario, the
// controls and the model can never disagree; see js/scenarioPlayer.js for the keyframe model and
// for why a scrub RE-SEEDS instead of pretending to rewind a real-time simulator.
function setRangeFromScenario(id, v) {
  const el = $(id); if (!el || v == null || !isFinite(v)) return;
  const prev = el.value; el.value = String(v);
  if (el.value !== prev) el.dispatchEvent(new Event('input'));
}
function setSelectFromScenario(id, v) {
  const el = $(id); if (!el || v == null || el.value === v) return;
  if (![...el.options].some((o) => o.value === v)) return;
  el.value = v; el._dd?.refresh(); el.dispatchEvent(new Event('change'));
}
const scenario = new ScenarioPlayer({
  apply: (v) => {
    setSelectFromScenario('bodyPosture', v.posture);
    setSelectFromScenario('armPos', v.arm);
    setRangeFromScenario('hr', v.hr); setRangeFromScenario('sbp', v.sbp); setRangeFromScenario('dbp', v.dbp);
    setRangeFromScenario('sv', v.sv); setRangeFromScenario('tpr', v.tpr);
    setRangeFromScenario('tone', v.tone); setRangeFromScenario('stiff', v.stiff);
    setRangeFromScenario('contact', v.contact);
    setRangeFromScenario('respRate', v.respRate); setRangeFromScenario('respDepth', v.respDepth); setRangeFromScenario('pulsus', v.pulsus);
  },
  onReseed: (t) => {
    // Honest jump: no rewind, no fast-forward — apply the scenario state at t and drop every window
    // that would otherwise mix the pre-jump and post-jump physiology. Cuff calibration is kept.
    structuralReset(); resetCumErr();
    scenarioBar.setState(`재시드 t=${t.toFixed(1)} s — 분석 창 재축적 중`);
    setStatus(`시나리오 재시드 t=${t.toFixed(1)} s (신호 이력·분석 창 리셋, 캘리브레이션 유지)`);
  },
});
const scenarioBar = buildScenarioBar({
  player: scenario,
  speeds: SIM_SPEED,
  getSpeed: () => simSpeed,
  setSpeed: (key) => { setSimSpeed(SIM_SPEED[key] ?? 1); const r = document.querySelector(`input[name="vizSmooth"][value="${key}"]`); if (r) r.checked = true; },
  enhance: (sel) => enhanceSelect(sel),
});
menubar.bar.parentNode.insertBefore(scenarioBar.bar, menubar.bar.nextSibling);
menubar.bar.parentNode.insertBefore(liveBar, menubar.bar.nextSibling); // ⑥ 라이브 스트림 상태줄 (메뉴바 바로 아래)
for (const r of document.querySelectorAll('input[name="vizSmooth"]')) {
  r.addEventListener('change', (e) => { if (e.target.checked && scenarioBar.speedSel.value !== e.target.value) { scenarioBar.speedSel.value = e.target.value; scenarioBar.speedSel._dd?.refresh(); } });
}
function loadScenario(name) {
  if (!SCENARIOS[name]) return false;
  scenarioBar.show(true);
  scenario.load(name);
  structuralReset(); resetCumErr(); // the scenario's t = 0 state is applied at once → same re-seed rule as a scrub
  scenarioBar.setState('t=0 재시드 — 분석 창 재축적 중');
  setStatus(`시나리오 ${SCENARIOS[name].label} 시작 (재생 ×${simSpeed})`);
  return true;
}

// ---------- 데이터 내보내기 (ROADMAP §2.3-14) ----------
const exportBuf = new ExportBuffer({ maxWindows: 40000, rawSeconds: 60 });
let lastCalib = null; // { sbp, dbp, t, source }
function exportMeta() {
  const ca = engine.capArray, c = engine.cardiac, h = c.hemodynamics();
  return {
    app: { title: document.title, url: location.href, masterFs_Hz: SAMPLE_RATE, engine: lastEngine || 'unknown', analysisMode: analysis.mode, signalEngineMode: engine.mode },
    array: { rows: ca.rows, cols: ca.cols, spacingMm: ca.spacingMm, capFs_Hz: ca.sampleRate_Hz, channels: ca.channelCount(),
      sheetLateral_mm: ca.sheetLateral_mm, sheetAlong_mm: ca.sheetAlong_mm, sheetAngle_deg:ca.sheetAngle_deg, arteryLateralAdjust_mm:ca.arteryLateralAdjust_mm, arteryDepthAdjust_mm:ca.arteryDepthAdjust_mm, layout: ca.layout ? { name: activeLayoutName, sheetW: ca.layout.sheetW, sheetH: ca.layout.sheetH, electrodes: ca.layout.electrodes.map(({ x, y, w, h: hh, shape, label }) => ({ x, y, w, h: hh, shape, label })) } : null,
      contactPressure: ca.contactPressure, nonlinZeta_perMmHg: ca.nonlinZeta_perMmHg, curvatureConformity: ca.curvatureConformity, noiseModel: ca.noiseModel, artifacts: { ...ca.artifacts } },
    body: engine.body ? { ...engine.body } : { height_cm: parseFloat($('height').value), weight_kg: parseFloat($('weight').value) },
    cardiac: { rhythm: $('rhythm').value, drive: c.drive, sbp: c.sbp, dbp: c.dbp, hr: c.hr, sv_mL: h.sv_mL, tpr: h.tpr, co_L_min: h.co_L_min, compliance_mL_mmHg: h.compliance_mL_mmHg,
      resp_bpm: c.respiration.rate_bpm, respDepth: c.respiration.depth, pulsusParadoxus_mmHg: c.pulsusParadoxus_mmHg,
      arteryToneScalar: engine.arteryToneScalar, ageStiffness: engine.ageStiffness },
    posture: { bodyPosture: $('bodyPosture').value, armPosition: $('armPos').value, armIdle: parseFloat($('idleArm').value), bodyIdle: parseFloat($('idleBody').value) },
    ppg: { fitzpatrick: engine.ppg.fitzpatrick, fingerTemp_C: engine.ppg.fingerTemp_C, artifacts: { ...engine.ppg.artifacts } },
    calibration: lastCalib ? { ...lastCalib, cuffModel: { biasS_mmHg: +CUFF.biasS.toFixed(2), biasD_mmHg: +CUFF.biasD.toFixed(2), sdS: CUFF.sdS, sdD: CUFF.sdD } } : null,
    scenario: scenario.active ? { name: scenario.name, label: SCENARIOS[scenario.name].label, note: SCENARIOS[scenario.name].note, t_s: +scenario.t.toFixed(2), duration_s: scenario.duration, keys: SCENARIOS[scenario.name].keys } : null,
    replay: replayer ? { file: replayFile, measured: replayMeasured, duration_s: replayer.duration } : null,
    // ⑥ 라이브 스트림 세션 (ROADMAP §3-5): 어떤 장치/브리지에서 어떤 품질로 들어온 데이터인지 기록에 남긴다.
    live: liveSource ? { url: liveUrl, status: liveSource.status, header: liveSource.header, hold: liveHold, stats: { ...liveSource.stats }, mismatch: liveSource.mismatch.slice() } : null,
    limitations: [
      '모든 신호·추정치는 파라메트릭 시뮬레이션 결과이며 임상 측정/검증이 아니다.',
      '추정기는 이 트윈의 생성 관계를 역산하므로 오차는 "모델 일치 상한"이다.',
      '원파형은 정전용량 샘플링 레이트로 데시메이션한 롤링 캡처(기본 최근 60 s)이며, 전체 세션 16 kHz 원본은 .dtrec 기록이다.',
      '실측 기록 재생·라이브 센서 스트림에는 기준 BP가 없어 true_* 열이 비어 있다.',
      '라이브 스트림에서는 손실/지연/중복 프레임을 보간하지 않고 버리며, 그 횟수는 live.stats 에 남는다 — 창 경계가 불연속일 수 있다.',
      'Parquet 은 브라우저에서 생성하지 않는다 — CSV/JSONL 을 pandas 로 읽어 변환할 것.',
    ],
  };
}
function openExport() { openExportDialog({ buffer: exportBuf, meta: exportMeta, onStatus: setStatus }); }
window.__export = { buffer: exportBuf, meta: exportMeta, open: openExport };
window.__scenario = { player: scenario, bar: scenarioBar, load: loadScenario, list: Object.keys(SCENARIOS) };

function loop(ts) { try { loopBody(ts); } catch (e) { console.error('[loop] error', e && e.stack || e); requestAnimationFrame(loop); } }
function loopBody(ts) {
  const dt = Math.max(0, (ts - lastTs) / 1000); lastTs = ts;
  const tPrev = engine.t;
  if (replayer && !paused) {
    // Replay: recorded frames are written into the engine's ring buffers at the recording's own pace
    // (in Worker mode as an `ingest` command — the .dtrec arrays are re-read every loop, so they are
    // posted as copies rather than transferred).
    for (const fr of replayer.next(dt * simSpeed)) engine.ingestFrame(replayHold > 1 ? holdFrame(fr, replayHold) : fr, replayer.header.capFs);
  }
  // ⑥ Live stream: exactly the same ingest, except the pace is the DEVICE's (the source is push-driven,
  // so `take()` returns whatever arrived since the last display frame — no simSpeed, a live stream has
  // no playback speed). While paused nothing is drained: the source's bounded queue then overflows and
  // reports the drop, which is the honest outcome — it never holds or interpolates samples.
  if (liveSource && !paused) {
    const capFs = liveSource.header ? liveSource.header.capFs : engine.capArray.sampleRate_Hz;
    for (const fr of liveSource.take()) engine.ingestFrame(liveHold > 1 ? holdFrame(fr, liveHold) : fr, capFs);
  }
  // Take the newest render packet from the engine and drain its analysis frames (TwinSource is a pure
  // pass-through of `engine.pump()` + `engine.takeFrames()` — server/dt_bridge_test.mjs proves the
  // resulting frame stream is byte-identical to calling the engine client directly).
  twinSource.pump(dt);
  if (liveSource) {
    if (frame % 6 === 0) updateLiveBar();
    if (frame % 15 === 0) {
      const s = liveSource.stats;
      setStatus(`● 라이브 ${liveUrl} · ${liveSource.status === 'connected' ? '연결됨' : liveSource.status === 'reconnecting' ? '재연결 중' : liveSource.status === 'stalled' ? `정지 ${(s.stallMs / 1000).toFixed(1)} s` : liveSource.status}`
        + ` · 지연 ${s.latencyMs == null ? '–' : s.latencyMs.toFixed(0) + ' ms'} · 손실 ${s.lost}/드롭 ${s.dropped} — 기준 BP 없음`);
    }
  } else if (replayer) {
    if (frame % 15 === 0) setStatus(`▶ ${replayMeasured ? '실측 기록 ' : ''}재생 ${replayFile} ${replayer.position.toFixed(1)} / ${replayer.duration.toFixed(1)} s${replayer.loop ? ' (반복)' : ''}${replayMeasured ? ' — 기준 BP 없음' : ''}`);
  } else if (!paused && scenario.active) {
    // Scenario keyframes advance by the sim time the ENGINE actually produced (it owns the clock
    // now), so slow-motion playback and a stalled frame slow/skip the scenario identically.
    scenario.update(Math.max(0, engine.t - tPrev));
  }
  if (recorder.active && frame % 15 === 0) setStatus(`● REC ${recorder.seconds().toFixed(1)} s · ${(recorder.bytes / 1e6).toFixed(1)} MB`);
  const L = engine.latest;
  if (!L.angles) { requestAnimationFrame(loop); return; }

  // Avatar
  const lastP = engine.lastRadialP;
  const hydro = L.hydrostatic_mmHg || 0;
  const pulseNorm = Math.max(0, Math.min(1, (lastP - hydro - engine.cardiac.dbp) / Math.max(1, engine.cardiac.sbp - engine.cardiac.dbp)));
  let gridNorm = null;
  if (L.lastGrid) {
    let lo = Infinity, hi = -Infinity;
    for (const r of L.lastGrid) for (const v of r) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const span = hi - lo || 1;
    gridNorm = L.lastGrid.map((r) => r.map((v) => (v - lo) / span));
  }
  // Per-site pulse phases (0..1) from the cardiac model with each segment's transit delay,
  // so heart → upper arm → wrist → finger visibly propagate in the avatar.
  const ppC = Math.max(1, engine.cardiac.sbp - engine.cardiac.dbp);
  const pulseAtDelay = (d) => Math.max(0, Math.min(1, (engine.cardiac.pressureAt(engine.t - d) - engine.cardiac.dbp) / ppC));
  const sitePulse = {
    heart: pulseAtDelay(0),
    brachial: pulseAtDelay(cumulativeDelay_s(BRACHIAL_IDX, engine.arteryToneScalar, engine.ageStiffness, engine.pwvGain)),
    radial: pulseAtDelay((L.radialPulseDelay_ms || 0) / 1000),
    finger: pulseAtDelay((L.fingerPulseDelay_ms || 0) / 1000),
  };
  if (avatar && viewVisible.avatar && $('avatar').clientHeight>0) {
    avatar.setElectrodeLayout(engine.capArray.rows, engine.capArray.cols, engine.capArray.spacingMm, engine.capArray.sheetLateral_mm - WRIST_ANATOMY.ARTERY_BASE_LATERAL_MM, 0);
    avatar.update(L.angles, sitePulse, gridNorm, L.torso, L);
  }

  // Stream the newest samples to the analysis system (Worker); results arrive via analysis.onResult.
  // The frames are built by the engine (Worker) and handed on as TRANSFERABLES, so a 16 kHz block is
  // never copied on the UI thread — it only changes owner engine Worker → UI → analysis Worker.
  // Every packet's frame must be consumed: dropping one would punch a hole in the analysis stream.
  for (const fr of twinSource.take()) {
    if (recorder.active) recorder.push(fr);
    if (exportBuf.rawOn) exportBuf.pushRaw(fr, fr.startTotal, Math.max(1, Math.round(SAMPLE_RATE / engine.capArray.sampleRate_Hz)), SAMPLE_RATE); // rolling raw capture (§2.3-14)
    analysis.pushFrame(fr);
  }
  if (!autoCalDone && !noTruth() && engine.t > 5 && lastFeat) { const c = window.__autoCuffMean ? window.__autoCuffMean() : { sbp: engine.cardiac.sbp, dbp: engine.cardiac.dbp }; doCalibrate(c.sbp, c.dbp, 'auto-simulated-cuff-3x'); }
  // Smooth, real-time waveforms: the strips and the MRC-combined trace are rebuilt EVERY frame from
  // the engine's local 16 kHz buffers using the latest beamformer weights from the analysis API; only
  // the slow quantities (SNR, weights, beam search, estimates) come from the 4–10 Hz results.
  if (frame % 2 === 1) {
    const chans = engine.chans;
    if (chans.length && chans[0].length) {
      const L = chans[0].length, nCh = chans.length;
      // Weights from the analysis API arrive at ~8 Hz; smooth them (EMA) so the combined trace does not
      // re-mix abruptly at every result, and apply the same per-channel delay alignment the beamformer used
      // (chanDelay_samples at 500 Hz = this window's rate), otherwise unaligned channels smear the upstroke.
      const wNew = (lastAnalysis && lastAnalysis.weights && lastAnalysis.weights.length === nCh) ? lastAnalysis.weights : null;
      if (!uiWeights || uiWeights.length !== nCh) uiWeights = wNew ? wNew.slice() : new Array(nCh).fill(1 / nCh);
      else if (wNew) for (let i = 0; i < nCh; i++) uiWeights[i] += 0.25 * (wNew[i] - uiWeights[i]);
      const w = uiWeights;
      const dly = (lastAnalysis && lastAnalysis.chanDelay_samples && lastAnalysis.chanDelay_samples.length === nCh) ? lastAnalysis.chanDelay_samples : null;
      const combined = new Float32Array(L);
      for (let i = 0; i < nCh; i++) {
        const wi = w[i]; if (!wi) continue; const x = chans[i]; let m = 0; for (let s = 0; s < L; s++) m += x[s]; m /= L;
        const d = dly ? dly[i] : 0; // channel i is late by d samples → advance it by d (linear interpolation)
        for (let s = 0; s < L; s++) { const p = Math.min(L - 1, Math.max(0, s + d)); const i0 = Math.floor(p), i1 = Math.min(L - 1, i0 + 1), f = p - i0; combined[s] += wi * ((x[i0] * (1 - f) + x[i1] * f) - m); }
      }
      const refRaw = engine.win('radialP');
      let ref = null; if (refRaw.length === L) { let m = 0; for (let s = 0; s < L; s++) m += refRaw[s]; m /= L; ref = new Float32Array(L); for (let s = 0; s < L; s++) ref[s] = refRaw[s] - m; }
      multiScope.draw({
        rows: engine.capArray.rows, cols: engine.capArray.cols, channels: chans,
        snrDb: lastAnalysis ? lastAnalysis.trueSnr_db : null, weights: w,
        combined, oracle: null, ref,
        combinedGain: lastAnalysis ? lastAnalysis.combinedGain : 1, oracleGain: 0,
        bestIdx: lastAnalysis ? lastAnalysis.bestIdx : 0,
        metrics: lastAnalysis ? { mrcSnr_db: lastAnalysis.mrcSnr_db, bestSnr_db: lastAnalysis.bestSnr_db, oracleSnr_db: lastAnalysis.oracleSnr_db, corrMrc: lastAnalysis.corrMrc, bestIdx: lastAnalysis.bestIdx } : null,
        infoLines: rowDelayText(),
        infoTo: $('capInfo'),
        tEnd: engine.t, windowSec: CHAN_WINDOW[0], dtSample: CHAN_DT, // 스캔바 표시
      });
    }
  }
  if (wristView && viewVisible.wrist3d && $('wrist3d').clientHeight>0) {
    wristView.setLayout(engine.capArray.rows, engine.capArray.cols, engine.capArray.spacingMm, engine.capArray.layout);
    let chNorm = null;
    if (L.capLast && L.capLast.length) {
      let lo = Infinity, hi = -Infinity; for (const v of L.capLast) { if (v < lo) lo = v; if (v > hi) hi = v; }
      const span = hi - lo || 1; chNorm = Float32Array.from(L.capLast, (v) => (v - lo) / span);
    }
    // Pulse value `d` seconds before "now" at the proximal end of the shown wrist segment
    const arrival = (L.radialPulseDelay_ms || 0) / 1000, pp = Math.max(1, engine.cardiac.sbp - engine.cardiac.dbp);
    const pulseFn = (d) => (engine.cardiac.pressureAt(engine.t - arrival - d) - engine.cardiac.dbp) / pp;
    wristView.update(L.arteryOffset, chNorm, lastAnalysis ? lastAnalysis.trueSnr_db : null, sitePulse.radial, pulseFn, L.tissue, !paused);
  }

  // Charts (throttle heavier draws to every other frame)
  if (frame % 2 === 0) {
    scopes.pressure.draw([engine.win('aorticP'), engine.win('brachialP'), engine.win('radialP'), engine.win('fingerP')], engine.t, winDt('aorticP'));
    scopes.velocity.draw([engine.win('radialV'), engine.win('venousV')], engine.t, winDt('radialV'));
    scopes.ppg.draw([engine.win('ppgRed'), engine.win('ppgIr')], engine.t, winDt('ppgRed'));
    scopes.spo2.draw([engine.win('spo2'), spo2Hist.subarray(0, spo2HistN)], engine.t, winDt('spo2'));
  } else {
    scopes.emg.draw([engine.win('biceps_brachii'), engine.win('deltoid'), engine.win('flexor_carpi_radialis'), engine.win('pronator_teres')], engine.t);
    scopes.acc.draw([engine.win('accX'), engine.win('accY'), engine.win('accZ')], engine.t, winDt('accX'));
    scopes.gyr.draw([engine.win('gyrX'), engine.win('gyrY'), engine.win('gyrZ')], engine.t, winDt('gyrX'));
    // Artery position relative to the sheet centre (absolute artery lateral − sheet lateral)
    const dg = displayGrid();
    const cv = customViz();
    if (dg) arrayViz.draw(dg, { ...snapshotScale(dg), arteryPath:engine.capArray.arteryPathOnPatch(L.arteryOffset), arteryLateral_mm: engine.capArray.arteryAt(engine.capArray.sheetAlong_mm,L.arteryOffset).lateral-engine.capArray.sheetLateral_mm, spacingMm: cv ? cv.cellMm : engine.capArray.spacingMm, estLateral_mm: lastBeamSearch ? lastBeamSearch.xHat : null, custom: cv });
    // Timing map: per-electrode arrival delay vs the proximal row (measured) and the model truth
    {
      const pwv = engine.capArray._localPWV();
      const rows=engine.capArray.rowCount(),cols=engine.capArray.layout?.cols||engine.capArray.cols;
      const positions=engine.capArray.electrodePositions_mm(),origin=Math.min(...positions.map(p=>p.along_mm));
      const model=positions.map(p=>(p.along_mm-origin)/pwv);
      timingGrid.draw({ rows, cols, measured: lastFeat ? lastFeat.chanDelays_ms : null, model, pwv, spacingMm: engine.capArray.spacingMm, capFs: L.capSampleRate_Hz,
        arteryPath:engine.capArray.arteryPathOnPatch(L.arteryOffset), arteryLateral_mm: engine.capArray.arteryAt(engine.capArray.sheetAlong_mm,L.arteryOffset).lateral-engine.capArray.sheetLateral_mm, estLateral_mm: lastBeamSearch ? lastBeamSearch.xHat : null, custom: cv });
    }
  }

  if (frame % 30 === 1) updatePwvChips();
  // Timeline scrubber: cheap progress update every 3rd frame, driven-value read-out every 0.5 s
  if (scenario.active) {
    if (frame % 3 === 0) scenarioBar.tick();
    if (frame % 30 === 2) {
      const v = scenario.valuesAt(scenario.t), p = [];
      if (v.sbp != null) p.push(`대본 BP ${v.sbp.toFixed(0)}/${(v.dbp ?? 0).toFixed(0)}`);
      if (v.hr != null) p.push(`HR ${v.hr.toFixed(0)}`);
      if (v.tone != null) p.push(`tone ${v.tone.toFixed(2)}`);
      if (v.stiff != null) p.push(`stiff ${v.stiff.toFixed(2)}`);
      if (v.contact != null) p.push(`접촉 ${v.contact.toFixed(2)}`);
      if (v.respRate != null) p.push(`호흡 ${v.respRate.toFixed(0)}`);
      if (v.posture) p.push(BODY_POSTURES[v.posture] ? BODY_POSTURES[v.posture].label : v.posture);
      if (v.arm) p.push(ARM_POSITIONS[v.arm] ? ARM_POSITIONS[v.arm].label : v.arm);
      scenarioBar.setState(p.join(' · '));
    }
  }

  // Metrics
  if (frame % 6 === 0) {
    const sgn = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}`;
    // 큰 숫자 칸(34 px)에는 자리표시자만 두고, 사유는 아래 작은 줄에 쓴다 — 긴 안내문이 숫자 칸을
    // 차지하면 카드가 흔들리고 읽기도 나쁘다(2026-08-25 사용자 요청).
    const waiting = '–/–';
    const waitNote = calibrated ? '추정 준비 중…'
      : noTruth() ? '커프 값을 직접 입력하세요 (실측 기록 — 진값 없음)'
      : (engine.t < 5 ? `커프 캘리브레이션 대기 ${Math.max(0, 5 - engine.t).toFixed(0)}s` : '커프 캘리브레이션 필요');
    // Cumulative mean ABSOLUTE error (mmHg) since the last calibration vs the simulator's set-point BP —
    // a simulation error under model-matched conditions, NOT a clinical accuracy figure.
    const cumText = (acc, est) => {
      if (!est) return '–';
      if (noTruth()) return '기준 없음'; // real patch recording: no reference BP to accumulate an error against
      acc.n++; acc.s += Math.abs(est.sbp - engine.cardiac.sbp); acc.d += Math.abs(est.dbp - engine.cardiac.dbp);
      acc.bs += est.sbp - engine.cardiac.sbp; acc.bd += est.dbp - engine.cardiac.dbp;
      const s = acc.s / acc.n, d = acc.d / acc.n;
      // 단위는 같은 줄 앞머리의 "mmHg" 가 이미 말해 준다 — 뒤에 한 번 더 붙이면 열(≈164 px)을 넘어
      // 옆 열로 삐져나온다(2026-08-25 사용자 보고). 툴팁에는 단위가 그대로 남아 있다.
      return { text: `시뮬 오차 ±${s.toFixed(1)} / ±${d.toFixed(1)}`, cls: Math.max(s, d) <= 5 ? 'good' : Math.max(s, d) <= 8 ? 'warn' : 'bad', title: `캘리브레이션 이후 n=${acc.n} · MAE SBP ${s.toFixed(1)} / DBP ${d.toFixed(1)} mmHg (시뮬레이터 진값 대비, 모델 일치 조건) · 평균 편향 ${(acc.bs / acc.n).toFixed(1)} / ${(acc.bd / acc.n).toFixed(1)} mmHg` };
    };
    const setCum = (id, r) => { const el = $(id); if (!el) return; if (typeof r === 'string') { el.textContent = translateUI(r); el.className = 'cum'; return; } el.textContent = translateUI(r.text); el.className = 'cum ' + r.cls; el.title = translateUI(r.title); };
    setCum('m-capcum', lastEstCap ? cumText(cumErr.cap, lastEstCap) : waitNote);
    setCum('m-ppgcum', lastEstPpg ? cumText(cumErr.ppg, lastEstPpg) : waitNote);
    // Estimator confidence (0–1, from the Rust/JS estimator: posterior MAP SD × window quality × calibration quality ×
    // hold decay) and the clamp flag. Shown next to the error so a low-confidence/clamped value is not read as a measurement.
    const setErr = (errId, confId, est) => {
      const e = $(errId), c = $(confId); if (!e) return;
      const errTxt = noTruth() ? '–/기준 없음' : `${sgn(est.sbp - engine.cardiac.sbp)}/${sgn(est.dbp - engine.cardiac.dbp)}`;
      if (!c) { e.textContent = translateUI(errTxt); return; }
      e.firstChild && e.firstChild.nodeType === 3 ? (e.firstChild.textContent = translateUI(errTxt + ' ')) : e.insertBefore(document.createTextNode(translateUI(errTxt + ' ')), c);
      const conf = typeof est.confidence === 'number' ? est.confidence : null;
      const clamped = !!est.clamped;
      c.textContent = translateUI(conf == null ? '' : `c${conf.toFixed(2)}${clamped ? ' ⚠' : ''}`);
      c.className = 'conf ' + (conf == null ? '' : conf >= 0.4 ? 'good' : conf >= 0.15 ? 'warn' : 'bad');
      if (est.mapSd_mmHg != null) c.title = translateUI(`신뢰도 ${conf == null ? '–' : conf.toFixed(2)} · 사후 MAP SD ${est.mapSd_mmHg.toFixed(0)} mmHg${clamped ? ' · 생리 범위로 클램프됨' : ''} — 0–1 = 사후 MAP SD × 창 품질 × 캘리브레이션 품질 × 홀드 감쇠`);
    };
    // ---- 교차모달 고장 검출 칩 (docs/CLINICAL_AUDIT.md §6.17) — 표시 전용 ----
    // 플래그가 서면 해당 추정기의 신뢰도는 이미 코어가 낮춰 놓았으므로 여기서는 계산하지 않고 보여주기만 한다.
    // 이 검출기들은 시뮬레이션 모델 안에서의 일관성 위반(캘리브레이션 시점 대비 z-점수)이지 임상 진단이 아니다.
    renderFaultChips();
    // Attachment-state chip (sheet re-placement monitor, rust attach.rs → result.attach): 안정 / 과도 / 시트 이동 / 분리됨;
    // while a re-calibration is required the cuff button pulses (the array estimate is a HELD value, confidence × 0.1)
    {
      const el = $('m-capattach'), a = lastAttach;
      if (el) {
        const dx = a && a.lateralShift_mm != null ? `${a.lateralShift_mm >= 0 ? '+' : ''}${a.lateralShift_mm.toFixed(1)} mm` : '–';
        const contact = !!(a && a.contactChange); // contact-pressure change flag (warn only: confidence × 0.7, no hold)
        // 혈압 숫자와 같은 줄에 놓이므로 칩은 최대한 짧게 — 전체 문구는 title 과 어레이 카드 정보줄에 있다
        // (2026-08-25 사용자 요청: 폭 축소).
        const txt = !a || a.state === 'uncalibrated' ? '–' : a.state === 'stable' ? (contact ? '접촉' : '안정') : a.state === 'transient' ? '과도' : a.state === 'shifted' ? `이동 ${dx}` : '분리';
        el.textContent = translateUI(txt);
        el.className = 'att ' + (!a || a.state === 'uncalibrated' ? '' : a.state === 'stable' ? (contact ? 'warn' : 'good') : a.state === 'transient' ? 'warn' : 'bad');
        if (a) el.title = translateUI(`부착 상태 ${a.state}${a.motion ? ' (동작 게이트)' : ''}${contact ? ' · 접촉 변화 감지(공통모드 DC 변화, 경고만: 신뢰도 ×0.7)' : ''} · 이동 점수 ${a.shiftScore.toFixed(2)} · Δx̂ ${dx} (임계 ${a.xThr_mm != null ? a.xThr_mm.toFixed(1) : '1.5'} mm) · 결합 패턴 유사도 ${a.patternSim != null ? a.patternSim.toFixed(3) : '–'} (허용 강하 ${a.simThr != null ? a.simThr.toFixed(2) : '0.10'}) · 진폭비 ${a.ampRatio != null ? a.ampRatio.toFixed(2) : '–'} · 기저선 스텝 ${a.baselineStep.toFixed(1)} A · 접촉지수 ${a.contactIdx != null ? (a.contactIdx >= 0 ? '+' : '') + a.contactIdx.toFixed(2) + ' A' : '–'}${a.sinceEvent_s != null ? ` · 이벤트 후 ${a.sinceEvent_s.toFixed(0)} s` : ''} — 캘리브레이션 시점 대비 빔서치 x̂(1차 증거)·결합 패턴·진폭 잔차·DC 스텝(보강 증거); 임계 = max(설계 바닥 1.5 mm / 유사도 0.1, 3×세션 자체 변동). 시트 이동/분리 시 어레이 BP는 마지막 유효값 홀드(신뢰도 ×0.1), 커프 재캘리브레이션 전까지 기준선 자동 재설정 없음`);
        // 7차(§6.24): 광학 변화에 의한 재캘리브레이션 요구도 같은 칩을 쓴다 (기존 시트 이동/분리와 동일한 신호)
        $('calib').classList.toggle('recal', !!(a && a.recalRequired) || !!(lastEstPpg && lastEstPpg.recalRequired));
      }
    }
    if (lastEstCap) {
      $('m-capbp').textContent = translateUI(`${lastEstCap.sbp.toFixed(0)}/${lastEstCap.dbp.toFixed(0)}`);
      $('m-capmap').textContent = translateUI(lastEstCap.map.toFixed(0));
      setErr('m-caperr', 'm-capconf', lastEstCap);
      $('m-capx').textContent = translateUI(lastEstCap.x.toFixed(2));
      $('m-cappwv').textContent = translateUI(lastEstCap.pwvLocal ? lastEstCap.pwvLocal.toFixed(1) : '–');
      $('m-captrefl').textContent = translateUI(lastEstCap.tRefl_ms != null ? lastEstCap.tRefl_ms.toFixed(0) : '–');
      // held/invalid estimates (estimator `_hold`/`_heldInvalid` before the first real estimate — e.g. right
      // after a scenario re-seed) carry no RI/PWV/tRefl cue, so every optional cue field must be guarded
      $('m-capri').textContent = translateUI(lastEstCap.ri != null ? lastEstCap.ri.toFixed(2) : '–');
    } else $('m-capbp').textContent = translateUI(waiting);
    if (lastEstPpg) {
      $('m-ppgbp').textContent = translateUI(`${lastEstPpg.sbp.toFixed(0)}/${lastEstPpg.dbp.toFixed(0)}`);
      $('m-ppgmap').textContent = translateUI(lastEstPpg.map.toFixed(0));
      setErr('m-ppgerr', 'm-ppgconf', lastEstPpg);
      $('m-ppgx').textContent = translateUI(lastEstPpg.x.toFixed(2));
      $('m-ppgtrefl').textContent = translateUI(lastEstPpg.tRefl_ms != null ? lastEstPpg.tRefl_ms.toFixed(0) : '–');
      $('m-ppgri').textContent = translateUI(lastEstPpg.ri != null ? lastEstPpg.ri.toFixed(2) : '–');
    } else $('m-ppgbp').textContent = translateUI(waiting);
    $('m-hr').textContent = translateUI(L.instantHR.toFixed(0));
    // Measured replay: the cardiac model's set-point is NOT the truth of a real recording — never display it as such
    $('m-bp').textContent = translateUI(noTruth() ? '진값 없음' : `${engine.cardiac.sbp.toFixed(0)}/${engine.cardiac.dbp.toFixed(0)}`);
    $('m-wristbp').textContent = translateUI(noTruth() ? '–' : `${(engine.cardiac.sbp + hydro).toFixed(0)}/${(engine.cardiac.dbp + hydro).toFixed(0)}`);
    syncHemoUi(); // SV/TPR/CO/C read-outs track tone·stiffness·HR (audit §6.13)
    updateDriftUi(); // 장기 혈관 드리프트 시계 읽기값 (audit §6.20; 시계가 꺼져 있으면 아무것도 표시하지 않음)
    $('m-hydro').textContent = translateUI((hydro >= 0 ? '+' : '') + hydro.toFixed(1));
    $('m-height').textContent = translateUI(L.wristDeltaH.toFixed(0));
    $('m-radial').textContent = translateUI(L.radialPulseDelay_ms.toFixed(0));
    $('m-finger').textContent = translateUI(L.fingerPulseDelay_ms.toFixed(0));
    $('m-spo2').textContent = translateUI(L.spo2.toFixed(1));
    updatePpgOptics(); // PPG 광학/관류 유도값(PI는 마지막 샘플에서 갱신) — 모델 가정 표시
    updateCapPhysics(); // 접촉압(압평/폐색/정맥 울혈)·곡률 이격·비선형 탄성 유도값 — 모델 가정 표시 (§6.15)
    $('m-motion').textContent = translateUI((L.motionLevel * 100).toFixed(0));
    const arteryHere=engine.capArray.arteryAt(engine.capArray.sheetAlong_mm,L.arteryOffset);$('m-art').textContent=translateUI(`${arteryHere.lateral.toFixed(1)} / ${arteryHere.depth.toFixed(1)}`);
    $('m-ang').textContent = translateUI(`${L.angles.shoulderAbd.toFixed(0)}° / ${L.angles.elbowFlex.toFixed(0)}° / ${L.angles.wristPron.toFixed(0)}°`);
    $('m-fs').textContent = translateUI(SAMPLE_RATE.toLocaleString());
    $('m-capfs').textContent = translateUI(Math.round(L.capSampleRate_Hz).toLocaleString());
    if (L.torso) $('m-sway').textContent = translateUI(`${(L.torso.pos[0] * 1000).toFixed(1)} / ${(L.torso.pos[2] * 1000).toFixed(1)}`);
    if (lastAnalysis) { $('w-snr').textContent = translateUI(lastAnalysis.bestSnr_db.toFixed(1)); $('w-mrc').textContent = translateUI(lastAnalysis.mrcSnr_db.toFixed(1)); }
    $('m-samples').textContent = translateUI(engine.totalSamples.toLocaleString());

    const { arterial } = engine.describeAnatomy();
    arterial.forEach((s, i) => {
      const el = $(`del-${s.name}`);
      if (el) {
        const d = engine.latest && i > 0 ? (i === engine.wristIdx ? L.radialPulseDelay_ms : i === engine.fingerIdx ? L.fingerPulseDelay_ms : null) : 0;
        if (d != null) el.textContent = translateUI(d.toFixed(0) + ' ms');
      }
    });
    for (const [m, def] of Object.entries(MUSCLES)) {
      const bar = $(`emg-${m}`);
      if (bar) bar.style.width = `${(L.emgActivation[m] * 100).toFixed(0)}%`;
    }
  }

  frame++;
  requestAnimationFrame(loop);
}

// Collapsible control panels (click the heading); state remembered per heading in localStorage
for (const h of document.querySelectorAll('.panel.controls > h2')) {
  const panel = h.parentElement, key = 'dt.panel.' + h.textContent.trim();
  // per-panel collapse state is remembered (localStorage); 보기 > 카드 상태 초기화 clears it
  try { if (localStorage.getItem(key) === '1') panel.classList.add('collapsed'); } catch (_) {}
  h.addEventListener('click', () => { panel.classList.toggle('collapsed'); try { localStorage.setItem(key, panel.classList.contains('collapsed') ? '1' : '0'); } catch (_) {} });
}

// Every card collapses/expands by clicking its heading (controls inside the heading are exempt);
// state remembered per heading in localStorage.
for (const h of document.querySelectorAll('.card > h3')) {
  const card = h.parentElement, key = 'dt.card.' + h.textContent.trim().slice(0, 40);
  try { if (localStorage.getItem(key) === '1') card.classList.add('collapsed'); } catch (_) {}
  h.addEventListener('click', (e) => {
    if (e.target.closest('input, label, button, select, .radio-group')) return;
    card.classList.toggle('collapsed');
    try { localStorage.setItem(key, card.classList.contains('collapsed') ? '1' : '0'); } catch (_) {}
    avatar?.resize(); wristView?.resize();
  });
}

// Drag-and-drop card reordering (drag a card heading onto another card); order persisted
{
  const grid = document.querySelector('.chart-grid');
  const KEY = 'dt.cardOrder';
  const cardId = (c) => c.dataset.cardId || (c.dataset.cardId = (c.querySelector('h3')?.textContent || '').trim().slice(0, 24));
  const cards = () => [...grid.querySelectorAll(':scope > .card')];
  try { const saved = JSON.parse(localStorage.getItem(KEY) || 'null'); if (Array.isArray(saved)) { const byId = new Map(cards().map((c) => [cardId(c), c])); for (const id of saved) { const c = byId.get(id); if (c) grid.appendChild(c); } } } catch (_) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cards().map(cardId))); } catch (_) {} };
  let dragging = null;
  for (const c of cards()) {
    const h = c.querySelector(':scope > h3'); if (!h) continue;
    h.setAttribute('draggable', 'true'); h.title = translateUI((h.title ? h.title + ' · ' : '') + '드래그하여 카드 순서 변경');
    h.addEventListener('dragstart', (e) => { dragging = c; c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', cardId(c)); } catch (_) {} });
    h.addEventListener('dragend', () => { dragging = null; c.classList.remove('dragging'); for (const x of cards()) x.classList.remove('drop-before', 'drop-after'); });
    c.addEventListener('dragover', (e) => { if (!dragging || dragging === c) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; const r = c.getBoundingClientRect(); const before = e.clientY < r.top + r.height / 2; c.classList.toggle('drop-before', before); c.classList.toggle('drop-after', !before); });
    c.addEventListener('dragleave', () => c.classList.remove('drop-before', 'drop-after'));
    c.addEventListener('drop', (e) => { if (!dragging || dragging === c) return; e.preventDefault(); const r = c.getBoundingClientRect(); const before = e.clientY < r.top + r.height / 2; grid.insertBefore(dragging, before ? c : c.nextSibling); c.classList.remove('drop-before', 'drop-after'); save(); avatar?.resize(); wristView?.resize(); });
  }
}

// EMG activation bars
const emgBars = $('emg-bars');
for (const [m, def] of Object.entries(MUSCLES)) {
  const row = document.createElement('div'); row.className = 'bar-row';
  row.innerHTML = localizeHTML(`<span>${def.label}</span><div class="bar"><div class="fill" id="emg-${m}"></div></div>`);
  emgBars.appendChild(row);
}

window.addEventListener('resize', () => { avatar?.resize(); wristView?.resize(); });
// Everything above is configuration; only now does the engine's clock start (in the Worker, or in
// this thread with ?inline=1) — so the first generated sample already sees the final setup.
engine.start();
requestAnimationFrame(loop);

document.getElementById('tissueFat')?.addEventListener('input',e=>{engine.set('capArray.tissueFat_mm',Number(e.target.value));document.getElementById('tissueFatOut').textContent=translateUI(e.target.value+' mm');});

$('resetWrist').addEventListener('click',e=>{
 e.stopPropagation();
 for(const id of ['tissueGain','tissueFat','arteryLateral','arteryDepth']){
  const input=$(id);input.value=input.defaultValue;input.dispatchEvent(new Event('input',{bubbles:true}));
 }
 applySheetAngle(0);
 applySheet(WRIST_ANATOMY.ARTERY_BASE_LATERAL_MM,defaultSheetAlong_mm(engine.capArray.rows,engine.capArray.spacingMm),false);
 wristView?.resetCamera();
 const model=$('handModel');model.value='A';model.dispatchEvent(new Event('change',{bubbles:true}));
});
