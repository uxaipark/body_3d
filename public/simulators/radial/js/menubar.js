
import {t as translateUI,html as localizeHTML,getLanguage} from '../../../i18n/locale.js';
// Thin top menu bar (28 px) with drop-down menus, including the "Reference" menu that opens a modal
// listing which papers / standards each feature is based on (data: js/references.js).
import { REFERENCES, FEATURES, refNumber } from './references.js';
import { SCENARIOS } from './scenarioPlayer.js';
import { THEMES, THEME_LABEL, getThemePref, setTheme } from './theme.js';

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = translateUI(text); return e; }

export function initMenubar({ actions = {} } = {}) {
  const bar = el('nav', 'menubar'); bar.setAttribute('aria-label', translateUI('메뉴'));
  const brand = el('button', 'mb-brand', 'Radial Artery Digital Twin'); brand.type = 'button'; brand.title = translateUI('메인 화면으로'); brand.addEventListener('click', () => goMain()); bar.appendChild(brand);

  const menus = [
    { label: '보기', items: [
      { label: '메인 (시뮬레이터)', run: () => goMain() },
      { sep: true },
      { label: '모든 카드 접기', run: () => actions.collapseAll && actions.collapseAll(true) },
      { label: '모든 카드 펼치기', run: () => actions.collapseAll && actions.collapseAll(false) },
      { sep: true },
      { label: '카드 순서 초기화', run: () => actions.resetOrder && actions.resetOrder() },
      { label: '카드 열림/접힘 상태 초기화 (모두 펼침)', run: () => actions.resetCollapse && actions.resetCollapse() },
      { sep: true },
      // 테마 (ROADMAP §2.3-16) — 선택은 localStorage `dt.theme` 에 저장, '시스템 설정'은 prefers-color-scheme 를 따름
      ...THEMES.map((t) => ({ label: `테마: ${THEME_LABEL[t]}`, run: () => setTheme(t), check: () => getThemePref() === t })),
    ] },
    { label: '분석', items: [
      { label: '커프 캘리브레이션…', run: () => actions.openCalibration && actions.openCalibration() },
      { label: '일시정지 / 재개', run: () => actions.togglePause && actions.togglePause() },
      { sep: true },
      { label: '엔진: Rust/WASM (기본)', run: () => setParam('core', null), check: () => new URLSearchParams(location.search).get('core') !== 'js' },
      { label: '엔진: JavaScript (참조)', run: () => setParam('core', 'js'), check: () => new URLSearchParams(location.search).get('core') === 'js' },
      { label: '지연-보상 빔포밍', run: () => setParam('nodc', new URLSearchParams(location.search).has('nodc') ? null : '1'), check: () => !new URLSearchParams(location.search).has('nodc') },
    ] },
    { label: '도구', items: [
      { label: '패치 전극 설계도구…', run: () => actions.openDesigner && actions.openDesigner() },
      { sep: true },
      // 시나리오 프리셋 + 타임라인 스크러버 (ROADMAP §2.3-13) — URL ?scenario=<name>
      { label: '시나리오 바 표시 / 숨김', run: () => actions.toggleScenarioBar && actions.toggleScenarioBar(), check: () => !!(actions.scenarioBarShown && actions.scenarioBarShown()) },
      ...Object.entries(SCENARIOS).map(([k, v]) => ({ label: `시나리오: ${v.label}`, run: () => actions.loadScenario && actions.loadScenario(k), check: () => !!(actions.activeScenario && actions.activeScenario() === k) })),
      { label: '시나리오 종료 (수동 조작으로)', run: () => actions.stopScenario && actions.stopScenario() },
      { sep: true },
      { label: '데이터 내보내기… (CSV / JSONL + 파라미터 JSON)', run: () => actions.openExport && actions.openExport() },
      { sep: true },
      { label: '기록 시작 / 정지·저장 (.dtrec)', run: () => actions.toggleRecording && actions.toggleRecording(), check: () => actions.isRecording && actions.isRecording() },
      { label: '기록 재생… (.dtrec 열기)', run: () => actions.openReplay && actions.openReplay(), check: () => actions.isReplaying && actions.isReplaying() },
      { label: '재생 중지 (라이브로 복귀)', run: () => actions.stopReplay && actions.stopReplay() },
      { sep: true },
      // ⑥ 라이브 센서 스트림 (ROADMAP §3-5) — URL ?source=ws://localhost:8787/stream, 안내 docs/LIVE_STREAM.md
      { label: '라이브 센서 스트림 연결… (WebSocket)', run: () => actions.openLive && actions.openLive(), check: () => !!(actions.isLive && actions.isLive()) },
      { label: '라이브 스트림 중지 (트윈으로 복귀)', run: () => actions.stopLive && actions.stopLive() },
    ] },
    { label: '설정', action: (btn) => actions.openPresets && actions.openPresets(btn) },
    {label:'연구 기록',items:[
      {label:'개발·통합 기록',run:()=>openDoc('/research/hand-wrist/02-code-audit.md','SOMA 통합 기록')},
      {label:'손·손목 해부학',run:()=>openDoc('/research/hand-wrist/03-anatomy.md','해부학 자료와 정합')},
      {label:'MRC·MVDR·ECG·혈압 설계',run:()=>openDoc('/research/hand-wrist/05-signal-pipeline.md','센싱 알고리즘 설계')},
      {label:'검증과 적용 범위',run:()=>openDoc('/research/hand-wrist/06-validation.md','검증 계획')},
      {label:'문헌 출처',run:()=>openDoc('/research/hand-wrist/references.md','출처')},
    ]},
  ];

  let open = null;
  const closeAll = () => { if (open) { open.classList.remove('open'); open = null; } };
  // Main view = close whatever full-page view or dialog is on top (designer, reference, doc viewer, …)
  const goMain = () => { closeAll(); closeReferences(); closeDoc(); if (actions.closeDesigner) actions.closeDesigner(); for (const m of document.querySelectorAll('.modal:not(.hidden)')) if (m.id !== 'calibModal') m.classList.add('hidden'); };
  for (const m of menus) {
    const wrap = el('div', 'mb-menu');
    const btn = el('button', 'mb-btn', m.label); btn.type = 'button';
    const list = el('div', 'mb-list'); list.setAttribute('role', 'menu');
    // 동적 메뉴(m.dynamic)는 열릴 때마다 항목을 다시 만든다 — 프리셋 목록처럼 내용이 변하는 메뉴용.
    const renderItems = (items) => {
      list.textContent = translateUI('');
      for (const it of items) {
        if (it.sep) { list.appendChild(el('div', 'mb-sep')); continue; }
        const a = el(it.href ? 'a' : 'button', 'mb-item'); a.setAttribute('role', 'menuitem');
        if (it.href) { a.href = it.href; a.target = '_blank'; a.rel = 'noopener'; } else a.type = 'button';
        if (it.title) a.title = translateUI(it.title);
        const chk = el('span', 'mb-check', ''); a.appendChild(chk); a.appendChild(el('span', 'mb-label', it.label));
        a.addEventListener('click', () => { closeAll(); if (it.run) it.run(); });
        a._it = it; list.appendChild(a);
      }
    };
    renderItems(m.items || []);
    const refreshList = () => { if (m.dynamic) renderItems(m.dynamic()); refreshChecks(list); };
    btn.addEventListener('click', (ev) => { ev.stopPropagation(); if (m.action) { closeAll(); m.action(btn); return; } const was = open === wrap; closeAll(); if (!was) { refreshList(); wrap.classList.add('open'); open = wrap; } });
    wrap.addEventListener('mouseenter', () => { if (m.action) return; if (open && open !== wrap) { closeAll(); refreshList(); wrap.classList.add('open'); open = wrap; } });
    wrap.appendChild(btn); wrap.appendChild(list); bar.appendChild(wrap);
  }
  const status = el('span', 'mb-status', ''); status.id = 'mbStatus'; bar.appendChild(status);
  document.addEventListener('click', closeAll);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeAll(); closeReferences(); closeDoc(); } });
  document.body.insertBefore(bar, document.body.firstChild);
  const qp = new URLSearchParams(location.search);
  if (qp.get('modal') === 'refs') openReferences(); // deep link / screenshot hook
  if (qp.get('modal') === 'presets' && actions.openPresets) actions.openPresets(); // 설정 프리셋 딥링크
  if (qp.get('doc')) openDoc(qp.get('doc'), qp.get('doc'));
  if (qp.get('menu')) { const w = [...bar.querySelectorAll('.mb-menu')].find((m) => m.querySelector('.mb-btn').textContent === translateUI(qp.get('menu'))); if (w) { refreshChecks(w.querySelector('.mb-list')); w.classList.add('open'); open = w; } }
  return { bar, setStatus: (t) => { status.textContent = translateUI(t); } };
}

