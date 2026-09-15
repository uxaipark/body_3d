
import {html,t} from '../../../i18n/locale.js';
// Custom vertical scrollbars for the two scrolling columns (left controls / right charts).
//  • The native scrollbar of each column is hidden; a thick track (.vsb) is drawn next to it.
//  • Every top-level card/panel in the column gets a small shortcut icon on the track at the position
//    of the card; clicking the icon scrolls the card to the centre of the column. The icon of the card
//    nearest the viewport centre is highlighted.
//  • Thumb drag, track click (page jump) and wheel-over-track all scroll the column.
//  • Layout changes (card reordering via drag-drop, collapse/expand, window resize) are tracked with
//    ResizeObserver + MutationObserver, so icon positions always stay in sync.
//  • NARROW WIDTHS (≤ 1100 px, ROADMAP §2.3-16): the two-column model is gone — the PAGE scrolls and
//    both columns stack. Instead of dropping the feature, the two column bars are folded away and a
//    single **page rail** (same track, same shortcut icons, `attachScrollbar(…, { page: true })`)
//    is pinned to the right edge and drives the window scroll. Switching back restores the columns.

// Monochrome line glyphs (scientific-instrument style), 24×24 viewBox, stroke = currentColor.
const S = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const GLYPH = {
  body: S('<circle cx="12" cy="5" r="2.4"/><path d="M12 7.6v6.2M8.2 10.2l3.8-1.6 3.8 1.6M12 13.8l-2.6 6.4M12 13.8l2.6 6.4"/>'),
  sliders: S('<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="1.8" fill="#0f172a"/><circle cx="15" cy="12" r="1.8" fill="#0f172a"/><circle cx="8" cy="17" r="1.8" fill="#0f172a"/>'),
  wrist: S('<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/><circle cx="15.5" cy="10" r="1.6"/><path d="M6 16.5h12"/>'), // cross-section: artery + electrode sheet
  grid: S('<circle cx="7" cy="7" r="1.4"/><circle cx="12" cy="7" r="1.4"/><circle cx="17" cy="7" r="1.4"/><circle cx="7" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="17" cy="12" r="1.4"/><circle cx="7" cy="17" r="1.4"/><circle cx="12" cy="17" r="1.4"/><circle cx="17" cy="17" r="1.4"/>'),
  heart: S('<path d="M12 20s-7-4.6-7-10a4 4 0 0 1 7-2.4A4 4 0 0 1 19 10c0 5.4-7 10-7 10z"/><path d="M6.5 12h3l1.2-2.4 1.6 4.8 1.4-3.2.9 0.8h3"/>'),
  pulse: S('<path d="M3 14h3.5l1.6-5 2 9 2-7.5 1.4 3.5H21"/>'),
  sensor: S('<path d="M3 16c2-4 3-6 4.5-6s2.5 6 4.5 6 3-6 4.5-6 2.5 6 4.5 6"/><path d="M3 9h18" stroke-dasharray="1.8 2.2"/>'),
  heatmap: S('<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16"/><rect x="9.3" y="9.3" width="5.3" height="5.3" fill="currentColor" stroke="none" opacity="0.8"/>'),
  axes: S('<path d="M5 19V6M5 19h13"/><path d="M5 6l-2 2.5M5 6l2 2.5M18 19l-2.5-2M18 19l-2.5 2"/><path d="M8 15l3-4 3 2.5 3-5"/>'),
  spo2: S('<path d="M12 3.5s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11z"/><path d="M9.5 15a2.5 2.5 0 0 0 2.5 2.5"/>'),
  anatomy: S('<path d="M12 3v7M12 10c0 3-4 4-4 8M12 10c0 3 4 4 4 8M8 18v3M16 18v3"/><circle cx="12" cy="3" r="0" /><path d="M9.5 6.5h5"/>'),
  dot: S('<circle cx="12" cy="12" r="3"/>'),
};
const ICONS = [
  // [matcher, glyph, label] — first match wins
  [(el) => el.classList.contains('avatar') || el.classList.contains('avatar-card'), 'body', '3D 아바타'],
  [(el) => el.classList.contains('wrist') || el.classList.contains('wrist-card'), 'wrist', '손목 단면 · 전극 시트'],
  [(el) => el.classList.contains('hemo'), 'pulse', '혈역학 — 동맥압 · 유속'],
  [(el) => el.classList.contains('sensors'), 'sensor', '센서 파형 — 정전용량 · PPG'],
  [(el) => el.classList.contains('array'), 'heatmap', '정전용량 어레이 — 스냅샷 · Δt'],
  [(el) => el.classList.contains('motion'), 'axes', '움직임 — EMG · IMU'],
  [(el) => el.classList.contains('spo2'), 'spo2', 'SpO₂'],
  [(el) => el.classList.contains('anatomy'), 'anatomy', '해부학적 경로'],
  [(el) => /자세/.test(el.textContent || ''), 'sliders', '자세 / 움직임'],
  [(el) => /정전용량 어레이/.test((el.querySelector('h2,h3') || {}).textContent || ''), 'grid', '손목 정전용량 어레이 / 전극 패치'],
  [(el) => /심장/.test((el.querySelector('h2,h3') || {}).textContent || ''), 'heart', '심장 / 혈압'],
];
function iconFor(el) {
  for (const [m, g, lb] of ICONS) { try { if (m(el)) return { ic: GLYPH[g], lb }; } catch (_) { /* ignore */ } }
  const h = el.querySelector('h2,h3');
  return { ic: GLYPH.dot, lb: h ? h.textContent.trim() : el.className };
}

