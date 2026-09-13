// Anatomical model: heart -> shoulder -> arm -> wrist -> palm -> finger
// Arterial and venous path segments with distance, reference diameter, and
// stiffness used to derive pulse wave velocity (Moens-Korteweg style scaling).
// Values are physiologically plausible approximations for a digital twin,
// not measured/validated anatomical data.

export const ARTERIAL_PATH = [
  { name: 'aortic_root',     label: '심장(대동맥 기시부)', distanceFromHeart_cm: 0,  refDiameter_mm: 28, stiffness: 0.35 },
  { name: 'subclavian',      label: '쇄골하동맥',          distanceFromHeart_cm: 12, refDiameter_mm: 8,  stiffness: 0.45 },
  { name: 'axillary',        label: '겨드랑동맥(어깨)',     distanceFromHeart_cm: 22, refDiameter_mm: 6,  stiffness: 0.50 },
  { name: 'brachial',        label: '위팔동맥',            distanceFromHeart_cm: 42, refDiameter_mm: 4,  stiffness: 0.58 },
  { name: 'radial_forearm',  label: '아래팔 요골동맥',      distanceFromHeart_cm: 56, refDiameter_mm: 2.6,stiffness: 0.65 },
  { name: 'radial_wrist',    label: '손목 요골동맥',        distanceFromHeart_cm: 66, refDiameter_mm: 2.3,stiffness: 0.70 },
  { name: 'palmar_arch',     label: '손바닥 동맥궁',        distanceFromHeart_cm: 71, refDiameter_mm: 1.8,stiffness: 0.74 },
  { name: 'digital_finger',  label: '손가락 지동맥',        distanceFromHeart_cm: 82, refDiameter_mm: 1.0,stiffness: 0.80 },
];

export const VENOUS_PATH = [
  { name: 'digital_vein',    label: '손가락 정맥',    distanceFromHeart_cm: 82, refDiameter_mm: 1.2, hasValves: true },
  { name: 'palmar_venous',   label: '손바닥 정맥망',  distanceFromHeart_cm: 71, refDiameter_mm: 1.8, hasValves: true },
  { name: 'wrist_veins',     label: '손목 정맥',      distanceFromHeart_cm: 66, refDiameter_mm: 2.2, hasValves: true },
  { name: 'forearm_veins',   label: '아래팔 정맥(요/척측피정맥)', distanceFromHeart_cm: 50, refDiameter_mm: 3.5, hasValves: true },
  { name: 'basilic_cephalic',label: '상완 정맥',      distanceFromHeart_cm: 30, refDiameter_mm: 5,   hasValves: true },
  { name: 'axillary_vein',   label: '겨드랑정맥',     distanceFromHeart_cm: 18, refDiameter_mm: 8,   hasValves: false },
  { name: 'subclavian_vein', label: '쇄골하정맥',     distanceFromHeart_cm: 8,  refDiameter_mm: 10,  hasValves: false },
  { name: 'right_atrium',    label: '우심방',         distanceFromHeart_cm: 0,  refDiameter_mm: 30,  hasValves: false },
];

// Arm posture presets: height of wrist relative to heart level (cm, + = below heart)
export const ARM_HEIGHT_PRESETS = {
  heart_level: { label: '심장 높이 (커프혈압계 표준 자세)', deltaH_cm: 0 },
  // 팔뚝을 책상 상판에 얹은 좌위 — 심장(가슴 중앙)보다 20~30 cm 아래. 2026-08-26 이전에는 12 cm 였는데
  // 그때는 아바타의 팔이 상판 위 20 cm 에 떠 있었다(js/kinematics.js ARM_POSITIONS 주석 참조).
  table_height: { label: '테이블 높이 (팔을 책상에 얹은 좌위)', deltaH_cm: 25 },
  down: { label: '아래로 내림 (중력 최대 영향)', deltaH_cm: 45 },
  raised: { label: '심장보다 위로 (거상)', deltaH_cm: -25 },
};

const BLOOD_DENSITY_KG_M3 = 1060;
const G = 9.81;
const PA_PER_MMHG = 133.322;

