// js/wrist3d/models.js — 손목 3D 뷰가 고를 수 있는 **손/전완 모델 3종**.
//
// 세 빌더가 같은 시그니처를 갖는다:
//   ctx = { THREE, MM, SEG_LEN, WRIST_ANATOMY, arteryMat, rx, rz, assetBase }
//   → { group: THREE.Group, dispose(), setGeometry({ rx, rz }) }
//
// 각 모델이 **소유하는 것**: 전완 껍질(피부/조직/끝 캡), 뼈·건·내부 구조, 그리고 손.
// 각 모델이 **소유하지 않는 것**: 조명, 박동하는 요골동맥 튜브, 전극 시트/패드/번호, 카메라,
// 포인터 조작 — 전부 `js/wristView.js` 가 그대로 들고 있다.  그래서 모델을 갈아 끼워도
// 패치 위치와 카메라가 초기화되지 않는다.
//
//   0. 현행       — 지금까지의 뷰 그대로(실린더 전완 + 구/캡슐 손).  픽셀 동일해야 한다.
//   A. 해부 단면 강화 — 층 구조 전완 + 요골/척골 + 건초 속 건 + 혈관/신경 + 의학 도해식 절단면.
//   E. 실사 GLB 손  — A 의 내부 구조 + 절단면 + 포토스캔 GLB 손을 손목에 용접.
//
// A / E 의 모양은 `proto/wrist_variants.html` 에서 확인·승인된 프로토타입을 옮긴 것이다.
// 프로토와 앱이 같은 코드를 보도록 공통 부품은 `js/wrist3d/anatomy.js` 에 있다.

import * as A from './anatomy.js';
import { buildGlbHand, buildBridge, buildIndexRing } from './handGlb.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/**
 * 그룹 안의 지오메트리/재질/텍스처를 모두 해제한다.
 * `keep` 에 든 재질(요골동맥 재질처럼 뷰가 소유한 것)은 건드리지 않는다.
 */