function refreshChecks(list) { for (const a of list.querySelectorAll('.mb-item')) { const it = a._it; let on = false; try { on = !!(it && it.check && it.check()); } catch (_) { on = false; } a.querySelector('.mb-check').textContent = translateUI(on ? '✓' : ''); } }
function setParam(k, v) { const u = new URL(location.href); if (v == null) u.searchParams.delete(k); else u.searchParams.set(k, v); location.href = u.toString(); }

// ---------------- Reference modal ----------------
let refModal = null;
function buildReferences() {
  const modal = el('div', 'modal hidden refs'); modal.id = 'refModal'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
  const box = el('div', 'modal-box wide');
  const head = el('div', 'refs-head');
  head.appendChild(el('h3', null, 'Reference — 기능별 참고 문헌'));
  const close = el('button', 'btn', '닫기'); close.type = 'button'; close.addEventListener('click', closeReferences); head.appendChild(close);
  box.appendChild(head);
  const intro = el('p', 'refs-intro', '각 기능/모델/알고리즘이 근거로 삼은 논문·표준·교재. 번호는 아래 문헌 목록의 번호. "모델 가정"으로 표시된 항목은 문헌의 정량값이 아니라 본 시뮬레이터의 파라메트릭 근사임.');
  box.appendChild(intro);
  const body = el('div', 'refs-body');
  for (const g of FEATURES) {
    body.appendChild(el('h4', null, g.group));
    const table = el('table', 'refs-table');
    const thead = el('thead'); const tr = el('tr'); for (const h of ['기능 / 모델', '구현 위치', '참고 문헌', '비고']) tr.appendChild(el('th', null, h)); thead.appendChild(tr); table.appendChild(thead);
    const tbody = el('tbody');
    for (const it of g.items) {
      const r = el('tr');
      r.appendChild(el('td', null, it.feature));
      r.appendChild(el('td', 'mono', it.where || ''));
      const tdRefs = el('td');
      it.refs.forEach((id, i) => { const n = refNumber(id); const a = el('a', 'refnum', `[${n}]`); a.href = `#ref-${n}`; a.title = translateUI((REFERENCES[n - 1] || {}).cite || ''); a.addEventListener('click', (e) => { e.preventDefault(); const t = box.querySelector(`#ref-${n}`); if (t) { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); t.classList.add('hl'); setTimeout(() => t.classList.remove('hl'), 1200); } }); tdRefs.appendChild(a); if (i < it.refs.length - 1) tdRefs.appendChild(document.createTextNode(translateUI(' '))); });
      r.appendChild(tdRefs);
      r.appendChild(el('td', 'muted', it.note || ''));
      tbody.appendChild(r);
    }
    table.appendChild(tbody); body.appendChild(table);
  }
  body.appendChild(el('h4', null, '문헌 목록'));
  const ol = el('ol', 'refs-list');
  REFERENCES.forEach((r, i) => { const li = el('li', null, r.cite); li.id = `ref-${i + 1}`; ol.appendChild(li); });
  body.appendChild(ol);
  box.appendChild(body);
  modal.appendChild(box);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeReferences(); });
  document.body.appendChild(modal);
  return modal;
}
export function openReferences() { if (!refModal) refModal = buildReferences(); refModal.classList.remove('hidden'); }
export function closeReferences() { if (refModal) refModal.classList.add('hidden'); }


