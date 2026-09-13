// js/wrist3d/anatomy.js — 손목 3D 뷰의 **해부 단면 부품 묶음**.
//
// A안(해부 단면 강화)과 E안(실사 GLB 손)이 공유하는 것만 여기 있다: 층 구조 표, 색, 심부 구조의
// 위치표, 그리고 근위 절단면(cut face)을 그리는 코드.  두 변형이 같은 그림을 두 번 들고 있지
// 않도록 `proto/variants/vA_anatomy.js` · `vE_glb.js` · `js/wrist3d/models.js` 가 모두 이 파일을
// 부른다.
//
// 좌표계는 `js/wristView.js` 와 같다: 전완 축 = world X(근위 −x → 원위 +x), 장측(손바닥) = +Y,
// lateral(+ 엄지쪽) = +Z, 1 mm = 0.001 world unit.
//
// ⚠ 근거 수준 — 이 파일의 숫자는 대부분 **작도 가정**이다.
//   `WRIST_ANATOMY`(요골동맥 lateral 12 mm / 깊이 2.5 mm, FCR 9 mm, PL 1.3 mm, 요골 21 mm)만
//   트윈의 물리 모델에 실제로 들어가는 상수이고, 그마저도 docs/CLINICAL_AUDIT.md §6.16 이 밝힌
//   대로 모델 가정이다.  층 두께·심부건 8개의 좌표·정맥/신경/척골 위치는 **이 뷰가 보기 좋게
//   그리려고 정한 값**이며 영상 분할 데이터도 문헌값도 아니다.  절대 임상 수치로 인용하지 말 것.

import * as THREE from '../vendor/three.module.js';
import { WRIST_ANATOMY } from '../capacitiveArray.js';

export const MM = 0.001;
// 기준 체형(170 cm / 70 kg)의 단면 반축 — `js/wristView.js` 의 WRIST_RX / WRIST_RZ 와 같은 값이다.
// (두 파일은 같은 값을 각자 적어 두고 이 주석으로만 묶여 있다. 바꿀 때 함께 바꿀 것.)
export const REF_RX = 20;   // mm, 장측–배측 반축(두께의 절반)
export const REF_RZ = 28;   // mm, 요–척측 반축(폭의 절반)
export const SEG_LEN = 110; // mm, 표시하는 전완 길이
export const X_CUT_MM = -SEG_LEN / 2;   // 근위 절단면의 world x (mm)

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** 기준 단면 타원의 장측 표면 높이(world y, m) — 심부 구조를 "피부에서 몇 mm" 로 놓기 위한 기준. */
export function surfaceY(lat_mm) {
  const zr = clamp(lat_mm / REF_RZ, -0.999, 0.999);
  return REF_RX * Math.sqrt(1 - zr * zr) * MM;
}
/** lateral(mm)에서 피부 아래 depth(mm) 지점의 y (mm 단위). */
export const yAt = (lat_mm, depth_mm) => surfaceY(lat_mm) / MM - depth_mm;

// ── 층 반축 (mm).  축마다 따로 파고들어야 깊은 칸이 뼈를 담을 만큼 넓게 남는다. ──────────────────
export const LAYERS = {
  skin: { ry: REF_RX, rz: REF_RZ },                    // 20 × 28
  fat: { ry: REF_RX - 1.8, rz: REF_RZ - 1.8 },         // 진피 ≈ 1.8 mm (작도 가정)
  fascia: { ry: REF_RX - 6.5, rz: REF_RZ - 4.0 },      // 피하지방 6.5 / 4.0 mm (작도 가정)
  muscle: { ry: REF_RX - 7.3, rz: REF_RZ - 4.8 },      // 심부근막 ≈ 0.8 mm (작도 가정)
};

export const COLORS = {
  skin: 0xe8b08d, epi: 0xc4795b, fat: 0xf2d894, fascia: 0xeeead4, muscle: 0x8e3a34,
  cortex: 0xf4f7fb, marrow: 0xe6bd85, tendon: 0xf5f0dc, sheath: 0xd8e6f2,
  artery: 0xe0243a, comitans: 0x5a6fc0, nerve: 0xf0dd7e, bone: 0xefe6d2,
  veinTube: 0x4a68b4,   // 길이 방향 정맥 튜브
  veinFace: 0x5878c8,   // 절단면의 정맥 내강 (조금 밝게 — 단면은 색으로 읽는다)
};