function disposeGroup(group, keep = new Set()) {
  const seen = new Set();
  group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      if (!m || keep.has(m) || seen.has(m)) continue;
      seen.add(m);
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap']) {
        if (m[k] && m[k].dispose) m[k].dispose();
      }
      m.dispose();
    }
  });
  group.clear();
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// 0. 현행 (baseline) — `js/wristView.js` 의 _buildWrist() / _buildHand() 를 그대로 옮긴 것.
//    여기서 한 줄이라도 다르면 "기존과 픽셀 동일" 이 깨진다.
// ══════════════════════════════════════════════════════════════════════════════════════════════════
export function buildModel0(ctx) {
  const { THREE, MM, SEG_LEN, WRIST_ANATOMY, arteryMat } = ctx;
  let rx = ctx.rx, rz = ctx.rz;
  const group = new THREE.Group();

  // 이 모델이 쓰는 단면 표면 높이(현행 뷰의 _surfaceY 와 같은 식).
  const surfaceY = (lat_mm) => {
    const zr = clamp(lat_mm / rz, -0.999, 0.999);
    return rx * Math.sqrt(1 - zr * zr) * MM;
  };

  // Skin: elliptical cylinder along X (scale a unit cylinder)
  const skinGeo = new THREE.CylinderGeometry(1, 1, SEG_LEN * MM, 64, 1, true);
  skinGeo.rotateZ(Math.PI / 2); // axis → X
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xe6b79a, roughness: 0.7, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
  const skin = new THREE.Mesh(skinGeo, skinMat);
  skin.scale.set(1, rx * MM, rz * MM);
  skin.receiveShadow = true;
  group.add(skin);
  // Inner tissue (opaque, slightly smaller) so the semi-transparent skin reads as a volume.
  // The 6 mm inset is an absolute skin/fat rind thickness — it does NOT scale with the body.
  const tissue = new THREE.Mesh(skinGeo.clone(), new THREE.MeshStandardMaterial({ color: 0xc98b72, roughness: 0.9 }));
  tissue.scale.set(0.999, (rx - 6) * MM, (rz - 6) * MM);
  group.add(tissue);
  // End caps (tissue discs) for visual closure
  const caps = [];
  for (const sx of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshStandardMaterial({ color: 0xb8775f, roughness: 0.95, side: THREE.DoubleSide }));
    cap.rotation.y = Math.PI / 2; cap.scale.set(rz * MM, rx * MM, 1); cap.position.x = sx * SEG_LEN * MM * 0.5;
    group.add(cap); caps.push(cap);
  }

  // Radius bone (stiff structure under the radial side). Lateral position comes from the physics
  // model (WRIST_ANATOMY) and is NOT body-scaled — see §6.16 "still fixed".
  const bone = new THREE.Mesh(new THREE.CylinderGeometry(6 * MM, 7 * MM, SEG_LEN * MM, 24), new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.6 }));
  bone.rotation.z = Math.PI / 2; bone.position.set(0, -4 * MM, WRIST_ANATOMY.RADIUS_BONE_LATERAL_MM * MM);
  group.add(bone);

  // Tendons (FCR, palmaris longus) — pale cords just under the skin
  const tendonMat = new THREE.MeshStandardMaterial({ color: 0xf5f0dc, roughness: 0.5 });
  // Drawn a little deeper (5.5 mm) and the FCR cord 1 mm ulnar of its model position so the cords do
  // not intersect the artery tube (which is lifted toward the skin for visibility, see _rebuildArtery).
  const tendons = [];
  for (const lat0 of [WRIST_ANATOMY.FCR_TENDON_LATERAL_MM, WRIST_ANATOMY.PL_TENDON_LATERAL_MM]) {
    // FCR cord 2 mm ulnar of its model ridge (clear of the artery tube); PL cord 1.5 mm ulnar so the two cords
    // also keep a gap between themselves (centres 5.2 mm apart > 3.8 mm radii sum) along the whole segment
    const lat = lat0 === WRIST_ANATOMY.FCR_TENDON_LATERAL_MM ? lat0 - 2.0 : lat0 - 1.5;
    const td = new THREE.Mesh(new THREE.CylinderGeometry(1.9 * MM, 1.9 * MM, SEG_LEN * MM, 16), tendonMat);
    td.rotation.z = Math.PI / 2; td.position.set(0, surfaceY(lat) - 6.0 * MM, lat * MM);
    group.add(td); tendons.push({ mesh: td, lat });
  }

  // Proximal marker (distal side is now the hand)
  const markerMat = new THREE.MeshBasicMaterial({ color: 0x94a3b8 });
  const prox = new THREE.Mesh(new THREE.ConeGeometry(2 * MM, 6 * MM, 12), markerMat); prox.rotation.z = Math.PI / 2; prox.position.set(-SEG_LEN * MM * 0.5 - 5 * MM, rx * MM + 4 * MM, 0); group.add(prox);

  buildBaselineHand(ctx, group);

  return {
    group,
    setGeometry({ rx: nrx, rz: nrz }) {
      rx = nrx; rz = nrz;
      skin.scale.set(1, rx * MM, rz * MM);
      tissue.scale.set(0.999, Math.max(1, rx - 6) * MM, Math.max(1, rz - 6) * MM);
      for (const cap of caps) cap.scale.set(rz * MM, rx * MM, 1);
      for (const t of tendons) t.mesh.position.set(0, surfaceY(t.lat) - 6.0 * MM, t.lat * MM);
      prox.position.y = rx * MM + 4 * MM;
    },
    dispose() { disposeGroup(group, new Set([arteryMat])); },
  };
}

/**
 * Palm + fingers + thumb attached at the distal (+x) end, palm facing up (volar = +Y),
 * thumb on the radial (+Z) side. Superficial palmar arch continues the radial artery.
 * 0안과 A안이 함께 쓰는 "현행 손".
 */