// ---------------- In-app markdown document viewer (UTF-8 safe; no external libs) ----------------
let docModal = null, docBody = null, docTitle = null;
function escapeHtml(t) { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function inline(md) {
  let h = escapeHtml(md);
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  h = h.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, t, u) => /^https?:/.test(u) ? `<a href="${u}" target="_blank" rel="noopener">${t}</a>` : `<a href="#" data-doc="${u}">${t}</a>`);
  return h;
}
// Minimal Markdown → HTML: headings, paragraphs, bullet/numbered lists, tables, fenced code, hr.
export function markdownToHtml(md) {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out = []; let i = 0; let list = null; let para = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) { flushPara(); closeList(); const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); i++; out.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`); continue; }
    const hm = /^(#{1,6})\s+(.*)$/.exec(l);
    if (hm) { flushPara(); closeList(); out.push(`<h${hm[1].length}>${inline(hm[2])}</h${hm[1].length}>`); i++; continue; }
    if (/^\s*(---|\*\*\*)\s*$/.test(l)) { flushPara(); closeList(); out.push('<hr/>'); i++; continue; }
    if (/^\s*\|/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flushPara(); closeList();
      const cells = (s) => s.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(l); i += 2; const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const lm = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(l);
    if (lm) { flushPara(); const kind = /^\d/.test(lm[1]) ? 'ol' : 'ul'; if (list !== kind) { closeList(); list = kind; out.push(`<${kind}>`); } out.push(`<li>${inline(lm[2])}</li>`); i++; continue; }
    if (!l.trim()) { flushPara(); closeList(); i++; continue; }
    para.push(l); i++;
  }
  flushPara(); closeList();
  return out.join('\n');
}
export async function openDoc(path, title) {
  if(getLanguage()==='en')path=path.replace(/^\/research\/hand-wrist\/(?!en\/)([^/]+\.md)$/, '/research/hand-wrist/en/$1');
  if (!docModal) {
    docModal = el('div', 'modal hidden docview'); docModal.setAttribute('role', 'dialog'); docModal.setAttribute('aria-modal', 'true');
    const box = el('div', 'modal-box wide');
    const head = el('div', 'refs-head'); docTitle = el('h3', null, title || path); head.appendChild(docTitle);
    const right = el('div', 'pd-row'); const raw = el('a', 'btn', '원본 열기'); raw.target = '_blank'; raw.rel = 'noopener'; raw.id = 'docRaw'; right.appendChild(raw);
    const close = el('button', 'btn', '닫기'); close.type = 'button'; close.addEventListener('click', closeDoc); right.appendChild(close); head.appendChild(right);
    box.appendChild(head); docBody = el('div', 'refs-body md'); box.appendChild(docBody); docModal.appendChild(box);
    docModal.addEventListener('click', (e) => { if (e.target === docModal) closeDoc(); });
    docBody.addEventListener('click', (e) => { const a = e.target.closest('a[data-doc]'); if (a) { e.preventDefault(); openDoc(a.getAttribute('data-doc'), a.textContent); } });
    document.body.appendChild(docModal);
  }
  docTitle.textContent = translateUI(title || path); docModal.querySelector('#docRaw').href = path;
  docBody.innerHTML = localizeHTML('<p class="refs-intro">불러오는 중…</p>'); docModal.classList.remove('hidden');
  try {
    const resp = await fetch(path, { cache: 'no-store' }); if (!resp.ok) throw new Error(`${resp.status}`);
    const buf = await resp.arrayBuffer(); const text = new TextDecoder('utf-8').decode(buf); // decode as UTF-8 regardless of server charset
    docBody.innerHTML = localizeHTML(markdownToHtml(text));
  } catch (e) { docBody.innerHTML = localizeHTML(`<p class="refs-intro">문서를 불러올 수 없습니다: ${escapeHtml(String(e))}</p>`); }
}
export function closeDoc() { if (docModal) docModal.classList.add('hidden'); }
