import {clipPatchPath} from './patchGeometry.js';
// Capacitive array snapshot visualizer with three modes:
//   'heatmap' — 2D colour grid (canvas 2D)
//   'bars'    — 3D cylinders whose height follows each electrode's ΔC (Three.js)
//   'surface' — 3D mesh surface over the electrode grid, potential-map style (Three.js)
// Two stacked canvases are used because a canvas cannot hold both 2D and WebGL contexts.

import * as THREE from './vendor/three.module.js';
import { Heatmap, ContourMap } from './charts.js';

function colormap(t) {
  t = Math.max(0, Math.min(1, t));
  const stops = [[30, 41, 99], [56, 189, 248], [250, 204, 21], [239, 68, 68]];
  const s = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(s));
  const f = s - i;
  const a = stops[i], b = stops[i + 1];
  return new THREE.Color((a[0] + (b[0] - a[0]) * f) / 255, (a[1] + (b[1] - a[1]) * f) / 255, (a[2] + (b[2] - a[2]) * f) / 255);
}

export class ArrayViz {
  constructor(canvas2d, canvas3d) {
    this.mode = 'heatmap';
    this.canvas2d = canvas2d;
    this.canvas3d = canvas3d;
    this.heatmap = new Heatmap(canvas2d);
    this.contour = new ContourMap(canvas2d);
    this.three = null; // lazily created
    this.rows = 0; this.cols = 0;
    // Same frame as the wrist 3D view: rows (proximal→distal) run along +X, columns (ulnar→thumb)
    // along +Z, volar surface = +Y. Same initial azimuth as the wrist view so the distal direction
    // points north-west on screen and the thumb side is to the right.
    this.orbit = { theta: Math.PI + Math.atan(1 / Math.cos(1.05)), phi: 1.05, radius: 2.3, dragging: false, lastX: 0, lastY: 0 };
    this.setMode('heatmap');
  }

  setMode(mode) {
    this.mode = mode;
    const is3d = mode !== 'heatmap' && mode !== 'contour';
    this.canvas2d.style.display = is3d ? 'none' : 'block';
    this.canvas3d.style.display = is3d ? 'block' : 'none';
    if (is3d && !this.three) this._initThree();
    if (this.three) {
      this.three.barsGroup.visible = mode === 'bars';
      this.three.surfaceGroup.visible = mode === 'surface';
    }
  }

