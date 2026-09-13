// 시뮬레이션 설정 프리셋 — 저장 / 불러오기 / 삭제 / 초기화 (2026-08-25 사용자 요청)
//
// 설계 원칙: 엔진 상태를 직접 직렬화하지 않고 **UI 컨트롤의 값**을 저장한다.
//  · 모든 설정은 이미 `index.html` 의 input/select 에 바인딩돼 있고, 그 change/input 핸들러가
//    엔진(worker 포함)·3D 뷰·분석 코어에 값을 전달한다. 컨트롤 값을 되돌리고 이벤트를 다시 쏘면
//    기존 배선을 그대로 재사용하므로 "저장은 됐는데 엔진에는 반영 안 되는" 부류의 버그가 생기지 않는다.
//  · 초기화는 스냅샷이 아니라 **문서의 기본값**(defaultValue / defaultChecked / defaultSelected)을 쓴다.
//    URL 훅이나 localStorage 복원으로 시작값이 이미 바뀌어 있어도 항상 "문서 기본값"으로 돌아간다.
//
// 저장되지 않는 것(의도): 카드 접힘/순서·테마 같은 화면 상태(별도 메뉴에 이미 초기화가 있음),
// 커프 캘리브레이션 결과(측정 이력이지 설정이 아님), 기록/재생·라이브 스트림 연결 상태.

const LS_KEY = 'dt.simPresets';
const SCHEMA = 1;

// 설정으로 볼 컨트롤: <main> 안의 id 있는 input/select. 파일 입력과 버튼류는 제외한다.
function controls() {
  const out = [];
  for (const el of document.querySelectorAll('main input[id], main select[id]')) {
    if (el.type === 'file' || el.type === 'button' || el.type === 'submit') continue;
    if (el.dataset.noPreset != null) continue;
    out.push(el);
  }
  return out;
}

const valueOf = (el) => (el.type === 'checkbox' || el.type === 'radio' ? !!el.checked : el.value);

function setValue(el, v) {
  if (el.type === 'checkbox' || el.type === 'radio') {
    if (el.checked === !!v) return false;
    el.checked = !!v;
  } else {
    if (el.value === String(v)) return false;
    el.value = String(v);
  }
  return true;
}

// 문서 기본값 — 초기화(reset)의 기준.
function documentDefault(el) {
  if (el.type === 'checkbox' || el.type === 'radio') return el.defaultChecked;
  if (el.tagName === 'SELECT') {
    const d = [...el.options].find((o) => o.defaultSelected);
    return d ? d.value : (el.options[0] ? el.options[0].value : '');
  }
  return el.defaultValue;
}

// 값 적용 후 기존 핸들러가 돌도록 이벤트를 쏜다. 라디오는 change, 나머지는 input+change.
function applyMap(map, { onlyChanged = true } = {}) {
  const touched = [];
  for (const el of controls()) {
    if (!(el.id in map)) continue;
    const changed = setValue(el, map[el.id]);
    if (changed || !onlyChanged) touched.push(el);
  }
  for (const el of touched) {
    if (el.type !== 'radio') el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return touched.length;
}

export function snapshotSettings() {
  const v = {};
  for (const el of controls()) v[el.id] = valueOf(el);
  return v;
}

export function applySettings(map) { return applyMap(map || {}); }

export function resetToDocumentDefaults() {
  const v = {};
  for (const el of controls()) v[el.id] = documentDefault(el);
  return applyMap(v);
}

// ---- 저장소 ----
function readAll() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    return raw && raw.schema === SCHEMA && raw.items ? raw.items : {};
  } catch (_) { return {}; }
}
function writeAll(items) {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ schema: SCHEMA, items })); return true; }
  catch (_) { return false; } // 용량 초과 등
}

export function listPresets() {
  const items = readAll();
  return Object.keys(items).sort((a, b) => (items[b].at || '').localeCompare(items[a].at || '') || a.localeCompare(b));
}
export function savePreset(name) {
  const n = String(name || '').trim();
  if (!n) return { ok: false, error: '이름이 비어 있습니다.' };
  const items = readAll();
  items[n] = { at: new Date().toISOString(), v: snapshotSettings() };
  return writeAll(items) ? { ok: true, name: n, count: Object.keys(items[n].v).length }
                         : { ok: false, error: '저장 실패(브라우저 저장 공간).' };
}
export function loadPreset(name) {
  const it = readAll()[name];
  if (!it) return { ok: false, error: '없는 프리셋입니다.' };
  return { ok: true, applied: applySettings(it.v), at: it.at };
}
export function deletePreset(name) {
  const items = readAll();
  if (!(name in items)) return { ok: false, error: '없는 프리셋입니다.' };
  delete items[name];
  return writeAll(items) ? { ok: true } : { ok: false, error: '저장 실패.' };
}
export function presetInfo(name) { return readAll()[name] || null; }

// ---- 설정 모달 (톱 메뉴 "설정" 클릭 시) ----------------------------------------------------
// prompt/confirm 대신 앱 내부 모달로 목록·이름 입력·저장/불러오기/삭제/초기화를 한 화면에서 처리한다.
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
let modal = null, refresh = null, nameInput = null, nameTimer = null, nameDirty = false;

// 기본 프리셋 이름 = 날짜 - 시분초 (2026-08-25 사용자 요청)
const stampName = () => {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} - ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

