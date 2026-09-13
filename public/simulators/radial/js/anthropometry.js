// Anthropometry layer: 체형(신장·체중) → 손목 조직 파라미터.
//
// ⚠ 정직성 노트 (읽고 쓸 것):
// 이 모듈의 모든 계수는 **모델 가정(문헌 보정 필요)** 이다 — 초음파/인체측정 문헌에서 직접 가져온
// 회귀식이 아니라, 트윈의 기존 기본값(동맥 깊이 2.5 mm @ 손목주름, 손목 폭 58 mm 가정)과 일관되도록
// 맞춘 단순 근사식이다(자세한 근거는 docs/CLINICAL_AUDIT.md §6.9). 인용할 문헌이 확정되기 전까지는
// "플레이스홀더 계수"로 취급할 것.
//
// 핵심 설계 판단: **손목 볼라(장측)는 지방이 적은 부위**다 — 피하지방은 복부처럼 BMI에 비례해 쌓이지
// 않고 얇게 유지되므로, BMI 효과를 의도적으로 **작게** 두었다. 따라서 이 레이어가 만드는 지배적 효과는
// 지방층 자체의 유전 감쇠(couplingAtten, 완만)가 아니라 **깊이 → 결합 커널 폭(σ ≈ 1.2·깊이,
// capacitiveArray.js) → 채널 SNR** 경로다. BMI→깊이 기울기·감쇠 τ 모두 초음파 문헌 보정 대상.
//
// 기본 체형 170 cm / 70 kg 은 트윈의 역사적 기본 동작(깊이 2.5 mm, 감쇠 1)과 **비트 동일**해야 한다.
// 이 모듈의 절대값이 정확히 2.5를 내지는 않으므로(BMI 22 기준으로 보정된 식), 소비자(engine.setBody,
// eval/population_eval.mjs)는 반드시 **기준 체형(REFERENCE_BODY) 대비 차분**으로 적용한다:
//   arteryDepthOffset_mm = depth(body) − depth(170, 70)   (기본 체형 → 정확히 0)
//   arterialAttenGain    = atten(body) ÷ atten(170, 70)   (기본 체형 → 정확히 1)

// 기준 체형: 트윈의 기존 암묵 기본(손목 폭 58 mm 가정 등)이 대략 이 체형을 상정했다고 보고 고정.
export const REFERENCE_BODY = { height_cm: 170, weight_kg: 70 };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// 170 cm / 70 kg 의 BMI (≈ 24.22) — 손목 둘레 보정 기준점.
const BMI_REF = 70 / 1.7 / 1.7;

/**
 * 신장·체중에서 손목(볼라, 요골동맥 위) 조직 파라미터를 유도한다.
 * 반환: { bmi, wristCirc_mm, skinFat_mm, arteryDepth_mm, couplingAtten }
 * 모든 식은 모델 가정(문헌 보정 필요) — 각 항의 근거는 해당 줄 주석 참조.
 */