// 심부 굴근건 — lateral(mm, + 엄지쪽) / 피부에서의 깊이(mm) / 반지름(mm).  전부 작도 가정.
// 전부 lateral −3 mm 보다 척측이라 요골동맥 회랑(lateral 8…16 mm)을 비켜 간다.
export const DEEP_TENDONS = [
  { lat: -4.5, d: 9.5, r: 1.7 }, { lat: -8.5, d: 9.8, r: 1.7 },
  { lat: -12.5, d: 9.6, r: 1.6 }, { lat: -16.5, d: 9.0, r: 1.5 },   // FDS 4
  { lat: -3.0, d: 13.5, r: 1.6 }, { lat: -7.5, d: 13.8, r: 1.6 },
  { lat: -12.0, d: 13.6, r: 1.5 },                                   // FDP 3
  { lat: -20.5, d: 6.5, r: 1.8 },                                    // FCU
];
// 표재정맥 — 요골동맥 회랑(lateral 8…16 mm)은 비워 둔다(동맥이 계속 읽혀야 하는 뷰라서).
export const VEINS = [
  { lat: -6, d: 2.1, r: 1.5, wob: 2.5 }, { lat: -19, d: 2.0, r: 1.2, wob: 1.6 }, { lat: 21.5, d: 1.9, r: 1.1, wob: 1.4 },
];
export const NERVE = { lat: 3.5, d: 7.2, r: 1.8 };            // 정중신경 (작도 가정)
export const ULNAR_ARTERY = { lat: -14, d: 3.6, r: 1.35 };    // 척골동맥 (작도 가정)
export const COMITANS = { off: 2.4, d: 4.2, r: 0.7 };         // 요골동맥 반행정맥 2개 (작도 가정)
// 요골: 배측-요측 부분이 WRIST_ANATOMY.RADIUS_BONE_LATERAL_MM(21 mm)를 품는 타원.
// 상수는 "단단한 구조물" 랜드마크로 지켜지고, 단면 모양 자체는 원위 요골을 흉내 낸 작도 가정이다.
export const RADIUS = { z: 21 - 7, y: -3, a: 11, b: 7, cortex: 1.6 };
export const ULNA = { z: -19, y: -4, a: 5.6, b: 5.4, cortex: 1.5 };   // 상수가 없어 이 뷰가 정한 위치
// 표재 굴근건 2개 — lateral 은 `WRIST_ANATOMY` 값에서 현행 뷰와 같은 만큼 척측으로 민 자리
// (요골동맥 튜브와 겹치지 않게 하려고 현행 `js/wristView.js` 가 쓰는 오프셋 그대로).
export const SUPERFICIAL_TENDONS = [
  { lat: WRIST_ANATOMY.FCR_TENDON_LATERAL_MM - 2.0, d: 6.0, r: 1.9, name: 'FCR' },
  { lat: WRIST_ANATOMY.PL_TENDON_LATERAL_MM - 1.5, d: 6.0, r: 1.9, name: 'PL' },
];

// ── 작은 기하 헬퍼 ────────────────────────────────────────────────────────────────────────────────
/** X 축을 따르는 타원 실린더(단위 실린더를 y/z 로 눌러 만든다). */
export function ellipCyl(ry, rz, len, mat, { y = 0, z = 0, segs = 48, open = true } = {}) {
  const g = new THREE.CylinderGeometry(1, 1, len * MM, segs, 1, open);
  g.rotateZ(Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.scale.set(1, ry * MM, rz * MM);
  m.position.set(0, y * MM, z * MM);
  return m;
}

/** 반투명 층 껍질 재질(속이 비쳐야 하므로 depthWrite 를 끈다). */
export function shellMat(color, opacity) {
  return new THREE.MeshStandardMaterial({
    color, roughness: 0.75, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false,
  });
}

/** 절단면에 놓이는 채워진 타원(선택적으로 타원 구멍) — 법선은 −X. */
export function cutFaceShape(aOut, bOut, aIn = 0, bIn = 0, segs = 72) {
  const shape = new THREE.Shape();
  shape.absellipse(0, 0, aOut, bOut, 0, Math.PI * 2, false, 0);
  if (aIn > 0 && bIn > 0) {
    const hole = new THREE.Path();
    hole.absellipse(0, 0, aIn, bIn, 0, Math.PI * 2, true, 0);
    shape.holes.push(hole);
  }
  const geo = new THREE.ShapeGeometry(shape, segs);
  geo.rotateY(-Math.PI / 2);   // shape (x, y) → world (z = lateral, y = 장측), 법선 → −X
  return geo;
}

/** mm 좌표 [x, y, z] 목록을 따라가는 고정 반지름 튜브(척골동맥·정맥·신경 등 정적 구조용). */
export function tube(points, radiusMm, mat, seg = 40, rad = 10) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0] * MM, p[1] * MM, p[2] * MM)));
  return new THREE.Mesh(new THREE.TubeGeometry(curve, seg, radiusMm * MM, rad, false), mat);
}

