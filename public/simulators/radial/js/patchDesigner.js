// Patch electrode design tool — modal with a 0.1 mm grid canvas: drag-and-drop electrodes, set each
// pad's size/shape/position, generate regular grids, save named layouts (localStorage) and apply them
// to the simulator (model + analysis core + 3D wrist view + snapshot/Δt views).
//
//   initPatchDesigner({ onApply(layout|null), getCurrent() }) → { open(), close() }
import { normalizeLayout, gridLayout, saveLayout, deleteLayout, loadLayouts, getLayout, minGap, snap, round1, MAX_ELECTRODES, PRESETS } from './electrodeLayout.js';
import { WRIST_ANATOMY } from './capacitiveArray.js';
import { WRIST_WIDTH_REF_MM } from './anthropometry.js';

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function num(id, label, value, { min = 0, max = 100, step = 0.1, w = 64 } = {}) {
  const wrap = el('label', 'pd-field'); wrap.appendChild(el('span', null, label));
  const i = el('input'); i.type = 'number'; i.id = id; i.min = min; i.max = max; i.step = step; i.value = value; i.style.width = `${w}px`; wrap.appendChild(i);
  return { wrap, input: i };
}

// Real palm-up hand photos (assets/hand_left.png / hand_right.png, RGBA). Registration measured from the
// alpha mask: narrowest wrist row (`widthPx` pixels wide) → px/mm, midline x, and the wrist crease ≈ 3.5 mm
// distal to the narrowest row. u (+thumb) grows with image x for the right hand and against it for the left.
//
// **손목 폭 가정은 더 이상 58 mm 고정이 아니다** (ROADMAP §2.1-4, docs/CLINICAL_AUDIT.md §6.16):
// 그 최협부 행이 몇 mm인지는 체형에서 유도한다(`anthropometry.deriveWristCrossSection().width_mm`).
// px/mm = widthPx / (가정 폭)이므로 폭 가정이 커지면 사진이 그만큼 크게 그려지고, 사진에서 **픽셀로**
// 잰 값(cx 기준 건 능선 위치, fcr/pl)도 같은 비율로 mm 값이 커진다 → 가이드 선이 사진과 계속 맞는다.
// 기준 체형(170/70)의 폭은 정확히 58.0 mm라 기존 정합은 한 픽셀도 바뀌지 않는다.
const HAND_IMG = {
  // widthPx: 알파 마스크에서 잰 손목 최협부 폭(픽셀). fcr/pl: 그 사진에서 잰 건 능선 위치 —
  // **기준 폭 58 mm 기준의 mm 값**(= 픽셀값 ÷ (widthPx/58))이며, 다른 폭 가정에서는 비례 확대해 쓴다.
  // Ridge positions from the luminance profile across the wrist band (bright tendon ridges): right hand
  // PL +1.3 mm / FCR +9.5 mm; left hand the same after fixing its midline (cx) on the PL ridge.
  // rot: the tendon ridges in the photos lean ≈4° (toward the thumb proximally); the photo is rotated
  // by this angle about the registration point so the ridges run along the drawn (near-vertical) lines.
  // (rot 은 각도라 폭에 비례하지 않는다 — 확대해도 기울기는 그대로.)
  left: { src: new URL('../assets/hand_left.png', import.meta.url).href, cx: 595.4, cy: 1112, widthPx: 331, fcr: 7.8, pl: -0.5, rot: 4.2, img: null },
  right: { src: new URL('../assets/hand_right.png', import.meta.url).href, cx: 530.5, cy: 1083, widthPx: 325, fcr: 8.9, pl: 0.8, rot: -4.2, img: null },
};
const OVERLAY_KEY = 'dt.wristOverlay';
const ARTERY_FCR_GAP_MM = 2.5; // artery centre sits just radial to the FCR ridge (@ 58 mm 기준 폭)
function loadOverlayPrefs() { try { const o = JSON.parse(localStorage.getItem(OVERLAY_KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (_) { return {}; } }
function saveOverlayPrefs(p) { try { localStorage.setItem(OVERLAY_KEY, JSON.stringify(p)); } catch (_) {} }
function loadHandImages() { /* Private source photos are excluded; metric layout canvas remains available. */ }

export function initPatchDesigner({ onApply, getCurrent } = {}) {
  let modal = null, canvas = null, ctx = null;
  let layout = null;           // working copy (normalised)
  let sel = -1;                // selected electrode index
  let drag = null;             // { idx, dx, dy } pointer offset (mm) from the pad centre
  let view = { pxPerMm: 10, ox: 0, oy: 0 }; // canvas mapping (origin = sheet centre)
  let hover = { x: 0, y: 0 };
  let wristSide = 'none'; // 'none' | 'right' | 'left' — wrist outline overlay (volar view)
  const anat = { pl: WRIST_ANATOMY.PL_TENDON_LATERAL_MM, fcr: WRIST_ANATOMY.FCR_TENDON_LATERAL_MM, artery: WRIST_ANATOMY.ARTERY_BASE_LATERAL_MM, rot: 0 }; // editable overlay positions (mm, + thumb) + photo rotation (°)
  let sheetPos = { lateral: WRIST_ANATOMY.ARTERY_BASE_LATERAL_MM, along: -9 }; // where the sheet centre sits on the wrist (from the simulator)
  // 손목 최협부 폭 가정(mm) — 체형에서 유도(`getCurrent().wrist.width_mm`). 기본 체형 → 정확히 58.0.
  // 사진 px/mm, 가이드 선(요골동맥·FCR·PL), 실루엣/뼈 선, 초기 줌이 모두 이 값을 따른다.
  let wristWidth_mm = WRIST_WIDTH_REF_MM;
  const widthScale = () => wristWidth_mm / WRIST_WIDTH_REF_MM; // 기준 체형 → 정확히 1
  // 폭 배율 재적용: 배율 1이면 값을 **그대로** 두어 기존 동작이 비트 동일하게 남는다.
  const rescale = (v, k) => (k === 1 ? v : Math.round(v * k * 100) / 100);
  const ui = {};

  function build() {
    modal = el('div', 'modal hidden pd'); modal.id = 'pdModal'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
    const box = el('div', 'modal-box pd-box');
    const head = el('div', 'refs-head');
    head.appendChild(el('h3', null, '패치 전극 설계도구 — 0.1 mm 그리드 · 드래그로 배치'));
    const headR = el('div', 'pd-row'); headR.style.width = 'auto';
    let anatEdit = new URLSearchParams(location.search).has('anatedit');
    const seg = el('div', 'pd-seg');
    // ⚙ control icon: toggles the guide-line adjustment inputs (PL / FCR / radial artery / photo rotation)
    const gear = el('button', 'btn pd-gear', ''); gear.type = 'button'; gear.title = '가이드 선(요골동맥·FCR·PL)·사진 회전 조정';
    gear.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z"/><path d="M19.4 13.5a7.7 7.7 0 0 0 0-3l2-1.5-2-3.4-2.4 1a7.6 7.6 0 0 0-2.6-1.5L14 2.6h-4l-.4 2.5a7.6 7.6 0 0 0-2.6 1.5l-2.4-1-2 3.4 2 1.5a7.7 7.7 0 0 0 0 3l-2 1.5 2 3.4 2.4-1a7.6 7.6 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 2.6-1.5l2.4 1 2-3.4-2-1.5z"/></svg>';
    gear.addEventListener('click', () => { anatEdit = !anatEdit; gear.classList.toggle('primary', anatEdit); const adjEl = document.getElementById('pdAnatAdj'); if (adjEl) adjEl.style.display = anatEdit && wristSide !== 'none' ? 'inline-flex' : 'none'; if (anatEdit && wristSide === 'none' && ui.wristBtns.right) ui.wristBtns.right.click(); });
    seg.appendChild(gear);
    const segLabel = el('span', 'pd-seg-label', '손목 아웃라인'); seg.appendChild(segLabel);
    // The fine-tune inputs are hidden by default (the saved/measured values are the defaults); reveal with
    // Alt+click on the label or ?anatedit=1 when the overlay needs re-registration.
    segLabel.title = '⚙ 아이콘: 가이드 선 조정 메뉴 표시/숨김';
    segLabel.addEventListener('click', (e) => { if (!e.altKey) return; anatEdit = !anatEdit; const adjEl = document.getElementById('pdAnatAdj'); if (adjEl) adjEl.style.display = anatEdit && wristSide !== 'none' ? 'inline-flex' : 'none'; });
    ui.wristBtns = {};
    for (const [v, t] of [['none', '없음'], ['right', '오른손'], ['left', '왼손']]) { const b = el('button', 'btn' + (v === wristSide ? ' primary' : ''), t); b.type = 'button'; b.addEventListener('click', () => { wristSide = v; for (const [k, bb] of Object.entries(ui.wristBtns)) bb.classList.toggle('primary', k === v); applyOverlayDefaults(v); const prefs = loadOverlayPrefs(); prefs.side = v; saveOverlayPrefs(prefs); const adjEl = document.getElementById('pdAnatAdj'); if (adjEl) adjEl.style.display = anatEdit && v !== 'none' ? 'inline-flex' : 'none'; b.title = v === 'none' ? '' : `오버레이 PL ${anat.pl} / FCR ${anat.fcr} / 동맥 ${anat.artery} mm · 회전 ${anat.rot}°`; fitView(); draw(); }); ui.wristBtns[v] = b; seg.appendChild(b); }
    // fine-tune the anatomy overlay against the photo (mm from the wrist midline, + thumb side)
    const adj = el('div', 'pd-seg'); adj.id = 'pdAnatAdj'; adj.style.display = 'none';
    const mk = (label, key, val) => { const wrap = el('label', 'pd-field'); wrap.style.width = 'auto'; wrap.appendChild(el('span', null, label)); const i = el('input'); i.type = 'number'; i.step = 0.5; i.min = -30; i.max = 30; i.value = val; i.style.width = '58px'; i.addEventListener('input', () => { anat[key] = +i.value; if (key === 'artery') anat.arteryManual = true; if (key === 'fcr' && !anat.arteryManual) { anat.artery = anat.fcr + rescale(ARTERY_FCR_GAP_MM, widthScale()); if (ui.anatArt) ui.anatArt.value = anat.artery; } persistOverlay(); draw(); }); wrap.appendChild(i); adj.appendChild(wrap); return i; };
    ui.anatPl = mk('PL', 'pl', anat.pl); ui.anatFcr = mk('FCR', 'fcr', anat.fcr); ui.anatArt = mk('요골동맥', 'artery', anat.artery); ui.anatRot = mk('사진 회전°', 'rot', anat.rot); ui.anatRot.step = 0.2; ui.anatRot.min = -30; ui.anatRot.max = 30;
    const resetA = el('button', 'btn', '기본값'); resetA.type = 'button'; resetA.title = '이 손의 오버레이 위치/회전을 측정 기본값으로 되돌리기';
    resetA.addEventListener('click', () => { const prefs = loadOverlayPrefs(); delete prefs[wristSide]; saveOverlayPrefs(prefs); anat.arteryManual = false; applyOverlayDefaults(wristSide); draw(); });
    adj.appendChild(resetA);
    // 손목 폭 가정 read-out (사진 정합의 스케일 근거) — 체형 슬라이더가 바꾼다
    ui.widthNote = el('span', 'pd-width-note', '');
    seg.appendChild(ui.widthNote);
    headR.appendChild(seg); headR.appendChild(adj);
    const closeB = el('button', 'btn', '닫기'); closeB.type = 'button'; closeB.addEventListener('click', close); headR.appendChild(closeB);
    head.appendChild(headR);
    box.appendChild(head);
    const body = el('div', 'pd-body');
    // ---- far left: vertical thumbnail list of saved layouts + presets (click → edit on the right)
    ui.thumbs = el('div', 'pd-thumbs'); body.appendChild(ui.thumbs);
    // ---- centre: canvas
    const left = el('div', 'pd-left');
    canvas = el('canvas', 'pd-canvas'); ctx = canvas.getContext('2d'); left.appendChild(canvas);
    ui.status = el('div', 'pd-status', ''); left.appendChild(ui.status);
    body.appendChild(left);
    // ---- right: controls
    const right = el('div', 'pd-right');
    // sheet
    const g1 = el('fieldset', 'pd-group'); g1.appendChild(el('legend', null, '시트 (mm)'));
    const sw = num('pdSheetW', '가로(lateral)', 20, { min: 6, max: 60, step: 0.1 }); const sh = num('pdSheetH', '세로(along)', 20, { min: 6, max: 100, step: 0.1 });
    g1.appendChild(sw.wrap); g1.appendChild(sh.wrap); ui.sheetW = sw.input; ui.sheetH = sh.input;
    const hintS = el('div', 'pd-hint', `x: − 새끼 ↔ + 엄지, y: − 몸통 ↔ + 손가락. 세로는 손목 모델 범위(${-WRIST_ANATOMY.SHEET_ALONG_MIN_MM} mm) 이내. 피치 = 전극 크기 + 간격 (3 mm 패드 + 0.5 mm 간격 = 3.5 mm).`); g1.appendChild(hintS);
    right.appendChild(g1);
    // grid generator
    const g2 = el('fieldset', 'pd-group'); g2.appendChild(el('legend', null, '규칙 격자 생성'));
    // Defaults = the reference patch: 4×3, 3 mm pads, 0.5 mm gap (pitch 3.5 mm)
    const gr = num('pdRows', '행(along)', 3, { min: 1, max: 8, step: 1, w: 52 }); const gc = num('pdCols', '열(lateral)', 4, { min: 1, max: 10, step: 1, w: 52 });
    const gpx = num('pdPitchX', '가로 피치', 3.5, { min: 0.5, max: 20 }); const gpy = num('pdPitchY', '세로 피치', 3.5, { min: 0.5, max: 30 });
    const gw = num('pdW', '전극 가로', 3, { min: 0.5, max: 15 }); const gh = num('pdH', '전극 세로', 3, { min: 0.5, max: 15 });
    const shapeSel = el('select'); shapeSel.id = 'pdShape'; for (const [v, t] of [['rect', '사각'], ['round', '모서리 둥근 사각'], ['circle', '원형/타원']]) { const o = el('option', null, t); o.value = v; shapeSel.appendChild(o); }
    const shapeWrap = el('label', 'pd-field'); shapeWrap.appendChild(el('span', null, '모양')); shapeWrap.appendChild(shapeSel);
    for (const f of [gr, gc, gpx, gpy, gw, gh]) g2.appendChild(f.wrap); g2.appendChild(shapeWrap);
    const stagWrap = el('label', 'pd-field'); const stag = el('input'); stag.type = 'checkbox'; stag.id = 'pdStagger'; stag.checked = true; stagWrap.appendChild(stag); stagWrap.appendChild(el('span', null, '짝수 행 반 피치 엇갈림')); g2.appendChild(stagWrap);
    const genB = el('button', 'btn', '격자 생성 (기존 전극 대체)'); genB.type = 'button';
    genB.addEventListener('click', () => { const L = gridLayout(+gr.input.value, +gc.input.value, +gpx.input.value, +gpy.input.value, +gw.input.value, +gh.input.value, shapeSel.value, stag.checked); setLayout({ ...L, name: layout ? layout.name : L.name, sheetW: Math.max(+ui.sheetW.value, L.sheetW), sheetH: Math.max(+ui.sheetH.value, L.sheetH) }); });
    g2.appendChild(genB); right.appendChild(g2);
    // selected electrode
    const g3 = el('fieldset', 'pd-group'); g3.appendChild(el('legend', null, '선택 전극'));
    ui.selTitle = el('div', 'pd-hint', '전극을 클릭해 선택 · 드래그로 이동(0.1 mm 스냅) · 방향키 0.1 mm, Shift+방향키 1 mm'); g3.appendChild(ui.selTitle);
    const ex = num('pdEx', 'x', 0, { min: -50, max: 50 }); const ey = num('pdEy', 'y', 0, { min: -60, max: 60 }); const ew = num('pdEw', '가로', 3, { min: 0.5, max: 15 }); const eh = num('pdEh', '세로', 3, { min: 0.5, max: 15 });
    const eshape = shapeSel.cloneNode(true); eshape.id = 'pdEshape'; const esw = el('label', 'pd-field'); esw.appendChild(el('span', null, '모양')); esw.appendChild(eshape);
    for (const f of [ex, ey, ew, eh]) g3.appendChild(f.wrap); g3.appendChild(esw);
    ui.ex = ex.input; ui.ey = ey.input; ui.ew = ew.input; ui.eh = eh.input; ui.eshape = eshape;
    const rowB = el('div', 'pd-row');
    const addB = el('button', 'btn', '+ 전극 추가'); addB.type = 'button'; addB.addEventListener('click', () => { if (!layout) return; if (layout.electrodes.length >= MAX_ELECTRODES) return flash(`최대 ${MAX_ELECTRODES}개`); const e = layout.electrodes.map((q) => ({ ...q })); e.push({ x: 0, y: 0, w: +ui.ew.value || 3, h: +ui.eh.value || 3, shape: ui.eshape.value }); setLayout({ ...layout, electrodes: e }, e.length - 1); });
    const dupB = el('button', 'btn', '복제'); dupB.type = 'button'; dupB.addEventListener('click', () => { if (sel < 0) return; if (layout.electrodes.length >= MAX_ELECTRODES) return flash(`최대 ${MAX_ELECTRODES}개`); const e = layout.electrodes.map((q) => ({ ...q })); const s = e[sel]; e.push({ ...s, x: round1(s.x + s.w + 1) }); setLayout({ ...layout, electrodes: e }, e.length - 1); });
    const delB = el('button', 'btn', '삭제'); delB.type = 'button'; delB.addEventListener('click', () => { if (sel < 0) return; const e = layout.electrodes.filter((_, i) => i !== sel).map((q) => ({ ...q })); setLayout({ ...layout, electrodes: e }, -1); });
    rowB.appendChild(addB); rowB.appendChild(dupB); rowB.appendChild(delB); g3.appendChild(rowB);
    right.appendChild(g3);
    // save / load / apply
    const g4 = el('fieldset', 'pd-group'); g4.appendChild(el('legend', null, '저장 · 불러오기 · 적용'));
    const nameWrap = el('label', 'pd-field'); nameWrap.appendChild(el('span', null, '이름')); ui.name = el('input'); ui.name.type = 'text'; ui.name.style.width = '150px'; ui.name.placeholder = '레이아웃 이름'; nameWrap.appendChild(ui.name); g4.appendChild(nameWrap);
    const row2 = el('div', 'pd-row');
    const saveB = el('button', 'btn primary', '저장'); saveB.type = 'button'; saveB.addEventListener('click', () => { if (!layout) return; const name = (ui.name.value || '').trim(); if (!name) return flash('이름을 입력하세요'); const L = saveLayout({ ...layout, name }); setLayout(L, sel); refreshSaved(); flash(`저장됨: ${name}`); if (onApply) onApply(null, { savedOnly: true }); });
    const applyB = el('button', 'btn primary', '시뮬레이터에 적용'); applyB.type = 'button'; applyB.addEventListener('click', () => { if (!layout) return; if (minGap(layout) < 0) return flash('전극이 겹칩니다 — 간격을 확인하세요'); if (onApply) onApply(layout); flash('적용됨'); });
    row2.appendChild(saveB); row2.appendChild(applyB); g4.appendChild(row2);
    const loadWrap = el('div', 'pd-row'); ui.saved = el('select'); ui.saved.style.flex = '1'; loadWrap.appendChild(ui.saved);
    const loadB = el('button', 'btn', '불러오기'); loadB.type = 'button'; loadB.addEventListener('click', () => { const n = ui.saved.value; if (!n) return; const L = PRESETS[n] ? PRESETS[n]() : getLayout(n); if (L) { setLayout(L, -1); ui.name.value = PRESETS[n] ? '' : n; } });
    const delL = el('button', 'btn', '삭제'); delL.type = 'button'; delL.addEventListener('click', () => { const n = ui.saved.value; if (!n || PRESETS[n]) return; deleteLayout(n); refreshSaved(); flash(`삭제됨: ${n}`); if (onApply) onApply(null, { savedOnly: true }); });
    loadWrap.appendChild(loadB); loadWrap.appendChild(delL); g4.appendChild(loadWrap);
    const gridB = el('button', 'btn', '규칙 격자(슬라이더)로 복귀'); gridB.type = 'button'; gridB.addEventListener('click', () => { if (onApply) onApply(null); flash('규칙 격자 모드'); });
    g4.appendChild(gridB);
    // Export all saved layouts (+ the working one) as JSON — input for the batch runner: node eval/doe_array.mjs --layouts file.json
    const expB = el('button', 'btn', 'JSON 내보내기 (DoE 배치용)'); expB.type = 'button';
    expB.addEventListener('click', () => {
      const all = loadLayouts(); const list = Object.values(all);
      if (layout) list.push({ name: (ui.name.value || layout.name || 'working').trim(), sheetW: layout.sheetW, sheetH: layout.sheetH, electrodes: layout.electrodes.map(({ x, y, w, h, shape, label }) => ({ x, y, w, h, shape, label })) });
      const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'electrode_layouts.json'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      flash(`${list.length}개 레이아웃 내보냄 → node eval/doe_array.mjs --layouts electrode_layouts.json`);
    });
    g4.appendChild(expB);
    ui.info = el('div', 'pd-hint', ''); g4.appendChild(ui.info);
    right.appendChild(g4);
    body.appendChild(right);
    box.appendChild(body); modal.appendChild(box); document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

    // ---- bindings
    for (const k of ['ex', 'ey', 'ew', 'eh', 'eshape']) ui[k].addEventListener('change', () => { if (sel < 0) return; const e = layout.electrodes.map((q) => ({ ...q })); e[sel] = { ...e[sel], x: round1(+ui.ex.value), y: round1(+ui.ey.value), w: round1(+ui.ew.value), h: round1(+ui.eh.value), shape: ui.eshape.value }; setLayout({ ...layout, electrodes: e }, sel, true); });
    for (const k of ['sheetW', 'sheetH']) ui[k].addEventListener('change', () => { setLayout({ ...layout, sheetW: +ui.sheetW.value, sheetH: Math.min(+ui.sheetH.value, -WRIST_ANATOMY.SHEET_ALONG_MIN_MM) }, sel, true); });
    canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); view.pxPerMm = Math.max(3, Math.min(40, view.pxPerMm * (e.deltaY < 0 ? 1.1 : 0.9))); draw(); }, { passive: false });
    document.addEventListener('keydown', (e) => { if (!modal || modal.classList.contains('hidden') || sel < 0) return; const tgt = e.target; if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'SELECT')) return; const st = e.shiftKey ? 1 : 0.1; let dx = 0, dy = 0; if (e.key === 'ArrowLeft') dx = -st; else if (e.key === 'ArrowRight') dx = st; else if (e.key === 'ArrowUp') dy = st; else if (e.key === 'ArrowDown') dy = -st; else if (e.key === 'Delete' || e.key === 'Backspace') { delB.click(); e.preventDefault(); return; } else return; e.preventDefault(); const el2 = layout.electrodes.map((q) => ({ ...q })); el2[sel] = { ...el2[sel], x: round1(el2[sel].x + dx), y: round1(el2[sel].y + dy) }; setLayout({ ...layout, electrodes: el2 }, sel, true); });
    seedLibrary();
    refreshSaved();
    loadHandImages(() => draw());
  }

  // Overlay positions for a hand: saved user values (localStorage) → else the photo's measured defaults.
  // 저장값은 **저장 당시의 폭 가정 `w`(mm) 기준의 실제 mm**다. 다른 폭에서 불러오면 비례 환산한다
  // (`w`가 없는 예전 저장값 = 58 mm 에서 잰 것으로 간주 → 기본 체형에서는 배율 1, 즉 예전 그대로).
  function applyOverlayDefaults(side) {
    const hd = HAND_IMG[side]; if (!hd) return;
    const saved = loadOverlayPrefs()[side] || {};
    const kRef = widthScale();                                        // 사진 측정 기본값 → 현재 폭
    const kSaved = wristWidth_mm / (saved.w || WRIST_WIDTH_REF_MM);    // 저장 당시 폭 → 현재 폭
    anat.pl = saved.pl != null ? rescale(saved.pl, kSaved) : rescale(hd.pl, kRef);
    anat.fcr = saved.fcr != null ? rescale(saved.fcr, kSaved) : rescale(hd.fcr, kRef);
    anat.rot = saved.rot ?? hd.rot ?? 0; // 각도 — 폭에 비례하지 않음
    anat.arteryManual = !!saved.arteryManual;
    // Radial artery hugs the radial side of the FCR tendon: default = FCR + 2.5 mm (centre-to-centre) unless the user placed it explicitly
    anat.artery = saved.arteryManual && saved.artery != null ? rescale(saved.artery, kSaved) : anat.fcr + rescale(ARTERY_FCR_GAP_MM, kRef);
    if (ui.anatPl) { ui.anatPl.value = anat.pl; ui.anatFcr.value = anat.fcr; ui.anatArt.value = anat.artery; ui.anatRot.value = anat.rot; }
    // 저장값이 다른 폭에서 잰 것이면 환산했다는 사실을 알린다(폭 기록이 없는 예전 값 = 58 mm 간주).
    if (saved.pl != null && Math.abs(kSaved - 1) > 0.001) flash(`저장된 오버레이(손목 폭 ${(saved.w || WRIST_WIDTH_REF_MM).toFixed(1)} mm${saved.w ? '' : ' — 폭 기록 없음, 기준 58 mm로 간주'} 기준)를 현재 ${wristWidth_mm.toFixed(1)} mm 로 ×${kSaved.toFixed(3)} 환산했습니다`);
  }
  function persistOverlay() {
    if (wristSide === 'none') return;
    // `w` = 이 값들을 잰 폭 가정. 다음에 다른 체형에서 열면 이 값으로 환산한다.
    const prefs = loadOverlayPrefs(); prefs[wristSide] = { pl: anat.pl, fcr: anat.fcr, artery: anat.artery, arteryManual: !!anat.arteryManual, rot: anat.rot, w: wristWidth_mm }; saveOverlayPrefs(prefs);
    flash(`손목 오버레이 저장됨 (${wristSide === 'left' ? '왼손' : '오른손'}, 손목 폭 ${wristWidth_mm.toFixed(1)} mm 기준)`);
  }
  // 폭 가정 표시 + (필요 시) 오버레이 값 재환산
  function setWristWidth(mm) {
    const w = Number.isFinite(mm) && mm > 10 ? mm : WRIST_WIDTH_REF_MM;
    if (w !== wristWidth_mm) {
      const k = w / wristWidth_mm;
      wristWidth_mm = w;
      // 이미 로드된 오버레이 값을 새 폭으로 환산(사진과 계속 일치하도록)
      anat.pl = rescale(anat.pl, k); anat.fcr = rescale(anat.fcr, k); anat.artery = rescale(anat.artery, k);
      if (ui.anatPl) { ui.anatPl.value = anat.pl; ui.anatFcr.value = anat.fcr; ui.anatArt.value = anat.artery; }
    }
    if (ui.widthNote) {
      ui.widthNote.textContent = `손목 폭 가정 ${wristWidth_mm.toFixed(1)} mm — 체형 슬라이더로 변경`;
      ui.widthNote.title = `손 사진의 px/mm 정합과 가이드 선(요골동맥·FCR·PL)이 이 폭을 기준으로 그려진다. 값은 자세/움직임 카드의 신장·체중(체형 프리셋)에서 유도 — js/anthropometry.js deriveWristCrossSection (모델 가정, docs/CLINICAL_AUDIT.md §6.16). 기준 체형 170 cm/70 kg → 정확히 58.0 mm.`;
    }
  }
  function flash(t) { ui.status.textContent = t; ui.status.classList.add('on'); setTimeout(() => ui.status.classList.remove('on'), 1500); }
  // Seed the library with a few ready-made patches the first time (users can edit/delete them)
  function seedLibrary() {
    const have = loadLayouts();
    const seeds = { '기준 패치 3×4 (3 mm · 0.5 mm · 가운데 행 우측)': '프리셋: 3×4 기준 패치 3 mm · 간격 0.5 mm · 가운데 행 반 피치 우측', '3×4 정렬 격자 3 mm': '프리셋: 3×4 격자 3 mm 패드 · 간격 0.5 mm (정렬)', '3×6 격자 3 mm': '프리셋: 3×6 격자 3 mm 패드 · 간격 0.5 mm', '6×3 격자 (6행×3열) 3 mm': '프리셋: 6×3 격자 (6행 × 3열) 3 mm 패드 · 간격 0.5 mm', '4×4 회전 격자 14°': '프리셋: 4×4 회전 격자 (≈14°, x·y 투영 모두 고유)', '2×5 스트립 1.5×4 mm': '프리셋: 2×5 스트립 (가로 1.5×4 mm)', '4×4 원형 Ø2 mm': '프리셋: 4×4 원형 Ø2 mm @3 mm', '3열 엇갈림 18전극': '프리셋: 3열 엇갈림(stagger) 18전극' };
    for (const [name, pk] of Object.entries(seeds)) if (!have[name] && PRESETS[pk]) saveLayout({ ...PRESETS[pk](), name });
  }
  function thumbCanvas(L, W = 150, H = 104) {
    const cv = el('canvas', 'pd-thumb-cv'); const dpr = window.devicePixelRatio || 1; cv.width = W * dpr; cv.height = H * dpr; cv.style.width = `${W}px`; cv.style.height = `${H}px`;
    const c = cv.getContext('2d'); c.fillStyle = '#0b1020'; c.fillRect(0, 0, cv.width, cv.height);
    const s = Math.min((W - 12) / L.sheetW, (H - 12) / L.sheetH) * dpr;
    const ox = (cv.width - L.sheetW * s) / 2, oy = (cv.height - L.sheetH * s) / 2;
    c.strokeStyle = 'rgba(253,230,138,0.7)'; c.lineWidth = 1 * dpr; c.strokeRect(ox, oy, L.sheetW * s, L.sheetH * s);
    for (const e of L.electrodes) {
      const x0 = ox + (e.x - e.w / 2 + L.sheetW / 2) * s, y0 = oy + (L.sheetH / 2 - (e.y + e.h / 2)) * s, pw = e.w * s, ph = e.h * s;
      c.beginPath(); if (e.shape === 'circle') c.ellipse(x0 + pw / 2, y0 + ph / 2, pw / 2, ph / 2, 0, 0, Math.PI * 2); else if (e.shape === 'round' && c.roundRect) c.roundRect(x0, y0, pw, ph, Math.min(pw, ph) * 0.3); else c.rect(x0, y0, pw, ph);
      c.fillStyle = 'rgba(245,180,30,0.95)'; c.fill();
    }
    return cv;
  }
  function refreshThumbs() {
    if (!ui.thumbs) return;
    ui.thumbs.innerHTML = '';
    ui.thumbs.appendChild(el('div', 'pd-thumbs-title', '저장된 패치'));
    const saved = loadLayouts();
    const items = [...Object.keys(saved).map((n) => ({ name: n, get: () => getLayout(n), kind: 'saved' })), ...Object.keys(PRESETS).map((n) => ({ name: n, get: () => PRESETS[n](), kind: 'preset' }))];
    for (const it of items) {
      const L = it.get(); if (!L) continue;
      const card = el('div', 'pd-thumb' + (layout && ((it.kind === 'saved' && ui.name.value === it.name) || (it.kind === 'preset' && layout.name === it.name)) ? ' active' : ''));
      card.appendChild(thumbCanvas(L));
      const cap = el('div', 'pd-thumb-cap', (it.kind === 'preset' ? '[프리셋] ' : '') + it.name); cap.title = it.name; card.appendChild(cap);
      card.appendChild(el('div', 'pd-thumb-sub', `${L.electrodes.length}전극 · ${L.rows}행 · ${L.sheetW}×${L.sheetH} mm`));
      card.addEventListener('click', () => { setLayout(L, -1); ui.name.value = it.kind === 'saved' ? it.name : ''; refreshThumbs(); });
      ui.thumbs.appendChild(card);
    }
  }
  function refreshSaved() {
    refreshThumbs();
    const cur = ui.saved.value; ui.saved.innerHTML = '';
    const o0 = el('option', null, '— 저장된 레이아웃 / 프리셋 —'); o0.value = ''; ui.saved.appendChild(o0);
    for (const n of Object.keys(loadLayouts())) { const o = el('option', null, n); o.value = n; ui.saved.appendChild(o); }
    for (const n of Object.keys(PRESETS)) { const o = el('option', null, n); o.value = n; ui.saved.appendChild(o); }
    if (cur) ui.saved.value = cur;
  }

  // Set the working layout (re-normalised: rows/cols indices, numbering) and redraw. `keepSel` keeps
  // the selection by electrode identity (the re-numbering may reorder the array).
  function setLayout(L, selIdx = sel, keepSel = false) {
    const prevSel = keepSel && layout && sel >= 0 ? layout.electrodes[sel] : null;
    layout = normalizeLayout(L);
    if (prevSel) sel = layout.electrodes.findIndex((e) => e.x === prevSel.x && e.y === prevSel.y && e.w === prevSel.w && e.h === prevSel.h);
    else sel = selIdx != null && selIdx >= 0 && selIdx < layout.electrodes.length ? (L.electrodes && L.electrodes[selIdx] ? layout.electrodes.findIndex((e) => e.x === round1(L.electrodes[selIdx].x) && e.y === round1(L.electrodes[selIdx].y)) : selIdx) : -1;
    ui.sheetW.value = layout.sheetW; ui.sheetH.value = layout.sheetH;
    syncSelUi(); draw();
  }
  function syncSelUi() {
    const e = sel >= 0 ? layout.electrodes[sel] : null;
    for (const k of ['ex', 'ey', 'ew', 'eh', 'eshape']) ui[k].disabled = !e;
    if (e) { ui.ex.value = e.x; ui.ey.value = e.y; ui.ew.value = e.w; ui.eh.value = e.h; ui.eshape.value = e.shape; ui.selTitle.textContent = `#${sel + 1} (행 ${e.r + 1}, 열 ${e.c + 1}) — 드래그로 이동 · 방향키 0.1 mm · Shift+방향키 1 mm · Delete 삭제`; }
    else ui.selTitle.textContent = '전극을 클릭해 선택 · 드래그로 이동(0.1 mm 스냅) · 방향키 0.1 mm, Shift+방향키 1 mm';
    const gap = layout.electrodes.length >= 2 ? minGap(layout) : null;
    ui.info.innerHTML = `전극 ${layout.electrodes.length} / ${MAX_ELECTRODES} · 행 ${layout.rows} · 최대 열 ${layout.cols}` + (gap != null ? ` · 최소 간격 ${gap.toFixed(1)} mm${gap < 0 ? ' <b style="color:#f87171">(겹침!)</b>' : ''}` : '');
  }

  // ---- canvas mapping: origin at sheet centre, x → right (+thumb), y → up (+distal)
  function fit() {
    const dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(r.width * dpr)), h = Math.max(1, Math.floor(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return { w, h, dpr };
  }
  function toPx(x, y, w, h, dpr) { return [w / 2 + x * view.pxPerMm * dpr, h / 2 - y * view.pxPerMm * dpr]; }
  function toMm(px, py) { const r = canvas.getBoundingClientRect(); const x = (px - r.left - r.width / 2) / view.pxPerMm, y = -(py - r.top - r.height / 2) / view.pxPerMm; return { x, y }; }
  function draw() {
    if (!layout || !canvas) return;
    const { w, h, dpr } = fit(); const s = view.pxPerMm * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#0b1020'; ctx.fillRect(0, 0, w, h);
    // sheet
    const [sx0, sy0] = toPx(-layout.sheetW / 2, layout.sheetH / 2, w, h, dpr);
    ctx.fillStyle = 'rgba(253,230,138,0.08)'; ctx.fillRect(sx0, sy0, layout.sheetW * s, layout.sheetH * s);
    // grid: 0.1 mm (only when zoomed in), 0.5 mm, 1 mm, 5 mm
    const showFine = s >= 25, showHalf = s >= 8;
    const xmin = -w / 2 / s, xmax = w / 2 / s, ymin = -h / 2 / s, ymax = h / 2 / s;
    const line = (step, color, lw) => { ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath(); for (let x = Math.ceil(xmin / step) * step; x <= xmax; x += step) { const [px] = toPx(x, 0, w, h, dpr); ctx.moveTo(px, 0); ctx.lineTo(px, h); } for (let y = Math.ceil(ymin / step) * step; y <= ymax; y += step) { const [, py] = toPx(0, y, w, h, dpr); ctx.moveTo(0, py); ctx.lineTo(w, py); } ctx.stroke(); };
    if (showFine) line(0.1, 'rgba(148,163,184,0.08)', 1);
    if (showHalf) line(0.5, 'rgba(148,163,184,0.12)', 1);
    line(1, 'rgba(148,163,184,0.2)', 1); line(5, 'rgba(148,163,184,0.38)', 1);
    ctx.strokeStyle = 'rgba(253,230,138,0.8)'; ctx.lineWidth = 1.5 * dpr; ctx.strokeRect(sx0, sy0, layout.sheetW * s, layout.sheetH * s);
    // artery guide (sheet centre is over the artery when sheet lateral = 12 mm): dashed vertical at x=0
    ctx.setLineDash([6 * dpr, 4 * dpr]); ctx.strokeStyle = 'rgba(248,113,113,0.55)'; ctx.lineWidth = 1 * dpr; ctx.beginPath(); const [ax] = toPx(0, 0, w, h, dpr); ctx.moveTo(ax, sy0 - 10 * dpr); ctx.lineTo(ax, sy0 + layout.sheetH * s + 10 * dpr); ctx.stroke(); ctx.setLineDash([]);
    if (wristSide !== 'none') drawWrist(ctx, w, h, dpr, s);
    // electrodes
    const font = (p) => `${p * dpr}px ui-monospace, Menlo, monospace`;
    layout.electrodes.forEach((e, i) => {
      const [x0, y0] = toPx(e.x - e.w / 2, e.y + e.h / 2, w, h, dpr); const pw = e.w * s, ph = e.h * s;
      ctx.beginPath();
      if (e.shape === 'circle') ctx.ellipse(x0 + pw / 2, y0 + ph / 2, pw / 2, ph / 2, 0, 0, Math.PI * 2);
      else if (e.shape === 'round' && ctx.roundRect) ctx.roundRect(x0, y0, pw, ph, Math.min(pw, ph) * 0.3);
      else ctx.rect(x0, y0, pw, ph);
      ctx.fillStyle = i === sel ? 'rgba(251,191,36,1)' : 'rgba(245,180,30,0.92)'; ctx.fill();
      ctx.strokeStyle = i === sel ? '#fff' : 'rgba(255,255,255,0.5)'; ctx.lineWidth = (i === sel ? 2 : 1) * dpr; ctx.stroke();
      ctx.fillStyle = '#0b1020'; ctx.font = font(Math.max(8, Math.min(14, Math.min(pw, ph) / dpr * 0.35))); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`${i + 1}`, x0 + pw / 2, y0 + ph / 2 - (e.label ? ph * 0.2 : 0));
      if (e.label) { ctx.font = font(Math.max(7, Math.min(11, Math.min(pw, ph) / dpr * 0.24))); ctx.fillStyle = 'rgba(11,16,32,0.85)'; ctx.fillText(e.label, x0 + pw / 2, y0 + ph / 2 + ph * 0.24); }
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    });
    // axes labels + cursor readout
    ctx.fillStyle = 'rgba(226,232,240,0.85)'; ctx.font = font(10.5);
    ctx.fillText('+y 손가락 (distal)', 8 * dpr, 14 * dpr); ctx.fillText('−y 몸통 (proximal)', 8 * dpr, h - 8 * dpr);
    ctx.textAlign = 'right'; ctx.fillText('+x 엄지 →', w - 8 * dpr, h / 2 - 4 * dpr); ctx.textAlign = 'left'; ctx.fillText('← −x 새끼', 8 * dpr, h / 2 - 4 * dpr);
    ctx.fillStyle = 'rgba(148,163,184,0.95)'; ctx.textAlign = 'right'; ctx.fillText(`커서 x ${hover.x.toFixed(1)}  y ${hover.y.toFixed(1)} mm · 줌 ${view.pxPerMm.toFixed(0)} px/mm (휠)`, w - 8 * dpr, 14 * dpr); ctx.textAlign = 'left';
  }

  // Volar wrist outline (mm, wrist frame: u = lateral, + thumb; v = along, 0 = wrist crease, − proximal),
  // mapped into sheet-local coordinates x = ±(u − sheetLateral), y = v − sheetAlong. Right wrist: thumb on
  // the right (+x). Left wrist: mirrored (thumb on the left). Anatomy from capacitiveArray.WRIST_ANATOMY.
  function drawWrist(ctx, w, h, dpr, s) {
    const A = WRIST_ANATOMY, sgn = wristSide === 'left' ? -1 : 1;
    const fcrU = anat.fcr, plU = anat.pl, artU = anat.artery;
    // 해부 치수는 손목 폭 가정에 비례해 커진다(사진 정합과 같은 배율). 패치/시트 위치는 실물이므로 배율 없음.
    const kW = widthScale();
    const X = (u) => toPx(sgn * (u - sheetPos.lateral), 0, w, h, dpr)[0];
    const Y = (v) => toPx(0, v - sheetPos.along, w, h, dpr)[1];
    const creaseHalf = 28 * kW, forearmHalf = 34 * kW, palmHalf = 40 * kW; // half-widths (mm) at crease / 80 mm proximal / 40 mm distal
    const boneU = A.RADIUS_BONE_LATERAL_MM * kW, ulnaU = -24 * kW;
    ctx.save();
    const hand = HAND_IMG[wristSide === 'left' ? 'left' : 'right'];
    if (hand && hand.img) {
      // Photo: image pixel (ix, iy) → sheet-local mm: x = (ix − cx)/k − sgn·sheetLateral, y = −sheetAlong − (iy − cy)/k
      // k = px/mm = 최협부 픽셀 폭 ÷ 손목 폭 가정 (폭 가정이 커지면 사진이 크게 그려진다)
      const k = hand.widthPx / wristWidth_mm, sc = s / k; // canvas px per image px
      // registration point (cx, cy) = wrist midline at the crease → sheet-local (−sgn·sheetLateral, −sheetAlong)
      const [rx, ry] = toPx(-sgn * sheetPos.lateral, -sheetPos.along, w, h, dpr);
      ctx.save(); ctx.globalAlpha = 0.92;
      ctx.translate(rx, ry); ctx.rotate((anat.rot || 0) * Math.PI / 180);
      ctx.drawImage(hand.img, -hand.cx * sc, -hand.cy * sc, hand.img.width * sc, hand.img.height * sc);
      ctx.restore();
    } else {
    // Skin silhouette — smooth Bézier outline (forearm gently narrowing to the wrist crease, then
    // flaring into the palm), light skin fill, thick soft outline.
    const L = -1, R = 1;
    const side = (sg) => ({ fore: X(sg * forearmHalf), f1: X(sg * (forearmHalf - 2)), f2: X(sg * (creaseHalf + 1.5)), crease: X(sg * creaseHalf), p1: X(sg * (creaseHalf + 1)), p2: X(sg * (palmHalf - 3)), palm: X(sg * palmHalf) });
    const l = side(L), r = side(R);
    const yFore = Y(-95), yCrease = Y(0), yPalm = Y(46), yTop = Y(60);
    ctx.beginPath();
    ctx.moveTo(l.fore, yFore);
    ctx.bezierCurveTo(l.f1, Y(-55), l.f2, Y(-22), l.crease, yCrease);
    ctx.bezierCurveTo(l.p1, Y(14), l.p2, Y(30), l.palm, yPalm);
    ctx.lineTo(l.palm, yTop); ctx.lineTo(r.palm, yTop); ctx.lineTo(r.palm, yPalm);
    ctx.bezierCurveTo(r.p2, Y(30), r.p1, Y(14), r.crease, yCrease);
    ctx.bezierCurveTo(r.f2, Y(-22), r.f1, Y(-55), r.fore, yFore);
    ctx.closePath();
    ctx.fillStyle = 'rgba(246, 212, 182, 0.30)'; ctx.fill(); // light skin tone
    // thick soft outline (two strokes: wide translucent halo + crisp line)
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(246, 212, 182, 0.35)'; ctx.lineWidth = 7 * dpr; ctx.stroke();
    ctx.strokeStyle = 'rgba(250, 225, 200, 0.95)'; ctx.lineWidth = 2.6 * dpr; ctx.stroke();
    }
    // Approximate FPCB + adhesive patch footprint: rounded head around the electrode sheet (+4 mm
    // adhesive margin), a 10 mm FPC neck running proximally, and a rounded connector/adhesive tab —
    // translucent white so the skin photo stays visible.
    {
      const m = 4, headW = layout.sheetW + 2 * m, headH = layout.sheetH + 2 * m;
      const [hx, hy] = toPx(-headW / 2, headH / 2, w, h, dpr); const hw = headW * s, hh = headH * s, rr = 3 * s;
      // Only the electrode patch (adhesive head) is drawn — no FPC neck / connector tab.
      ctx.save(); ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(hx, hy, hw, hh, rr); else ctx.rect(hx, hy, hw, hh);
      ctx.fillStyle = 'rgba(255,255,255,0.38)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1.2 * dpr; ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 0.95;
    // wrist crease (gently curved skin fold)
    ctx.strokeStyle = 'rgba(250,225,200,0.6)'; ctx.lineWidth = 1.6 * dpr; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(X(-creaseHalf + 2), Y(0)); ctx.quadraticCurveTo(X(0), Y(-2.5), X(creaseHalf - 2), Y(0)); ctx.stroke();
    // radial artery (red): lateral 12, slight ulnar drift proximally; deeper proximally (thinner line)
    ctx.strokeStyle = 'rgba(248,113,113,0.85)'; ctx.lineWidth = 2.2 * dpr; ctx.beginPath(); ctx.moveTo(X(artU + 1.2), Y(8)); ctx.lineTo(X(artU), Y(0)); ctx.lineTo(X(artU - 0.5), Y(-80)); ctx.stroke(); // runs parallel to (just radial of) the FCR ridge — no crossing
    // tendons (white): FCR, palmaris longus
    ctx.strokeStyle = 'rgba(226,232,240,0.5)'; ctx.lineWidth = 3 * dpr;
    for (const u of [fcrU, plU]) { ctx.beginPath(); ctx.moveTo(X(u), Y(6)); ctx.lineTo(X(u - 0.5), Y(-80)); ctx.stroke(); }
    // radius / ulna bone edges (grey dashed)
    ctx.strokeStyle = 'rgba(148,163,184,0.5)'; ctx.lineWidth = 1.5 * dpr; ctx.setLineDash([3 * dpr, 3 * dpr]);
    ctx.beginPath(); ctx.moveTo(X(boneU), Y(2)); ctx.lineTo(X(boneU - 2 * kW), Y(-80)); ctx.moveTo(X(ulnaU), Y(2)); ctx.lineTo(X(ulnaU + 2 * kW), Y(-80)); ctx.stroke(); ctx.setLineDash([]);
    // labels
    const font = (p) => `${p * dpr}px ui-monospace, Menlo, monospace`;
    ctx.font = font(10); ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(248,113,113,0.95)'; ctx.fillText('요골동맥', X(artU), Y(12));
    ctx.fillStyle = 'rgba(226,232,240,0.75)'; ctx.fillText('FCR', X(fcrU), Y(10)); ctx.fillText('PL', X(plU), Y(10));
    ctx.fillStyle = 'rgba(148,163,184,0.85)'; ctx.fillText('요골', X(boneU), Y(6)); ctx.fillText('척골', X(ulnaU), Y(6));
    ctx.fillStyle = 'rgba(251,191,36,0.9)'; ctx.fillText(`${wristSide === 'left' ? '왼손' : '오른손'} 손목 (손바닥 쪽) · 손목 주름`, X(0), Y(-3));
    ctx.fillText(wristSide === 'left' ? '← 엄지' : '엄지 →', X(sgn * 26 * kW), Y(-10));
    ctx.textAlign = 'left'; ctx.restore();
  }

  // Zoom so the patch is drawn at TRUE scale relative to the wrist when the outline is shown
  // (wrist ≈ 60 mm wide at the crease), or to fit the sheet otherwise.
  function fitView() {
    if (!canvas || !layout) return;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    // 100 × 110 mm = 기준 폭 58 mm 손목 + 손바닥이 들어가는 크기 → 폭 가정에 비례해 넓힌다
    if (wristSide !== 'none') view.pxPerMm = Math.max(3, Math.min(30, Math.floor(Math.min(W / (100 * widthScale()), H / (110 * widthScale()))))); // whole wrist + palm in view, patch at true scale
    else view.pxPerMm = Math.max(4, Math.min(30, Math.floor(Math.min(W / (layout.sheetW + 8), H / (layout.sheetH + 8)))));
  }

  function hit(mm) { for (let i = layout.electrodes.length - 1; i >= 0; i--) { const e = layout.electrodes[i]; if (Math.abs(mm.x - e.x) <= e.w / 2 && Math.abs(mm.y - e.y) <= e.h / 2) return i; } return -1; }
  function onDown(ev) { if (!layout) return; const mm = toMm(ev.clientX, ev.clientY); const i = hit(mm); sel = i; if (i >= 0) { const e = layout.electrodes[i]; drag = { idx: i, dx: mm.x - e.x, dy: mm.y - e.y }; canvas.setPointerCapture(ev.pointerId); } syncSelUi(); draw(); }
  function onMove(ev) { if (!layout) return; const mm = toMm(ev.clientX, ev.clientY); hover = mm; if (drag) { const e = layout.electrodes[drag.idx]; const nx = snap(mm.x - drag.dx), ny = snap(mm.y - drag.dy); if (nx !== e.x || ny !== e.y) { e.x = round1(nx); e.y = round1(ny); ui.ex.value = e.x; ui.ey.value = e.y; } } draw(); }
  function onUp(ev) { if (drag) { const i = drag.idx; drag = null; const e = layout.electrodes.map((q) => ({ ...q })); setLayout({ ...layout, electrodes: e }, i, true); } }

  function open() {
    if (!modal) build();
    const cur = getCurrent ? getCurrent() : null;
    if (cur && cur.sheet) sheetPos = { lateral: cur.sheet.lateral_mm, along: cur.sheet.along_mm };
    // 체형에서 유도된 손목 폭(기본 체형 → 58.0 mm 정확히) — 사진 정합·가이드 선의 스케일 기준
    setWristWidth(cur && cur.wrist ? cur.wrist.width_mm : WRIST_WIDTH_REF_MM);
    if (wristSide !== 'none') applyOverlayDefaults(wristSide);
    if (cur && cur.electrodes) { setLayout(cur, -1); ui.name.value = cur.name && !/^\d+×\d+/.test(cur.name) ? cur.name : ''; }
    else if (!layout) { setLayout(PRESETS[Object.keys(PRESETS)[0]](), -1); } // reference patch preset (3×4, middle row +½ pitch)
    const qp = new URLSearchParams(location.search); const savedSide = loadOverlayPrefs().side; const wantSide = qp.get('wrist') || (savedSide && savedSide !== 'none' ? savedSide : null); if (wantSide && ui.wristBtns[wantSide] && wristSide !== wantSide) ui.wristBtns[wantSide].click();
    refreshThumbs();
    modal.classList.remove('hidden');
    fitView();
    requestAnimationFrame(draw);
  }
  function close() { if (modal) modal.classList.add('hidden'); }
  return { open, close, refreshSaved: () => { if (ui.saved) refreshSaved(); } };
}
