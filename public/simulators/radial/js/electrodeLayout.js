// Electrode patch layouts — data model, normalisation and persistence for the patch design tool.
//
// Layout (all mm, sheet-relative; x = lateral, + toward the thumb; y = along, + distal):
//   { name, sheetW, sheetH, electrodes: [{ x, y, w, h, shape: 'rect' | 'round' | 'circle' }] }
// normalizeLayout() adds row/column indices (r = along-cluster index, proximal → distal; c = order
// within the row, ulnar → thumb) so the analysis core can still form "row beams" for local PTT.
// Regular grids (the Rows/Cols/pitch sliders) are expressed with the same model via gridLayout().

export const MAX_ELECTRODES = 20;
export const SNAP_MM = 0.1;
export const ROW_TOL_MM = 0.5; // electrodes whose along-centres differ by less than this form one row

const STORAGE_KEY = 'dt.layouts';

export function snap(v, step = SNAP_MM) { return Math.round(v / step) * step; }
export function round1(v) { return Math.round(v * 10) / 10; }

// stagger: every second row (r = 1, 3, …) shifted by half the lateral pitch (brick pattern)
export function gridLayout(rows, cols, pitchX, pitchY = pitchX, w = 3, h = 3, shape = 'rect', stagger = false) {
  const electrodes = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) electrodes.push({ x: round1((c - (cols - 1) / 2) * pitchX + (stagger && r % 2 ? pitchX / 2 : 0)), y: round1((r - (rows - 1) / 2) * pitchY), w, h, shape });
  return normalizeLayout({ name: `${rows}×${cols} @ ${pitchX}${pitchY !== pitchX ? '×' + pitchY : ''} mm${stagger ? ' 엇갈림' : ''}`, electrodes });
}

// Assign r/c indices, compute rows/cols counts and (if absent) the sheet size from the footprint.
export function normalizeLayout(layout) {
  const src = layout && Array.isArray(layout.electrodes) ? layout.electrodes : [];
  const els = src.slice(0, MAX_ELECTRODES).map((e) => ({
    x: round1(+e.x || 0), y: round1(+e.y || 0), w: Math.max(0.5, round1(+e.w || 3)), h: Math.max(0.5, round1(+e.h || 3)), shape: e.shape === 'circle' || e.shape === 'round' ? e.shape : 'rect', label: e.label || undefined,
  }));
  // rows = clusters of y (proximal → distal)
  const order = els.map((e, i) => i).sort((a, b) => els[a].y - els[b].y || els[a].x - els[b].x);
  const rowsIdx = []; let cur = null, curMean = 0;
  for (const i of order) {
    const y = els[i].y;
    if (!cur || Math.abs(y - curMean) > ROW_TOL_MM) { cur = []; rowsIdx.push(cur); curMean = y; }
    cur.push(i); curMean = cur.reduce((s, j) => s + els[j].y, 0) / cur.length;
  }
  let maxCols = 0;
  rowsIdx.forEach((row, r) => { row.sort((a, b) => els[a].x - els[b].x); row.forEach((i, c) => { els[i].r = r; els[i].c = c; }); maxCols = Math.max(maxCols, row.length); });
  // Channel numbering follows row-major (r, c) like the regular grid so #1 is proximal-ulnar.
  const ordered = rowsIdx.flat().map((i) => els[i]);
  ordered.forEach((e, k) => { e.k = k; });
  const xs = ordered.map((e) => e.x - e.w / 2).concat(ordered.map((e) => e.x + e.w / 2));
  const ys = ordered.map((e) => e.y - e.h / 2).concat(ordered.map((e) => e.y + e.h / 2));
  const bw = ordered.length ? Math.max(...xs) - Math.min(...xs) : 10, bh = ordered.length ? Math.max(...ys) - Math.min(...ys) : 10;
  const sheetW = Math.max(6, round1(layout && layout.sheetW ? +layout.sheetW : bw + 4));
  const sheetH = Math.max(6, round1(layout && layout.sheetH ? +layout.sheetH : bh + 4));
  const rowAlongs = rowsIdx.map((row) => row.reduce((s, i) => s + els[i].y, 0) / row.length);
  return { name: (layout && layout.name) || 'custom', sheetW, sheetH, electrodes: ordered, rows: rowsIdx.length, cols: maxCols, rowAlongs, id: layout && layout.id ? layout.id : `L${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` };
}

export function layoutKey(layout) { return layout ? `${layout.id}:${layout.electrodes.length}:${layout.sheetW}x${layout.sheetH}` : 'grid'; }

// Minimum edge-to-edge gap between any two electrodes (mm); negative = overlap.
export function minGap(layout) {
  const e = layout.electrodes; let g = Infinity;
  for (let i = 0; i < e.length; i++) for (let j = i + 1; j < e.length; j++) {
    const dx = Math.abs(e[i].x - e[j].x) - (e[i].w + e[j].w) / 2, dy = Math.abs(e[i].y - e[j].y) - (e[i].h + e[j].h) / 2;
    const gap = Math.max(dx, dy); // axis-aligned boxes: separated if either axis gap > 0
    if (gap < g) g = gap;
  }
  return g;
}