// ── 길이 방향 구조물 ──────────────────────────────────────────────────────────────────────────────
/** 반투명 4층 껍질(피부/지방/근막/근육) — A안이 쓰는 전완 겉면. */
export function buildLayeredShells(parent) {
  const out = [];
  const add = (m) => { parent.add(m); out.push(m); return m; };
  add(ellipCyl(LAYERS.skin.ry, LAYERS.skin.rz, SEG_LEN, shellMat(COLORS.skin, 0.34)));
  add(ellipCyl(LAYERS.fat.ry, LAYERS.fat.rz, SEG_LEN, shellMat(COLORS.fat, 0.24)));
  add(ellipCyl(LAYERS.fascia.ry, LAYERS.fascia.rz, SEG_LEN, shellMat(COLORS.fascia, 0.24)));
  add(ellipCyl(LAYERS.muscle.ry, LAYERS.muscle.rz, SEG_LEN, new THREE.MeshStandardMaterial({
    color: 0x7d3d38, roughness: 0.9, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false,
  })));
  return out;
}

/** 요골 + 척골을 타원 실린더로(피질만 — 골수는 절단면에서 보인다). A안용. */
export function buildAnatomyBones(parent) {
  const mat = new THREE.MeshStandardMaterial({ color: COLORS.bone, roughness: 0.62 });
  const radius = ellipCyl(RADIUS.b, RADIUS.a, SEG_LEN, mat, { y: RADIUS.y, z: RADIUS.z, segs: 32, open: false });
  const ulna = ellipCyl(ULNA.b, ULNA.a, SEG_LEN, mat, { y: ULNA.y, z: ULNA.z, segs: 24, open: false });
  parent.add(radius, ulna);
  return { radius, ulna, mat };
}

/** 척골만(E안은 요골을 현행 뷰의 흰 실린더로 그대로 두고 척골만 A 에서 가져온다). */
export function buildUlnaOnly(parent) {
  const mat = new THREE.MeshStandardMaterial({ color: COLORS.bone, roughness: 0.62 });
  const ulna = ellipCyl(ULNA.b, ULNA.a, SEG_LEN, mat, { y: ULNA.y, z: ULNA.z, segs: 24, open: false });
  parent.add(ulna);
  return ulna;
}

/** FCR / PL 건을 반투명 건초(sheath) 안에 넣어 그린다. A안용. */
export function buildSheathedTendons(parent) {
  const tendonMat = new THREE.MeshStandardMaterial({ color: COLORS.tendon, roughness: 0.5 });
  const sheathMat = new THREE.MeshStandardMaterial({
    color: COLORS.sheath, roughness: 0.35, transparent: true, opacity: 0.34, side: THREE.DoubleSide, depthWrite: false,
  });
  const list = [];
  for (const t of SUPERFICIAL_TENDONS) {
    const td = new THREE.Mesh(new THREE.CylinderGeometry(t.r * MM, t.r * MM, SEG_LEN * MM, 16), tendonMat);
    td.rotation.z = Math.PI / 2; td.position.set(0, yAt(t.lat, t.d) * MM, t.lat * MM);
    const sh = new THREE.Mesh(new THREE.CylinderGeometry((t.r + 0.75) * MM, (t.r + 0.75) * MM, SEG_LEN * MM, 16, 1, true), sheathMat);
    sh.rotation.z = Math.PI / 2; sh.position.copy(td.position);
    parent.add(td, sh);
    list.push({ mesh: td, sheath: sh, lat: t.lat, name: t.name });
  }
  return { list, tendonMat, sheathMat };
}

/** 심부 굴근군(FDS ×4 / FDP ×3 / FCU)을 길이 방향 코드로. E안용 —
 *  A안은 이 8개를 **절단면에만** 그린다(길이 방향으로 다 그리면 요골동맥이 파묻힌다). */