function buildBaselineHand(ctx, parent) {
  const { THREE, MM, SEG_LEN, WRIST_ANATOMY, arteryMat } = ctx;
  const skin = new THREE.MeshStandardMaterial({ color: 0xe6b79a, roughness: 0.7 });
  const x0 = SEG_LEN * MM * 0.5; // wrist end
  const hand = new THREE.Group();
  hand.position.x = x0;
  parent.add(hand);

  // Palm: flattened ellipsoid ~85 mm long, 85 mm wide, 26 mm thick
  const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), skin);
  palm.scale.set(46 * MM, 13 * MM, 44 * MM);
  palm.position.set(40 * MM, 0, 0);
  palm.castShadow = true;
  hand.add(palm);
  // Thenar eminence (base of thumb) bulge on the radial side
  const thenar = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), skin);
  thenar.scale.set(22 * MM, 11 * MM, 16 * MM); thenar.position.set(28 * MM, 2 * MM, 30 * MM); hand.add(thenar);

  // Fingers: index (radial, +z) → little (ulnar, −z)
  const fingers = [{ z: 27, len: 68, r: 7.5 }, { z: 9, len: 75, r: 7.5 }, { z: -9, len: 70, r: 7 }, { z: -27, len: 56, r: 6.3 }];
  for (let i = 0; i < fingers.length; i++) {
    const f = fingers[i];
    const g = new THREE.CapsuleGeometry(f.r * MM, f.len * MM, 6, 16);
    g.rotateZ(Math.PI / 2); // axis → X
    const m = new THREE.Mesh(g, skin);
    m.position.set((82 + f.len / 2) * MM, 0, f.z * MM);
    m.castShadow = true;
    hand.add(m);
  }
  // Thumb: angled outward (+z) and slightly up from the thenar
  const tg = new THREE.CapsuleGeometry(8 * MM, 52 * MM, 6, 16); tg.rotateZ(Math.PI / 2);
  const thumb = new THREE.Mesh(tg, skin);
  thumb.position.set(55 * MM, 4 * MM, 52 * MM);
  thumb.rotation.y = -0.75; // point distally + radially
  thumb.castShadow = true;
  hand.add(thumb);

  // PPG ring on the index finger (proximal phalanx)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(9 * MM, 1.6 * MM, 10, 32), new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.9, roughness: 0.25 }));
  ring.rotation.y = Math.PI / 2; ring.position.set(100 * MM, 0, 27 * MM); hand.add(ring);

  // Superficial palmar arch: continues from the radial artery (radial side) across the palm toward the ulnar side
  const lat0 = (WRIST_ANATOMY.ARTERY_BASE_LATERAL_MM) * MM;
  const archPts = [
    new THREE.Vector3(-2 * MM, 10 * MM, lat0),
    new THREE.Vector3(16 * MM, 11.5 * MM, lat0 - 2 * MM),
    new THREE.Vector3(34 * MM, 12.5 * MM, lat0 - 14 * MM),
    new THREE.Vector3(50 * MM, 12.5 * MM, lat0 - 30 * MM),
    new THREE.Vector3(58 * MM, 12 * MM, lat0 - 44 * MM),
  ];
  const arch = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(archPts), 32, 1.0 * MM, 12, false), arteryMat);
  hand.add(arch);
  // Digital artery to the index finger from the arch
  const digPts = [new THREE.Vector3(34 * MM, 12.5 * MM, lat0 - 14 * MM), new THREE.Vector3(60 * MM, 12 * MM, 22 * MM), new THREE.Vector3(95 * MM, 7 * MM, 27 * MM), new THREE.Vector3(135 * MM, 5 * MM, 27 * MM)];
  const dig = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(digPts), 32, 0.7 * MM, 10, false), arteryMat);
  hand.add(dig);

  return hand;
}

