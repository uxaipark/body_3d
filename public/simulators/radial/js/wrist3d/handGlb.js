// js/wrist3d/handGlb.js — the photoscanned hand from `female_hand.glb`, loaded with a locally
// vendored three r172 GLTFLoader and fitted to this view's wrist coordinate frame.
//
// 이 파일이 **유일한 원본**이다.  `proto/variants/handGlb.js` 는 여기로 재수출하는 한 줄짜리
// shim 이므로, 프로토 페이지와 앱(E안)이 같은 코드를 본다.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ 라이선스 — 이 자산은 자유롭게 쓸 수 없다
//   원본 `female_hand.glb` 의 glTF `asset.extras` 에 조건이 들어 있다(파일에서 직접 읽었다):
//     title   : "Female hand"
//     author  : deep3dstudio (https://sketchfab.com/deep3dstudio)
//     license : **CC-BY-NC-4.0**  (http://creativecommons.org/licenses/by-nc/4.0/)
//     source  : https://sketchfab.com/3d-models/female-hand-3e9b8ad1942048e3a267d92fb1124d46
//   즉 **저작자 표시 필수 + 비영리(NonCommercial) 전용**이다.
//   사용자가 **비영리 사용**을 택했으므로 앱에도 넣되, E안이 켜져 있는 동안 손목 카드 푸터에
//   저작자 표시 줄을 띄운다(`index.html` `#handCredit`, `js/main.js`).  **상용 제품·특허 명세·
//   임상 문서·마케팅/투자 자료에는 쓸 수 없다** — 그때는 자산을 교체해야 한다.
//
//   교체는 한 줄이다: `buildGlbHand({ asset, assetBase })` 가 경로를 인자로 받는다.
//     buildGlbHand({ asset: 'my_hand.glb' })                       // assets/my_hand.glb
//     buildGlbHand({ asset: 'x.glb', assetBase: '/vendor/hands/' }) // 다른 디렉터리
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// 용량: 원본은 33.4 MB이고 그 대부분이 **8192² PNG 3장 + 4096² 1장**이다(RGBA8로 올리면 VRAM
// 800 MB 급).  그래서 `assets/female_hand_1k.glb` 로 **다시 패킹**해 쓴다 — 텍스처를
// 1024/512 JPEG로 줄이고, three r172가 더 이상 지원하지 않는 `KHR_materials_pbrSpecularGlossiness`
// 를 표준 `pbrMetallicRoughness` 로 바꿨다(안 바꾸면 손이 흰색으로 로드된다).
// **원본 `female_hand.glb` 는 한 바이트도 건드리지 않았다.**  33.4 MB → 0.42 MB.

import * as THREE from '../vendor/three.module.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';

// 기본 자산 디렉터리 — 이 모듈(js/wrist3d/) 기준으로 저장소 루트의 `assets/`.
// 프로토 페이지도 shim 을 통해 같은 파일을 쓰므로 같은 경로를 본다(사본이 하나뿐).
const DEFAULT_ASSET_BASE = '../../assets/';

const MM = 0.001;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// 정렬은 **하드코딩이 아니라 지오메트리에서 계산**한다 (모델이 바뀌어도 동작하도록).
// 아래 세 가지를 메시에서 직접 재고, 잰 값과 판정 근거를 `stats.frame` 으로 내보낸다.
//   D (원위 방향) : 바운딩박스 최장축 + "손가락 쪽 끝은 슬랩 안에서 여러 덩어리로 갈라진다"로 방향 결정
//   V (장측 방향) : "손끝은 손바닥 쪽으로 휘어 있다" — 손끝 무게중심이 손바닥 무게중심보다
//                   두께축의 어느 쪽에 있는가로 결정 (판정 여유를 `volarMarginUnits` 로 보고)
//   R (요측 방향) : 오른손이면 R = D × V.  판정 검증은 "엄지 기저는 다른 손가락보다 훨씬 근위" —
//                   틀리면 왼손이므로 미러링하고 `stats.frame.handed = 'left'` 로 보고한다
// 그 다음 손목 최협부(근위 40 % 구간의 폭 최소점)를 찾아 **손목 폭 58 mm** 로 균일 스케일하고,
// 그 지점을 우리 손목주름(x = 55 mm)에 놓는다.
// ══════════════════════════════════════════════════════════════════════════════════════════════════
export const ALIGN = {
  wristWidthMm: 58.0,   // §6.16 `WRIST_WIDTH_REF_MM` — 스케일 기준(모델 가정)
  creaseX: 55.0,        // 모델의 손목 최협부를 우리 손목주름 x = 55 mm 에 놓는다
  clipX: 50.0,          // 그보다 근위의 모델 전완 스텁은 잘라 낸다(패치 원위 끝이 x = 52)
  forearmRy: 20.0,      // 우리 전완 원위 링의 반축(깊이) — 체형 배율이 곱해진 값을 넘길 것
  forearmRz: 28.0,      // 우리 전완 원위 링의 반축(폭)
  // 손목 배굴(dorsiflexion).  스캔이 약간 굴곡된 자세로 모델링돼 있어 그냥 붙이면 접합부가 꺾여
  // 보인다.  **회전 중심은 손목 절단 링의 중심**, 회전축은 요-척측(우리 +Z), 부호는 손등 쪽.
  // 12° 는 **작도 가정**이고 프로토에서 슬라이더(0–30°)로 조정할 수 있다.
  extensionDeg: 12,
  // 반지 자리: **손끝에서** 손가락 축을 따라 되짚어 간 거리 / 손가락 전체 길이.
  // 0.82 = 기절골 근위쪽(= MCP 바로 원위) — 결혼반지를 끝까지 민 위치.  MCP 를 추정해서 거기서
  // 오프셋하는 방식은 쓰지 않는다(MCP 추정이 틀리면 반지가 손바닥에 박힌다 — 실제로 그랬다).
  ringTipFrac: 0.82,
  ringFinger: 0,        // 0 = 검지(엄지에 가장 가까운 손가락) … 3 = 소지.  수동 오버라이드용
  volarSignOverride: 0,   // 0 = 자동 판정, ±1 = 강제(손끝 휨이 거의 없는 모델용)
  sleeveOverlap: 4.0,   // 슬리브가 잘린 자리를 이만큼 원위까지 덮는다(잘린 구멍이 보이지 않게)
  scaleBy: 'wrist',     // 'wrist' = 손목 폭 58 mm 기준 | 'hand' = 손 길이 190 mm 기준
  handLengthMm: 190.0,  // scaleBy: 'hand' 일 때의 기준(모델 가정)
};

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

/** Cross-section clusters along axis `w` inside a slab — used to tell the finger end from the wrist. */
function clusterCount(vals, gap) {
  if (vals.length < 8) return 0;
  const s = [...vals].sort((a, b) => a - b);
  let n = 1;
  for (let i = 1; i < s.length; i++) if (s[i] - s[i - 1] > gap) n++;
  return n;
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
function pct(a, q) { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]; }

/**
 * Derive the hand's own frame from the mesh.  All three axes come out of measurements; every
 * decision reports the margin it was made on so a bad model shows up in the log instead of silently
 * producing a hand that faces the wrong way.
 */