// Typical lateral pitch (median gap between distinct x centres) — used by the beam search scan margin.
export function lateralPitch(layout, fallback = 4) {
  const xs = [...new Set(layout.electrodes.map((e) => e.x))].sort((a, b) => a - b);
  if (xs.length < 2) return fallback;
  const gaps = xs.slice(1).map((v, i) => v - xs[i]).sort((a, b) => a - b);
  return gaps[gaps.length >> 1] || fallback;
}

// ---- persistence ----
export function loadLayouts() { try { const o = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (_) { return {}; } }
export function saveLayout(layout) { const all = loadLayouts(); const L = normalizeLayout(layout); all[L.name] = { name: L.name, id: L.id, sheetW: L.sheetW, sheetH: L.sheetH, electrodes: L.electrodes.map(({ x, y, w, h, shape, label }) => ({ x, y, w, h, shape, label })) }; try { localStorage.setItem(STORAGE_KEY, JSON.stringify(all)); } catch (_) {} return L; }
export function deleteLayout(name) { const all = loadLayouts(); delete all[name]; try { localStorage.setItem(STORAGE_KEY, JSON.stringify(all)); } catch (_) {} }
export function getLayout(name) { const all = loadLayouts(); return all[name] ? normalizeLayout(all[name]) : null; }

// A few built-in presets (not stored; listed in the dropdown under the user's saved layouts)
export const PRESETS = {
  // Reference patch (actual FPC design): 3 rows × 4 cols, 3×3 mm pads, 0.5 mm gap (pitch 3.5 mm), the MIDDLE
  // row shifted right (thumb side) by half a pitch. Labels = connector net names (top row C1 B0 B1 A6,
  // middle C0 C2 B5 B2, bottom B6 B3 B4 C3, left→right). Channel numbering stays row-major from proximal-ulnar.
  '프리셋: 3×4 기준 패치 3 mm · 간격 0.5 mm · 가운데 행 반 피치 우측': () => {
    const names = { 2: ['C1', 'B0', 'B1', 'A6'], 1: ['C0', 'C2', 'B5', 'B2'], 0: ['B6', 'B3', 'B4', 'C3'] }; // r=2 distal/top
    const el = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) el.push({ x: round1((c - 1.5) * 3.5 + (r === 1 ? 1.75 : 0)), y: round1((r - 1) * 3.5), w: 3, h: 3, shape: 'rect', label: names[r][c] });
    return normalizeLayout({ name: '프리셋: 3×4 기준 패치 3 mm · 간격 0.5 mm · 가운데 행 반 피치 우측', electrodes: el });
  },
  '프리셋: 3×4 격자 3 mm 패드 · 간격 0.5 mm (정렬)': () => { const L = gridLayout(3, 4, 3.5, 3.5, 3.0, 3.0); return { ...L, name: '프리셋: 3×4 격자 3 mm 패드 · 간격 0.5 mm (정렬)' }; },
  '프리셋: 3×6 격자 3 mm 패드 · 간격 0.5 mm': () => { const L = gridLayout(3, 6, 3.5, 3.5, 3.0, 3.0); return { ...L, name: '프리셋: 3×6 격자 3 mm 패드 · 간격 0.5 mm' }; },
  '프리셋: 6×3 격자 (6행 × 3열) 3 mm 패드 · 간격 0.5 mm': () => { const L = gridLayout(6, 3, 3.5, 3.5, 3.0, 3.0); return { ...L, name: '프리셋: 6×3 격자 (6행 × 3열) 3 mm 패드 · 간격 0.5 mm' }; },
  // 4×4 grid rotated by atan(1/4) ≈ 14.0°: every electrode has a UNIQUE x and a UNIQUE y projection
  // (x' ∝ 4c − r, y' ∝ c + 4r), so lateral beam search and along-axis delay mapping both see 16 distinct positions
  '프리셋: 4×4 회전 격자 (≈14°, x·y 투영 모두 고유)': () => {
    const th = Math.atan(1 / 4), cs = Math.cos(th), sn = Math.sin(th), p = 3.5, el = [];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { const x = (c - 1.5) * p, y = (r - 1.5) * p; el.push({ x: round1(x * cs - y * sn), y: round1(x * sn + y * cs), w: 2.6, h: 2.6, shape: 'rect' }); }
    return normalizeLayout({ name: '프리셋: 4×4 회전 격자 (≈14°, x·y 투영 모두 고유)', electrodes: el });
  },
  '프리셋: 2×5 스트립 (가로 1.5×4 mm)': () => { const L = gridLayout(2, 5, 3.0, 6.0, 1.5, 4.0); return { ...L, name: '프리셋: 2×5 스트립 (가로 1.5×4 mm)' }; },
  '프리셋: 4×4 원형 Ø2 mm @3 mm': () => { const L = gridLayout(4, 4, 3.0, 3.0, 2.0, 2.0, 'circle'); return { ...L, name: '프리셋: 4×4 원형 Ø2 mm @3 mm' }; },
  '프리셋: 3열 엇갈림(stagger) 18전극': () => {
    const el = []; for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) el.push({ x: (c - 2.5) * 3.5 + (r % 2 ? 1.75 : 0), y: (r - 1) * 4.5, w: 2.4, h: 3.2, shape: 'round' });
    return normalizeLayout({ name: '프리셋: 3열 엇갈림(stagger) 18전극', electrodes: el });
  },
};