export function deriveWristTissue({ height_cm = 170, weight_kg = 70 } = {}) {
  const h_m = height_cm / 100;
  // BMI = 체중/신장² — 정의식(가정 아님).
  const bmi = weight_kg / (h_m * h_m);

  // 손목 둘레: 신장 선형 + BMI 항의 1차 근사 — 모델 가정(문헌 보정 필요).
  // 보정점: 170 cm/70 kg → 165 mm. 트윈의 설계도구가 손목 최협부 폭 58 mm(가정)를 쓰는데,
  // 폭 58 mm의 타원 단면(높이 ≈ 40 mm)의 둘레가 대략 155–170 mm라 165 mm를 기준으로 삼았다.
  // 기울기(신장 0.55 mm/cm, BMI 2.0 mm/단위)는 자릿수만 맞춘 플레이스홀더.
  const wristCirc_mm = clamp(165 + 0.55 * (height_cm - 170) + 2.0 * (bmi - BMI_REF), 120, 220);

  // 볼라 손목 피하지방 두께: 손목은 지방 희소 부위 — 얇고 BMI 의존이 약하다는 가정.
  // 1.2 mm @ BMI 22 + 0.06 mm/BMI, 절단 [0.8, 2.8] mm — 모델 가정(초음파 문헌 보정 필요).
  const skinFat_mm = clamp(1.2 + 0.06 * (bmi - 22), 0.8, 2.8);

  // 요골동맥 깊이(피부→동맥 중심, 손목주름): 고정 기저 2.0 mm(진피+근막 등 비지방 조직)
  // + 지방 두께의 부분 기여(계수 0.42 — 지방층 전체가 동맥 위에 놓이지는 않는다는 가정이며,
  // BMI 22·신장 170에서 트윈의 기존 기본 2.5 mm와 일치하도록 보정한 값)
  // + 작은 신장 항(큰 골격 → 약간 깊음), 절단 [2.0, 4.5] mm — 모두 모델 가정(문헌 보정 필요).
  const arteryDepth_mm = clamp(2.0 + 0.42 * skinFat_mm + 0.003 * (height_cm - 170), 2.0, 4.5);

  // 지방층에 의한 **추가** 동맥 맥파 진폭 감쇠(커널 폭 확대 효과와 별개): exp(−(지방−1.2)/τ), τ = 3 mm.
  // 완만한 감쇠(BMI 35에서도 ×0.77) — 지방의 유전율이 공기보다 훨씬 높아 정전용량 경로 감쇠가
  // 크지 않다는 가정. τ 값은 플레이스홀더(문헌/실측 보정 필요). 잡음 기준 진폭에는 적용하지 않는다
  // (capacitiveArray.js 참조: 지방 ↑ → 신호만 감소 → SNR 저하로 모델).
  const couplingAtten = Math.exp(-(skinFat_mm - 1.2) / 3);

  return { bmi, wristCirc_mm, skinFat_mm, arteryDepth_mm, couplingAtten };
}

// 기준 체형의 유도값 — 차분 적용의 분모/기준점.
export function referenceWristTissue() { return deriveWristTissue(REFERENCE_BODY); }

/**
 * 신장·체중 → **검지 손가락(PPG 링 착용부) 광학 경로** 파라미터.
 * 반환: { fingerWidth_mm, fingerTissue_mm, dcAtten, acAtten }
 *
 * ⚠ 모든 계수는 **모델 가정(문헌 보정 필요)** — 손가락 인체측정/광학 문헌에서 가져온 값이 아니다.
 * 설계 판단은 위 손목 레이어와 같다: **효과를 의도적으로 작게** 둔다. 손가락은 지방이 거의 없는
 * 부위라 체형에 따른 연부조직 두께 변화가 작고, 이 항의 목적은 "모집단 표집이 광학 변이도 덮게"
 * 하는 것이지 지배적 오차원을 만드는 것이 아니다(BMI 17→35에서 DC ×1.03→×0.92 수준).
 *
 * 소비 규약은 `deriveWristTissue`와 동일 — 반드시 **기준 체형 대비 비율**로 적용한다:
 *   tissueDcGain = dcAtten(body) ÷ dcAtten(170, 70)   (기준 체형 → 정확히 1)
 *   tissueAcGain = acAtten(body) ÷ acAtten(170, 70)   (기준 체형 → 정확히 1)
 * (`js/ppgSpo2.js` `setBodyOptics()`가 그렇게 한다.)
 */
export function deriveFingerOptics({ height_cm = 170, weight_kg = 70 } = {}) {
  const h_m = height_cm / 100;
  const bmi = weight_kg / (h_m * h_m);

  // 검지 원위지골 폭: 신장 선형 + 약한 BMI 항 — 모델 가정(플레이스홀더).
  // 보정점 170 cm/70 kg → 16 mm(성인 검지 폭의 자릿수), 절단 [13, 22] mm.
  const fingerWidth_mm = clamp(16 + 0.05 * (height_cm - 170) + 0.22 * (bmi - BMI_REF), 13, 22);

  // 센서–동맥 사이 연부조직(비맥동) 두께: 손가락은 지방 희소 → 얇고 BMI 의존이 약하다는 가정.
  // 1.6 mm @ 기준 체형 + 0.05 mm/BMI + 미세한 신장 항, 절단 [1.2, 2.6] mm — 모델 가정.
  const fingerTissue_mm = clamp(1.6 + 0.05 * (bmi - BMI_REF) + 0.004 * (height_cm - 170), 1.2, 2.6);

  // DC(비맥동) 감쇠: exp(−(조직−기준)/τ_dc), τ_dc = 6 mm — 완만(모델 가정, 문헌 보정 필요).
  const dcAtten = Math.exp(-(fingerTissue_mm - 1.6) / 6);
  // 맥동분율(AC/DC) 희석: 비맥동 조직이 두꺼울수록 검출광 중 맥동 성분의 비율이 낮아진다는 가정.
  // τ_ac = 12 mm — DC보다 **더** 완만(즉 AC/DC 영향은 DC 영향의 절반 수준).
  const acAtten = Math.exp(-(fingerTissue_mm - 1.6) / 12);

  return { bmi, fingerWidth_mm, fingerTissue_mm, dcAtten, acAtten };
}