export function deriveFrame(pos, opt = {}) {
  const N = pos.count;
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  const P = new Array(N);
  for (let i = 0; i < N; i++) {
    const p = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    P[i] = p;
    for (let k = 0; k < 3; k++) { if (p[k] < mn[k]) mn[k] = p[k]; if (p[k] > mx[k]) mx[k] = p[k]; }
  }
  const ext = [0, 1, 2].map((k) => mx[k] - mn[k]);
  const L = ext.indexOf(Math.max(...ext));                 // length axis
  const rest = [0, 1, 2].filter((k) => k !== L);
  const Wx = ext[rest[0]] >= ext[rest[1]] ? rest[0] : rest[1];   // width axis (the wider of the two)
  const Th = rest[0] === Wx ? rest[1] : rest[0];                 // thickness axis
  const len = ext[L];

  // ── which end is the fingers?  a slab there splits into several clusters along the width axis ──
  const slab = 0.10 * len, gap = 0.028 * len;
  const endClusters = [0, 1].map((endHi) => {
    const lo = endHi ? mx[L] - slab : mn[L];
    const hi = endHi ? mx[L] : mn[L] + slab;
    const v = [];
    for (const p of P) if (p[L] >= lo && p[L] <= hi) v.push(p[Wx]);
    return clusterCount(v, gap);
  });
  const fingersAtHi = endClusters[1] >= endClusters[0];
  const dOf = (p) => (fingersAtHi ? p[L] - mn[L] : mx[L] - p[L]);   // 0 = wrist end
  const Dsign = fingersAtHi ? 1 : -1;

  // ── volar side: the fingertips curl toward the palm ──────────────────────────────────────────
  const palmT = [], tipT = [];
  for (const p of P) {
    const d = dOf(p) / len;
    if (d > 0.30 && d < 0.52) palmT.push(p[Th]);
    else if (d > 0.88) tipT.push(p[Th]);
  }
  const volarMargin = mean(tipT) - mean(palmT);
  const Vsign = opt.volarSignOverride ? opt.volarSignOverride : (volarMargin >= 0 ? 1 : -1);

  const D = V3(0, 0, 0).setComponent(L, Dsign);
  const V = V3(0, 0, 0).setComponent(Th, Vsign);
  const R = new THREE.Vector3().crossVectors(D, V);          // right hand: R = D × V

  // ── verify the thumb really is on +R ─────────────────────────────────────────────────────────
  // Discriminator: **the thumb is the short digit** — the tip of the thumb never reaches as far
  // distally as the fingers.  So take the extreme ±R quantile of the digit region and compare how
  // far each side reaches.  (A "the thumb base is more proximal" test was tried first and is NOT
  // reliable: the hypothenar reaches just as far proximally.)
  const wSign = Math.sign(R.getComponent(Wx)) || 1;
  const allW = P.map((q) => q[Wx] * wSign);
  const hiCut = pct(allW, 0.93), loCut = pct(allW, 0.07);
  let plusMaxD = 0, minusMaxD = 0;
  for (const p of P) {
    const d = dOf(p) / len;
    if (d < 0.45) continue;
    const w = p[Wx] * wSign;
    if (w > hiCut && d > plusMaxD) plusMaxD = d;
    else if (w < loCut && d > minusMaxD) minusMaxD = d;
  }
  const thumbMargin = minusMaxD - plusMaxD;      // > 0 → the +R side is the short digit = the thumb
  const handed = thumbMargin >= 0 ? 'right' : 'left';

  // ── wrist: narrowest width in the proximal 40 % ──────────────────────────────────────────────
  let wristD = 0, wristW = 1e9, wristT = 0, wristCw = 0, wristCt = 0;
  for (let d = 0.03 * len; d < 0.40 * len; d += 0.01 * len) {
    let a = 1e9, b = -1e9, c = 1e9, e = -1e9, n = 0;
    for (const p of P) {
      const dd = dOf(p);
      if (dd < d || dd > d + 0.035 * len) continue;
      if (p[Wx] < a) a = p[Wx]; if (p[Wx] > b) b = p[Wx];
      if (p[Th] < c) c = p[Th]; if (p[Th] > e) e = p[Th];
      n++;
    }
    if (n > Math.max(12, P.length * 0.004) && b - a < wristW) { wristW = b - a; wristD = d + 0.0175 * len; wristT = e - c; wristCw = (a + b) / 2; wristCt = (c + e) / 2; }
  }
  return {
    axes: { L, Wx, Th }, D, V, R, handed, len,
    wristD, wristWidth: wristW, wristThick: wristT, wristCentre: { w: wristCw, t: wristCt },
    margins: { volarUnits: +volarMargin.toFixed(3), thumbReachMargin: +thumbMargin.toFixed(3), plusMaxD: +plusMaxD.toFixed(3), minusMaxD: +minusMaxD.toFixed(3), endClusters },
  };
}

/**
 * @returns { group, mesh, material, stats, setFlex(f[5]) }
 */