// Hydrostatic pressure contribution at a point `deltaH_cm` below (+) or above (-) the heart.
export function hydrostaticOffset_mmHg(deltaH_cm) {
  const h_m = deltaH_cm / 100;
  const pa = BLOOD_DENSITY_KG_M3 * G * h_m;
  return pa / PA_PER_MMHG;
}

// Pulse wave velocity per segment (Moens-Korteweg-inspired scaling), m/s.
// toneScalar: 1.0 = resting baseline; >1 = vasoconstriction/stiffer (higher PWV);
// <1 = vasodilation (lower PWV). ageStiffness: 1.0 baseline, up to ~1.6 for stiff/older vessels.
// pwvGain: pressure dependence (Bramwell–Hill-like; see pwvPressureGain), 1.0 at MAP_REF.
// Segment-specific sensitivity (audit B-4): age stiffening acts mostly on the elastic aorta and little on
// the muscular brachial/radial arteries; vasomotor tone acts on the muscular/peripheral arteries and
// hardly on the aorta. t = 0 at the aortic root … 1 at the fingertip (by distance).
//   stiffness exponent ws = 1.0 → 0.3,  tone exponent wt = 0.1 → 1.0 (model assumptions, not literature values)
export function segmentWeights(segment) {
  const last = ARTERIAL_PATH[ARTERIAL_PATH.length - 1].distanceFromHeart_cm || 1;
  const t = Math.max(0, Math.min(1, (segment.distanceFromHeart_cm || 0) / last));
  return { ws: 1.0 - 0.7 * t, wt: 0.1 + 0.9 * t, t };
}
export function segmentPWV_ms(segment, toneScalar = 1.0, ageStiffness = 1.0, pwvGain = 1.0) {
  const basePWV = 4.0 + segment.stiffness * 9.0; // piecewise-empirical table: 7.2 (root) … 11.2 m/s (digital); not Moens–Korteweg
  const { ws, wt } = segmentWeights(segment);
  return basePWV * Math.pow(toneScalar, wt) * Math.pow(ageStiffness, ws) * pwvGain;
}

// PWV rises with distending pressure (arterial wall is non-linearly elastic): ≈ +0.6 %/mmHg of MAP.
export const MAP_REF_MMHG = 93;
export const PWV_PER_MMHG = 0.006;
export function pwvPressureGain(map_mmHg) {
  return Math.max(0.5, 1 + PWV_PER_MMHG * (map_mmHg - MAP_REF_MMHG));
}

// Cumulative pulse arrival delay (seconds) from heart to a given arterial segment index.
// hydroWrist_mmHg (optional): hydrostatic offset at the wrist; each segment's pressure gain is raised by
// the local hydrostatic share (∝ distance fraction) so arm lowering shortens the transit time (audit B-3).
export function cumulativeDelay_s(pathIndex, toneScalar = 1.0, ageStiffness = 1.0, pwvGain = 1.0, hydroWrist_mmHg = 0) {
  let delay = 0;
  const wristIdx = findSegmentIndex('radial_wrist');
  const wristDist = ARTERIAL_PATH[wristIdx].distanceFromHeart_cm || 1;
  for (let i = 1; i <= pathIndex; i++) {
    const prev = ARTERIAL_PATH[i - 1];
    const cur = ARTERIAL_PATH[i];
    const segLength_m = (cur.distanceFromHeart_cm - prev.distanceFromHeart_cm) / 100;
    const frac = Math.min(1, cur.distanceFromHeart_cm / wristDist);
    const gLocal = Math.max(0.5, pwvGain + PWV_PER_MMHG * hydroWrist_mmHg * frac);
    const pwv = segmentPWV_ms(cur, toneScalar, ageStiffness, gLocal);
    delay += segLength_m / pwv;
  }
  return delay;
}

// Peripheral amplification factor for pulse pressure (systolic amplification distally),
// simplified monotonic model normalized to 1.0 at aortic root.
export function amplificationFactor(pathIndex) {
  const t = pathIndex / (ARTERIAL_PATH.length - 1);
  return 1.0 + 0.35 * t; // up to ~1.35x pulse pressure amplification at fingertip
}

export function findSegmentIndex(name, path = ARTERIAL_PATH) {
  return path.findIndex((s) => s.name === name);
}