// 기준 체형의 손가락 광학 유도값 — 비율 적용의 분모.
export function referenceFingerOptics() { return deriveFingerOptics(REFERENCE_BODY); }

// ---------------------------------------------------------------------------------------------
// 손목 **단면 기하** (ROADMAP §2.1-4 나머지 절반; 상세·한계 docs/CLINICAL_AUDIT.md §6.16)
//
// 목적: 위에서 만든 `wristCirc_mm`(둘레)를 3D 뷰(js/wristView.js)와 설계도구 사진 정합
// (js/patchDesigner.js)이 실제로 필요로 하는 **폭·깊이·곡률**로 바꾼다.
//
// ⚠ 정직성 노트: 아래 두 가지가 이 레이어의 전부이고, 둘 다 **모델 가정**이다.
//   (1) 단면 종횡비 ASPECT = 깊이(배측–장측) ÷ 폭(요–척측) = 0.70 — 손목은 원이 아니라 **납작하다**.
//       성인 손목 폭 55–60 mm / 두께 38–42 mm 라는 자릿수에서 고른 값이며, 인체측정 문헌에서
//       가져온 회귀값이 아니다. 체형(BMI)에 따라 종횡비가 변한다는 항은 **넣지 않았다**
//       (근거 없음 — 지방이 붙어도 형태는 닮은꼴로 커진다고 가정).
//   (2) 기준 폭 WIDTH_REF_MM = 58 mm — 설계도구가 손 사진을 정합할 때 쓰는 "손목 최협부 폭"
//       가정값이다. 사진 **한 장**(assets/hand_*.png)의 알파 마스크에서 잰 픽셀 폭을 mm로
//       바꾸는 데 쓰였을 뿐, 모집단 평균이 아니다.
//
// 닮은꼴 가정이므로 폭은 둘레에 **정비례**한다: width(body) = 58 mm × circ(body)/circ(기준 체형).
// 기준 체형에서 비율이 정확히 1(같은 코드 경로의 같은 double)이라 width = 58.0 **정확히**이고,
// 소비자(wristView/설계도구)의 기본 동작이 픽셀 단위로 바뀌지 않는다.
//
// 알려진 불일치(숨기지 않는다): 폭 58 mm·깊이 40.6 mm 타원의 실제 둘레는 ≈156 mm 로,
// `deriveWristTissue`가 기준점으로 삼은 165 mm와 5–6 % 어긋난다. 두 값이 서로 독립적으로
// (하나는 "손목 둘레의 자릿수", 하나는 "사진 한 장의 폭") 정해졌기 때문이며, 여기서는 **폭 쪽을
// 정합의 기준으로 고정**하고 둘레는 체형 변화의 **스케일 신호로만** 썼다. 반환값에
// `ellipsePerim_mm`(형상에서 계산한 실제 둘레)를 같이 실어 이 차이를 볼 수 있게 한다.

// 단면 종횡비(깊이/폭) — 모델 가정. 손목은 원보다 납작하다.
export const WRIST_ASPECT = 0.70;
// 기준 체형(170/70)의 손목 최협부 폭 — 설계도구 사진 정합의 가정값(모델 가정).
export const WRIST_WIDTH_REF_MM = 58.0;