export async function buildGlbHand(opts = {}) {
  const { align = {}, transparent = false, asset = 'female_hand_1k.glb',
    assetBase = DEFAULT_ASSET_BASE, label = 'photoscan GLB' } = opts;
  const A = { ...ALIGN, ...align };
  const t0 = performance.now();
  // 자산 교체 지점 — `asset`/`assetBase` 만 바꾸면 다른 손 모델로 갈아 끼울 수 있다(라이선스 주석 참조).
  const url = new URL(`${assetBase}${asset}`, import.meta.url).href;
  const gltf = await new GLTFLoader().loadAsync(url);
  const loadMs = performance.now() - t0;

  // Some exports contain several copies of the same mesh under different transforms
  // (hand_lowpoly.glb has four).  Take the FIRST one and drop the rest.
  const meshes = [];
  gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const mesh = meshes[0];
  if (!mesh) throw new Error(`${asset}: no mesh`);
  gltf.scene.updateMatrixWorld(true);
  for (let i = 1; i < meshes.length; i++) meshes[i].removeFromParent();

  // bake the glTF node transform so everything below is in one frame
  const g = mesh.geometry;
  g.applyMatrix4(mesh.matrixWorld);
  mesh.position.set(0, 0, 0); mesh.quaternion.identity(); mesh.scale.set(1, 1, 1);

  const cageTris = g.index ? g.index.count / 3 : 0;

  const F = deriveFrame(g.attributes.position, A);
  const scale = (A.scaleBy === 'hand'
    ? A.handLengthMm / (F.len - F.wristD)
    : A.wristWidthMm / F.wristWidth) * MM;

  // rotation: rows are the model-space unit vectors that become our +X / +Y / +Z
  const Rv = F.handed === 'left' ? F.R.clone().negate() : F.R;   // mirror a left hand onto our right wrist
  const M = new THREE.Matrix4().set(
    F.D.x, F.D.y, F.D.z, 0,
    F.V.x, F.V.y, F.V.z, 0,
    Rv.x, Rv.y, Rv.z, 0,
    0, 0, 0, 1,
  );
  M.premultiply(new THREE.Matrix4().makeScale(scale, scale, scale));
  const mirrored = M.determinant() < 0;
  if (mirrored && g.index) {          // a mirror flips winding + normals; fix the mesh, not the pixels
    const a = g.index.array;
    for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
    g.index.needsUpdate = true;
    const nrm = g.attributes.normal;
    if (nrm) { for (let i = 0; i < nrm.count * 3; i++) nrm.array[i] = -nrm.array[i]; nrm.needsUpdate = true; }
  }
  g.applyMatrix4(M);
  g.computeBoundingBox();

  // ── place it: LENGTH by the wrist crease, then SURFACE-match the cross-section ────────────────
  // Centroid matching leaves a step, because the scan's wrist centre and our ellipse centre are not
  // at the same height.  What has to line up is the **volar surface** — that is the face the
  // electrode patch sits on.  So: put the narrowest section on the crease along x, then translate in
  // y so the volar tops coincide, centre laterally on the extremes, and let a ±5 % fine scale
  // minimise what is left over on the other three extremes.
  const bb0 = g.boundingBox.clone();
  const wristXNow = bb0.min.x + F.wristD * scale;
  g.applyMatrix4(new THREE.Matrix4().makeTranslation(A.creaseX * MM - wristXNow, 0, 0));
  g.computeBoundingBox();
  const pos = g.attributes.position;

  const joinX = A.clipX + A.sleeveOverlap;
  const sect = (xMm, halfMm = 1.6) => {
    const ys = [], zs = [];
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getX(i) / MM - xMm) > halfMm) continue;
      ys.push(pos.getY(i) / MM); zs.push(pos.getZ(i) / MM);
    }
    if (ys.length < 12) return null;
    return {
      n: ys.length,
      yTop: pct(ys, 0.985), yBot: pct(ys, 0.015),
      zRad: pct(zs, 0.985), zUln: pct(zs, 0.015),
    };
  };
  // ── axis: rotate so the hand's long axis lies along the forearm, then apply the dorsiflexion ──
  // (measured, not assumed: the hand axis is wristCentre → the most distal point of the mid digits)
  const axisBefore = (() => {
    const wc = sect(joinX);
    if (!wc) return null;
    const c = new THREE.Vector3(joinX * MM, ((wc.yTop + wc.yBot) / 2) * MM, ((wc.zRad + wc.zUln) / 2) * MM);
    let far = null, fd = -1;
    for (let i = 0; i < pos.count; i++) {
      const p = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
      const d = p.distanceTo(c);
      if (d > fd) { fd = d; far = p; }
    }
    return far.clone().sub(c).normalize();
  })();
  const axisAngleDeg = axisBefore ? THREE.MathUtils.radToDeg(Math.acos(Math.min(1, Math.abs(axisBefore.x)))) : 0;
  if (A.extensionDeg) {
    const wc = sect(joinX);
    const c = new THREE.Vector3(joinX * MM, wc ? ((wc.yTop + wc.yBot) / 2) * MM : 0, wc ? ((wc.zRad + wc.zUln) / 2) * MM : 0);
    // +Z is the radio-ulnar axis; a NEGATIVE rotation about it lifts the fingertips dorsally (−Y)
    const q = new THREE.Matrix4().makeRotationZ(-THREE.MathUtils.degToRad(A.extensionDeg));
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
    g.applyMatrix4(q);
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(c.x, c.y, c.z));
    g.computeBoundingBox();
  }

  const s0 = sect(joinX) || { yTop: 20, yBot: -20, zRad: 28, zUln: -28, n: 0 };
  const FY = A.forearmRy, FZ = A.forearmRz;           // our distal ring half-axes (mm)
  const hy0 = (s0.yTop - s0.yBot) / 2, hz0 = (s0.zRad - s0.zUln) / 2;
  // fine scale: volar top is pinned, so only the other three extremes carry a residual
  let fine = 1, bestCost = Infinity;
  for (let k = -50; k <= 50; k++) {
    const f = 1 + k * 0.001;
    const cost = Math.abs(2 * hy0 * f - 2 * FY) + 2 * Math.abs(hz0 * f - FZ);
    if (cost < bestCost) { bestCost = cost; fine = f; }
  }
  if (Math.abs(fine - 1) > 1e-6) {
    // scale about the join section's own centre so the length placement barely moves
    const cx = joinX * MM, cy = ((s0.yTop + s0.yBot) / 2) * MM, cz = ((s0.zRad + s0.zUln) / 2) * MM;
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(-cx, -cy, -cz));
    g.applyMatrix4(new THREE.Matrix4().makeScale(fine, fine, fine));
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(cx, cy, cz));
    g.computeBoundingBox();
  }
  const s1 = sect(joinX) || s0;
  const dy = FY * MM - s1.yTop * MM;                       // volar surfaces coincide
  const dz = -((s1.zRad + s1.zUln) / 2) * MM;              // centre laterally on the extremes
  g.applyMatrix4(new THREE.Matrix4().makeTranslation(0, dy, dz));
  g.computeBoundingBox(); g.computeBoundingSphere();

  const s2 = sect(joinX) || s1;
  const residual = {
    volarMm: +(s2.yTop - FY).toFixed(3),
    dorsalMm: +(s2.yBot + FY).toFixed(3),
    radialMm: +(s2.zRad - FZ).toFixed(3),
    ulnarMm: +(s2.zUln + FZ).toFixed(3),
    fineScale: +fine.toFixed(4),
  };
  const joinSec = { ry: (s2.yTop - s2.yBot) / 2, rz: (s2.zRad - s2.zUln) / 2,
    cy: (s2.yTop + s2.yBot) / 2, cz: (s2.zRad + s2.zUln) / 2, n: s2.n };

  // ── cut the mesh for real at x = clipX so a genuine open boundary loop exists to bridge to ────
  const sliced = sliceAtX(g, A.clipX * MM);
  mesh.geometry = sliced.geometry;
  g.dispose();
  const loopN = 48;
  const cutLoop = sliced.loop.length >= 8 ? resampleLoop(sliced.loop, loopN) : null;

  const mat = mesh.material;
  // Matte, pattern-free skin.  The 8192² normal/AO maps downscaled to 1024/512 leave visible
  // seam-and-grid artefacts on the palm, so BOTH are dropped — the base colour already carries the
  // creases and the veins.  (Reported in proto/README.md; the alternative, keeping them at
  // normalScale ≈ 0.3, still showed the grid at grazing angles.)
  mat.metalness = 0.0;
  // ── skin finish ────────────────────────────────────────────────────────────────────────────────
  // DEFAULT: no textures.  A photogrammetry scan's maps carry the seams, the baked lighting streaks
  // and the normal-map noise of the capture; on this asset those read as dirty lines all over the
  // palm and the wrist.  The scan's value is its SHAPE, so the maps are dropped and both hands get
  // the same matte skin material as the forearm — which also removes the colour step at the bridge.
  // `?tex=on` puts the original maps back for comparison.
  const hadMaps = { base: !!mat.map, normal: !!mat.normalMap, ao: !!mat.aoMap, rough: !!mat.roughnessMap };
  if (!opts.textures) {
    mat.map = null; mat.normalMap = null; mat.aoMap = null; mat.roughnessMap = null; mat.metalnessMap = null;
    mat.color = new THREE.Color(opts.skinColor || 0xe6b79a);
    mat.roughness = 0.86; mat.metalness = 0.0; mat.flatShading = false;
  } else if (!mat.map) {
    mat.color = new THREE.Color(opts.skinColor || 0xe6b79a);
    mat.roughness = 0.86;
  }
  mat.needsUpdate = true;
  if (transparent) { mat.transparent = true; mat.opacity = 0.85; }
  mesh.castShadow = true; mesh.receiveShadow = true;

  const group = new THREE.Group();
  group.add(mesh);

  const gg = mesh.geometry;
  const tris = gg.index ? gg.index.count / 3 : gg.attributes.position.count / 3;
  const bb = gg.boundingBox;
  const ringSeat = findIndexRing(gg, { ringTipFrac: A.ringTipFrac, ringFinger: A.ringFinger });
  return {
    group, mesh, material: mat, join: joinSec, clipX: A.clipX, joinX,
    cutLoop, cutSegments: sliced.segments, ringSeat,
    // No skin, no bones, no animations in the glTF — there is nothing to pose.  See proto/README.md.
    setFlex() { /* fixed pose */ },
    stats: {
      technique: label, asset, meshesInFile: meshes.length,
      sourceTriangles: cageTris,
      textures: !!opts.textures, mapsInFile: hadMaps,
      triangles: tris, vertices: pos.count, loadMs: +loadMs.toFixed(1),
      frame: {
        axes: F.axes, handed: F.handed, mirrored,
        distal: F.D.toArray(), volar: F.V.toArray(), radial: Rv.toArray(),
        margins: F.margins,
      },
      scaleBy: A.scaleBy, scaleMmPerUnit: +(scale / MM).toFixed(4),
      wristWidthUnits: +F.wristWidth.toFixed(3),
      wristMm: { width: +(F.wristWidth * scale / MM).toFixed(1), thickness: +(F.wristThick * scale / MM).toFixed(1) },
      handLengthMm: +((F.len - F.wristD) * scale / MM).toFixed(1),
      joinSectionMm: { ry: +joinSec.ry.toFixed(2), rz: +joinSec.rz.toFixed(2), cy: +joinSec.cy.toFixed(2), cz: +joinSec.cz.toFixed(2), n: joinSec.n },
      surfaceResidualMm: residual,
      axis: { handVsForearmDeg: +axisAngleDeg.toFixed(2), extensionDeg: A.extensionDeg },
      cut: { segments: sliced.segments, loopVerts: sliced.loop.length, resampled: cutLoop ? cutLoop.length : 0 },
      indexRing: ringSeat ? ringSeat.why : null,
      bboxMm: { min: [bb.min.x, bb.min.y, bb.min.z].map((v) => +(v / MM).toFixed(1)), max: [bb.max.x, bb.max.y, bb.max.z].map((v) => +(v / MM).toFixed(1)) },
      skins: 0, animations: gltf.animations.length,
    },
  };
}