export function attachScrollbar(scroller, opts = {}) {
  const page = !!opts.page; // page mode: `scroller` is the document scroller, the bar is a fixed rail
  const targets = opts.targets || ((root) => Array.from(root.children));
  const bar = document.createElement('div'); bar.className = page ? 'vsb page-rail' : 'vsb';
  const thumb = document.createElement('div'); thumb.className = 'vsb-thumb';
  const icons = document.createElement('div'); icons.className = 'vsb-icons';
  bar.appendChild(thumb); bar.appendChild(icons);
  if (page) document.body.appendChild(bar);
  else {
    // wrap: <div class="scol"> scroller <div class="vsb"> </div>
    const wrap = document.createElement('div'); wrap.className = 'scol';
    scroller.parentNode.insertBefore(wrap, scroller); wrap.appendChild(scroller);
    wrap.appendChild(bar);
    scroller.classList.add('noscrollbar');
  }

  const MIN_THUMB = 28, PAD = 10; // track padding top/bottom (px) — keeps end icons inside the track
  let iconEls = [];
  let enabled = true;

  // Card offset measured against the scroller itself — works for a column scroller AND for the page
  // rail (where the cards sit inside positioned wrappers, so `offsetTop` is not relative to it).
  function topOf(el) {
    if (page) return el.getBoundingClientRect().top + (window.scrollY || scroller.scrollTop || 0);
    return el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  }
  const viewH = () => (page ? window.innerHeight : scroller.clientHeight);
  const scrollTop = () => (page ? (window.scrollY || scroller.scrollTop || 0) : scroller.scrollTop);
  const scrollTo = (top, smooth) => {
    const t = Math.max(0, Math.min(maxScroll(), top));
    if (page) window.scrollTo({ top: t, behavior: smooth ? 'smooth' : 'auto' });
    else scroller.scrollTo({ top: t, behavior: smooth ? 'smooth' : 'auto' });
  };
  function trackLen() { return Math.max(1, bar.clientHeight - 2 * PAD); }
  function maxScroll() { return Math.max(0, scroller.scrollHeight - viewH()); }
  function yOf(st) { return PAD + (maxScroll() ? (st / maxScroll()) * (trackLen() - thumbH()) : 0); }
  function thumbH() { const sh = scroller.scrollHeight || 1; return Math.max(MIN_THUMB, Math.min(trackLen(), trackLen() * viewH() / sh)); }

  let lastKey = '';
  function rebuildIcons() {
    const els = targets(scroller).filter((el) => el && el.offsetParent !== null);
    // Rebuild ONLY when the set/order of cards changed (drag-drop reorder, collapse of a whole card).
    // Rebuilding on every DOM mutation inside the cards (chips, values) replaced the buttons
    // continuously → visible jitter and lost click events (the pressed button vanished before `click`).
    const key = els.map((e) => e.className + '|' + (e.id || '')).join(';');
    if (key === lastKey && iconEls.length === els.length) { highlight(); return; }
    lastKey = key;
    icons.innerHTML = localizeHTML(''); iconEls = [];
    // Icons are a FIXED, evenly spaced stack at the top of the track (they never move with the
    // layout or the scroll position) — each is just a shortcut: click → scroll that card to centre.
    const PITCH = Math.min(26, Math.max(18, (bar.clientHeight - 2 * PAD - 12) / Math.max(1, els.length)));
    for (const [i, el] of els.entries()) {
      const { ic, lb } = iconFor(el);
      const b = document.createElement('button'); b.type = 'button'; b.className = 'vsb-ic'; b.innerHTML = localizeHTML(ic); b.title = translateUI(lb); b.setAttribute('aria-label', translateUI(lb));
      const y = PAD + 12 + i * PITCH;
      b.style.top = `${Math.min(bar.clientHeight - PAD, y)}px`;
      b.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); centreOn(el); });
      icons.appendChild(b); iconEls.push({ el, b });
    }
    watchStates();
    highlight();
  }
  function centreOn(el) {
    // Toggle behaviour: clicking the icon of the card that is already open AND centred collapses it;
    // a collapsed card is expanded first (via its heading so the remembered state updates), then
    // scrolled to the centre once the layout has settled; any other card is just centred.
    // "already in view" = the card's centre lies inside the visible part of the column (two cards can
    // share a grid row, so the single 'active' highlight must not be the criterion)
    const cy = topOf(el) + el.offsetHeight / 2;
    const inView = cy >= scrollTop() && cy <= scrollTop() + viewH();
    if (!el.classList.contains('collapsed') && inView) {
      const h = el.querySelector(':scope > h2, :scope > h3');
      if (h) h.click(); else el.classList.add('collapsed');
      requestAnimationFrame(() => layout());
      return;
    }
    if (el.classList.contains('collapsed')) {
      const h = el.querySelector(':scope > h2, :scope > h3');
      if (h) h.click(); else el.classList.remove('collapsed');
      requestAnimationFrame(() => requestAnimationFrame(() => scrollTo(topOf(el) + el.offsetHeight / 2 - viewH() / 2, true)));
      return;
    }
    scrollTo(topOf(el) + el.offsetHeight / 2 - viewH() / 2, true);
  }
  // 아이콘에 카드의 열림/접힘 상태를 표시한다 — 접힌 카드는 점선 테두리 + 흐린 색
  // (2026-08-25 사용자 요청). 클래스 변화는 MutationObserver 로 즉시 따라간다.
  function syncStates() {
    for (const it of iconEls) {
      const col = it.el.classList.contains('collapsed');
      it.b.classList.toggle('is-collapsed', col);
      const base = it.b.dataset.baseTitle || (it.b.dataset.baseTitle = it.b.title.replace(/ — (열림|접힘)$/, ''));
      it.b.title = translateUI(`${base} — ${col ? '접힘' : '열림'}`);
      it.b.setAttribute('aria-expanded', col ? 'false' : 'true');
    }
  }
  let stateObs = null;
  function watchStates() {
    if (stateObs) stateObs.disconnect();
    stateObs = new MutationObserver(syncStates);
    for (const it of iconEls) stateObs.observe(it.el, { attributes: true, attributeFilter: ['class'] });
    syncStates();
  }
  function highlight() {
    const mid = scrollTop() + viewH() / 2;
    let best = null, bd = Infinity;
    for (const it of iconEls) { const d = Math.abs(topOf(it.el) + it.el.offsetHeight / 2 - mid); if (d < bd) { bd = d; best = it; } }
    for (const it of iconEls) it.b.classList.toggle('active', it === best);
    syncStates();
  }
  function layout() {
    if (!enabled) return;
    const ms = maxScroll();
    thumb.style.height = `${thumbH()}px`; thumb.style.top = `${yOf(scrollTop())}px`;
    bar.classList.toggle('noscroll', ms <= 0);
    highlight();
  }

  // --- thumb drag / track click / wheel
  let drag = null;
  thumb.addEventListener('pointerdown', (ev) => { drag = { y0: ev.clientY, st0: scrollTop() }; thumb.setPointerCapture(ev.pointerId); thumb.classList.add('drag'); ev.preventDefault(); });
  thumb.addEventListener('pointermove', (ev) => { if (!drag) return; const range = trackLen() - thumbH(); if (range <= 0) return; scrollTo(drag.st0 + (ev.clientY - drag.y0) / range * maxScroll(), false); });
  const endDrag = () => { drag = null; thumb.classList.remove('drag'); };
  thumb.addEventListener('pointerup', endDrag); thumb.addEventListener('pointercancel', endDrag);
  bar.addEventListener('pointerdown', (ev) => {
    if (ev.target !== bar && ev.target !== icons) return;
    const r = bar.getBoundingClientRect(); const y = ev.clientY - r.top;
    const th = thumbH(), tt = yOf(scrollTop());
    // click above/below the thumb → page jump; far away → jump directly to that fraction
    const frac = Math.max(0, Math.min(1, (y - PAD - th / 2) / Math.max(1, trackLen() - th)));
    const target = frac * maxScroll();
    const pageDir = y < tt ? -1 : y > tt + th ? 1 : 0;
    if (Math.abs(target - scrollTop()) < viewH() * 0.9 || !pageDir) scrollTo(target, true);
    else scrollTo(scrollTop() + pageDir * viewH() * 0.9, true);
  });
  bar.addEventListener('wheel', (ev) => { scrollTo(scrollTop() + ev.deltaY, false); ev.preventDefault(); }, { passive: false });

  (page ? window : scroller).addEventListener('scroll', () => requestAnimationFrame(layout), { passive: true });
  let pending = false;
  const refresh = () => { if (!enabled || pending) return; pending = true; requestAnimationFrame(() => { pending = false; rebuildIcons(); layout(); }); };
  // Size changes → thumb/layout only; structural changes (cards added/removed/reordered) → icon rebuild.
  const ro = new ResizeObserver(() => requestAnimationFrame(layout));
  ro.observe(page ? document.body : scroller);
  if (!page) for (const c of scroller.children) ro.observe(c);
  const moRoot = page ? document.querySelector('main') : scroller;
  const mo = new MutationObserver((muts) => { if (!page) for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1 && n.parentNode === scroller) ro.observe(n); refresh(); });
  if (moRoot) mo.observe(moRoot, { childList: true, subtree: page });
  const grid = (page ? document : scroller).querySelector(page ? 'main .chart-grid' : ':scope > .chart-grid');
  if (grid && !page) mo.observe(grid, { childList: true }); // right column cards
  window.addEventListener('resize', refresh);

  function setEnabled(on) {
    enabled = !!on;
    bar.style.display = enabled ? '' : 'none';
    if (!page) scroller.classList.toggle('noscrollbar', enabled);
    if (enabled) { lastKey = ''; refresh(); }
  }
  refresh();
  return { refresh, centreOn, bar, setEnabled, isEnabled: () => enabled };
}

