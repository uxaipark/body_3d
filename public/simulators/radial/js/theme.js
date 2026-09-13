// Theme (dark / light / system) — ROADMAP §2.3-16.
//
// The stylesheet is dark-native: css/style.css defines the dark palette on `:root` and the
// light palette twice — once for an explicit `:root[data-theme="light"]` and once inside
// `@media (prefers-color-scheme: light)` guarded by `:root:not([data-theme="dark"])`. This
// module only decides which of the three states the document is in:
//
//   'system' (default) → NO data-theme attribute → the OS preference decides
//   'dark' / 'light'   → data-theme attribute → beats the media query in both directions
//
// The choice is persisted in localStorage under the existing `dt.*` namespace (`dt.theme`).
// Canvas-drawn plots (charts.js, arrayViz.js, three.js views) keep a dark plot surface in
// both themes — see the note at the top of css/style.css.

const KEY = 'dt.theme';
export const THEMES = ['system', 'dark', 'light'];
export const THEME_LABEL = { system: '시스템 설정 따름', dark: '다크', light: '라이트' };

const mqLight = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;
// `?theme=` overrides the stored choice for this page load only (screenshot / deep-link hook). It is
// reported by getThemePref() so the menu check mark shows what is actually on screen, and it is dropped
// as soon as the user picks a theme from the menu (that choice is the one that gets stored).
let urlOverride = null;

export function getThemePref() {
  if (urlOverride) return urlOverride;
  try { const v = localStorage.getItem(KEY); return THEMES.includes(v) ? v : 'system'; } catch (_) { return 'system'; }
}
/** The theme actually in effect right now ('dark' | 'light'). */
export function effectiveTheme(pref = getThemePref()) {
  if (pref === 'dark' || pref === 'light') return pref;
  return mqLight && mqLight.matches ? 'light' : 'dark';
}
export function setTheme(pref, { persist = true } = {}) {
  const p = THEMES.includes(pref) ? pref : 'system';
  if (persist) urlOverride = null;
  if (p === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', p);
  if (persist) { try { localStorage.setItem(KEY, p); } catch (_) {} }
  const eff = effectiveTheme(p);
  document.dispatchEvent(new CustomEvent('dt:theme', { detail: { pref: p, theme: eff } }));
  return eff;
}
/** dark → light → system → dark … (menu/keyboard shortcut) */
export function cycleTheme() { const i = THEMES.indexOf(getThemePref()); return setTheme(THEMES[(i + 1) % THEMES.length]); }

/** Apply the stored/URL preference at start-up. `?theme=dark|light|system` overrides (not persisted). */
export function initTheme() {
  const q = new URLSearchParams(location.search).get('theme');
  const urlPref = THEMES.includes(q) ? q : null;
  urlOverride = urlPref;
  const pref = urlPref || getThemePref();
  setTheme(pref, { persist: false });
  // While on 'system', follow the OS switching live.
  if (mqLight && mqLight.addEventListener) mqLight.addEventListener('change', () => { if (getThemePref() === 'system' && !urlPref) setTheme('system', { persist: false }); });
  return { pref, theme: effectiveTheme(pref) };
}