/**
 * A short skin-coloured sleeve that blends the forearm's elliptical end into the model's wrist
 * stub, so the two surfaces do not show a step.  Radii are measured from the loaded model.
 */
export function buildWristSleeve(hand, { fromX = 42, ry0 = 20, rz0 = 28, color = 0xe6b79a, over = 1.06 } = {}) {
  const j = hand.join;
  const toX = hand.joinX;
  const N = 12, S = 48;
  const p = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, x = fromX + (toX - fromX) * t;
    const s = t * t * (3 - 2 * t);                              // smoothstep so the flare is gentle
    const ry = ry0 + (j.ry * over - ry0) * s, rz = rz0 + (j.rz * over - rz0) * s;
    const cy = j.cy * s * MM, cz = j.cz * s * MM;
    for (let k = 0; k < S; k++) {
      const th = (k / S) * Math.PI * 2;
      p.push(x * MM, cy + ry * Math.cos(th) * MM, cz + rz * Math.sin(th) * MM);
    }
  }
  for (let i = 0; i < N; i++) for (let k = 0; k < S; k++) {
    const k2 = (k + 1) % S;
    const a = i * S + k, b = i * S + k2, c = (i + 1) * S + k, d = (i + 1) * S + k2;
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.66, side: THREE.DoubleSide }));
  m.receiveShadow = true;
  return m;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// 손가락 축을 따라 걷기 위한 사전 계산 — 정점을 mm 로 한 번만 뽑고, 삼각형마다 중심/반지름을
// 만들어 둔다(광선 시험에서 멀리 있는 삼각형을 통째로 건너뛰려고).
function prepareMesh(geo) {
  const pos = geo.attributes.position;
  const n = pos.count;
  const Pmm = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) { Pmm[i * 3] = pos.getX(i) / MM; Pmm[i * 3 + 1] = pos.getY(i) / MM; Pmm[i * 3 + 2] = pos.getZ(i) / MM; }
  const I = geo.index.array, NT = I.length / 3;
  const TC = new Float64Array(NT * 3), TR = new Float64Array(NT);
  for (let t = 0; t < NT; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const cx = (Pmm[a] + Pmm[b] + Pmm[c]) / 3, cy = (Pmm[a + 1] + Pmm[b + 1] + Pmm[c + 1]) / 3, cz = (Pmm[a + 2] + Pmm[b + 2] + Pmm[c + 2]) / 3;
    TC[t * 3] = cx; TC[t * 3 + 1] = cy; TC[t * 3 + 2] = cz;
    TR[t] = Math.max(
      Math.hypot(Pmm[a] - cx, Pmm[a + 1] - cy, Pmm[a + 2] - cz),
      Math.hypot(Pmm[b] - cx, Pmm[b + 1] - cy, Pmm[b + 2] - cz),
      Math.hypot(Pmm[c] - cx, Pmm[c + 1] - cy, Pmm[c + 2] - cz));
  }
  return { Pmm, I, NT, TC, TR, n };
}

/** An orthonormal pair spanning the plane whose normal is the unit vector `a` (mm frame). */
function planeBasis(ax, ay, az) {
  let ux = -ay, uy = ax, uz = 0;                                       // (0,0,1) × a
  if (ux * ux + uy * uy + uz * uz < 1e-6) { ux = az; uy = 0; uz = -ax; }   // (0,1,0) × a
  const l = Math.hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
  return { ux, uy, uz, vx: ay * uz - az * uy, vy: az * ux - ax * uz, vz: ax * uy - ay * ux };
}

/**
 * **"이게 정말 손가락인가" 시험** — 후보 단면 중심에서 손가락 축에 수직인 평면 안으로 광선을
 * `N` 개 쏘고, 각각이 메시를 **빠져나가는 거리**(가장 가까운 삼각형 교차)를 재서 돌려준다.
 * 손가락이면 모든 방향이 십 몇 mm 안에서 끝나고, 손바닥 살 속이면 어떤 방향은 한참 안 끝난다.
 * 나가지 못한 방향은 `maxMm` 을 넘긴 값(= Infinity 대신 maxMm + 1)으로 보고한다.
 */
function rayExitDistances(M, c, ax, ay, az, N, maxMm) {
  const B = planeBasis(ax, ay, az);
  // 멀리 있는 삼각형은 통째로 버린다 (구 경계로 판정)
  const cand = [];
  for (let t = 0; t < M.NT; t++) {
    const dx = M.TC[t * 3] - c[0], dy = M.TC[t * 3 + 1] - c[1], dz = M.TC[t * 3 + 2] - c[2];
    if (Math.hypot(dx, dy, dz) - M.TR[t] < maxMm) cand.push(t);
  }
  const out = [];
  for (let k = 0; k < N; k++) {
    const th = (k / N) * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th);
    const dx = B.ux * cs + B.vx * sn, dy = B.uy * cs + B.vy * sn, dz = B.uz * cs + B.vz * sn;
    let best = maxMm + 1;
    for (const t of cand) {                                    // Möller–Trumbore
      const a = M.I[t * 3] * 3, b = M.I[t * 3 + 1] * 3, q = M.I[t * 3 + 2] * 3;
      const e1x = M.Pmm[b] - M.Pmm[a], e1y = M.Pmm[b + 1] - M.Pmm[a + 1], e1z = M.Pmm[b + 2] - M.Pmm[a + 2];
      const e2x = M.Pmm[q] - M.Pmm[a], e2y = M.Pmm[q + 1] - M.Pmm[a + 1], e2z = M.Pmm[q + 2] - M.Pmm[a + 2];
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (det > -1e-12 && det < 1e-12) continue;
      const inv = 1 / det;
      const sx = c[0] - M.Pmm[a], sy = c[1] - M.Pmm[a + 1], sz = c[2] - M.Pmm[a + 2];
      const u = (sx * px + sy * py + sz * pz) * inv;
      if (u < -1e-9 || u > 1 + 1e-9) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * inv;
      if (v < -1e-9 || u + v > 1 + 1e-9) continue;
      const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (tt > 0.05 && tt < best) best = tt;
    }
    out.push(best);
  }
  return out;
}

/**
 * Find the index finger and a ring seat on it — **from the geometry**, no hard-coded coordinates.
 * Runs on the already-aligned mesh (our frame: +X distal, +Y volar, +Z radial).
 *
 * 판정 (전부 기하에서 계산, 근거는 반환값의 `why` 에 실린다):
 *   1. 손끝 영역의 정점을 **z(요척 방향)로 클러스터링** → 손가락 덩어리들 → 검지 선택
 *   2. **손끝에서 출발**한다(손끝은 애매하지 않다).  MCP 를 추정하지 않는다.
 *   3. 손가락 **자기 축**을 따라 1.5 mm 씩 근위로 걸으며 매 걸음 단면을 잘라 중심을 다시 잡고,
 *      그 자리에서 **광선 12 개**를 축에 수직으로 쏴 "손가락인가"를 시험한다
 *      (모든 방향이 12 mm 안에서 메시를 빠져나가야 손가락.  손바닥 살은 여기서 걸린다)
 *   4. 시험을 통과하는 마지막 자리까지가 **손가락 길이**.  반지 자리 = 손끝에서 그 길이의
 *      `ringTipFrac`(≈ 82 %) 지점 = MCP 바로 원위.  실패하면 **원위로 한 칸씩 물러나며** 재시험
 *   5. 받아들이는 조건: 광선 16 개가 전부 ≤ 12 mm **그리고** 단면 최대반지름 7–11 mm
 *      (그보다 크면 평면이 손바닥을 자른 것이다 — 옛 코드의 오배치가 딱 이 경우였다)
 *   6. 반지 = 그 자리의 **단면 중심**에, 평면은 **그 자리의 손가락 축에 수직**,
 *      안지름 = 단면 최대반지름 + 0.3 mm
 */