export const NARROW_QUERY = '(max-width: 1100px)';

export function initScrollbars() {
  const left = document.querySelector('main > .left'), right = document.querySelector('main > .right');
  const out = {};
  if (left) out.left = attachScrollbar(left, { targets: (r) => Array.from(r.children) });
  if (right) out.right = attachScrollbar(right, { targets: (r) => Array.from(r.querySelectorAll(':scope > .chart-grid > .card, :scope > .card')) });

  // Narrow layout: fold the column bars away and drive the page scroll with a single right-edge rail.
  let pageBar = null;
  const mq = window.matchMedia ? window.matchMedia(NARROW_QUERY) : null;
  const apply = () => {
    const narrow = !!(mq && mq.matches);
    document.body.classList.toggle('narrow', narrow);
    if (out.left) out.left.setEnabled(!narrow);
    if (out.right) out.right.setEnabled(!narrow);
    if (narrow && !pageBar) {
      pageBar = attachScrollbar(document.scrollingElement || document.documentElement, {
        page: true,
        targets: () => Array.from(document.querySelectorAll('main .panel.controls, main .chart-grid > .card, main .right > .card')),
      });
      out.page = pageBar;
    }
    if (pageBar) pageBar.setEnabled(narrow);
  };
  if (mq) { (mq.addEventListener ? mq.addEventListener('change', apply) : mq.addListener(apply)); }
  apply();
  out.applyMode = apply;
  out.isNarrow = () => !!(mq && mq.matches);
  return out;
}