export function buildDeepTendons(parent) {
  const mat = new THREE.MeshStandardMaterial({ color: COLORS.tendon, roughness: 0.5 });
  const list = [];
  for (const t of DEEP_TENDONS) {
    const td = new THREE.Mesh(new THREE.CylinderGeometry(t.r * MM, t.r * MM, SEG_LEN * MM, 14), mat);
    td.rotation.z = Math.PI / 2;
    td.position.set(0, yAt(t.lat, t.d) * MM, t.lat * MM);
    parent.add(td); list.push(td);
  }
  return { list, mat };
}

/** 정중신경. */
export function buildMedianNerve(parent) {
  const mat = new THREE.MeshStandardMaterial({ color: COLORS.nerve, roughness: 0.55, emissive: 0x554400, emissiveIntensity: 0.15 });
  const nv = new THREE.Mesh(new THREE.CylinderGeometry(NERVE.r * MM, NERVE.r * MM, SEG_LEN * MM, 14), mat);
  nv.rotation.z = Math.PI / 2;
  nv.position.set(0, yAt(NERVE.lat, NERVE.d) * MM, NERVE.lat * MM);
  parent.add(nv);
  return { mesh: nv, mat };
}

/** 척골동맥 + 표재정맥 3개 (+ 선택적으로 요골동맥 반행정맥 2개). */
export function buildUlnarArteryAndVeins(parent, { comitantes = false } = {}) {
  const mats = [];
  const ulnarMat = new THREE.MeshStandardMaterial({ color: COLORS.artery, emissive: 0x7a0a16, emissiveIntensity: 0.5, roughness: 0.4 });
  mats.push(ulnarMat);
  const U = ULNAR_ARTERY;
  parent.add(tube([
    [X_CUT_MM, yAt(U.lat, U.d + 1.4), U.lat],
    [0, yAt(U.lat, U.d), U.lat + 0.4],
    [-X_CUT_MM, yAt(U.lat + 1, U.d - 0.4), U.lat + 1],
  ], U.r, ulnarMat, 24, 10));

  const veinMat = new THREE.MeshStandardMaterial({ color: COLORS.veinTube, roughness: 0.5, transparent: true, opacity: 0.72 });
  mats.push(veinMat);
  for (const v of VEINS) {
    parent.add(tube([
      [X_CUT_MM, yAt(v.lat - v.wob, v.d + 0.4), v.lat - v.wob],
      [-20, yAt(v.lat + v.wob * 0.6, v.d), v.lat + v.wob * 0.6],
      [12, yAt(v.lat - v.wob * 0.5, v.d), v.lat - v.wob * 0.5],
      [-X_CUT_MM, yAt(v.lat + v.wob, v.d - 0.2), v.lat + v.wob],
    ], v.r, veinMat, 30, 10));
  }
  if (comitantes) {
    const AL = WRIST_ANATOMY.ARTERY_BASE_LATERAL_MM;
    for (const sgn of [-1, 1]) {
      const lat = AL + sgn * COMITANS.off;
      const c = new THREE.Mesh(new THREE.CylinderGeometry(COMITANS.r * MM, COMITANS.r * MM, SEG_LEN * MM, 10), veinMat);
      c.rotation.z = Math.PI / 2;
      c.position.set(0, yAt(lat, COMITANS.d) * MM, lat * MM);
      parent.add(c);
    }
  }
  return { mats };
}

// ── 근위 절단면 ───────────────────────────────────────────────────────────────────────────────────
/**
 * 의학 도해식 절단면: 피부/지방/근막/근육 층 + 요골·척골(피질/골수) + 건초 속 굴근건 +
 * 혈관(내강/벽) + 정중신경(다발).
 *
 * 절단면의 법선은 −X, 즉 키 라이트 반대쪽이다.  그냥 두면 전체가 푸른빛 회색 죽이 되므로
 * 조각마다 **자기 색을 emissive 로 함께 준다** — 해부 도해를 음영이 아니라 색으로 읽는 방식.
 *
 * @param septa A안만 쓰는 근육 칸막이(fascial septa) 윤곽 2개를 추가로 그린다.
 */