export function findIndexRing(geo, opts = {}) {
  const clearanceMm = opts.clearanceMm === undefined ? 0.3 : opts.clearanceMm;
  const tipFrac = clamp(opts.ringTipFrac === undefined ? 0.82 : opts.ringTipFrac, 0.4, 0.95);
  const RAY_MAX_MM = 12.0;          // 손가락이면 모든 방향이 이 안에서 끝난다
  const R_LO = 7.0, R_HI = 11.0;    // 검지 반지 자리의 단면 최대반지름 허용 범위 (mm)
  const M = prepareMesh(geo);
  const pos = geo.attributes.position;
  const n = pos.count;
  const P = new Array(n);
  let xMin = 1e9, xMax = -1e9;
  for (let i = 0; i < n; i++) {
    const p = [M.Pmm[i * 3], M.Pmm[i * 3 + 1], M.Pmm[i * 3 + 2]];
    P[i] = p;
    if (p[0] < xMin) xMin = p[0]; if (p[0] > xMax) xMax = p[0];
  }
  const L = xMax - xMin;
  const clusterZ = (pts, gap) => {
    if (!pts.length) return [];
    const s = [...pts].sort((a, b) => a[2] - b[2]);
    const out = [[s[0]]];
    for (let i = 1; i < s.length; i++) {
      if (s[i][2] - s[i - 1][2] > gap) out.push([]);
      out[out.length - 1].push(s[i]);
    }
    return out.filter((c) => c.length > 8).map((c) => ({
      pts: c, zMin: c[0][2], zMax: c[c.length - 1][2],
      zMean: mean(c.map((p) => p[2])), yMean: mean(c.map((p) => p[1])),
      xMax: Math.max(...c.map((p) => p[0])),
    }));
  };
  // Digit tips: far enough distal that the four fingers are separate blobs even when adjacent.
  // Slab low enough that the THUMB is in it too, split finely enough that adjacent fingers stay apart.
  // The THUMB is much shorter than the fingers, so a slab that only catches the four fingertips
  // silently drops it — and then every digit is mis-labelled by one (seen in E_ring_debug.png).
  // Look for FIVE clusters first, and only fall back to four if the thumb really cannot be split.
  let cl = [], tipCut = 0;
  const tryCuts = (want) => {
    for (const f of [0.50, 0.55, 0.60, 0.65, 0.70, 0.75]) {
      const tc = xMin + f * L;
      const c = clusterZ(P.filter((p) => p[0] > tc), 2.5);
      if (c.length >= want) { tipCut = tc; return c; }
    }
    return [];
  };
  cl = tryCuts(5);
  if (cl.length < 5) cl = tryCuts(4);
  if (cl.length < 4) cl = tryCuts(3);
  if (cl.length < 2) return null;

  // Track EVERY digit proximally and find where its section suddenly widens (= its web / base).
  // The thumb is decisive here: its base sits far more proximally than any finger's MCP.
  // ⚠ This tracker is used **only to label the digits and to report their bases as a cross-check**.
  // The ring seat is NOT derived from it: an estimated MCP is exactly what put the ring inside the
  // palm before.  The seat comes from the tip-anchored walk + ray test further down.
  const trackDigit = (c0) => {
    let cy = c0.yMean, cz = c0.zMean;
    const tipX = c0.xMax, tr = [];
    for (let x = tipX - 4; x > xMin; x -= 2) {
      const slab = P.filter((p) => Math.abs(p[0] - x) < 1.5 && Math.hypot(p[1] - cy, p[2] - cz) < 16);
      if (slab.length < 8) break;
      const ny = mean(slab.map((p) => p[1])), nz = mean(slab.map((p) => p[2]));
      const rad = mean(slab.map((p) => Math.hypot(p[1] - ny, p[2] - nz)));
      cy = ny; cz = nz;
      tr.push([x, ny, nz, rad]);
    }
    if (tr.length < 4) return null;
    const mid = tr.slice(0, Math.max(4, Math.floor(tr.length * 0.6))).map((t) => t[3]).sort((a, b) => a - b);
    const rMed = mid[Math.floor(mid.length / 2)] || 1;
    let mergeX = tr[tr.length - 1][0];
    for (let i = 0; i < tr.length; i++) if (tr[i][3] > rMed * 1.55) { mergeX = tr[i][0]; break; }
    return { c: c0, tr, mergeX, tipX };
  };
  const digits = cl.map(trackDigit).filter(Boolean).sort((a, b) => b.c.zMean - a.c.zMean);
  if (digits.length < 2) return null;
  // +Z is already established as the RADIAL direction by deriveFrame (verified by the handedness
  // test), so the radial-most digit is the thumb and the next one is the index.  Its base ("mergeX")
  // is reported as a cross-check: the thumb's base must be the most proximal of all the digits.
  // 1) drop the thumb: it is the digit whose axis differs most from the other four (and it starts
  //    far more proximally).  With +Z already established as RADIAL, the thumb is also the
  //    radial-most digit — both tests agree here, and both are reported.
  // Is the radial-most cluster actually the thumb?  The thumb sits FAR off the row of fingers, so
  // its z-gap to the next digit is much larger than the gaps between the fingers themselves.  If the
  // gaps are all similar the thumb simply is not in the slab (it is much shorter) and the
  // radial-most cluster IS the index — getting this wrong shifts every label by one finger.
  const gaps = [];
  for (let i = 0; i + 1 < digits.length; i++) gaps.push(digits[i].c.zMean - digits[i + 1].c.zMean);
  const restGaps = gaps.slice(1).sort((a, b) => a - b);
  const medGap = restGaps.length ? restGaps[Math.floor(restGaps.length / 2)] : gaps[0];
  const thumbPresent = gaps.length > 1 && gaps[0] > medGap * 1.5;
  const thumb = thumbPresent ? digits[0] : null;
  const fingersOnly = thumbPresent ? digits.slice(1) : digits;      // radial → ulnar: index … little
  const pick = clamp(Math.round(opts.ringFinger === undefined ? 0 : opts.ringFinger), 0, fingersOnly.length - 1);
  const chosen = fingersOnly[pick];
  const bases = fingersOnly.map((d) => d.mergeX).sort((a, b) => a - b);
  const clusterMcp = bases[Math.floor(bases.length / 2)];   // reported only, never used to place the ring
  const index = chosen.c;
  const thumbIsRadial = thumbPresent && thumb.mergeX <= Math.min(...fingersOnly.map((d) => d.mergeX));

  // ── 2. the FINGERTIP — the most distal vertex of the chosen digit's own cluster ─────────────────
  // The tip is the one landmark on a hand that cannot be mistaken for anything else.  Everything
  // below is measured from it; no MCP is estimated anywhere.
  let tip = null, tipX = -1e9;
  for (const p of chosen.c.pts) if (p[0] > tipX) { tipX = p[0]; tip = p; }
  if (!tip) return null;
  // initial axis: tip → the centroid of the flesh within 18 mm of it, i.e. the finger's own direction
  let sx = 0, sy = 0, sz = 0, cnt = 0;
  for (const p of P) {
    const dx = p[0] - tip[0], dy = p[1] - tip[1], dz = p[2] - tip[2];
    if (dx * dx + dy * dy + dz * dz < 18 * 18) { sx += p[0]; sy += p[1]; sz += p[2]; cnt++; }
  }
  if (cnt < 8) return null;
  let ax = tip[0] - sx / cnt, ay = tip[1] - sy / cnt, az = tip[2] - sz / cnt;
  let al = Math.hypot(ax, ay, az) || 1; ax /= al; ay /= al; az /= al;

  // ── 3. march proximally along the finger's OWN axis, 1.5 mm at a time ───────────────────────────
  // At each step: cut a cross-section perpendicular to the current axis, re-centre on it, then run
  // the ray test.  `s` is the arc length travelled from the tip.
  const STEP = 1.5, MAX_STEPS = 120;
  const stations = [];
  let c = [tip[0] - ax * 3, tip[1] - ay * 3, tip[2] - az * 3], s = 3;
  let lost = null;
  for (let k = 0; k < MAX_STEPS; k++) {
    const cand = [c[0] - ax * STEP, c[1] - ay * STEP, c[2] - az * STEP];
    const sec = sectionPolygon(geo, cand, [ax, ay, az], { keepR: 11, Pmm: M.Pmm });
    if (!sec) { lost = 'no section'; break; }
    // the re-centred section must stay near the candidate — a big sideways jump means the plane has
    // slid off the finger onto the palm/web and the walk is no longer following the digit
    const jump = Math.hypot(sec.centre[0] - cand[0], sec.centre[1] - cand[1], sec.centre[2] - cand[2]);
    if (jump > 4) { lost = `centre jumped ${jump.toFixed(1)} mm`; break; }
    const prev = c;
    c = sec.centre;
    s += Math.hypot(c[0] - prev[0], c[1] - prev[1], c[2] - prev[2]);
    const ray = rayExitDistances(M, c, ax, ay, az, 12, RAY_MAX_MM + 8);
    const worstRay = Math.max(...ray);
    stations.push({ s, c, a: [ax, ay, az], sec, ray, worstRay, finger: worstRay <= RAY_MAX_MM && sec.rAbsMax <= 12 });
    if (!stations[stations.length - 1].finger) { lost = `ray test failed (worst ${worstRay.toFixed(1)} mm)`; break; }
    // axis update: the direction from here to the centre ~6 mm distal, blended with the old axis
    const back = stations.length >= 5 ? stations[stations.length - 5].c : tip;
    let nx = back[0] - c[0], ny = back[1] - c[1], nz = back[2] - c[2];
    const nl = Math.hypot(nx, ny, nz);
    if (nl > 2) {
      ax = ax * 0.5 + (nx / nl) * 0.5; ay = ay * 0.5 + (ny / nl) * 0.5; az = az * 0.5 + (nz / nl) * 0.5;
      const q = Math.hypot(ax, ay, az) || 1; ax /= q; ay /= q; az /= q;
    }
  }
  // finger length = the arc length of the last station that still passed the "is this a finger?" test
  const good = [];
  for (const st of stations) { if (!st.finger) break; good.push(st); }
  if (good.length < 6) return null;
  const fingerLenMm = good[good.length - 1].s;

  // ── 4. the ring station: `tipFrac` of the finger length back from the TIP ───────────────────────
  const targetS = tipFrac * fingerLenMm;
  let k0 = 0;
  for (let i = 1; i < good.length; i++) if (Math.abs(good[i].s - targetS) < Math.abs(good[k0].s - targetS)) k0 = i;
  // ── 5. accept only a station that is unambiguously ON THE FINGER ────────────────────────────────
  // 16 rays this time, and the size cross-check.  A plane that cut the palm shows up as either a ray
  // that will not leave the mesh or a section radius far bigger than any finger.  On failure step
  // DISTALLY (toward the tip) and try again — never proximally, that is where the palm is.
  const tries = [];
  let picked = null;
  for (let i = k0; i >= 0; i--) {
    const st = good[i];
    if (st.s < 0.45 * fingerLenMm) break;             // no plausible ring seat that far out
    const ray16 = rayExitDistances(M, st.c, st.a[0], st.a[1], st.a[2], 16, RAY_MAX_MM + 8);
    const worst = Math.max(...ray16);
    const r = st.sec.rAbsMax;
    const ok = worst <= RAY_MAX_MM && r >= R_LO && r <= R_HI;
    tries.push({ sFrac: +(st.s / fingerLenMm).toFixed(3), worstRayMm: +worst.toFixed(2), rMaxMm: +r.toFixed(2), ok });
    if (ok) { picked = { st, ray16, worst }; break; }
  }
  if (!picked) return null;
  const { st, ray16 } = picked;
  const axis = new THREE.Vector3(st.a[0], st.a[1], st.a[2]).normalize();
  // ── 6. the ring: on the section's own centre, plane ⟂ the finger axis, sized on the OUTER radius.
  // The section is near-circular here (ratio below); a circular ring sized to the major axis cannot
  // dig in anywhere, so the torus stays circular rather than elliptical.
  const sec = st.sec;
  const ry = sec.rAbsMax + clearanceMm, rz = ry;
  const cen = sec.centre;
  const rAng = sec.byAngle.map((q) => q.r);
  const ellipt = Math.max(...rAng) / Math.max(1e-6, Math.min(...rAng));
  return {
    section: sec,
    centre: new THREE.Vector3(cen[0] * MM, cen[1] * MM, cen[2] * MM),
    axis, ry, rz,
    debug: digits.map((d, i) => ({ role: thumbPresent ? (i === 0 ? 'thumb' : ['index', 'middle', 'ring', 'little'][i - 1] || `d${i}`) : (['index', 'middle', 'ring', 'little'][i] || `d${i}`),
      p: new THREE.Vector3(d.c.xMax * MM, d.c.yMean * MM, d.c.zMean * MM), picked: d === chosen })),
    why: {
      tipClusters: cl.length, tipCutFrac: +((tipCut - xMin) / L).toFixed(2), thumbIsRadial,
      thumbPresent, gapsZ: gaps.map((g) => +g.toFixed(1)),
      thumbBaseXmm: thumb ? +thumb.mergeX.toFixed(1) : null, fingerBasesXmm: fingersOnly.map((d) => +d.mergeX.toFixed(1)),
      indexTipZ: +index.zMean.toFixed(1), clusterMcpXmm: +clusterMcp.toFixed(1),
      // ── the tip-anchored walk ──
      tipMm: tip.map((v) => +v.toFixed(1)),
      fingerLenMm: +fingerLenMm.toFixed(1), stationsWalked: stations.length, walkEndedBy: lost,
      tipFracTarget: tipFrac, tipFracUsed: +(st.s / fingerLenMm).toFixed(3),
      sFromTipMm: +st.s.toFixed(1), retries: tries.length - 1, retryLog: tries,
      // ── the "is this really a finger?" test at the accepted station ──
      rayExitMm: ray16.map((v) => +Math.min(v, 99).toFixed(1)), rayWorstMm: +picked.worst.toFixed(2),
      rayLimitMm: RAY_MAX_MM,
      ringXmm: +cen[0].toFixed(1),
      sectionCentreMm: cen.map((v) => +v.toFixed(2)),
      sectionRmaxMm: +sec.rMax.toFixed(2), sectionRabsMaxMm: +sec.rAbsMax.toFixed(2),
      sectionRminMm: +sec.rMin.toFixed(2), sectionEllipticity: +ellipt.toFixed(2),
      sectionPoints: sec.n,
      ringFinger: pick,
      digitTips: digits.map((d, i) => ({ role: thumbPresent ? (i === 0 ? 'thumb' : ['index', 'middle', 'ring', 'little'][i - 1] || `d${i}`) : (['index', 'middle', 'ring', 'little'][i] || `d${i}`),
        x: +d.c.xMax.toFixed(1), y: +d.c.yMean.toFixed(1), z: +d.c.zMean.toFixed(1) })),
      ringInnerMm: { ry: +ry.toFixed(2), rz: +rz.toFixed(2) },
      axisDeg: +THREE.MathUtils.radToDeg(Math.acos(Math.min(1, Math.abs(axis.x)))).toFixed(1),
    },
  };
}