// 이름 칸을 매 초 현재 시각으로 갱신한다(2026-08-25 사용자 요청). 사용자가 직접 입력했거나
// 목록에서 프리셋을 고른 뒤에는 덮어쓰지 않는다(nameDirty).
function startNameClock() {
  stopNameClock();
  nameTimer = setInterval(() => {
    if (!modal || modal.classList.contains('hidden')) return stopNameClock();
    if (!nameDirty && nameInput && document.activeElement !== nameInput) nameInput.value = stampName();
  }, 1000);
}
function stopNameClock() { if (nameTimer) { clearInterval(nameTimer); nameTimer = null; } }

export function openPresetDialog(anchor = null) {
  // 톱 메뉴 '설정' 을 다시 누르면 닫히도록 토글로 동작한다(2026-08-25 사용자 요청).
  if (modal && !modal.classList.contains('hidden')) { modal.classList.add('hidden'); stopNameClock(); return false; }
  if (!modal) {
    modal = el('div', 'modal hidden presets'); modal.id = 'presetModal';
    modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
    const box = el('div', 'modal-box'); box.style.width = '440px';
    box.appendChild(el('h3', null, '시뮬레이션 설정 — 프리셋'));
    box.appendChild(el('p', 'hint', '현재 화면의 모든 시뮬레이션 컨트롤 값을 이름으로 저장하고 다시 불러옵니다. 카드 접힘·순서·테마와 커프 캘리브레이션 결과는 포함되지 않습니다.'));

    const listWrap = el('div', 'preset-list'); listWrap.setAttribute('role', 'listbox');
    box.appendChild(listWrap);

    const nameRow = el('div', 'preset-name');
    const input = el('input'); input.type = 'text'; input.placeholder = '프리셋 이름'; input.maxLength = 60; nameInput = input;
    const bSave = el('button', 'btn primary', '현재 설정 저장');
    nameRow.appendChild(input); nameRow.appendChild(bSave); box.appendChild(nameRow);

    const status = el('div', 'preset-status', ''); box.appendChild(status);

    const actions = el('div', 'modal-actions');
    const bReset = el('button', 'btn', '기본값으로 초기화');
    const bLoad = el('button', 'btn', '불러오기');
    const bDel = el('button', 'btn', '삭제');
    const bClose = el('button', 'btn primary', '닫기');
    actions.appendChild(bReset); actions.appendChild(bDel); actions.appendChild(bLoad); actions.appendChild(bClose);
    box.appendChild(actions);
    modal.appendChild(box); document.body.appendChild(modal);

    let sel = null;
    const say = (t, bad = false) => { status.textContent = t; status.className = 'preset-status' + (bad ? ' bad' : ''); };
    refresh = () => {
      listWrap.textContent = '';
      const names = listPresets();
      if (!names.length) { listWrap.appendChild(el('div', 'preset-empty', '저장된 프리셋이 없습니다 — 아래에 이름을 입력하고 저장하세요.')); sel = null; }
      for (const n of names) {
        const it = presetInfo(n);
        const row = el('button', 'preset-row' + (n === sel ? ' sel' : '')); row.type = 'button';
        row.appendChild(el('b', null, n));
        row.appendChild(el('span', null, `${new Date(it.at).toLocaleString()} · ${Object.keys(it.v).length}개 항목`));
        row.addEventListener('click', () => { sel = n; input.value = n; nameDirty = true; refresh(); });
        row.addEventListener('dblclick', () => { sel = n; doLoad(); });
        listWrap.appendChild(row);
      }
      bLoad.disabled = bDel.disabled = !sel;
    };
    const doLoad = () => { if (!sel) return; const r = loadPreset(sel); say(r.ok ? `"${sel}" 적용 — ${r.applied}개 항목 변경` : r.error, !r.ok); };
    bSave.addEventListener('click', () => {
      const r = savePreset(input.value);
      if (r.ok) { sel = r.name; refresh(); nameDirty = false; input.value = stampName(); say(`"${r.name}" 저장 — ${r.count}개 항목`); } else say(r.error, true);
    });
    input.addEventListener('input', () => { nameDirty = true; });   // 직접 입력하면 시계 정지
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') bSave.click(); });
    bLoad.addEventListener('click', doLoad);
    bDel.addEventListener('click', () => { if (!sel) return; const n = sel; const r = deletePreset(n); sel = null; refresh(); say(r.ok ? `"${n}" 삭제` : r.error, !r.ok); });
    bReset.addEventListener('click', () => { const n = resetToDocumentDefaults(); say(`기본값으로 초기화 — ${n}개 항목 복원`); });
    bClose.addEventListener('click', () => { modal.classList.add('hidden'); stopNameClock(); });
    modal.addEventListener('click', (e) => { if (e.target === modal) { modal.classList.add('hidden'); stopNameClock(); } });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.classList.contains('hidden')) { modal.classList.add('hidden'); stopNameClock(); } });
  }
  refresh();
  nameDirty = false;
  if (nameInput) nameInput.value = stampName(); // 열 때마다 현재 시각으로 제안
  startNameClock();                              // 그리고 매 초 갱신
  modal.classList.remove('hidden');
  // 화면 한가운데가 아니라 "설정" 메뉴 버튼 바로 아래에 띄운다(2026-08-25 사용자 요청).
  const btn = anchor || [...document.querySelectorAll('.mb-btn')].find((b) => b.textContent.trim() === '설정');
  const box = modal.querySelector('.modal-box');
  if (btn && box) {
    const r = btn.getBoundingClientRect(), bw = box.offsetWidth || 440, bh = box.offsetHeight || 260;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - bw - 8));
    const top = Math.max(8, Math.min(r.bottom + 6, window.innerHeight - bh - 8));
    box.style.position = 'fixed'; box.style.left = `${Math.round(left)}px`; box.style.top = `${Math.round(top)}px`;
  }
  return true;
}