// 타원 둘레(라마누잔 2차 근사, 상대오차 < 1e-5) — 수학식(가정 아님).
function ellipsePerimeter(a, b) {
  const h = ((a - b) / (a + b)) ** 2;
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

/**
 * 신장·체중 → 손목 **단면 기하**(타원 근사).
 * 반환: {
 *   bmi, wristCirc_mm,          // 위 레이어에서 그대로 전달
 *   width_mm, depth_mm,         // 요–척측 폭 / 배측–장측 깊이 (최협부, 손목주름 부근)
 *   semiWidth_mm, semiDepth_mm, // 타원 반축 a, b
 *   volarRadius_mm,             // 장측(볼라) 정점의 곡률 반지름 = a²/b — 강체 패치가 맞춰야 하는 양
 *   ellipsePerim_mm,            // 위 형상의 실제 둘레(위 "알려진 불일치" 참조)
 *   widthScale, depthScale,     // 기준 체형 대비 배율 (기준 체형 → 정확히 1)
 * }
 * 소비 규약: 절대값을 그대로 쓰는 곳(설계도구 사진 정합)과 **배율만** 쓰는 곳(wristView의
 * 역사적 반축 28/20 mm)이 나뉜다 — 후자는 기준 체형 픽셀 동일성을 지키기 위한 선택이다.
 */
export function deriveWristCrossSection({ height_cm = 170, weight_kg = 70 } = {}) {
  const t = deriveWristTissue({ height_cm, weight_kg });
  const ref = deriveWristTissue(REFERENCE_BODY);
  // 닮은꼴 타원 가정 → 폭 ∝ 둘레. 기준 체형에서 비율은 정확히 1(같은 double) → width = 58.0 정확히.
  const scale = t.wristCirc_mm / ref.wristCirc_mm;
  // 절단 [42, 78] mm: 둘레 절단 [120, 220]이 만드는 범위(≈42–77 mm)를 조금 넘는 안전망 — 모델 가정.
  const width_mm = clamp(WRIST_WIDTH_REF_MM * scale, 42, 78);
  const depth_mm = width_mm * WRIST_ASPECT;
  const semiWidth_mm = width_mm / 2, semiDepth_mm = depth_mm / 2;
  // 타원 x²/a² + y²/b² = 1 의 단축 정점(0, b)에서의 곡률 반지름 = a²/b — 수학식(가정 아님).
  // 납작할수록(b 작을수록) 이 값이 커진다 = 볼라면이 평평하다 = 강체 패치가 뜨지 않는다.
  const volarRadius_mm = (semiWidth_mm * semiWidth_mm) / semiDepth_mm;
  return {
    bmi: t.bmi, wristCirc_mm: t.wristCirc_mm,
    width_mm, depth_mm, semiWidth_mm, semiDepth_mm, volarRadius_mm,
    ellipsePerim_mm: ellipsePerimeter(semiWidth_mm, semiDepth_mm),
    widthScale: width_mm / WRIST_WIDTH_REF_MM,
    depthScale: (width_mm * WRIST_ASPECT) / (WRIST_WIDTH_REF_MM * WRIST_ASPECT),
  };
}

// 기준 체형의 단면 기하 — 배율 적용의 분모(widthScale/depthScale = 정확히 1).
export function referenceWristCrossSection() { return deriveWristCrossSection(REFERENCE_BODY); }

// 체형 프리셋(자세/움직임 카드) — **대표값일 뿐 모집단 통계가 아니다**.
// '보통'은 트윈의 기준 체형(170/70)과 정확히 같아 클릭해도 기본 동작이 바뀌지 않는다.
export const BODY_PRESETS = [
  { key: 'lean',  label: '마른',      height_cm: 175, weight_kg: 58,  hint: 'BMI ≈ 18.9 — 얇은 지방층·얕은 동맥' },
  { key: 'normal', label: '보통(기준)', height_cm: 170, weight_kg: 70, hint: '트윈 기준 체형 — 기존 동작과 비트 동일' },
  { key: 'obese', label: '비만',      height_cm: 170, weight_kg: 100, hint: 'BMI ≈ 34.6 — 두꺼운 지방층·깊은 동맥·넓고 납작한 손목' },
  { key: 'small', label: '작은 손목',  height_cm: 155, weight_kg: 47,  hint: 'BMI ≈ 19.6 · 작은 골격' },
  { key: 'large', label: '큰 손목',    height_cm: 190, weight_kg: 95,  hint: 'BMI ≈ 26.3 · 큰 골격' },
];