  _initThree() {
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: this.canvas3d, antialias: true, alpha: true });
    } catch (e) {
      console.warn('ArrayViz 3D disabled:', e);
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 50);
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a1410, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(2, 3, 2); scene.add(key);

    // Base plate representing the wrist band area
    const plate = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.04, 2.2), new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.9 }));
    plate.position.y = -0.02; scene.add(plate);

    const barsGroup = new THREE.Group(); scene.add(barsGroup);
    const surfaceGroup = new THREE.Group(); scene.add(surfaceGroup);

    // Artery centre marker: thin line along the proximal→distal axis (+X)
    const arteryLine = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:.95,depthTest:false}));
    arteryLine.position.y = 0.006; scene.add(arteryLine);

    const floorGroup = new THREE.Group(); scene.add(floorGroup); // grid lines + electrode numbers + axis labels
    this.three = { renderer, scene, camera, barsGroup, surfaceGroup, floorGroup, arteryLine, bars: [], surface: null, surfaceRows: 0, surfaceCols: 0, floorRows: 0, floorCols: 0 };

    // Simple orbit on the 3D canvas
    const el = this.canvas3d;
    el.addEventListener('pointerdown', (e) => { this.orbit.dragging = true; this.orbit.lastX = e.clientX; this.orbit.lastY = e.clientY; });
    window.addEventListener('pointerup', () => { this.orbit.dragging = false; });
    window.addEventListener('pointermove', (e) => {
      if (!this.orbit.dragging) return;
      const dx = e.clientX - this.orbit.lastX, dy = e.clientY - this.orbit.lastY;
      this.orbit.lastX = e.clientX; this.orbit.lastY = e.clientY;
      this.orbit.theta -= dx * 0.008;
      this.orbit.phi = Math.max(0.25, Math.min(1.45, this.orbit.phi - dy * 0.008));
    });
    el.addEventListener('wheel', (e) => { e.preventDefault(); this.orbit.radius = Math.max(1.2, Math.min(6, this.orbit.radius + e.deltaY * 0.003)); }, { passive: false });
  }

  _layout(rows, cols) {
    // Physical layout in the wrist frame: rows along X (proximal −x → distal +x), cols along Z (ulnar −z → thumb +z).
    const span = 1.3;
    const pitch = span / Math.max(rows, cols, 2);
    return { pitch, x0: -((rows - 1) * pitch) / 2, z0: -((cols - 1) * pitch) / 2 };
  }

  // Canvas-textured label sprite (opaque thin text), always facing the camera, drawn on top.
  _labelSprite(text, { color = '#ffffff', size = 48, bg = null } = {}) {
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64;
    const ctx = cv.getContext('2d');
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, 128, 64); }
    ctx.font = `500 ${size}px ui-monospace, Menlo, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(11,16,32,0.9)'; ctx.strokeText(text, 64, 34);
    ctx.fillStyle = color; ctx.fillText(text, 64, 34);
    const tex = new THREE.CanvasTexture(cv);
    // Depth-tested so the bars / surface occlude the floor numbers (they live on the floor plane)
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false }));
    return sp;
  }

  // Floor: cell grid at the electrode pitch (same frame as the wrist view), electrode numbers at each
  // footprint, and axis labels (distal / thumb side) so the orientation is unambiguous.
  _rebuildFloor(rows, cols) {
    const T = this.three;
    if (T.floorRows === rows && T.floorCols === cols) return;
    while (T.floorGroup.children.length) T.floorGroup.remove(T.floorGroup.children[0]);
    T.floorRows = rows; T.floorCols = cols;
    const { pitch, x0, z0 } = this._layout(rows, cols);
    const xMin = x0 - pitch / 2, xMax = x0 + (rows - 0.5) * pitch, zMin = z0 - pitch / 2, zMax = z0 + (cols - 0.5) * pitch;
    const pts = [];
    for (let i = 0; i <= rows; i++) { const x = xMin + i * pitch; pts.push(x, 0.005, zMin, x, 0.005, zMax); }
    for (let j = 0; j <= cols; j++) { const z = zMin + j * pitch; pts.push(xMin, 0.005, z, xMax, 0.005, z); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    T.floorGroup.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.55 })));
    // Electrode numbers at the footprint corner (proximal-ulnar corner of each cell) so bars don't hide them
    if (!this.custom) for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const k = r * cols + c;
      const s = this._labelSprite(String(k + 1), { size: 44 });
      s.scale.set(pitch * 0.55, pitch * 0.28, 1);
      s.position.set(x0 + r * pitch - pitch * 0.3, 0.012, z0 + c * pitch - pitch * 0.3);
      T.floorGroup.add(s);
    }
    const ax = this._labelSprite('손가락', { color: '#fbbf24', size: 34 }); ax.scale.set(pitch * 1.2, pitch * 0.42, 1); ax.position.set(xMax + pitch * 0.55, 0.02, 0); T.floorGroup.add(ax);
    const az = this._labelSprite('엄지쪽', { color: '#fbbf24', size: 34 }); az.scale.set(pitch * 1.2, pitch * 0.42, 1); az.position.set(0, 0.02, zMax + pitch * 0.6); T.floorGroup.add(az);
    const ap = this._labelSprite('몸통', { color: '#94a3b8', size: 34 }); ap.scale.set(pitch * 1.0, pitch * 0.42, 1); ap.position.set(xMin - pitch * 0.5, 0.02, 0); T.floorGroup.add(ap);
  }

  _rebuildBars(rows, cols) {
    this._rebuildFloor(rows, cols);
    const T = this.three;
    while (T.barsGroup.children.length) T.barsGroup.remove(T.barsGroup.children[0]);
    T.bars = [];
    const { pitch, x0, z0 } = this._layout(rows, cols);
    const radius = pitch * 0.32;
    const geo = new THREE.CylinderGeometry(radius, radius, 1, 20);
    geo.translate(0, 0.5, 0); // pivot at base so scaling y grows upward
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.35, metalness: 0.2 }));
        m.position.set(x0 + r * pitch, 0, z0 + c * pitch); // x = along (row), z = lateral (col)
        T.barsGroup.add(m); T.bars.push(m);
      }
    }
  }

  _rebuildSurface(rows, cols) {
    this._rebuildFloor(rows, cols);
    const T = this.three;
    while (T.surfaceGroup.children.length) T.surfaceGroup.remove(T.surfaceGroup.children[0]);
    const { pitch } = this._layout(rows, cols);
    // Plane x-extent = along (rows), z-extent = lateral (cols); bilinear upsampling ×4 per pitch
    const w = (rows - 1) * pitch || pitch, h = (cols - 1) * pitch || pitch;
    const segX = Math.max(1, (rows - 1) * 4), segZ = Math.max(1, (cols - 1) * 4);
    const geo = new THREE.PlaneGeometry(w, h, segX, segZ);
    geo.rotateX(-Math.PI / 2);
    const colors = new Float32Array(geo.attributes.position.count * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const solid = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.05, side: THREE.DoubleSide, transparent: true, opacity: 0.92 }));
    const wire = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.18 }));
    T.surfaceGroup.add(solid); T.surfaceGroup.add(wire);
    // Electrode markers on the surface
    const markerGeo = new THREE.SphereGeometry(pitch * 0.08, 10, 8);
    const markers = [];
    const x0 = -w / 2, z0 = -h / 2;
    if (!this.custom) for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const s = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
      s.position.set(x0 + (rows > 1 ? r * (w / (rows - 1)) : 0), 0, z0 + (cols > 1 ? c * (h / (cols - 1)) : 0));
      T.surfaceGroup.add(s); markers.push(s);
    }
    // Iso-lines (등고선) drawn on the surface, rebuilt every frame from the same height field
    const isoGeo = new THREE.BufferGeometry();
    isoGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(0), 3));
    const iso = new THREE.LineSegments(isoGeo, new THREE.LineBasicMaterial({ color: 0x0b1020, transparent: true, opacity: 0.85 }));
    iso.renderOrder = 5;
    T.surfaceGroup.add(iso);
    T.surface = { geo, segX, segZ, w, h, markers, iso, isoGeo };
    T.surfaceRows = rows; T.surfaceCols = cols;
  }

  // Marching squares over the surface height field (nx × nz, heights in `hf`, y = value·0.6) → 3D segments.
  _updateIsoLines(S, hf, nx, nz, levels = 9) {
    const x0 = -S.w / 2, z0 = -S.h / 2, dx = S.w / Math.max(1, nx - 1), dz = S.h / Math.max(1, nz - 1);
    const pts = [];
    const lerp = (p, q, iso) => (iso - p) / ((q - p) || 1e-9);
    for (let L = 1; L < levels; L++) {
      const iso = L / levels, y = iso * 0.6 + 0.004;
      for (let iz = 0; iz < nz - 1; iz++) for (let ix = 0; ix < nx - 1; ix++) {
        const a = hf[iz * nx + ix], b = hf[iz * nx + ix + 1], c = hf[(iz + 1) * nx + ix + 1], d = hf[(iz + 1) * nx + ix];
        const idx = (a > iso ? 8 : 0) | (b > iso ? 4 : 0) | (c > iso ? 2 : 0) | (d > iso ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        const X = x0 + ix * dx, Z = z0 + iz * dz;
        const top = [X + lerp(a, b, iso) * dx, Z], right = [X + dx, Z + lerp(b, c, iso) * dz], bottom = [X + lerp(d, c, iso) * dx, Z + dz], left = [X, Z + lerp(a, d, iso) * dz];
        const seg = (p, q) => { pts.push(p[0], y, p[1], q[0], y, q[1]); };
        switch (idx) {
          case 1: case 14: seg(left, bottom); break;
          case 2: case 13: seg(bottom, right); break;
          case 3: case 12: seg(left, right); break;
          case 4: case 11: seg(top, right); break;
          case 5: seg(left, top); seg(bottom, right); break;
          case 6: case 9: seg(top, bottom); break;
          case 7: case 8: seg(left, top); break;
          case 10: seg(top, right); seg(left, bottom); break;
        }
      }
    }
    S.isoGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(pts), 3));
    S.isoGeo.computeBoundingSphere();
  }

  // grid: number[rows][cols] raw values; arteryLateral_mm / spacingMm for artery-line overlay.
  draw(grid, { arteryLateral_mm = 0, arteryPath = null, spacingMm = 6, estLateral_mm = null, vMin = null, vMax = null, custom = null } = {}) {
    if (!grid || !grid.length) return;
    const rows = grid.length, cols = grid[0].length;
    if (this.mode === 'heatmap') {
      this.heatmap.draw(grid, { arteryLateral_mm, arteryPath, spacingMm, estLateral_mm, vMin, vMax, custom });
      return;
    }
    if (this.mode === 'contour') {
      this.contour.draw(grid, { arteryLateral_mm, arteryPath, spacingMm, estLateral_mm, vMin, vMax, custom });
      return;
    }
    // Dense interpolated grids (custom layouts) carry no per-cell electrode numbers in 3D
    if (!!custom !== !!this.custom) { this.custom = !!custom; if (this.three) { this.three.floorRows = -1; this.three.surfaceRows = -1; } }
    const T = this.three;
    if (!T) return;

    // Fit renderer to CSS size
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas3d.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width)), h = Math.max(1, Math.floor(rect.height));
    if (this.canvas3d.width !== Math.floor(w * dpr) || this.canvas3d.height !== Math.floor(h * dpr)) {
      T.renderer.setSize(w, h, false);
      T.camera.aspect = w / h; T.camera.updateProjectionMatrix();
    }

    // Normalize — with the supplied (peak-hold) scale when given, else per-frame min/max
    let lo = vMin, hi = vMax;
    if (lo == null || hi == null) { lo = Infinity; hi = -Infinity; for (const r of grid) for (const v of r) { if (v < lo) lo = v; if (v > hi) hi = v; } }
    const span = hi - lo || 1;
    const norm = (v) => Math.max(0, Math.min(1, (v - lo) / span));

    const { pitch } = this._layout(rows, cols);
    const centerCol = (cols - 1) / 2 + arteryLateral_mm / spacingMm;
    const points=arteryPath||[{along_mm:-rows*spacingMm/2,lateral_mm:arteryLateral_mm},{along_mm:rows*spacingMm/2,lateral_mm:arteryLateral_mm}];
    T.arteryLine.geometry.setAttribute('position',new THREE.Float32BufferAttribute(clipPatchPath(points,cols*spacingMm/2,rows*spacingMm/2).flatMap(p=>[p.along_mm/spacingMm*pitch,.008,p.lateral_mm/spacingMm*pitch]),3));T.arteryLine.frustumCulled=false; // lateral offset of the artery line
    // Beam-search estimate (yellow) next to the true artery line (white)
    if (!T.estLine) { T.estLine = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.01, 0.008), new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.9 })); T.estLine.position.y = 0.012; T.scene.add(T.estLine); }
    T.estLine.visible = estLateral_mm != null;
    if (estLateral_mm != null) T.estLine.position.z = (((cols - 1) / 2 + estLateral_mm / spacingMm) - (cols - 1) / 2) * pitch;

    if (this.mode === 'bars') {
      if (T.bars.length !== rows * cols) this._rebuildBars(rows, cols);
      let k = 0;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const n = norm(grid[r][c]);
        const m = T.bars[k++];
        m.scale.y = 0.05 + n * 0.9;
        m.material.color.copy(colormap(n));
        m.material.emissive.copy(colormap(n)).multiplyScalar(0.25);
      }
    } else if (this.mode === 'surface') {
      if (!T.surface || T.surfaceRows !== rows || T.surfaceCols !== cols) this._rebuildSurface(rows, cols);
      const S = T.surface;
      const pos = S.geo.attributes.position, col = S.geo.attributes.color;
      const nx = S.segX + 1, nz = S.segZ + 1;
      const hf = new Float32Array(nx * nz); // normalised height field for the iso-lines
      for (let iz = 0; iz < nz; iz++) {
        const gc = cols > 1 ? (iz / (nz - 1)) * (cols - 1) : 0; // fractional column index (z = lateral)
        const c0 = Math.floor(gc), c1 = Math.min(cols - 1, c0 + 1), fc = gc - c0;
        for (let ix = 0; ix < nx; ix++) {
          const gr = rows > 1 ? (ix / (nx - 1)) * (rows - 1) : 0; // fractional row index (x = along)
          const r0 = Math.floor(gr), r1 = Math.min(rows - 1, r0 + 1), fr = gr - r0;
          const v = (1 - fc) * ((1 - fr) * grid[r0][c0] + fr * grid[r1][c0]) + fc * ((1 - fr) * grid[r0][c1] + fr * grid[r1][c1]);
          const n = norm(v);
          const idx = iz * nx + ix;
          pos.setY(idx, n * 0.6);
          hf[idx] = n;
          const cc = colormap(n);
          col.setXYZ(idx, cc.r, cc.g, cc.b);
        }
      }
      pos.needsUpdate = true; col.needsUpdate = true;
      S.geo.computeVertexNormals();
      this._updateIsoLines(S, hf, nx, nz);
      let k = 0;
      if (S.markers.length) for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) S.markers[k++].position.y = norm(grid[r][c]) * 0.6 + 0.012;
    }

    const o = this.orbit;
    T.camera.position.set(o.radius * Math.sin(o.phi) * Math.sin(o.theta), o.radius * Math.cos(o.phi), o.radius * Math.sin(o.phi) * Math.cos(o.theta));
    T.camera.lookAt(0, 0.15, 0);
    T.renderer.render(T.scene, T.camera);
  }
}