export function buildCutFace(parent, { septa = false, faceX = X_CUT_MM } = {}) {
  const face = new THREE.Group();
  parent.add(face);
  const mats = [];
  const put = (geo, color, xOff, y = 0, z = 0, glow = 0.55) => {
    const mat = new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: glow, roughness: 0.9, side: THREE.DoubleSide,
    });
    mats.push(mat);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(faceX * MM - xOff * MM, y * MM, z * MM);
    face.add(m);
  };

  const L = LAYERS, C = COLORS;
  // 층(동심 고리) — 서로 겹치지 않게 이어 붙여 z-fighting 이 없다.
  put(cutFaceShape(L.skin.rz * MM, L.skin.ry * MM, L.skin.rz * MM - 0.45 * MM, L.skin.ry * MM - 0.45 * MM), C.epi, 0.06);
  put(cutFaceShape(L.skin.rz * MM - 0.45 * MM, L.skin.ry * MM - 0.45 * MM, L.fat.rz * MM, L.fat.ry * MM), C.skin, 0.06);
  put(cutFaceShape(L.fat.rz * MM, L.fat.ry * MM, L.fascia.rz * MM, L.fascia.ry * MM), C.fat, 0.06);
  put(cutFaceShape(L.fascia.rz * MM, L.fascia.ry * MM, L.muscle.rz * MM, L.muscle.ry * MM), C.fascia, 0.06);
  put(cutFaceShape(L.muscle.rz * MM, L.muscle.ry * MM), C.muscle, 0.06);
  if (septa) {
    for (const s of [[-13, 3.5, 6.5, 5.5], [-5, -6.5, 6.0, 4.2]]) {
      put(cutFaceShape(s[2] * MM, s[3] * MM, (s[2] - 0.3) * MM, (s[3] - 0.3) * MM), 0xa8705c, 0.09, s[1], s[0], 0.2);
    }
  }

  // 뼈: 피질 고리 + 골수/해면골 채움
  const boneFace = (B) => {
    put(cutFaceShape(B.a * MM, B.b * MM, (B.a - B.cortex) * MM, (B.b - B.cortex) * MM), C.cortex, 0.12, B.y, B.z);
    put(cutFaceShape((B.a - B.cortex) * MM, (B.b - B.cortex) * MM), C.marrow, 0.12, B.y, B.z);
  };
  boneFace(RADIUS); boneFace(ULNA);

  // 건 단면 + 건초 고리
  const tendonFace = (lat, d, r) => {
    put(cutFaceShape((r + 0.75) * MM, (r + 0.75) * MM, r * MM, r * MM, 28), 0xbcd0e4, 0.16, yAt(lat, d), lat, 0.22);
    put(cutFaceShape(r * MM, r * MM, 0, 0, 28), C.tendon, 0.16, yAt(lat, d), lat, 0.34);
  };
  for (const t of SUPERFICIAL_TENDONS) tendonFace(t.lat, t.d, t.r);
  for (const t of DEEP_TENDONS) tendonFace(t.lat, t.d, t.r);

  // 정중신경 단면 + 신경다발
  put(cutFaceShape(NERVE.r * MM, NERVE.r * MM, 0, 0, 24), C.nerve, 0.16, yAt(NERVE.lat, NERVE.d), NERVE.lat, 0.5);
  for (const f of [[-0.7, 0.5], [0.7, 0.4], [0, -0.7]]) {
    put(cutFaceShape(0.42 * MM, 0.42 * MM, 0, 0, 12), 0xb99f3a, 0.2, yAt(NERVE.lat, NERVE.d) + f[1], NERVE.lat + f[0]);
  }

  // 혈관 단면(내강 + 벽)
  const vesselFace = (lat, d, r, col, wall = 0x8f1020) => {
    put(cutFaceShape((r + 0.4) * MM, (r + 0.4) * MM, 0, 0, 24), wall, 0.17, yAt(lat, d), lat, 0.25);
    put(cutFaceShape(r * MM, r * MM, 0, 0, 24), col, 0.19, yAt(lat, d), lat, 0.8);
  };
  const AR = WRIST_ANATOMY;
  // 요골동맥은 절단면(= 가장 근위)에서 가장 깊다 — 길이 방향 튜브와 같은 깊이 식을 쓴다.
  vesselFace(AR.ARTERY_BASE_LATERAL_MM,
    Math.max(0.9, AR.ARTERY_BASE_DEPTH_MM - 0.7) + AR.ARTERY_DEPTH_GRADIENT_MM_PER_MM * SEG_LEN / 2, 1.3, C.artery);
  vesselFace(ULNAR_ARTERY.lat, ULNAR_ARTERY.d + 1.4, ULNAR_ARTERY.r, C.artery);
  for (const sg of [-1, 1]) vesselFace(AR.ARTERY_BASE_LATERAL_MM + sg * COMITANS.off, COMITANS.d, COMITANS.r, C.comitans, 0x22307a);
  for (const v of VEINS) vesselFace(v.lat - v.wob, v.d + 0.4, v.r, COLORS.veinFace, 0x22337a);

  return { group: face, mats };
}