/** A ring seated on the index finger: torus in the plane ⟂ the finger axis at the seat. */
export function buildIndexRing(seat, { tube = 1.5, color = 0xcbd5e1, clearance = 0 } = {}) {
  // The torus CENTRELINE must clear the finger by the tube radius, otherwise the ring is embedded in
  // the flesh.  `seat.ry` is ALREADY the inner radius (section max radius + its own clearance), so
  // the extra `clearance` here defaults to 0: innerSurface = seat.ry → centreline = seat.ry + tube.
  const r = seat.ry + clearance + tube;
  const g = new THREE.TorusGeometry(r * MM, tube * MM, 12, 44);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, metalness: 0.9, roughness: 0.25 }));
  // TorusGeometry lies in local XY with its axis on +Z → point +Z along the finger
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), seat.axis.clone().normalize());
  m.position.copy(seat.centre);
  m.castShadow = true;
  return m;
}

/**
 * The mesh's cross-section polygon in the plane (c, normal a): every triangle that crosses the
 * plane contributes one segment; the segment endpoints are the outline.  Returns the outline's
 * centroid, its min/max radius, and a radius-by-angle table for the penetration check.
 */
export function sectionPolygon(geo, c, a, opt = {}) {
  // `keepR` = how far from the seed centre outline points still count as THIS digit.  It has to be
  // bigger than the finger's own radius (≈ 10 mm at the base) but smaller than the gap to the next
  // finger; 9.5 was the old fixed value and clipped a section whose radius was 9.4 mm.
  const keepR = opt.keepR === undefined ? 9.5 : opt.keepR;
  const ix = geo.index.array;
  const Pmm = opt.Pmm || prepareMesh(geo).Pmm;      // positions in mm (hoisted out of the inner loop)
  const A = new THREE.Vector3(a.x !== undefined ? a.x : a[0], a.y !== undefined ? a.y : a[1], a.z !== undefined ? a.z : a[2]).normalize();
  let u = new THREE.Vector3(0, 0, 1).cross(A);
  if (u.lengthSq() < 1e-6) u = new THREE.Vector3(0, 1, 0).cross(A);
  u.normalize();
  const v = new THREE.Vector3().crossVectors(A, u).normalize();
  const d = (i) => (Pmm[i * 3] - c[0]) * A.x + (Pmm[i * 3 + 1] - c[1]) * A.y + (Pmm[i * 3 + 2] - c[2]) * A.z;
  const pt2 = (i, j, t) => {
    const x = lerp(Pmm[i * 3], Pmm[j * 3], t) - c[0];
    const y = lerp(Pmm[i * 3 + 1], Pmm[j * 3 + 1], t) - c[1];
    const z = lerp(Pmm[i * 3 + 2], Pmm[j * 3 + 2], t) - c[2];
    return [x * u.x + y * u.y + z * u.z, x * v.x + y * v.y + z * v.z];
  };
  const pts = [];
  for (let t = 0; t < ix.length; t += 3) {
    const i0 = ix[t], i1 = ix[t + 1], i2 = ix[t + 2];
    const d0 = d(i0), d1 = d(i1), d2 = d(i2);
    for (const [p, q, dp, dq] of [[i0, i1, d0, d1], [i1, i2, d1, d2], [i2, i0, d2, d0]]) {
      if ((dp < 0) === (dq < 0)) continue;
      pts.push(pt2(p, q, dp / (dp - dq)));
    }
  }
  if (pts.length < 8) return null;
  // the finger is the cluster nearest the seed centre — drop points that belong to a neighbour
  // keep only the blob around the seed centre — a plane through the finger base also cuts the
  // neighbouring finger, and including it would double the measured radius
  let cu = 0, cv = 0, near = pts;
  for (let it = 0; it < 5; it++) {
    near = pts.filter((p) => Math.hypot(p[0] - cu, p[1] - cv) < keepR);
    if (near.length < 8) return null;
    cu = mean(near.map((p) => p[0])); cv = mean(near.map((p) => p[1]));
  }
  const rr = near.map((p) => ({ r: Math.hypot(p[0] - cu, p[1] - cv), th: Math.atan2(p[1] - cv, p[0] - cu) }));
  const rs = rr.map((q) => q.r).sort((x, y) => x - y);
  const rMax = rs[Math.floor(rs.length * 0.92)];
  return {
    centre: [c[0] + cu * u.x + cv * v.x, c[1] + cu * u.y + cv * v.y, c[2] + cu * u.z + cv * v.z],
    // rMax is the 92nd percentile (robust to a stray point); rAbsMax is the true outermost point —
    // the ring has to be sized on rAbsMax or it digs in exactly where the outline bulges most.
    rMax, rAbsMax: rs[rs.length - 1], rMin: rs[0], n: near.length, byAngle: rr,
    u: [u.x, u.y, u.z], v: [v.x, v.y, v.z],
  };
}