// A / E 의 단면 배율 처리 — 그룹 전체를 y/z 로 아핀 스케일한다.
//
// 정직하게 적어 두자면, 이것은 0안이 하는 일과 **다른 근사**다.  0안은 진피 6 mm 와 요골 위치를
// 절대값으로 고정하고 껍질만 늘린다.  A/E 는 층이 여럿이고(E 는 손이 전완에 용접돼 있어서) 부품별
// 재배치를 하면 층 두께가 어긋나거나 이음매가 벌어진다.  그래서 단면 전체를 같은 비율로 늘린다 —
// 기준 체형(배율 1)에서는 완전히 같고, 다른 체형에서는 "층 두께도 함께 늘어난" 그림이 된다.
// 이는 작도상의 단순화이지 해부학적 주장이 아니다.
function sectionScaler(group) {
  return ({ rx, rz }) => group.scale.set(1, rx / A.REF_RX, rz / A.REF_RZ);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// A. 해부 단면 강화 — proto/variants/vA_anatomy.js 를 옮긴 것.
//    바뀌는 것은 전완의 **겉면과 속**, 그리고 근위 절단면이다.  손·전극 패치·요골동맥 튜브는
//    현행(0안)과 같다.
// ══════════════════════════════════════════════════════════════════════════════════════════════════
export function buildModelA(ctx) {
  const { THREE, MM, SEG_LEN, arteryMat } = ctx;
  const group = new THREE.Group();

  // 층 껍질(반투명) → 속이 계속 읽힌다
  A.buildLayeredShells(group);
  // 요골 + 척골 (피질만; 골수는 절단면에서 보인다)
  A.buildAnatomyBones(group);
  // FCR + PL 을 건초 안에 넣어서.  심부 굴근군(FDS/FDP/FCU)은 **절단면에만** 그린다 —
  // 길이 방향으로 8개를 더 깔면 이 뷰가 존재하는 이유인 요골동맥이 파묻힌다.
  A.buildSheathedTendons(group);
  A.buildMedianNerve(group);
  // 척골동맥 + 표재정맥.  요골동맥 반행정맥도 절단면에만 — 길이 방향으로 그리면 요골동맥과 경쟁한다.
  A.buildUlnarArteryAndVeins(group, { comitantes: false });
  // 근위 절단면(의학 도해식). A 만 근육 칸막이 윤곽을 함께 그린다.
  A.buildCutFace(group, { septa: true });

  // 손과 근위 방향 표시는 현행 그대로
  buildBaselineHand(ctx, group);
  const prox = new THREE.Mesh(new THREE.ConeGeometry(2 * MM, 6 * MM, 12), new THREE.MeshBasicMaterial({ color: 0x94a3b8 }));
  prox.rotation.z = Math.PI / 2;
  prox.position.set(-SEG_LEN * MM * 0.5 - 5 * MM, A.REF_RX * MM + 4 * MM, 0);
  group.add(prox);

  const setGeometry = sectionScaler(group);
  setGeometry({ rx: ctx.rx, rz: ctx.rz });
  return { group, setGeometry, dispose() { disposeGroup(group, new Set([arteryMat])); } };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// E. 실사 GLB 손 — proto/variants/vE_glb.js 를 옮긴 것.
//
// 전완 내부(요골동맥·FCR/PL 건·요골·내부 조직·근위 캡)는 **0안과 같은 지오메트리·위치·색**이고,
// 여기에 A 의 심부 구조와 절단면을 더한다.  E 가 바꾸는 것은 **손**과 **피부의 투명도 창**이다.
//
// ⚠ 손 GLB 는 CC-BY-NC-4.0 (deep3dstudio) — **비영리 전용**.  E 가 켜져 있는 동안 손목 카드
//   푸터에 저작자 표시가 뜬다(`index.html` #handCredit).  자세한 조건은 js/wrist3d/handGlb.js 헤더.
// ══════════════════════════════════════════════════════════════════════════════════════════════════

// 작도 가정(mm) — 전부 이 뷰가 보기 좋게 정한 값이다(프로토와 같은 값).
const E_PARAMS = {
  skinAlpha: 0.55,     // 근위쪽 피부 불투명도(= 현행 뷰와 같음)
  windowAlpha: 0.12,   // 원위 "피부 창" 의 불투명도
  windowStart: -72,    // 창이 열리기 시작하는 along (110 mm 전완의 원위 65 %)
  windowFade: 26,      // 창 경계가 부드러워지는 구간 길이
  glbCutAlong: 11,     // GLB 를 자르는 along — 손목주름보다 11 mm 원위(패치가 전완 위에 남도록)
  extensionDeg: 12,    // 손목 배굴(스캔이 살짝 굴곡 자세라 그대로 붙이면 이음매가 꺾여 보인다)
  ringTipFrac: 0.82,   // 반지 자리 = 손끝에서 손가락 길이의 82 % (= MCP 바로 원위)
};
const E_SKIN_COLOR = 0xe6b79a;

export async function buildModelE(ctx) {
  const { THREE, MM, SEG_LEN, WRIST_ANATOMY, arteryMat, assetBase } = ctx;
  const RY = A.REF_RX, RZ = A.REF_RZ;
  const X_CREASE_MM = SEG_LEN / 2;
  const group = new THREE.Group();

  // ---------- 전완 피부: 현행의 타원 실린더에 **정점 알파 하나만** 더한 것 ------------------------
  // 원위 구간을 통째로 열어 패치 밑 요골동맥이 계속 보이게 한다.  셰이더를 건드리지 않는다.
  const NS = 22, NR = 64;
  const pos = [], colr = [], idx = [];
  const skinCol = new THREE.Color(E_SKIN_COLOR);
  for (let i = 0; i < NS; i++) {
    const along = -SEG_LEN + (SEG_LEN * i) / (NS - 1);            // along, −110 … 0
    const w0 = smooth(E_PARAMS.windowStart, E_PARAMS.windowStart + E_PARAMS.windowFade, along);
    for (let j = 0; j < NR; j++) {
      const th = (j / NR) * Math.PI * 2;
      pos.push((X_CREASE_MM + along) * MM, RY * Math.cos(th) * MM, RZ * Math.sin(th) * MM);
      const volar = 0.45 + 0.55 * clamp(Math.cos(th), 0, 1);      // 장측일수록 더 많이 연다
      colr.push(skinCol.r, skinCol.g, skinCol.b, lerp(E_PARAMS.skinAlpha, E_PARAMS.windowAlpha, volar * w0));
    }
  }
  for (let i = 0; i < NS - 1; i++) for (let j = 0; j < NR; j++) {
    const k = (j + 1) % NR;
    idx.push(i * NR + j, i * NR + k, (i + 1) * NR + j, i * NR + k, (i + 1) * NR + k, (i + 1) * NR + j);
  }
  const skinGeo = new THREE.BufferGeometry();
  skinGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  skinGeo.setAttribute('color', new THREE.Float32BufferAttribute(colr, 4));
  skinGeo.setIndex(idx);
  skinGeo.computeVertexNormals();
  const skin = new THREE.Mesh(skinGeo, new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: 0.7, transparent: true,
    side: THREE.DoubleSide, depthWrite: false,
  }));
  skin.receiveShadow = true;
  skin.renderOrder = 5;                    // 내부 구조 뒤에 그려야 내부가 계속 보인다
  group.add(skin);

  // ---------- 전완 속: 현행(0안)과 같은 것들 -------------------------------------------------------
  const tissueGeo = new THREE.CylinderGeometry(1, 1, SEG_LEN * MM, 64, 1, true);
  tissueGeo.rotateZ(Math.PI / 2);
  const tissue = new THREE.Mesh(tissueGeo, new THREE.MeshStandardMaterial({ color: 0xc98b72, roughness: 0.9 }));
  tissue.scale.set(0.999, (RY - 6) * MM, (RZ - 6) * MM);
  group.add(tissue);
  // 근위 끝 캡만 그린다(원위 끝은 손이 용접되는 자리라 캡이 없다)
  const cap = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshStandardMaterial({ color: 0xb8775f, roughness: 0.95, side: THREE.DoubleSide }));
  cap.rotation.y = Math.PI / 2; cap.scale.set(RZ * MM, RY * MM, 1);
  cap.position.x = -SEG_LEN * MM * 0.5 + 0.3 * MM;   // 절단면 조각보다 0.3 mm 뒤(z-fighting 방지)
  group.add(cap);
  // 요골 — 현행 뷰의 지오메트리/위치/색 그대로
  const bone = new THREE.Mesh(new THREE.CylinderGeometry(6 * MM, 7 * MM, SEG_LEN * MM, 24),
    new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.6 }));
  bone.rotation.z = Math.PI / 2;
  bone.position.set(0, -4 * MM, WRIST_ANATOMY.RADIUS_BONE_LATERAL_MM * MM);
  group.add(bone);
  // FCR + PL — 현행 뷰와 같은 자리(건초 없이)
  const tendonMat = new THREE.MeshStandardMaterial({ color: 0xf5f0dc, roughness: 0.5 });
  for (const t of A.SUPERFICIAL_TENDONS) {
    const td = new THREE.Mesh(new THREE.CylinderGeometry(t.r * MM, t.r * MM, SEG_LEN * MM, 16), tendonMat);
    td.rotation.z = Math.PI / 2; td.position.set(0, A.yAt(t.lat, t.d) * MM, t.lat * MM);
    group.add(td);
  }

  // ---------- A 의 나머지 내부 구조 — 여기서는 길이 방향으로도 그린다 ------------------------------
  // (A 는 심부건·반행정맥을 절단면에만 그리지만, E 는 반투명 창으로 길이 방향을 보여 주는 것이 목적)
  A.buildUlnaOnly(group);
  A.buildDeepTendons(group);
  A.buildMedianNerve(group);
  A.buildUlnarArteryAndVeins(group, { comitantes: true });

  // ---------- 손: 포토스캔 GLB ---------------------------------------------------------------------
  const hand = await buildGlbHand({
    textures: false, skinColor: E_SKIN_COLOR,
    ...(assetBase ? { assetBase } : {}),
    align: {
      forearmRy: RY, forearmRz: RZ,
      clipX: X_CREASE_MM + E_PARAMS.glbCutAlong,   // 실제로 자른다 — 손목주름 11 mm 원위
      extensionDeg: E_PARAMS.extensionDeg,
      ringTipFrac: E_PARAMS.ringTipFrac,
      ringFinger: 0,                               // 0 = 검지
    },
  });
  group.add(hand.group);

  // 용접 브리지: 전완 원위 타원 링 → 자르면서 생긴 경계 루프.  정점 알파가 창에서 불투명으로
  // 올라가므로 이음매에서 투명도가 튀지 않는다.
  if (hand.cutLoop) {
    const bridgeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true, roughness: 0.8, side: THREE.DoubleSide,
      transparent: true, depthWrite: false,
    });
    const bridge = buildBridge({
      loop: hand.cutLoop, fromX: X_CREASE_MM, ry: RY, rz: RZ, rings: 4,
      mat: bridgeMat, alphaFrom: E_PARAMS.windowAlpha + 0.08, alphaTo: 1.0, color: E_SKIN_COLOR,
    });
    bridge.renderOrder = 5;
    group.add(bridge);
  }
  // PPG 반지 — 실제 손가락 지오메트리에서 잰 자리에 끼운다
  if (hand.ringSeat) group.add(buildIndexRing(hand.ringSeat));

  // ---------- 근위 절단면 — A 와 같은 의학 도해식 단면(근육 칸막이 윤곽만 없음) --------------------
  A.buildCutFace(group, { septa: false });

  const setGeometry = sectionScaler(group);
  setGeometry({ rx: ctx.rx, rz: ctx.rz });
  return { group, setGeometry, hand, dispose() { disposeGroup(group, new Set([arteryMat])); } };
}