/** Smallest gap (mm) between the ring's inner surface and the finger outline.  > 0 = no penetration. */
export function checkRingClearance(seat, geo, { tube = 1.5, samples = 72, clearance = 0 } = {}) {
  const sec = seat.section;
  if (!sec) return null;
  const rInner = seat.ry + clearance;          // buildIndexRing puts the inner surface here
  let worst = 1e9;
  for (let i = 0; i < samples; i++) {
    const th = -Math.PI + (i / samples) * Math.PI * 2;
    // outline radius at this angle: the largest sample within ±10°
    let rOut = 0;
    for (const q of sec.byAngle) {
      let da = Math.abs(q.th - th); if (da > Math.PI) da = Math.PI * 2 - da;
      if (da < 0.175 && q.r > rOut) rOut = q.r;
    }
    if (rOut > 0) worst = Math.min(worst, rInner - rOut);
  }
  void tube;
  return +worst.toFixed(3);
}

/** (unused legacy signature kept out) */
function _legacyClearance(seat, geo, { tube = 1.5, samples = 36 } = {}) {
  const pos = geo.attributes.position;
  const r = seat.ry + tube;
  const a = seat.axis.clone().normalize();
  const u = new THREE.Vector3(0, 0, 1).cross(a).normalize();
  if (!isFinite(u.x) || u.lengthSq() < 1e-6) u.set(0, 1, 0);
  const v = new THREE.Vector3().crossVectors(a, u).normalize();
  let worst = 1e9;
  for (let i = 0; i < samples; i++) {
    const th = (i / samples) * Math.PI * 2;
    const px = seat.centre.x + (u.x * Math.cos(th) + v.x * Math.sin(th)) * (r - tube) * MM;
    const py = seat.centre.y + (u.y * Math.cos(th) + v.y * Math.sin(th)) * (r - tube) * MM;
    const pz = seat.centre.z + (u.z * Math.cos(th) + v.z * Math.sin(th)) * (r - tube) * MM;
    // distance from the finger's centre line at this station, minus the mesh's radius there
    const dx = px - seat.centre.x, dy = py - seat.centre.y, dz = pz - seat.centre.z;
    let nearest = 1e9;
    for (let k = 0; k < pos.count; k++) {
      const qx = pos.getX(k) - px, qy = pos.getY(k) - py, qz = pos.getZ(k) - pz;
      const d = qx * qx + qy * qy + qz * qz;
      if (d < nearest) nearest = d;
    }
    const gap = Math.sqrt(nearest) / MM;
    // inside the flesh the nearest surface vertex is still ~0, so also test the radial distance
    const radial = Math.hypot(dx, dy, dz) / MM;
    const clear = radial - seat.ry;
    if (Math.min(gap, clear) < worst) worst = Math.min(gap, clear);
  }
  return +worst.toFixed(3);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// 실제 폴리곤 다리 (mesh bridge) — 두 물체를 겹쳐 가리는 것이 아니라 **잘라서 잇는다**
//
// 문제: 이 스캔에는 손목에 **깨끗한 열린 경계 루프가 없다**(열린 에지 692개가 모델 전체에 흩어져
// 있고, 근위 끝은 둥글게 닫힌 캡이다).  그래서 "GLB의 손목 루프를 뽑아 잇는다"를 그대로는 못 한다.
// 해결: **평면 x = clipX 에서 지오메트리를 실제로 잘라** 새 열린 경계를 만든다.  그러면 진짜 링이
// 생기고, 그 링과 전완 원위 링 사이를 보간 링 3줄로 이어 **정점을 공유(용접)** 한 밴드를 만든다.
// ══════════════════════════════════════════════════════════════════════════════════════════════════

/** Cut an indexed triangle mesh with the plane x = px, keeping x ≥ px.  Returns the new geometry
 *  and the ordered boundary loop created by the cut. */
export function sliceAtX(geo, px) {
  const P = geo.attributes.position, Nn = geo.attributes.normal, UV = geo.attributes.uv;
  const idx = geo.index.array;
  const outP = [], outN = [], outUV = [], outI = [];
  const key = new Map();
  const emit = (v) => {                                  // v = {p:[x,y,z], n:[..], uv:[u,v]}
    const k = v.p.map((q) => Math.round(q * 1e6)).join(',');
    let i = key.get(k);
    if (i === undefined) {
      i = outP.length / 3;
      outP.push(...v.p); outN.push(...v.n); outUV.push(...v.uv);
      key.set(k, i);
    }
    return i;
  };
  const vert = (i) => ({
    p: [P.getX(i), P.getY(i), P.getZ(i)],
    n: Nn ? [Nn.getX(i), Nn.getY(i), Nn.getZ(i)] : [0, 0, 1],
    uv: UV ? [UV.getX(i), UV.getY(i)] : [0, 0],
  });
  const lerpV = (a, b, t) => ({
    p: [0, 1, 2].map((k) => a.p[k] + (b.p[k] - a.p[k]) * t),
    n: [0, 1, 2].map((k) => a.n[k] + (b.n[k] - a.n[k]) * t),
    uv: [0, 1].map((k) => a.uv[k] + (b.uv[k] - a.uv[k]) * t),
  });
  const segs = [];
  for (let t = 0; t < idx.length; t += 3) {
    const v = [vert(idx[t]), vert(idx[t + 1]), vert(idx[t + 2])];
    const inn = v.map((q) => q.p[0] >= px);
    const cnt = inn.filter(Boolean).length;
    if (cnt === 0) continue;
    if (cnt === 3) { outI.push(emit(v[0]), emit(v[1]), emit(v[2])); continue; }
    // one or two vertices survive → clip, and record the cut segment
    const poly = [];
    const cut = [];
    for (let e = 0; e < 3; e++) {
      const a = v[e], b = v[(e + 1) % 3];
      if (inn[e]) poly.push(a);
      if (inn[e] !== inn[(e + 1) % 3]) {
        const tt = (px - a.p[0]) / (b.p[0] - a.p[0]);
        const m = lerpV(a, b, tt);
        m.p[0] = px;
        poly.push(m); cut.push(m);
      }
    }
    if (cut.length === 2) segs.push([cut[0].p, cut[1].p]);
    for (let k = 1; k + 1 < poly.length; k++) outI.push(emit(poly[0]), emit(poly[k]), emit(poly[k + 1]));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(outP, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(outN, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(outUV, 2));
  out.setIndex(outI);
  out.computeBoundingBox(); out.computeBoundingSphere();

  // order the cut segments into a loop (largest connected chain wins — scan meshes are messy)
  const K = (p) => `${Math.round(p[1] * 1e6)},${Math.round(p[2] * 1e6)}`;
  const adj = new Map();
  for (const [a, b] of segs) {
    for (const [x, y] of [[a, b], [b, a]]) {
      const k = K(x);
      if (!adj.has(k)) adj.set(k, { p: x, to: [] });
      adj.get(k).to.push(K(y));
    }
  }
  let bestLoop = [];
  const seen = new Set();
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const chain = []; let cur = start, prev = null;
    for (let guard = 0; guard < adj.size + 2; guard++) {
      if (seen.has(cur)) break;
      seen.add(cur);
      chain.push(adj.get(cur).p);
      const nxt = adj.get(cur).to.find((k) => k !== prev && !seen.has(k));
      if (!nxt) break;
      prev = cur; cur = nxt;
    }
    if (chain.length > bestLoop.length) bestLoop = chain;
  }
  return { geometry: out, loop: bestLoop, segments: segs.length };
}

/** Resample a closed loop of [x,y,z] to N points, ordered by angle about its centroid in (y,z),
 *  starting at the volar (+Y) direction and running the same way as the forearm ring. */
export function resampleLoop(loop, N) {
  const cy = mean(loop.map((p) => p[1])), cz = mean(loop.map((p) => p[2]));
  const byAng = loop.map((p) => ({ p, a: Math.atan2(p[2] - cz, p[1] - cy) })).sort((u, v) => u.a - v.a);
  const out = [];
  for (let i = 0; i < N; i++) {
    const a = -Math.PI + (i / N) * Math.PI * 2;
    // nearest two samples in angle → linear blend
    let lo = byAng[byAng.length - 1], hi = byAng[0];
    for (let k = 0; k < byAng.length; k++) {
      if (byAng[k].a >= a) { hi = byAng[k]; lo = byAng[(k - 1 + byAng.length) % byAng.length]; break; }
    }
    let da = hi.a - lo.a; if (da <= 0) da += Math.PI * 2;
    let dd = a - lo.a; if (dd < 0) dd += Math.PI * 2;
    const t = da > 1e-9 ? Math.min(1, dd / da) : 0;
    out.push([lerp(lo.p[0], hi.p[0], t), lerp(lo.p[1], hi.p[1], t), lerp(lo.p[2], hi.p[2], t)]);
  }
  return out;
}

/**
 * A welded polygon bridge from the forearm's distal ellipse ring to the GLB's cut loop.
 * Both end rings use the EXACT vertices of the surfaces they meet, so there is no gap by
 * construction; the end normals are taken from those surfaces so the shading does not break.
 */
export function buildBridge({ loop, fromX, ry, rz, rings = 3, mat, alphaFrom = 0.34, alphaTo = 1.0, color = 0xe6b79a }) {
  const N = loop.length;
  const A = [];                                        // forearm ring (ellipse), same winding/start
  for (let i = 0; i < N; i++) {
    const a = -Math.PI + (i / N) * Math.PI * 2;         // atan2(z, y) — same parametrisation as the loop
    A.push([fromX * MM, ry * Math.cos(a) * MM, rz * Math.sin(a) * MM]);
  }
  const B = loop.map((p) => [p[0], p[1], p[2]]);
  const R = rings + 3;
  const P = [], I = [], C = [];
  const col = new THREE.Color(color);
  for (let r = 0; r < R; r++) {
    const t = r / (R - 1), s = t * t * (3 - 2 * t);     // smoothstep → tangent-continuous at both ends
    for (let i = 0; i < N; i++) {
      P.push(lerp(A[i][0], B[i][0], s), lerp(A[i][1], B[i][1], s), lerp(A[i][2], B[i][2], s));
      // vertex alpha ramps from the translucent forearm to the opaque hand, so the see-through
      // forearm reaches all the way to the join instead of stopping at an opaque collar
      C.push(col.r, col.g, col.b, lerp(alphaFrom, alphaTo, s));
    }
  }
  for (let r = 0; r < R - 1; r++) for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const a = r * N + i, b = r * N + j, c = (r + 1) * N + i, d = (r + 1) * N + j;
    I.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 4));
  g.setIndex(I);
  g.computeVertexNormals();
  // end rings: use the exact analytic normals of the surfaces we weld to, so shading is continuous
  const nrm = g.attributes.normal.array;
  for (let i = 0; i < N; i++) {
    const a = -Math.PI + (i / N) * Math.PI * 2;
    const ny = Math.cos(a) / (ry * ry), nz = Math.sin(a) / (rz * rz);
    const l = Math.hypot(ny, nz) || 1;
    nrm[i * 3] = 0; nrm[i * 3 + 1] = ny / l; nrm[i * 3 + 2] = nz / l;
  }
  g.attributes.normal.needsUpdate = true;
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  return m;
}
