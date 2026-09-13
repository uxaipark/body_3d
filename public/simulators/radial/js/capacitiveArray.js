import {arteryTether} from './arteryDeformation.js';
import {wristSurface} from './wristSurface.js';
import {rotatePatchPoint,patchAlongHalf,normalizePatchAngle} from './patchGeometry.js';
import {atlasArteryAt} from './atlasProfile.js';
import {WRIST_MECHANICS,radiusPerPressure,surfaceTransfer,WristRelaxation} from './wristMechanics.js';
// Capacitive electrode array on a flexible sheet over the volar wrist (radial artery).
//
// Geometry (mm, wrist-local): `lateral` runs across the wrist (+ toward the thumb/radial side),
// `along` runs proximal(−) → distal(+). The radial artery is at lateral = ARTERY_BASE_LATERAL
// (shifted by forearm pronation), at a depth that increases proximally (it is most superficial
// near the wrist crease). The flexor carpi radialis (FCR) tendon lies ulnar to the artery and
// couples motion/tendon artifact into nearby electrodes. The sheet can be moved (lateral/along
// offsets) — moving it off the artery lowers arterial coupling, moving toward the tendon raises
// artifact, moving proximally deepens the artery: all of which change waveform/SNR per channel.
//
// This mirrors the "C(x,t)" spatiotemporal concept in the SkyLabs-vs-capacitive patent review.

import { ARTERIAL_PATH, findSegmentIndex, segmentPWV_ms, MAP_REF_MMHG, PWV_PER_MMHG } from './anatomy.js';
import { normalizeLayout, lateralPitch } from './electrodeLayout.js';
import { MeasuredNoiseGenerator, NOISE_MODEL_V1 } from './noiseModelMeasured.js';
import { deriveWristCrossSection, referenceWristCrossSection } from './anthropometry.js'; // read-only (owned elsewhere): wrist cross-section geometry

// Deterministic uniform hash in [0,1) (for seeded, reproducible noise)
function hashU(x) { const s = Math.sin(x * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); }

// ---- §6.23 (11) · zero-phase magnitude shaping for the per-channel mechanical roll-off (C) ----------
// Design a SYMMETRIC (h[−m] = h[+m], hence exactly real / zero-phase) FIR whose amplitude response is the
// fitted one-pole MAGNITUDE  G(f) = 1/√(1 + (f/fc)²)  — the only thing the measurement constrains — with
// NONE of the group delay a minimum-phase pole would impose (measured lag −0.5 ms vs implied +29.2 ms,
// Wilcoxon p = 0.0002; see the MECH block).
//
// Method = frequency sampling: h[m] = (1/N)·Σ_i G(f_i)·e^{j2πim/N} over the N = 2M+1 point grid
// f_i = i·fsk/N. Two properties fall out exactly (not approximately) and both matter:
//   · Σ h[m] = G(0) = 1 → DC gain is EXACTLY 1, so `capPerMmHg` stays calibrated and an all-pass pad and
//     a rolled-off pad have identical mean gain (the fit constrains the SHAPE, not the level).
//   · h is even about m = 0 → the phase is identically 0 at every frequency, for every fc → the
//     DIFFERENTIAL group delay between any two channels is exactly 0. That is the whole point.
// The response equals G exactly at the N grid frequencies; between them it ripples by the (small) amount
// that the time-domain aliasing of the truncated kernel produces — quantified in docs/CLINICAL_AUDIT.md
// §6.23 (11). `fsk` is the kernel's quadrature rate (fs/D, see MECH.kernelStep_Hz), so the tap count is
// set by fc and the physics, not by the front-end rate.
const MECH_TAP_CACHE = new Map();
function zeroPhaseMagTaps(fc_Hz, fsk_Hz, supportTau, maxM) {
  const key = `${fc_Hz}|${fsk_Hz}|${supportTau}|${maxM}`;
  const hit = MECH_TAP_CACHE.get(key);
  if (hit) return hit;
  const tau_s = 1 / (2 * Math.PI * fc_Hz);                                  // the one-pole's time constant
  const M = Math.max(1, Math.min(maxM, Math.ceil(supportTau * tau_s * fsk_Hz)));
  const N = 2 * M + 1;
  const G = new Float64Array(M + 1);
  for (let i = 0; i <= M; i++) { const r = (i * fsk_Hz / N) / fc_Hz; G[i] = 1 / Math.sqrt(1 + r * r); }
  const h = new Float64Array(N);
  for (let m = 0; m <= M; m++) {
    let s = G[0];
    for (let i = 1; i <= M; i++) s += 2 * G[i] * Math.cos(2 * Math.PI * i * m / N);
    h[M + m] = h[M - m] = s / N;
  }
  const out = { h, M };
  if (MECH_TAP_CACHE.size > 128) MECH_TAP_CACHE.clear();
  MECH_TAP_CACHE.set(key, out);
  return out;
}

// Lateral coordinate: 0 = volar wrist midline, + = radial (thumb / away-from-torso) side, − = ulnar.
// The radial artery runs on the radial side of the volar wrist (≈10–12 mm medial to the radial
// edge, just radial to the FCR tendon), NOT at the midline.
export const WRIST_ANATOMY = {
  ARTERY_BASE_LATERAL_MM: 12,    // radial artery centre at the wrist crease
  ARTERY_BASE_DEPTH_MM: 2.5,     // below skin at the wrist crease
  ARTERY_DEPTH_GRADIENT_MM_PER_MM: 0.06, // deeper proximally
  FCR_TENDON_LATERAL_MM: 9,      // flexor carpi radialis ridge, just ulnar to the artery (≈ +9.5 mm on the volar wrist photos)
  PL_TENDON_LATERAL_MM: 1.3,     // palmaris longus ridge, ≈ midline (photos: +1.3 mm)
  RADIUS_BONE_LATERAL_MM: 21,    // radial styloid side (stiff, little pulsation)
  SHEET_LATERAL_MIN_MM: -18,
  SHEET_LATERAL_MAX_MM: 24,
  // `along` = 0 at the wrist crease (start of the hand); negative = proximal (up the forearm).
  SHEET_ALONG_MIN_MM: -100,
  SHEET_ALONG_MAX_MM: 0,
};

// Default sheet centre so its distal edge sits right at the wrist crease.
export function defaultSheetAlong_mm(rows, spacingMm) { return -((rows * spacingMm + 4) / 2 + 1); }

// ---------------------------------------------------------------------------------------------------
// ROADMAP §2.1 items 2 (비선형 압력-직경) · 5 (정맥/조직 압박) · 4 (손목 곡률 → 패드별 이격)
// — docs/CLINICAL_AUDIT.md §6.15.  EVERY constant below is a **모델 가정(문헌 보정 필요)**: none of them
// is taken from a measurement or a cited paper, and none should be quoted as one.
//
// (A) NON-LINEAR PRESSURE–DIAMETER (item 2).  The wall is exponentially elastic (Hughes-type
//     E(P) = E₀·e^{ζP}); with Bramwell–Hill the distensibility is D(P) = (1/A)dA/dP = D₀·e^{−ζ(P−P₀)}
//     and the log-area strain over a beat is
//         Δln A(t) = ∫_{P_dia}^{P(t)} D(u) du = D₀ · Peff(t),
//         Peff(t) = [e^{−ζ(P_dia+h−P₀)} − e^{−ζ(P(t)+h−P₀)}] / ζ        ("effective distending pressure", mmHg)
//     with h = the local hydrostatic offset (transmural pressure) and P₀ = MAP_REF_MMHG (93), the SAME
//     anchor the twin's PWV pressure law uses.  ΔC ∝ Δln A (small-strain), so Peff simply REPLACES the
//     linear (P − P_dia) of the old law.  ζ → 0 gives Peff → P − P_dia exactly, and the code takes a
//     literal legacy branch at ζ = 0 so the default stream is bit-identical.
//     NO DOUBLE COUNTING: the twin already carries the pressure stiffening once, quasi-statically, as
//     D ∝ 1/PWV² = 1/g(MAP)² with g = 1 + 0.006·(MAP−93) (audit B-2).  Because 1/g² ≈ e^{−2·0.006·(MAP−93)},
//     that IS the same exponential law evaluated at MAP only.  So when ζ > 0 the g² factor is DROPPED
//     from `distensibility` and the exponential carries the pressure dependence WITHIN the beat instead.
//     Consequently the consistent value of ζ is 2·PWV_PER_MMHG = 0.012 /mmHg (NONLIN_ZETA_CONSISTENT).
// (B) CONTACT PRESSURE — applanation → occlusion → venous congestion (item 5).  The 0–1 contact slider is
//     mapped to a hold-down (contact-stress) pressure P_hold = cp·CONTACT.full_mmHg.  Transmission of the
//     intra-arterial pulse peaks where the transmural pressure is ≈ 0 (P_hold ≈ MAP — the classic
//     applanation-tonometry / oscillometric-envelope optimum) and is expressed RELATIVE TO THE cp = 0.5
//     ANCHOR, so cp = 0.5 is exactly 1 for every MAP (the twin's `capPerMmHg` is calibrated there):
//         G_app = exp(−½[(P_hold − MAP)² − (P_hold₀ − MAP)²]/W_app²),   P_hold₀ = 0.5·full
//     Above systolic the vessel closes: G_occ = exp(−ln2·(max(0, P_hold − max(SBP, P_hold₀))/W_occ)²).
//     Over-compression also DAMPS THE SYSTOLIC PEAK (soft-knee compression of the distension waveform,
//     knee κ = 1/(1 + a·overDrive)) — the tonometric "flattened top", which changes the WAVEFORM SHAPE
//     and not only its size.  Venous congestion adds a slow, respiration-modulated volume term that grows
//     with cp above the anchor and with a dependent limb (hydrostatic).  Every term is exactly neutral at
//     cp = 0.5 by construction, so today's default is unchanged.  ⚠ HONEST NOTE: real venous occlusion
//     starts far below the anchor (~10–20 mmHg); the model represents only the INCREMENT above the twin's
//     reference contact state (the same increment-only convention §6.14 had to use for the photon noise).
// (C) WRIST CURVATURE → PER-PAD STANDOFF (mechanical half of item 4).  A rigid flat patch on a curved
//     wrist leaves an air/adhesive gap that grows with the pad's lateral distance x from the patch centre:
//         gap(x) = (1 − conformity)·(R − √(R² − x²))
//     (R = the VOLAR radius of curvature a²/b of the wrist's elliptical cross-section, from
//     js/anthropometry.js `deriveWristCrossSection` — imported read-only).  The gap sits in SERIES with the tissue
//     path (the "series air-gap" argument behind NOISE_KNOBS.pulseGain in js/noiseModelMeasured.js), so the
//     transmitted arterial modulation is scaled by 1/(1 + gap/g₀)² — attenuation only: the coupling KERNEL
//     WIDTH stays set by the source depth (σ ≈ 1.2·depth, audit B-7), because a series gap scales an
//     already-formed field pattern rather than re-blurring it.
//     `conformity = 1` (default) = the twin's historical implicit assumption of a perfectly conforming
//     patch → gap ≡ 0 → bit-identical for every body and every layout.
// ---------------------------------------------------------------------------------------------------

// (A) The ζ that is CONSISTENT with the twin's own PWV pressure law (1/g² ≈ e^{−2·0.006·ΔMAP}).
export const NONLIN_ZETA_CONSISTENT = 2 * PWV_PER_MMHG; // 0.012 /mmHg — 모델 가정 (문헌 보정 필요)

// (B) Contact-pressure model constants — ALL 모델 가정 (문헌 보정 필요).
export const CONTACT = {
  full_mmHg: 160,        // cp = 1 ↔ a hold-down contact stress that fully occludes an adult radial artery
  appWidth_mmHg: 55,     // half-width of the applanation / oscillometric transmission envelope around MAP
  occWidth_mmHg: 15,     // amplitude halves this far above systolic; ≈ 0 at ~2× that
  clipGain: 1.2,         // soft-knee strength of the systolic damping per unit over-drive
  venGain_pF: 0.25,      // capacitance of a fully congested venous bed under a pad (arterial pulse ≈ 0.5 pF)
  venTau_s: 25,          // venous filling time constant (sustained pressure → congestion builds)
  venHydroRef_mmHg: 30,  // hydrostatic offset that doubles the congestion (dependent limb ≈ +33 mmHg)
  venRespFrac: 0.35,     // respiratory swing as a fraction of the congested volume (shared phase source)
  venPulseFrac: 0.18,    // cardiac-synchronous venous echo (delayed, damped arterial pulse)
  venPulseLag_s: 0.18,   // its lag behind the arterial pulse
  venSigma_mm: 15,       // lateral half-width of the (broad, superficial) venous bed
};

// (C) Wrist-curvature standoff constants — ALL 모델 가정 (문헌 보정 필요).
export const CURVATURE = {
  gapHalf_mm: 0.6,       // g₀ of the series-gap divider 1/(1 + gap/g₀)²: transmission halves at gap ≈ 0.25 mm
};
// ---------------------------------------------------------------------------------------------------
// §6.23 (2026-08-26) — 채널 간 신호 다양성.  이전 트윈의 모든 채널은 **같은 스칼라 맥파**에 서로 다른
// 양(+)의 이득만 곱한 것이었다: 부호 반전 불가, 형태(morphology) 동일, 대역폭 동일.  실측 12패드 기록
// (data/data_version1 standard 10파일, ECG 없음 → 배열 자체에서 박동 클록)에서 측정한 값:
//   · 패드 쌍 앙상블 상관: 중앙 +0.72, p10 −0.20, 최소 −0.73, **음수 쌍 15.8 %**, < −0.3 인 쌍 7.7 %
//   · 패드별 반전(상관 < 0) 비율은 최적 패드로부터의 거리에 따라 6.5 %(<5 mm) → 18.6 %(≥7 mm) → 30 %(≥11 mm)
//     로 증가 (Spearman ρ(거리, 상관) = −0.458, p = 1.5e−7)
//   · 진폭 max/min: 파일 중앙값 11.2 [3.5, 79.9]
//   · **부직포(nonwoven) 대조군은 음수 쌍 0.8 %** (최소 −0.086) — 피부 결합이 끊긴 기판에서는 반전이
//     사라진다 → 반전은 전자적 원인이 아니라 **기계적(피부 변위) 매개**임을 보여 준다.
// ⚠ 위 네 줄은 전부 **`data_version1`** 값이다: 패치 배치 1종 · 10파일 · 250 Hz · **어레이 자신에서 뽑은
//   박동 클록**(= 순환적).  2026-08-29 에 같은 통계를 **`data_with_ecg1`(21명 · 1 kHz · 독립 ECG 게이트
//   `PA_3`)** 로 다시 쟀다 — **상수는 하나도 바뀌지 않았고 근거와 불확실성만 갱신**됐다.  요약:
//     · 음수 쌍 비율은 단일 값이 아니다 → **피험자 평균 30.6 ± 21.6 %p, 피험자별 0–60 %**(위 15.8 % 는
//       표준편차 22–28 %p 인 양의 점추정이었고, 자기 게이트가 −10.0 %p 아래로 편향시켰다, p = 0.0165)
//     · 거리 의존은 방향만 확인(ρ −0.17, 쌍 이격 p = 7.1e−5), 강도는 약해졌다(옛 −0.46)
//     · all-pass 유병률·코너 범위·(B) 고리 vs 쌍극자 판별·**(C) 영위상**은 전부 **확인**됐다
//     · 진폭 max/min 10.4 [3.4, 144.2] (옛 11.2 [3.5, 79.9])
//   상세 `eval/results_ecg1_kernel.md`, 해석 `docs/CLINICAL_AUDIT.md` §6.23 (13), `docs/NOISE_MODEL.md` §8.
// 아래 네 가지 기전으로 이 구조를 재현한다.  (A)만 실측에 피팅되었고, (B)(C)의 크기는 가정이다.
//
// (A) 부호 있는 체적보존 결합 커널.  조직은 비압축성이므로 동맥이 팽창하면 그 **직상 피부는 융기하고
//     주변 고리(annulus)는 함몰**한다.  커널을 difference-of-Gaussians 로 두면
//         K(u) = [ e^{−u²/2} − (β/κ²)·e^{−u²/(2κ²)} ] / (1 − β/κ²),   u = dist/σ
//     이고, **음의 외곽 로브의 진폭은 자유 파라미터가 아니다**: 평면 적분
//         ∫K dA ∝ 2πσ²·[1 − (β/κ²)·κ²] = 2πσ²(1 − β)
//     이므로 β = 1 이면 ∫K dA = 0, 즉 **측방으로 되돌아오는 변위 체적 = 동맥 체적 변화**(완전 체적보존)
//     가 되고, β < 1 은 변위의 일부가 동맥 축방향/심부로 빠져나가는 경우다.  β = 1 은 **유도된 값**
//     (비압축성), κ 는 **피팅된 값**(아래) — 로브 깊이 β/κ² 는 이 둘에서 자동으로 따라 나온다.
//     정규화 (1 − β/κ²) 로 K(0) = 1 을 유지하므로 `capPerMmHg` 보정(ΔC/C ≈ 18 %)은 건드리지 않는다.
//     영교차 반지름은 r₀ = σ·κ·√(2(2 ln κ − ln β)/(κ² − 1)).
// (B) 패치 강체 로킹(rocking).  뻣뻣한 패치는 융기 위에서 시소처럼 기울고 반대쪽 끝이 피부에서 뜬다.
//     자유 피부 변위장 u_k 에 대해 패드 좌표로 **최소제곱 기울기(피스톤 제외, 반대칭 모멘트)** 를 구해
//         u'_k = u_k − s·[θ_x·(x_k − x̄) + θ_y·(y_k − ȳ)],   s = 1 − curvatureConformity
//     로 뺀다.  피스톤(공통) 모드는 스트랩이 눌러 주므로 제외한다 — 그래서 이 항은 배열 평균을 보존하고
//     진폭을 죽이지 않으며 **양 끝 패드에 반대 부호**만 준다.  s = 0(완전 밀착)이면 정확히 항등원.
// (C) 채널별 기계 **크기(magnitude)** 정형 — **영위상(zero-phase)**.  패드별 전달비를 1극 크기로 피팅하면
//     36개 중 23개가 all-pass, 나머지가 2.16–14.57 Hz(중앙 5.45)로 맞고 **2극을 분해할 근거가 데이터에
//     없다**.  코너는 **패드별 독립 추첨**이고 거리·진폭과 무관하다(순서는 실측이 반박한다, §6.23 (10)).
//     **위상은 0 이다**: 실측 지연 중앙 −0.5 ms 인데 최소위상 1극은 +29.2 ms 를 부과한다(Wilcoxon
//     p = 0.0002) → 대칭 커널(유한 패드 면적의 공간 평균이 그 예)로 구현한다, §6.23 (11).  구현은 대칭
//     FIR + 채널 공통 look-ahead 보상이라 **채널 간 차등 군지연이 정확히 0**(전 채널 절대 지연도 0)이며,
//     탭은 `sampleRate_Hz` 에서 유도되고 FIR 이므로 100 Hz–16 kHz 전 구간에서 무조건 안정하다.
// (D) 비동맥 성분의 위상 분리 + 프런트엔드 포화.  정맥 에코는 지금까지 동맥 맥파를 그대로 지연·축소한
//     복사본(모든 채널 동일 위상·동일 형태)이었다 → 패드별 지연 지터와 자체 1극 평활을 준다.  합성
//     완더/험도 채널별 위상을 갖는다.  포화는 **하드 클립**이다(소프트가 아니라): 실측은 10-bit ADC이고
//     품질 마스크가 코드 ≥1023 포화를 직접 검사한다 — CDC 출력 코드는 소프트니가 없는 하드 레일이다.
// ---------------------------------------------------------------------------------------------------

// (A) 결합 커널.  β = 유도(비압축성), κ = 피팅(실측 3×4 패치 기하에서 음수 쌍 비율 15.8 %에 맞춤).
export const COUPLING = {
  volumeReturn: 1.0,   // β — **유도**: 비압축 조직에서 측방으로 되돌아오는 변위 체적 = 동맥 체적 변화 → ∫K dA = 0
  annulusRatio: 1.8,   // κ — **피팅**: 실측과 **동일한 3×4 패치 기하(피치 3.5 mm)·동일한 앙상블 평균 절차**로
                       // 트윈의 음수 쌍 비율을 실측 15.8 % 에 맞춘 값 (κ=1.8 → 10/66 = 15.2 %; 66쌍이므로
                       // 격자 해상도가 1.5 %p 이고 κ=2.0 은 16.7 % — 데이터는 κ 를 1.8–2.5 로만 좁힌다).
                       // 이 κ 에서 영교차 r₀ = 6.3–7.2 mm(σ 3.4–3.9 mm), 함몰 고리의 바닥은 봉우리의 −10.8 %.
                       // ⚠ 주석 정정(2026-08-26): 바닥 값이 −9.6 % 로 적혀 있었으나 그것은 κ≈2.05 의 값이다.
                       // κ=1.8·β=1 의 닫힌 형태 u_min = √(8 ln κ/(1−1/κ²)) = 2.608 → K = −0.10805 (0.0002 간격
                       // 수치 스캔도 동일). κ 1.8–2.5 구간에서는 −10.8…−8.0 %. **코드는 κ 에서 커널을 계산하므로
                       // 물리는 옳고 틀린 것은 주석 숫자뿐이다** — 동작 변화 없음(`docs/CLINICAL_AUDIT.md` §6.23 (12)).
                       // ⚠ r₀ 는 `dist` 공간(dist = √(dLat² + 1.5·depth²)) 반지름이다. **측방** 영교차는
                       // r₀_lat = 5.2–6.0 mm 로 더 작다 — 개구/패드 배치를 논할 때는 이쪽을 써야 한다.
                       // ⚠⚠ 근거 갱신(2026-08-29, §6.23 (13) · `eval/results_ecg1_kernel.md`).  값은 그대로 1.8 이지만
                       // **불확실성은 넓어졌다**.  `data_with_ecg1`(21명 · 1 kHz · 독립 ECG 게이트 `PA_3`)에서
                       // 음수 쌍 비율은 단일 값이 아니라 **피험자 평균 30.6 ± 21.6 %p(95 % CI [20.7, 40.5]),
                       // 피험자별 0–60 %** 다 — 위의 "15.8 %" 는 표준편차 22–28 %p 인 양의 점추정이었고,
                       // 게다가 v1 의 어레이 자기 게이트가 그것을 **−10.0 %p 만큼 아래로 편향**시켰다(p = 0.0165).
                       // 실측 배치 범위(sheetLateral −8…+12 · sheetAlong −15.5…−40)에서 κ 를 쓸면 배치 평균이
                       // κ 1.4–3.0 전 구간에서 17.3–23.4 % 이고 배치별 범위는 어느 κ 에서도 0–54.5 % 다:
                       // **배치 분산이 κ 의 효과를 덮으므로 이 통계로 κ 는 더 이상 식별되지 않는다.**
                       // κ=1.8 의 21.1 % 가 실측 CI 안이고 분포 모양도 맞으므로 **움직일 근거가 없어 유지**한다.
                       // → 위 줄의 "데이터는 κ 를 1.8–2.5 로만 좁힌다"는 **폐기(superseded)**;
                       //   맞는 진술은 "이 통계로는 κ 1.4–3.0 중 어느 것도 배제되지 않는다" 이다.
};
// (B) 패치 강성.  s = 1 − curvatureConformity (기존 노브 재사용, 새 파라미터를 만들지 않음).
export const PATCH = {
  // **모델 가정**.  피팅하려 했으나 실패했다: 진폭 max/min 으로 맞추려 해도 실측 파일별 값이 11.2 [3.5, 79.9]
  // 로 너무 흩어져 conformity 를 구분하지 못했고(1.0/0.85/0.75 모두 실측 범위 안), 부직포 대조군은 기판
  // 강성 대조로 쓸 수 있을 것 같았지만 **맥파 자체가 사라져**(4/4 파일 맥파 미검출) 강성만 분리할 수 없었다.
  // 0.85 는 "완전 밀착(1)은 물리적으로 불가능하다"는 것 이상을 주장하지 않는 보수적 값이다.
  // 근거 갱신(2026-08-29, §6.23 (13)): 독립 코호트 `data_with_ecg1` 10명에서도 **고리가 10/10 이겼다**
  // (자유 중심 DoG vs a+b·x+c·y, 평균 R² 0.897 vs 0.352, 모수 보정 후 0.758 vs 0.160; 쌍극자 기울기의
  // 부호는 여전히 피험자마다 제각각).  즉 (B) 로킹은 **두 번째 데이터셋에서도 실측 미지지**이며,
  // 이 상수는 계속 "특허 주장을 시험 가능하게 만들기 위한 모델 가정"으로만 읽어야 한다.
  conformityDefault: 0.85,
};
// (C) 채널별 기계 **크기 정형**.  **패드별 독립 추첨**이며 결합 거리와 무관하고(아래 "왜 거리 법칙을 버렸나"),
//     **위상은 0** 이다(아래 "왜 위상을 영(0)으로 두나").  실측이 준 것은 크기뿐이므로 크기만 모델에 넣는다.
export const MECH = {
  // ---- 실측에서 직접 나온 두 값 (피팅) ----
  allPassFrac: 23 / 36,   // = 0.639. **피팅**: 실측 36개 패드 중 23개는 1극 롤오프가 아예 분해되지 않았다(all-pass).
  corner_lo_Hz: 2.16,     // **피팅**: 롤오프가 분해된 13개 패드의 코너 범위 하단
  corner_hi_Hz: 14.57,    //           〃 상단 (13개 값: 2.16 2.93 2.93 3.32 4.10 5.45 5.45 5.65 6.23 7.20 9.14 9.92 14.57; 중앙 5.45)
  // ---- 재측정 확인 (2026-08-29, §6.23 (13) · `eval/results_ecg1_kernel.md`) — 값 변경 없음 ----
  // `data_with_ecg1`(21명 · 1 kHz · 독립 ECG 게이트, 죽은 패드 제외)에서 두 추정기로 다시 쟀다:
  //   · all-pass 유병률 **68.1 % [58.9, 76.3]**(앙상블 비 |Y|/|R|, n = 119) · **72.4 % [62.5, 81.0]**
  //     (Welch 교차스펙트럼 H = Sxy/Sxx, 무게이트, n = 98)  → 위의 **0.639 가 두 95 % CI 안에 들어간다**.
  //   · 분해된 코너 0.50–18.65 Hz(중앙 7.08) / 0.50–17.83 Hz(중앙 6.23) → 위의 13개 표본과
  //     **KS p = 0.142 / 0.687, Mann–Whitney p = 0.206 로 유의차 없음**.
  // 따라서 위 세 값은 **더 큰 코호트에서 확인**됐다.
  // 분포 형태 = **로그균등**.  근거: (i) 13개 표본에 대해 로그균등과 로그정규의 KS 적합도가 **완전히 같다**
  // (양쪽 D = 0.138, p = 0.936) — 즉 **n = 13 으로는 두 형태를 구별할 수 없다**(모수 부트스트랩 겹침 36 %).
  // (ii) 구별할 수 없으므로 **범위 외에는 아무것도 가정하지 않는 쪽**(스케일 자유량에 대한 최대엔트로피 =
  // 로그균등)을 택했다.  (iii) 그 결과 따라 나오는 중앙값 √(2.16·14.57) = 5.61 Hz 는 실측 중앙 5.45 Hz 와
  // 3 % 안에서 일치한다 — 중앙값에 맞춘 것이 아니라 **저절로 맞은 것**이다.
  // → **형태는 n = 38 로도 여전히 [미해결]**(2026-08-29, §6.23 (13)).  파라메트릭 부트스트랩 KS 로 추정 모수를
  //   보정하고 식별 가능한 코너(fc ≥ 1.5 Hz)만 써도, 앙상블 비 추정기는 로그균등을 p = 0.015 로 기각하는데
  //   **더 잘 조건화된 Welch 교차스펙트럼 추정기는 p = 0.920 으로 전혀 기각하지 않는다**.  두 추정기가
  //   어긋나므로 표본이 3배가 되어도 로그균등/로그정규는 구별되지 않는다 → 로그균등 유지.
  //
  // ---- 왜 거리 법칙(fc = pathGain/dist²)을 기본에서 뺐나 (§6.23 최초 구현의 결함) ----
  // 처음에는 전단파 확산에서 유도한 `fc ∝ 1/dist²` 를 기본으로 넣었다.  **크기는 실측 범위에 맞았지만
  // "약결합 패드일수록 좁은 대역"이라는 순서를 실측이 지지하지 않는다**: r(ln relAmp, ln fc) = −0.065
  // (p = 0.83), Spearman ρ = −0.091 (p = 0.77) — 유의한 연관이 전혀 없고, 애초에 2/3 가 all-pass 다.
  // 그런데 거리 단조 코너는 **어레이를 따라 계통적인 군지연 기울기**를 만든다.  1극의 DC 군지연은
  // 1/(2π·fc) 이므로 행별 fc 5.9–6.8 Hz 는 군지연 23–27 ms, 행 간 차이 ≈4 ms 가 된다.  그런데 두 클러스터
  // 국소 PTT(8 mm, ~10 m/s)는 **0.8 ms** 다 — 가정이 만든 기울기가 측정 대상의 5배였고, 실제로 국소 PWV
  // 유효 창이 137/138 → 0/138 로 사라지고 JS/WASM `pttWF` 패리티가 깨졌다.  **측정이 반박하는 순서를
  // 모델에 넣어 그 결과를 관측한 셈**이므로 기본에서 제거했다.  대역폭 산포(=실측이 지지하는 것)는 남기고
  // 순서(=실측이 반박하는 것)만 뺀 것이지, 수치를 좋게 만들려는 튜닝이 아니다.
  // → **재확인(2026-08-29, §6.23 (13))**: 21명 · 1 kHz 에서 all-pass 를 fc = ∞ 로 포함해 순위상관을 내면
  //   Spearman(맥파 진폭, fc) = **−0.013 (p = 0.885, n = 119)**, 거리와는 오히려 **+0.133 (p = 0.149)** —
  //   `fc ∝ 1/dist²` 가 예측하는 강한 음(−)의 **반대 부호**다.  ⚠ 분해된 38개 패드만 보면 +0.454 (p = 0.004)
  //   로 순서가 있는 것처럼 보이지만 이것은 **선택 효과**다(all-pass 여부는 진폭과 무관, p = 0.393).
  //   → 순서 제거는 두 번째 데이터셋에서도 옳다.
  distanceLaw: false,     // 기본 false.  DT_CAP_KNOBS 로만 켜는 **실측 미지지(unsupported) 변종** — 진단·A/B 전용.
  pathGain_Hz_mm2: 189,   // distanceLaw = true 일 때만 쓰인다 (fc = pathGain / dist²)
  minCorner_Hz: 1.5,      // distanceLaw 변종의 클램프 (모델 가정)
  maxCorner_Hz: 40,       // 〃
  //
  // ---- 왜 위상을 영(0)으로 두나 (§6.23 (11), 3차 정정 · 2026-08-26) ----
  // 위 코너들은 **크기(magnitude) 비율만으로** 피팅한 값이다(`|Y(f)|/|R(f)|`, docs/NOISE_MODEL.md §7).
  // 그런데 이것을 **최소위상 1극**으로 구현하면 `1/(2π·fc)` 의 군지연이 **덤으로 부과된다** — 측정한 적이
  // 없는 양을 모델이 강제하는 것이다.  실측은 그 지연을 **기각한다**(코너가 분해된 13패드, 기준 패드 대비
  // 앙상블 상호상관 지연):
  //     실측 지연            중앙 **−0.5 ms**  (IQR [−33.5, +0.6])
  //     최소위상이 함의       중앙 **+29.2 ms** (범위 10.9–73.8)
  //     Wilcoxon p = 0.0002 · r(함의, 실측) = +0.31 (p = 0.30) · 비율 중앙 −0.01
  // 즉 **크기 롤오프는 실재하고 위상 지연은 실재하지 않는다.**  대칭(짝) 임펄스 응답을 갖는 기전 —
  // 유한 패드 면적에 대한 **공간 평균**이 대표적이며, 코드는 커스텀 레이아웃에서 이미 패드 풋프린트
  // 평균을 한다 — 은 정확히 이 성질(크기 롤오프 + 위상 0)을 만든다.  그래서 (C)는 **영위상 크기 정형**
  // 으로 구현한다.  피팅된 크기(all-pass 유병률·코너 범위·로그균등·패드별 추첨)는 하나도 바꾸지 않았고
  // **위상만** 바꿨다.
  // → **1 kHz 에서 확인됨(2026-08-29, §6.23 (13)).**  위의 −0.5 ms 는 250 Hz 에서 **1/8 표본**이라 "분해능
  //   한계 때문에 우연히 0 에 가까웠을" 가능성이 남아 있었다.  `data_with_ecg1`(1 kHz, 1 표본 = 1 ms)에서
  //   **세 개의 독립 추정기**로 다시 쟀다(재현 게이트 rsplit ≥ 0.9):
  //     앙상블 상호상관(QRS 블랭크 창)  중앙 **−0.06 ms**, IQR **[−0.41, +0.20]**, Wilcoxon vs 0 p = 0.22 (n = 60)
  //     Welch 교차스펙트럼 위상 기울기   중앙 +0.68 ms, IQR [−3.90, +7.51], p = 0.54 (n = 40, **게이트 무관**)
  //     코너가 분해된 패드에서 최소위상 함의 +17.29 ms 와 비교 → **Wilcoxon p = 6.0e−8**, r(함의, 실측) = −0.25
  //   즉 차등 군지연은 1/2 표본 이내로 0 이고 최소위상이 부과할 값과는 결정적으로 다르다.  **(11) 은 옳았다.**
  minimumPhase: false,    // 기본 false.  true = §6.23 최초본/정정본의 **최소위상 1극** = **실측 미지지(unsupported)
                          // 변종** (실측 지연과 Wilcoxon p = 0.0002 로 유의하게 다르다).  DT_CAP_KNOBS 로만
                          // 켜는 진단·A/B 전용:  DT_CAP_KNOBS='{"MECH":{"minimumPhase":true}}'
  // 영위상 FIR 의 **수치** 파라미터 (물리 주장이 아니다).
  supportTau: 5,          // 대칭 커널의 반폭 = 5 시상수.  커널은 e^{−2π fc |t|} 로 감쇠하므로 5τ 에서 잔여
                          // 에너지 < 1 %; 이 값이 곧 look-ahead 보상 지연을 정한다(아래 mechCorner/_mechZeroPhase).
  kernelStep_Hz: 1000,    // 커널 구적(quadrature) 간격의 목표 표본율.  fs > 이 값이면 D = round(fs/1000) 로
                          // **stride 를 두어** 탭을 뽑는다 — 대칭성(=위상 0)은 그대로이고, 탭 수와 정확도가
                          // fs 에 무관해진다.  1 kHz 는 최고 코너 14.57 Hz 의 34배·맥파 대역의 ≫20배이므로
                          // 이 stride 가 만드는 이미지는 신호 대역 밖이다.  (fs ≤ 1 kHz 면 D = 1 = stride 없음.)
  maxLookahead_s: 1.0,    // 보상 지연의 안전 상한 (커널 반폭이 이보다 길면 잘린다).  기본 설정의 최악값은
                          // fc = 2.16 Hz 의 5τ = 0.369 s 이므로 실제로는 걸리지 않는다.
};
// (D) 프런트엔드 범위 — **피팅**: 실측 10-bit ADC 의 안정 기저선 358 counts / 전체 스케일 1023 counts.
export const FRONTEND = {
  fullScaleOverBaseline: 1023 / 358, // = 2.858 → 기저선 5 pF 일 때 전체 스케일 14.3 pF
  floor_pF: 0,                       // 하한 레일 (실측의 re-zero/드롭아웃은 코드 0 으로 읽힌다)
};
// (D) 정맥 에코의 자체 위상/형태 — 모두 **모델 가정**.
export const VEN_PHASE = {
  corner_Hz: 1.2,     // 정맥상은 컴플라이언스가 커서 동맥 맥파의 평활된 사본이다 (1극)
  lagJitter_s: 0.06,  // 패드별 지연 지터 (정맥상 위치·깊이 차이)
};

// §6.23 노브를 환경변수로 덮어쓰기 (js/noiseModelMeasured.js 의 DT_NOISE_KNOBS 와 같은 규약).
// 기전별 기여를 분리하는 A/B 진단용 — 기본값은 아무것도 바꾸지 않는다.
//   DT_CAP_KNOBS='{"MECH":{"allPassFrac":1}}'            …  (= (C) 기계 크기 정형 끄기)
//   DT_CAP_KNOBS='{"MECH":{"minimumPhase":true}}'        …  (= §6.23 (10) 정정본: 최소위상 1극, UNSUPPORTED)
//   DT_CAP_KNOBS='{"MECH":{"distanceLaw":true,"minimumPhase":true}}'  (= §6.23 최초본, UNSUPPORTED)
if (typeof process !== 'undefined' && process.env && process.env.DT_CAP_KNOBS) {
  try {
    const o = JSON.parse(process.env.DT_CAP_KNOBS);
    if (o.COUPLING) Object.assign(COUPLING, o.COUPLING);
    if (o.PATCH) Object.assign(PATCH, o.PATCH);
    if (o.MECH) Object.assign(MECH, o.MECH);
    if (o.FRONTEND) Object.assign(FRONTEND, o.FRONTEND);
    if (o.VEN_PHASE) Object.assign(VEN_PHASE, o.VEN_PHASE);
  } catch (_) { /* ignore malformed env */ }
}

let _refVolarR_mm = null;
// Volar radius of curvature of the REFERENCE body's wrist (mm) — the twin's historical implicit geometry.
export function referenceVolarRadius_mm() { if (_refVolarR_mm == null) _refVolarR_mm = referenceWristCrossSection().volarRadius_mm; return _refVolarR_mm; }
// Convenience for consumers that only know the body: 체형 → 볼라 곡률 반지름 (js/anthropometry.js).
export function volarRadiusForBody(height_cm, weight_kg) { return deriveWristCrossSection({ height_cm, weight_kg }).volarRadius_mm; }

export class CapacitiveArrayModel {
  constructor() {
    this.anatomicalMechanics = true; this.tissueFat_mm=2.2; this.tissueRelaxation=new WristRelaxation(); this.tissueDisplacement_mm=[]; this.tissueRadius_mm=[];
    this.rows = 3; // along proximal->distal (artery flow) axis (max 8)
    this.cols = 3; // across the wrist (lateral) (max 6)
    this.spacingMm = 4;
    this.contactPressure = 0.5; // 0..1 normalized strap/contact pressure
    this.sampleRate_Hz = 1000; // capacitance front-end sampling rate (zero-order-held into the 16 kHz master clock)
    this.baselineC_pF = 5.0;
    this.couplingRadiusMm = 5.5; // legacy constant (unused when couplingSigmaPerDepth > 0)
    this.couplingSigmaPerDepth = 1.2; // audit B-7: kernel width ∝ artery depth (σ ≈ 1.2·depth, ≥ 2.5 mm) — model assumption
    this.sampleSkew_us = 0; // per-channel multiplexer skew (µs per channel index); 0 = simultaneous sampling (idealised)
    this.noiseSeed = 1234; // seeded Gaussian front-end noise (white + 1/f-like random walk), audit B-5 — set per virtual subject in eval/population_eval.mjs
    this.arteryDepthOffset_mm = 0; // per-subject artery depth offset added to ARTERY_BASE_DEPTH_MM (population evaluation, audit §6.5); 0 = nominal anatomy
    this.arterialAttenGain = 1; // extra arterial-amplitude attenuation from the subcutaneous fat layer (anthropometry.js couplingAtten, applied as a delta vs the 170 cm/70 kg reference body — engine.setBody); 1 = nominal. Deliberately NOT applied to the measured-noise pulse reference: fat lowers the signal, not the front-end noise → SNR drops (model assumption, audit §6.9)
    this.arteryToneScalar = 1.0;
    this.ageStiffness = 1.0;
    this.pwvGain = 1.0; // pressure dependence of PWV (set by engine from MAP)
    this.capPerMmHg = 0.9 / 42; // pF per mmHg at unit distensibility & best coupling — CALIBRATION KNOB (ΔC/C ≈ 18 % at PP 42; model assumption, audit B-7)
    this.sheetAngle_deg=0;this.arteryLateralAdjust_mm=0;this.arteryDepthAdjust_mm=0;
    this.sheetLateral_mm = WRIST_ANATOMY.ARTERY_BASE_LATERAL_MM; // sheet centre (absolute wrist lateral); default = over the artery
    this.sheetAlong_mm = defaultSheetAlong_mm(this.rows, this.spacingMm); // 0 = wrist crease, − = proximal
    this.noiseLevel = 1.0;
    // Respiration rate of the baseline-wander term. Set by engine.step from the SHARED respiration phase
    // source (js/cardiac.js RespirationModel) so the skin-displacement wander stays in phase with RSA and
    // the pulsus-paradoxus SBP dip (audit §6.13). Default = the twin's historical 0.25 Hz; the wander
    // AMPLITUDE is unchanged. (The 'measured' noise model keeps its own fitted 0.24 Hz respiration peak —
    // that term is a fitted artefact of the real recordings, not the twin's physiology.)
    this.breathRate_Hz = 0.25;
    // Optional external noise / artifact sources (toggled from the UI)
    this.artifacts = { hum: false, wander: false, motionGain: 1, noiseGain: 1 };
    // Noise/artefact model: 'synthetic' (original CDC-class assumptions) | 'measured' (fitted from the real
    // 12-pad patch recordings, js/noiseModelMeasured.js — white + pink + common-mode + respiration + attachment
    // drift + posture-change transients + 1-count quantisation, all in units of the measured pulse amplitude).
    this.noiseModel = 'synthetic';
    // ---- ROADMAP §2.1-2 · non-linear pressure–diameter (audit §6.15 (A)) ----
    // ζ (1/mmHg) of the exponential wall elasticity. 0 = the historical LINEAR law (bit-identical default);
    // NONLIN_ZETA_CONSISTENT (0.012) = the value implied by the twin's own PWV pressure law. When ζ > 0 the
    // quasi-static 1/pwvGain² factor is dropped from `distensibility` (see sampleAllChannels) because the
    // within-beat exponential then carries that same pressure stiffening — no double counting.
    this.nonlinZeta_perMmHg = 0;
    this.nonlinRefP_mmHg = MAP_REF_MMHG; // anchor of the exponential = anchor of pwvPressureGain (93 mmHg)
    // Local transmural offset (hydrostatic, mmHg) at the wrist — set per frame by engine.step(); 0 = heart level.
    // Used by the non-linear elasticity (operating point) and by the contact model (applanation optimum).
    this.transmuralOffset_mmHg = 0;
    // ---- ROADMAP §2.1-5 · contact pressure: applanation / occlusion / venous congestion (audit §6.15 (B)) ----
    // 'tonometric' (default) = the physical-ish model; EXACTLY neutral at the default contact 0.5.
    // 'legacy' = the historical ad-hoc triangle gain 1 − 0.5·|cp − 0.5| (for A/B evaluation runs).
    this.contactModel = 'tonometric';
    this._ven = null; // venous congestion state {level, t} (first-order filling lag)
    // ---- ROADMAP §2.1-4 (mechanical half) · wrist curvature → per-pad standoff (audit §6.15 (C)) ----
    // 1 = perfectly conforming patch (the twin's historical implicit assumption → gap 0 → bit-identical);
    // 0 = rigid flat patch on the wrist curve. Values in between = a partly conforming flex patch.
    // ⚠ §6.23: the default moved 1 → PATCH.conformityDefault. `1` was never a measurement — the comment
    // above calls it "the twin's historical implicit assumption". A rigid polyimide FPCB patch (the real
    // one: data/lead_map_version1.png) on a ≈30 mm-radius wrist does not conform. `spatialModel:'legacy'`
    // makes BOTH the standoff gap and the rocking term exactly 0 again, i.e. it reproduces conformity = 1.
    this.curvatureConformity = PATCH.conformityDefault;
    this.volarRadius_mm = null; // per-subject volar radius of curvature (engine.setBody → anthropometry deriveWristCrossSection); null = reference body
    // ---- §6.23 · channel diversity: signed kernel / patch rocking / per-channel mechanical LP / saturation ----
    // 'volumetric' (default) = the new physics; 'legacy' = the pre-§6.23 build, BIT-IDENTICAL (it also
    // forces the standoff gap and the rocking tilt to 0, i.e. curvatureConformity behaves as 1).
    this.spatialModel = 'volumetric';
    this._mech = null;  // per-channel one-pole mechanical low-pass state (MECH.minimumPhase variant only)
    this._mechZ = null; // per-channel ZERO-PHASE mechanical magnitude shaper (§6.23 (11); the default)
    this._tendon = null; // shared tendon-shear process + delay ring (per-pad propagation lag)
    this._measured = null; // lazily created MeasuredNoiseGenerator
    // Optional user-designed electrode layout (patch design tool). null = regular rows×cols grid.
    this.layout = null;
  }

  // Custom layout from the patch designer (sheet-relative mm; see electrodeLayout.js). null → regular grid.
  setLayout(layout) {
    this.layout = layout ? normalizeLayout(layout) : null;
    this.setSheetOffset(null, this.sheetAlong_mm); // re-clamp to the new sheet length
  }
  // Sheet footprint (mm): custom layout size or the regular grid + 4 mm margin
  sheetSize_mm() { return this.layout ? { w: this.layout.sheetW, h: this.layout.sheetH } : { w: this.cols * this.spacingMm + 4, h: this.rows * this.spacingMm + 4 }; }
  // Number of electrode rows (along-clusters) and their along offsets (mm, relative to the sheet centre)
  rowCount() { return this.layout ? this.layout.rows : this.rows; }
  rowAlongs_mm() { return this.layout ? this.layout.rowAlongs : Array.from({ length: this.rows }, (_, r) => (r - (this.rows - 1) / 2) * this.spacingMm); }
  // Distance between the first and last electrode row (the local-PWV baseline), mm
  alongExtent_mm() { const a = this.rowAlongs_mm(); return a.length >= 2 ? a[a.length - 1] - a[0] : 0; }
  // Typical lateral electrode pitch (beam-search scan margin / display)
  lateralPitch_mm() { return this.layout ? lateralPitch(this.layout, this.spacingMm) : this.spacingMm; }

  configure({ rows, cols, spacingMm }) {
    const MAX_ELECTRODES = 20;
    if (rows) this.rows = Math.max(1, Math.min(8, Math.round(rows)));
    if (cols) this.cols = Math.max(1, Math.min(6, Math.round(cols)));
    // Enforce the electrode budget: shrink the dimension that was NOT just set (or cols by default)
    if (this.rows * this.cols > MAX_ELECTRODES) {
      if (rows && !cols) this.cols = Math.max(1, Math.floor(MAX_ELECTRODES / this.rows));
      else if (cols && !rows) this.rows = Math.max(1, Math.floor(MAX_ELECTRODES / this.cols));
      else this.cols = Math.max(1, Math.floor(MAX_ELECTRODES / this.rows));
    }
    if (spacingMm) this.spacingMm = Math.max(1, spacingMm);
    this.setSheetOffset(null, this.sheetAlong_mm); // re-clamp to the new sheet size
  }

  setSampleRate(hz) { this.sampleRate_Hz = Math.max(10, Math.min(16000, Math.round(hz))); }
  setContactPressure(v) { this.contactPressure = Math.max(0, Math.min(1, v)); }

  // Along range: the sheet may not extend past the wrist crease (distal edge ≤ 0) nor beyond the
  // modelled forearm segment (proximal edge ≥ SHEET_ALONG_MIN_MM).
  alongRange_mm() {
    const size=this.sheetSize_mm(),half=patchAlongHalf(size.w,size.h,this.sheetAngle_deg);
    return { min: WRIST_ANATOMY.SHEET_ALONG_MIN_MM + half, max: WRIST_ANATOMY.SHEET_ALONG_MAX_MM - half - 1 };
  }

  setSheetOffset(lateral_mm, along_mm) {
    const { min, max } = this.alongRange_mm();
    if (lateral_mm != null) this.sheetLateral_mm = Math.max(WRIST_ANATOMY.SHEET_LATERAL_MIN_MM, Math.min(WRIST_ANATOMY.SHEET_LATERAL_MAX_MM, lateral_mm));
    if (along_mm != null) this.sheetAlong_mm = Math.max(min, Math.min(max, along_mm));
  }

  setSheetAngle(degrees){this.sheetAngle_deg=normalizePatchAngle(degrees);this.setSheetOffset(null,this.sheetAlong_mm);}

  channelCount() { return this.layout ? this.layout.electrodes.length : this.rows * this.cols; }

  // Electrode positions in wrist coordinates (sheet offsets included). Regular grid: k = r*cols + c.
  // Custom layout: k = row-major order of the designed pads (r = along-cluster, c = ulnar→thumb).
  electrodePositions_mm() {
    const key=`${this.sheetLateral_mm}:${this.sheetAlong_mm}:${this.sheetAngle_deg}:${this.rows}:${this.cols}:${this.spacingMm}:${this.anatomicalMechanics}`;
    if(this._positionsKey===key&&this._positionsLayout===this.layout)return this._positionsCache;
    const finish=positions=>{this._positionsKey=key;this._positionsLayout=this.layout;this._positionsCache=this.anatomicalMechanics?positions.map(p=>{const q=wristSurface.sample(this.sheetLateral_mm,p.along_mm,p.lateral_mm-this.sheetLateral_mm);return {...p,lateral_mm:q.z,surfaceY_mm:q.y};}):positions;return this._positionsCache;};
    const positions = [];
    if (this.layout) {
      for (const e of this.layout.electrodes){const q=rotatePatchPoint(e.x,e.y,this.sheetAngle_deg);positions.push({ k: e.k, r: e.r, c: e.c, along_mm: this.sheetAlong_mm + q.along, lateral_mm: this.sheetLateral_mm + q.lateral, w_mm: e.w, h_mm: e.h, shape: e.shape });}
      return finish(positions);
    }
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const q=rotatePatchPoint((c-(this.cols-1)/2)*this.spacingMm,(r-(this.rows-1)/2)*this.spacingMm,this.sheetAngle_deg);
        const along_mm=this.sheetAlong_mm+q.along,lateral_mm=this.sheetLateral_mm+q.lateral;
        positions.push({ k: r * this.cols + c, r, c, along_mm, lateral_mm });
      }
    }
    return finish(positions);
  }

  arteryPathOnPatch(arteryOffset){
    const points=[];
    for(let along=-110;along<=8;along+=1){const a=this.arteryAt(along,arteryOffset);
      const lateral=this.anatomicalMechanics?wristSurface.arcBetween(this.sheetLateral_mm,a.lateral,along):a.lateral-this.sheetLateral_mm;
      const q=rotatePatchPoint(lateral,along-this.sheetAlong_mm,-this.sheetAngle_deg);
      points.push({lateral_mm:q.lateral,along_mm:q.along});
    }return points;
  }

  _localPWV() {
    const wristSeg = ARTERIAL_PATH[findSegmentIndex('radial_wrist')];
    return segmentPWV_ms(wristSeg, this.arteryToneScalar, this.ageStiffness, this.pwvGain); // m/s
  }

  // Artery centre for a given along position: lateral from anatomy + pronation shift; depth deepens proximally.
  arteryAt(along_mm, arteryOffset) {
    arteryOffset={lateral_mm:arteryOffset.lateral_mm+(this.arteryLateralAdjust_mm||0),depth_mm:arteryOffset.depth_mm+(this.arteryDepthAdjust_mm||0)};
    if(this.anatomicalMechanics){const a=atlasArteryAt(along_mm),w=arteryTether(along_mm).weight;return {lateral:a.lateral_mm+arteryOffset.lateral_mm*w,depth:Math.max(1.3,a.depth_mm+((this.arteryDepthOffset_mm||0)+(arteryOffset.depth_mm-1))*w)};}
    const lateral = WRIST_ANATOMY.ARTERY_BASE_LATERAL_MM + arteryOffset.lateral_mm;
    const depth = WRIST_ANATOMY.ARTERY_BASE_DEPTH_MM + (this.arteryDepthOffset_mm || 0) + (arteryOffset.depth_mm - 1.0)
      + WRIST_ANATOMY.ARTERY_DEPTH_GRADIENT_MM_PER_MM * Math.max(0, -along_mm);
    return { lateral, depth };
  }

  // ---- (C) wrist curvature → per-pad standoff (ROADMAP §2.1-4 mechanical half, audit §6.15 (C)) ----
  // Volar radius of curvature under the patch (mm) = a²/b of the wrist's elliptical cross-section
  // (js/anthropometry.js `deriveWristCrossSection`, read-only — its aspect ratio/width are 모델 가정).
  wristRadius_mm() { return this.volarRadius_mm || referenceVolarRadius_mm(); }
  // Skin gap (mm) under a pad `x` mm from the patch centre: the sagitta of the wrist arc, taken up by the
  // patch's conformity. conformity = 1 → exactly 0 (the twin's historical implicit assumption).
  // §6.23: true when the new spatial physics is active. 'legacy' reproduces the pre-§6.23 build exactly.
  get _volumetric() { return this.spatialModel !== 'legacy'; }

  padGap_mm(xFromCentre_mm) {
    const c = this.curvatureConformity;
    if (!this._volumetric) return 0; // legacy: the pre-§6.23 DEFAULT was conformity 1 → gap ≡ 0
    if (!(c < 1)) return 0;
    const R = this.wristRadius_mm();
    const x = Math.min(Math.abs(xFromCentre_mm), 0.95 * R);
    return (1 - c) * (R - Math.sqrt(R * R - x * x));
  }
  // Gap → transmitted arterial modulation. The gap is a capacitor IN SERIES with the tissue path, and for a
  // series pair the transmitted modulation scales as (C_total/C_tissue)² = 1/(1 + gap/g₀)² — the "series
  // air-gap" argument behind NOISE_KNOBS.pulseGain (js/noiseModelMeasured.js). g₀ = CURVATURE.gapHalf_mm is a
  // 모델 가정 (it lumps the gap's permittivity, the tissue path length and field fringing into one number).
  // NOTE (deliberate): the gap attenuates but does NOT widen the coupling kernel — the kernel width is set by
  // the depth of the SOURCE (σ ≈ 1.2·depth, audit B-7); a series gap scales an already-formed field pattern.
  padStandoffGain(xFromCentre_mm) {
    const gap = this.padGap_mm(xFromCentre_mm);
    if (!(gap > 0)) return 1; // conformity 1 → exactly 1 → bit-identical
    const s = 1 + gap / CURVATURE.gapHalf_mm;
    return 1 / (s * s);
  }

  // ---- (A) §6.23 · signed, volume-conserving lateral coupling kernel --------------------------------
  // K(u) = [e^{−u²/2} − (β/κ²)·e^{−u²/(2κ²)}] / (1 − β/κ²),  u = dist/σ.  See the §6.23 header block:
  // β (COUPLING.volumeReturn) is DERIVED from incompressibility — it is the fraction of the arterial
  // volume change that returns as a lateral surface DEPRESSION, and β = 1 makes ∫K dA vanish exactly, so
  // the negative lobe's depth β/κ² is NOT a free parameter. κ (COUPLING.annulusRatio) is the one fitted
  // number. K(0) = 1 by construction → `capPerMmHg` stays calibrated.
  couplingKernel(u) {
    if (!this._volumetric) return Math.exp(-0.5 * u * u); // legacy: strictly positive Gaussian — bit-identical
    const k = COUPLING.annulusRatio, b = COUPLING.volumeReturn;
    const a = b / (k * k);
    if (!(a > 0) || !(a < 1)) return Math.exp(-0.5 * u * u); // degenerate settings → legacy kernel
    return (Math.exp(-0.5 * u * u) - a * Math.exp(-0.5 * (u / k) * (u / k))) / (1 - a);
  }
  // Zero-crossing radius of the kernel (mm) for a given σ — the observable the measured data constrains.
  kernelZeroCrossing_mm(sigma_mm) {
    const k = COUPLING.annulusRatio, b = COUPLING.volumeReturn;
    if (!this._volumetric || !(b > 0) || !(k > 1)) return Infinity;
    return sigma_mm * k * Math.sqrt(2 * (2 * Math.log(k) - Math.log(b)) / (k * k - 1));
  }

  // Per-electrode static geometry factors (independent of time). Returns {coupling, tendonGain, boneDamp}.
  // NOTE (§6.23): `coupling` is now SIGNED — pads outside the kernel's zero crossing return a negative
  // value (the incompressible-tissue depression annulus). Consumers that rank channels must use |coupling|.
  electrodeGeometry(p, arteryOffset) {
    const art = this.arteryAt(p.along_mm, arteryOffset);
    if(this.anatomicalMechanics&&Number.isFinite(p.surfaceY_mm)){
      const centreY=atlasArteryAt(p.along_mm).surfaceY_mm-art.depth;
      art.depth=Math.max(1.3,Math.abs(p.surfaceY_mm-centreY));
    }
    const dLat = p.lateral_mm - art.lateral;
    const dist = Math.sqrt(dLat * dLat + art.depth * art.depth * 1.5);
    const sigma = this.couplingSigmaPerDepth > 0 ? Math.max(2.5, this.couplingSigmaPerDepth * art.depth) : this.couplingRadiusMm;
    // Curvature standoff: set by the pad's lateral distance from the PATCH CENTRE (not from the artery).
    const coupling = (this.anatomicalMechanics ? surfaceTransfer(dLat,art.depth,this.tissueFat_mm) : this.couplingKernel(dist / sigma)) * this.padStandoffGain(p.lateral_mm - this.sheetLateral_mm);
    const dT = Math.min(Math.abs(p.lateral_mm - WRIST_ANATOMY.FCR_TENDON_LATERAL_MM), Math.abs(p.lateral_mm - WRIST_ANATOMY.PL_TENDON_LATERAL_MM));
    const tendonGain = 0.35 + 0.65 * Math.exp(-0.5 * (dT / 7) ** 2); // artifact strongest over tendons
    const dB = Math.abs(p.lateral_mm - WRIST_ANATOMY.RADIUS_BONE_LATERAL_MM);
    const boneDamp = 1 - 0.35 * Math.exp(-0.5 * (dB / 5) ** 2); // stiff over bone → less displacement
    return { coupling, tendonGain, boneDamp, artery: art, dist_mm: dist, sigma_mm: sigma };
  }

  // ---- (A) non-linear pressure → diameter (ROADMAP §2.1-2, audit §6.15 (A)) ----
  // "Effective distending pressure" Peff = ∫_{P_dia}^{P} e^{−ζ(u+h−P₀)} du (mmHg): the log-area strain of an
  // exponentially elastic wall, divided by D₀. ζ = 0 returns the historical linear (P − P_dia) EXACTLY.
  distendingPulse_mmHg(p_mmHg, dbp_mmHg) {
    const z = this.nonlinZeta_perMmHg;
    if (!(z > 0)) return Math.max(0, p_mmHg - dbp_mmHg); // legacy linear law — bit-identical
    const h = this.transmuralOffset_mmHg || 0, p0 = this.nonlinRefP_mmHg;
    return Math.max(0, (Math.exp(-z * (dbp_mmHg + h - p0)) - Math.exp(-z * (p_mmHg + h - p0))) / z);
  }

  // ---- (B) contact pressure: applanation / occlusion / venous congestion (ROADMAP §2.1-5, audit §6.15 (B)) ----
  // Returns { hold_mmHg, app, occ, gain, knee, venDrive } for a contact pressure `cp` at the local
  // (hydrostatically offset) operating point. EVERY field is exactly neutral at cp = 0.5.
  contactState(cp, sbp, dbp) {
    // Every field must stay FINITE in every mode (a NaN here would propagate into the capacitance grid
    // and into the UI read-outs / heat-map colour mapping).
    const h = this.transmuralOffset_mmHg || 0;
    const map = dbp + (sbp - dbp) / 3 + h, sys = sbp + h;
    if (this.contactModel === 'legacy' || !isFinite(map) || !isFinite(sys) || !isFinite(cp)) {
      const g = 1 - 0.5 * Math.abs(cp - 0.5);
      return { hold_mmHg: cp * CONTACT.full_mmHg, app: g, occ: 1, gain: g, knee: 1, venDrive: 0 };
    }
    const hold = cp * CONTACT.full_mmHg, hold0 = 0.5 * CONTACT.full_mmHg;
    // Applanation / oscillometric transmission envelope, peaked at transmural 0 (P_hold = MAP), expressed
    // relative to the cp = 0.5 anchor → exactly 1 there for any MAP.
    const app = Math.exp(-0.5 * ((hold - map) * (hold - map) - (hold0 - map) * (hold0 - map)) / (CONTACT.appWidth_mmHg * CONTACT.appWidth_mmHg));
    // Occlusion above systolic (floored at the anchor so cp ≤ 0.5 is untouched even at very low SBP).
    const over = Math.max(0, hold - Math.max(sys, hold0)) / CONTACT.occWidth_mmHg;
    const occ = over > 0 ? Math.exp(-Math.LN2 * over * over) : 1;
    // Over-compression damps the systolic peak: soft-knee compression of the distension waveform.
    const clipDrive = Math.max(0, hold - hold0) / Math.max(1, sys - hold0);
    const knee = 1 / (1 + CONTACT.clipGain * clipDrive);
    return { hold_mmHg: hold, app, occ, gain: app * occ, knee, venDrive: Math.max(0, (cp - 0.5) / 0.5) };
  }
  // Contact → arterial-amplitude gain at an arbitrary cp (evaluation hook: eval/population_eval.mjs
  // --contact-correct emulates an observer that knows this map).
  contactGainAt(cp, sbp, dbp) { const c = this.contactState(cp, sbp, dbp); return c.gain; }
  // Soft-knee systolic compression: identity when knee ≥ 1 (cp ≤ 0.5) — bit-identical default.
  _softKnee(u, knee) { return (knee >= 1 || u <= knee) ? u : knee + (1 - knee) * Math.tanh((u - knee) / (1 - knee)); }
  // Venous congestion level (0–1), first-order filling lag τ = CONTACT.venTau_s toward the drive.
  // Dependent limb (positive hydrostatic offset) raises the steady level; raised limb drains it.
  _venousLevel(t, drive) {
    const target = Math.max(0, Math.min(2, drive * (1 + (this.transmuralOffset_mmHg || 0) / CONTACT.venHydroRef_mmHg)));
    const st = this._ven || (this._ven = { level: null, t });
    if (st.level == null || !(t >= st.t)) { st.level = target; st.t = t; return target; } // start settled (no start-up transient)
    const dt = Math.min(1, t - st.t); st.t = t;
    st.level += (target - st.level) * (1 - Math.exp(-dt / CONTACT.venTau_s));
    return st.level;
  }

  // ---- (B) §6.23 · patch rigid-body rocking ---------------------------------------------------------
  // A stiff patch cannot follow the skin's curvature change: it pivots on the arterial bulge and its far
  // end lifts off. Model it as the removal of the least-squares TILT of the free-skin displacement field
  // over the pad set — piston (common) mode EXCLUDED, because the strap resists it while the tilt mode is
  // soft. Removing a pure tilt leaves the array MEAN untouched, so rocking redistributes the pulse rather
  // than attenuating it, and gives the two ends of the patch OPPOSITE-SIGNED contributions.
  //   u'_k = u_k − s·[θ_x·(x_k − x̄) + θ_y·(y_k − ȳ)],   s = 1 − curvatureConformity  (patch stiffness)
  // Returns the per-channel ADDITIVE delta on the static coupling (null when inert). Applying the tilt to
  // the STATIC coupling rather than to the time-varying field is exact up to the row-to-row local-PTT
  // spread (≈0.5 ms over the patch), because the tilt operator is linear and the pulse is common to first
  // order — and it keeps the whole mechanism out of the per-sample inner loop.
  // 모델 가정: that the pad-mean pivot is the right constraint, and the magnitude scale (a pure tilt with
  // no torsional-stiffness roll-off). The measured standard set does NOT support a rocking dipole — a
  // free-centre annulus beat an (a + b·x + c·y) dipole in 10/10 files (mean R² 0.75 vs 0.26) and the
  // fitted dipole gradients had inconsistent signs across files. It is implemented because the patent
  // proposals (grooved / flexible patch, curved-skin conformity) claim to fix exactly this failure and
  // the twin previously had NO rocking mechanism at all, so those claims could not be tested.
  patchRockDeltas(positions, couplings) {
    const s = 1 - this.curvatureConformity;
    if (!this._volumetric || !(s > 0) || positions.length < 3) return null;
    let sx = 0, sy = 0, n = positions.length;
    for (const p of positions) { sx += p.lateral_mm; sy += p.along_mm; }
    const xb = sx / n, yb = sy / n;
    let sxx = 0, syy = 0, sxy = 0, sxu = 0, syu = 0;
    for (let i = 0; i < n; i++) {
      const dx = positions[i].lateral_mm - xb, dy = positions[i].along_mm - yb, u = couplings[i];
      sxx += dx * dx; syy += dy * dy; sxy += dx * dy; sxu += dx * u; syu += dy * u;
    }
    const det = sxx * syy - sxy * sxy;
    let tx = 0, ty = 0;
    if (Math.abs(det) > 1e-9) { tx = (syy * sxu - sxy * syu) / det; ty = (sxx * syu - sxy * sxu) / det; }
    else if (sxx > 1e-9) tx = sxu / sxx;                    // degenerate (single row/column) layouts
    else if (syy > 1e-9) ty = syu / syy;
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = -s * (tx * (positions[i].lateral_mm - xb) + ty * (positions[i].along_mm - yb));
    return out;
  }

  // ---- (C) §6.23 · per-channel mechanical MAGNITUDE shaping (zero phase) -----------------------------
  // The tissue between artery and pad gives each pad a slightly different mechanical bandwidth. One pole,
  // not two, because the measured per-pad transfer MAGNITUDES resolved only one (23/36 pads all-pass, the
  // rest a single corner in 2.16–14.57 Hz).
  //
  // The corner is drawn PER PAD, seeded, and is deliberately INDEPENDENT of the coupling geometry —
  // see the MECH block above for why the original distance law was removed. Two measured quantities go
  // in: the all-pass prevalence (23/36) and the corner range; the shape is log-uniform because the data
  // cannot distinguish it from lognormal and log-uniform assumes least beyond the measured range.
  //
  // The seeded draw uses the same hashU(seed, channel, salt) construction as the per-pad noise state, so
  // it is deterministic and reproducible, fixed for the session and the pad, and carries no systematic
  // relation to distance or amplitude.
  //
  // ⚠ Only the MAGNITUDE above was ever measured. §6.23 (11) therefore realises it with ZERO PHASE
  // (`_mechZeroPhaseState` / `_mechZeroPhaseStep` below); `MECH.minimumPhase = true` selects the
  // superseded minimum-phase one-pole (UNSUPPORTED variant, DT_CAP_KNOBS only), whose coefficient
  // a = exp(−2π·fc/fs) ∈ [0, 1) is derived from `sampleRate_Hz` and is unconditionally stable.
  mechCorner_Hz(k, dist_mm) {
    if (!this._volumetric) return Infinity;
    if (MECH.distanceLaw) { // UNSUPPORTED variant (DT_CAP_KNOBS only): the ordering the measurement contradicts
      const d = Math.max(0.5, dist_mm);
      return Math.max(MECH.minCorner_Hz, Math.min(MECH.maxCorner_Hz, MECH.pathGain_Hz_mm2 / (d * d)));
    }
    const u = hashU(this.noiseSeed * 0.113 + k * 47.3 + 8.6);
    if (u < MECH.allPassFrac) return Infinity;                       // no resolvable mechanical roll-off
    const v = (u - MECH.allPassFrac) / (1 - MECH.allPassFrac);       // remap the remainder to (0, 1)
    return MECH.corner_lo_Hz * Math.pow(MECH.corner_hi_Hz / MECH.corner_lo_Hz, v); // log-uniform
  }

  // ---- (C) §6.23 (11) · zero-phase realisation: state, and why it works in a STREAMING twin ----------
  // A symmetric kernel is acausal: y(t) needs x(t + m·Δ) as well as x(t − m·Δ), so a plain forward-backward
  // (`filtfilt`) pass is not available here — the twin generates samples forward in time and the analysis
  // core consumes them live. Two facts make the streaming realisation exact anyway:
  //
  //  1. **The delay is a fixed integer and it is the SAME for every channel.** The taps are symmetric about
  //     one common centre index L (in samples), regardless of each pad's own corner and of how many taps it
  //     needs — an all-pass pad simply gets h = δ at that same centre. So the array is delayed as a block:
  //     the DIFFERENTIAL group delay between any two channels is EXACTLY 0 at every frequency, which is the
  //     only thing Δt / local PWV / PTT can see, and the only thing the measurement constrains
  //     (its −0.5 ms median is a pad-vs-reference-pad lag, i.e. a differential).
  //  2. **The twin can pay that block delay back, because it is a generator, not a receiver.** The arterial
  //     drive is a closed-form function of time (`cardiac.pressureAt`), and `_beatStateAt` already
  //     materialises the beat timeline 2 s ahead of the current sample, so evaluating the pulse L samples
  //     into the future is cheap. `sampleAllChannels` therefore feeds the ring with pulse(t + L/fs) and
  //     reads the centred convolution back out, so the NET latency of the whole mechanism is exactly 0 —
  //     the array's absolute timing (and hence `pttWF`, which is a cap-vs-PPG delay) is untouched. This is
  //     a look-ahead in the SIMULATED signal, not in the analysis path.
  //     The one state effect is that it stretches `_ensureTimelineUntil`'s horizon from t+2 s to t+2+L/fs,
  //     and RR uses the `hr` in force when a beat is generated. It is NOT observable: over a 30 s stream
  //     the SHA-256 of `ppg.ir` / `ecg` / `pressureAt(t)` is IDENTICAL for legacy, minimum-phase and
  //     zero-phase, and the PPG-only columns of every ESH table agree to the last decimal — including the
  //     `exercise` scenario, whose HR ramps 72 → 120 bpm (docs/CLINICAL_AUDIT.md §6.23 (11)).
  //
  // The kernel is applied to the PULSE term, not to the finished arterial capacitance: the mechanical path
  // shapes the pressure→displacement waveform, while coupling / contact gain / distensibility are
  // instantaneous scale factors. Filtering the product would drag those static envelopes L samples behind
  // the pulse they multiply (a step in contact pressure or sheet position would arrive late). The
  // superseded `MECH.minimumPhase` branch keeps filtering the product, exactly as §6.23 shipped it.
  //
  // Corners are FROZEN at build time. For the supported (distance-independent, per-pad seeded) draw that is
  // exact. Under the UNSUPPORTED `MECH.distanceLaw` variant it freezes them at the artery offset of the
  // first sample — acceptable for an A/B-only path, and noted here rather than silently.
  _mechZeroPhaseState(nPos, positions, geos) {
    const fs = this.sampleRate_Hz;
    const sig = [fs, nPos, this.noiseSeed, MECH.allPassFrac, MECH.corner_lo_Hz, MECH.corner_hi_Hz,
      MECH.distanceLaw ? 1 : 0, MECH.pathGain_Hz_mm2, MECH.minCorner_Hz, MECH.maxCorner_Hz,
      MECH.supportTau, MECH.kernelStep_Hz, MECH.maxLookahead_s].join('|');
    if (this._mechZ && this._mechZ.sig === sig) return this._mechZ.L > 0 ? this._mechZ : null;
    // Quadrature stride: the kernel is a sampled continuous-time convolution, so its step is set by the
    // physics (corners ≤ 14.57 Hz), not by the front-end rate. D = 1 for fs ≤ MECH.kernelStep_Hz.
    const D = Math.max(1, Math.round(fs / MECH.kernelStep_Hz));
    const fsk = fs / D;
    const maxM = Math.max(1, Math.floor(MECH.maxLookahead_s * fs / D));
    const ch = [];
    let Mmax = 0;
    for (let i = 0; i < nPos; i++) {
      const k = positions[i].k;
      const fc = this.mechCorner_Hz(k, geos[i].dist_mm);
      if (!(fc > 0) || !isFinite(fc)) { ch[k] = { fc: Infinity, taps: null, M: 0 }; continue; } // all-pass pad
      const d = zeroPhaseMagTaps(fc, fsk, MECH.supportTau, maxM);
      ch[k] = { fc, taps: d.h, M: d.M };
      if (d.M > Mmax) Mmax = d.M;
    }
    const L = Mmax * D, RL = 2 * L + 1;
    for (const c of ch) if (c) { c.buf = new Float64Array(RL); c.pos = 0; c.idx = -1; c.primed = false; }
    this._mechZ = { sig, L, D, fsk, ch };
    return L > 0 ? this._mechZ : null;
  }

  // One streaming sample of the zero-phase shaper for channel k. `x` is the pulse term evaluated at
  // t + L/fs (the look-ahead of point 2 above); the return value is the shaped pulse at t.
  // All-pass pads take the `taps == null` path, which is a pure L-sample read-back of the ring, i.e. it
  // returns x(t) bit-for-bit — an all-pass pad is untouched, as it must be.
  _mechZeroPhaseStep(st, k, x, tIdx) {
    const c = st.ch[k];
    if (!c) return x;
    const RL = c.buf.length;
    if (c.idx !== tIdx) {                       // one ring write per capacitance sample (sampleGrid re-entry safe)
      c.idx = tIdx;
      if (!c.primed) { c.buf.fill(x); c.pos = 0; c.primed = true; } // start settled: no start-up transient
      else { c.pos = c.pos + 1 >= RL ? 0 : c.pos + 1; c.buf[c.pos] = x; }
    }
    const L = st.L;
    if (!c.taps) { let q = c.pos - L; if (q < 0) q += RL; return c.buf[q]; }
    const taps = c.taps, M = c.M, D = st.D;
    let y = 0;
    for (let m = -M; m <= M; m++) {
      let q = (c.pos - L + m * D) % RL;
      if (q < 0) q += RL;
      y += taps[m + M] * c.buf[q];
    }
    return y;
  }

  // Sample ALL channels at time t. Returns Float32Array(rows*cols) of capacitance (pF).
  // The arterial pulse is evaluated once per row (distinct local-PTT delay), then reused per column.
  // `arrivalDelay_s` = pulse transit time heart → wrist (the electrodes see the pulse when it arrives).
  sampleAllChannels(t, cardiac, arteryOffset, motionLevel, out = null, arrivalDelay_s = 0) {
    const n = this.channelCount();
    const res = out && out.length >= n ? out : new Float32Array(n);
    const localPWV = this._localPWV();
    const pressureComponent = (this.contactPressure - 0.5) * -0.4; // over-tight strap reduces coupling
    // Contact pressure → applanation / occlusion / systolic damping / venous congestion (audit §6.15 (B)).
    // Exactly neutral at the default cp = 0.5: gain 1, knee 1, venDrive 0.
    const CS = this.contactState(this.contactPressure, cardiac.sbp, cardiac.dbp);
    const contactCouplingGain = CS.gain; // best coupling at the applanation optimum (P_hold ≈ MAP)
    // Arterial wall distensibility follows Bramwell–Hill: D ∝ 1/PWV² ∝ 1/(tone·stiff·g)² (audit B-2).
    // With the non-linear elasticity ON (ζ > 0) the g² (pressure) factor moves INTO the within-beat
    // exponential — the same mechanism, evaluated per sample instead of once at MAP (audit §6.15 (A)).
    const distensibility = this.nonlinZeta_perMmHg > 0
      ? (this.distensibilityScale || 1) / Math.pow(this.arteryToneScalar * this.ageStiffness, 2)
      : (this.distensibilityScale || 1) / Math.pow(this.arteryToneScalar * this.ageStiffness * (this.pwvGain || 1), 2);
    // Full-scale distension of this beat (the soft-knee normaliser); with ζ = 0 this is just PP.
    const distendFull = Math.max(1e-6, this.distendingPulse_mmHg(cardiac.sbp, cardiac.dbp));
    const A = this.artifacts;
    // Mains hum (60 Hz capacitive pickup, common-mode across the sheet with slight per-channel phase)
    const hum = A.hum ? 0.12 * Math.sin(2 * Math.PI * 60 * t) : 0;
    // Baseline wander: strap/contact impedance drift + respiration-coupled skin displacement
    const wander = A.wander ? 0.35 * Math.sin(2 * Math.PI * this.breathRate_Hz * t + 0.7) + 0.2 * Math.sin(2 * Math.PI * 0.08 * t) : 0;
    const motionGainA = A.motionGain || 1, noiseGainA = A.noiseGain || 1;
    const positions = this.electrodePositions_mm();
    // (C) §6.23 (11): the zero-phase shaper's block look-ahead, in seconds. 0 unless the zero-phase branch
    // is active (legacy, `MECH.minimumPhase`, or an all-pass-only array all leave it exactly 0). It is
    // assigned below, before the channel loop, and read through this binding by `pulseAt`.
    let mechLook_s = 0;
    // Distending pulse pressure is evaluated once per distinct along position (distinct local-PTT delay)
    const pulseCache = new Map();
    const pulseAt = (along) => {
      const key = Math.round(along * 100);
      let v = pulseCache.get(key);
      if (v == null) { const localDelay_s = (along / 1000) / localPWV; v = this.distendingPulse_mmHg(cardiac.pressureAt(t + mechLook_s - arrivalDelay_s - localDelay_s), cardiac.dbp); pulseCache.set(key, v); }
      return v;
    };
    // Multiplexed front-end: channel k is converted k·skew later (option; default 0 = simultaneous)
    const pulseAtSkewed = (along, k) => { const localDelay_s = (along / 1000) / localPWV; return this.distendingPulse_mmHg(cardiac.pressureAt(t + mechLook_s - arrivalDelay_s - localDelay_s - k * this.sampleSkew_us * 1e-6), cardiac.dbp); };
    // Seeded Gaussian noise per channel & sample (white) + slow 1/f-like random walk (AR(1)); stateful per channel
    // BUGFIX (2026-08-25, audit §6.15): the state started as `{rw: 0, idx: 0}`, so at t = 0 (tIdx = 0) the
    // `st.idx !== tIdx` guard below was FALSE, the white/random-walk draw was skipped and `st.white` was still
    // `undefined` → the FIRST capacitance sample of a session was NaN on every channel (three
    // `[loop] error … _colormap` console errors and one blank C(x,t) snapshot frame at page load).
    // Seeding `white: 0` (rather than moving `idx`) fixes it WITHOUT touching the seeded noise stream: the
    // t = 0 sample is now simply noise-free and every sample after it is bit-identical to the previous tree.
    if (!this._noiseState || this._noiseState.length < positions.length) this._noiseState = Array.from({ length: Math.max(positions.length, 20) }, () => ({ rw: 0, white: 0, idx: 0 }));
    const gauss = (seed) => { const u = hashU(seed), v = hashU(seed * 1.61803 + 7.7); return Math.sqrt(-2 * Math.log(Math.max(1e-12, u))) * Math.cos(2 * Math.PI * v); };
    const tIdx = Math.round(t * this.sampleRate_Hz); // one draw per capacitance sample
    // Measured-model amplitude reference: the twin's pulse amplitude of a pad centred over the artery at the
    // sheet's along position and nominal PP 42 mmHg (depth-limited coupling; independent of where the sheet is,
    // so the device noise does not change when the sheet is moved). Default geometry: ≈ 0.5 pF.
    let pulseRef_pF = 0;
    if (this.noiseModel === 'measured') {
      const artC = this.arteryAt(this.sheetAlong_mm, arteryOffset);
      const g0 = this.electrodeGeometry({ along_mm: this.sheetAlong_mm, lateral_mm: artC.lateral }, arteryOffset);
      pulseRef_pF = this.capPerMmHg * 42 * g0.coupling * g0.boneDamp;
    }
    // Venous congestion (audit §6.15 (B)): slow baseline swelling + a respiratory swing that uses the SHARED
    // respiration phase (js/cardiac.js RespirationModel: signal(t) = sin(2π·rate·t), consumed here through
    // `breathRate_Hz` — NOT a second oscillator) + a lagged, damped cardiac echo (a delayed copy of the
    // arterial pulse: the confound that makes congestion dangerous for reflection features). Exactly 0 at cp ≤ 0.5.
    // (D) §6.23: the cardiac ECHO is no longer a scaled copy of the arterial pulse with one array-wide
    // lag. It now gets its OWN lag (per-pad jitter: the venous bed's depth/position differs pad to pad)
    // and its OWN shape (a one-pole smear — the venous bed is compliant, so it integrates the arterial
    // pulse rather than reproducing it). Both are 모델 가정. The respiration and slow-filling parts stay
    // array-wide, which is physical: they ARE common-mode (and the measured model already gives
    // respiration a per-channel gain jitter). Exactly 0 at cp ≤ 0.5, as before.
    let venBase_pF = 0, venCommon = 0, venEchoLegacy = 0;
    if (CS.venDrive > 0) {
      venBase_pF = CONTACT.venGain_pF * this._venousLevel(t, CS.venDrive);
      venCommon = 1 + CONTACT.venRespFrac * Math.sin(2 * Math.PI * this.breathRate_Hz * t);
      venEchoLegacy = this.distendingPulse_mmHg(cardiac.pressureAt(t - arrivalDelay_s - CONTACT.venPulseLag_s), cardiac.dbp) / distendFull;
      if (this._volumetric && (!this._venEcho || this._venEcho.length < positions.length)) {
        const a = Math.exp(-2 * Math.PI * VEN_PHASE.corner_Hz / this.sampleRate_Hz);
        this._venEcho = Array.from({ length: Math.max(positions.length, 20) }, () => ({ y: 0, idx: -1, a, prime: true }));
      }
    }
    // ---- static per-channel geometry pre-pass (needed because (B) rocking is an ARRAY-WIDE operator) ----
    const nPos = positions.length;
    const geos = new Array(nPos), couplings = new Float64Array(nPos), areaScales = new Float64Array(nPos);
    for (let i = 0; i < nPos; i++) {
      const p = positions[i];
      const geo = this.electrodeGeometry(p, arteryOffset);
      let coupling = geo.coupling, areaScale = 1;
      if (this.layout) {
        // Finite pad: coupling averaged over the pad footprint (centre + 4 quarter points) and
        // sensitivity ∝ pad area relative to a 3×3 mm reference pad (front-end offset-compensated, so
        // the 5 pF baseline is unchanged).
        const qw = p.w_mm / 4, qh = p.h_mm / 4;
        const g1 = this.electrodeGeometry({ along_mm: p.along_mm, lateral_mm: p.lateral_mm - qw }, arteryOffset).coupling;
        const g2 = this.electrodeGeometry({ along_mm: p.along_mm, lateral_mm: p.lateral_mm + qw }, arteryOffset).coupling;
        const g3 = this.electrodeGeometry({ along_mm: p.along_mm - qh, lateral_mm: p.lateral_mm }, arteryOffset).coupling;
        const g4 = this.electrodeGeometry({ along_mm: p.along_mm + qh, lateral_mm: p.lateral_mm }, arteryOffset).coupling;
        coupling = (coupling + g1 + g2 + g3 + g4) / 5;
        areaScale = (p.w_mm * p.h_mm) / 9;
      }
      geos[i] = geo; couplings[i] = coupling; areaScales[i] = areaScale;
    }
    // (B) patch rigid-body rocking: subtract the least-squares TILT of the free-skin displacement field.
    const rock = this.patchRockDeltas(positions, couplings);
    if (rock) for (let i = 0; i < nPos; i++) couplings[i] += rock[i];
    // (C) per-channel mechanical magnitude shaping.
    //   default  → ZERO PHASE: symmetric FIR + a common block look-ahead (§6.23 (11)); acts on the PULSE.
    //   knob     → MECH.minimumPhase: the superseded minimum-phase one-pole (UNSUPPORTED variant); acts on
    //              the finished arterial term, exactly as §6.23 shipped it, so the A/B is byte-faithful.
    let mech = null, mechZ = null;
    if (this._volumetric && !this.anatomicalMechanics) {
      if (MECH.minimumPhase) {
        const fs = this.sampleRate_Hz;
        if (!this._mech || this._mech.length < nPos) this._mech = Array.from({ length: Math.max(nPos, 20) }, () => ({ y: 0, idx: -1, a: 0, prime: true }));
        mech = this._mech;
        // fc = ∞ (an all-pass pad) → a = 0 → the filter is an exact pass-through, bit-for-bit.
        for (let i = 0; i < nPos; i++) { const fc = this.mechCorner_Hz(positions[i].k, geos[i].dist_mm); mech[positions[i].k].a = fc === Infinity ? 0 : Math.exp(-2 * Math.PI * fc / fs); }
      } else {
        mechZ = this._mechZeroPhaseState(nPos, positions, geos);
        if (mechZ) mechLook_s = mechZ.L / this.sampleRate_Hz; // read by pulseAt / pulseAtSkewed above
      }
    }
    for (let i = 0; i < nPos; i++) {
      const p = positions[i];
      const k = p.k, r = p.r, c = p.c;
      const pulseRaw = this.sampleSkew_us > 0 ? pulseAtSkewed(p.along_mm, k) : pulseAt(p.along_mm);
      // Over-compression damps the systolic peak (identity while knee ≥ 1, i.e. cp ≤ 0.5)
      let pulse_mmHg = CS.knee >= 1 ? pulseRaw : distendFull * this._softKnee(pulseRaw / distendFull, CS.knee);
      // (C) zero-phase mechanical magnitude shaping acts on the PULSE (the waveform that travelled the
      // tissue path); the look-ahead built into `pulseAt` above is paid back here, so the net delay is 0.
      if (mechZ) pulse_mmHg = this._mechZeroPhaseStep(mechZ, k, pulse_mmHg, tIdx);
      const geo = geos[i], coupling = couplings[i], areaScale = areaScales[i];
      let arterialComponent = coupling * geo.boneDamp * contactCouplingGain * this.capPerMmHg * distensibility * pulse_mmHg * areaScale * (this.arterialAttenGain || 1);
      if(this.anatomicalMechanics){
        // Pressure -> radius (Bramwell-Hill small strain) -> causal tissue -> electrode.
        // The old zero-phase tissue filter is bypassed; do not double-filter tissue.
        const target=radiusPerPressure()*distensibility*pulse_mmHg;
        const dr=this.tissueRelaxation.step(k,tIdx,target,this.sampleRate_Hz);
        const displacement=coupling*geo.boneDamp*contactCouplingGain*dr*(this.arterialAttenGain||1);
        this.tissueRadius_mm[k]=dr;this.tissueDisplacement_mm[k]=displacement;
        arterialComponent=displacement*WRIST_MECHANICS.capSensitivity_pFmm*areaScale;
      }
      // (C) the arterial term — and ONLY it — has travelled the tissue path from the artery to this pad,
      // so it is the term the mechanical low-pass acts on (front-end noise and DC do not traverse it).
      if (mech) {
        const m = mech[k];
        if (m.idx !== tIdx) {
          m.idx = tIdx;
          if (m.prime) { m.y = arterialComponent; m.prime = false; }   // start settled: no start-up transient
          else m.y = m.a * m.y + (1 - m.a) * arterialComponent;
        }
        arterialComponent = m.y;
      }
      const st = this._noiseState[k];
      // Non-arterial motion/tendon artifact: per-channel slow random process (seeded AR(1), τ ≈ 0.5 s — no fixed
      // tone), spatially less coherent than the arterial pulse; amplitude scaled with the capacitance gain.
      if (st.midx !== tIdx) { st.midx = tIdx; st.mot = 0.998 * (st.mot || 0) + 0.045 * gauss(this.noiseSeed + k * 3571 + tIdx * 0.001 + 0.91); }
      const motionSeed = 0.5 + 0.5 * Math.tanh(st.mot);
      const motionComponent = motionLevel * motionGainA * geo.tendonGain * (0.3 + 0.7 * motionSeed) * 0.45 * areaScale;
      // Venous bed: broad and superficial (wide lateral profile centred on the volar midline). 0 at cp ≤ 0.5.
      let venousComponent = 0;
      if (venBase_pF !== 0) {
        let echo = venEchoLegacy;
        if (this._volumetric) {
          const lagK = CONTACT.venPulseLag_s + VEN_PHASE.lagJitter_s * (2 * hashU(this.noiseSeed * 0.083 + k * 31.7 + 3.1) - 1);
          const raw = this.distendingPulse_mmHg(cardiac.pressureAt(t - arrivalDelay_s - lagK), cardiac.dbp) / distendFull;
          const vs = this._venEcho[k];
          if (vs.idx !== tIdx) { vs.idx = tIdx; if (vs.prime) { vs.y = raw; vs.prime = false; } else vs.y = vs.a * vs.y + (1 - vs.a) * raw; }
          echo = vs.y;
        }
        venousComponent = venBase_pF * (venCommon + CONTACT.venPulseFrac * echo)
          * Math.exp(-0.5 * (p.lateral_mm / CONTACT.venSigma_mm) ** 2) * areaScale;
      }
      // (D) §6.23: the shared non-arterial oscillators get a per-channel PHASE, not just a per-channel
      // amplitude. Before, every pad's hum and every pad's respiration-coupled skin wander were the same
      // sinusoid scaled by a constant, so they were perfectly correlated across the array — which is what
      // let a "diverse" array still look like one channel. Both are 모델 가정 and both are inert unless
      // the corresponding artifact toggle is on. (The tendon/motion term already had an independent
      // per-channel AR(1) and is left alone.)
      const humK = A.hum
        ? (this._volumetric ? 0.12 * Math.sin(2 * Math.PI * 60 * t + 0.35 * (2 * hashU(this.noiseSeed * 0.089 + k * 37.1 + 4.2) - 1)) : hum) * (1 + 0.15 * Math.sin(k))
        : 0;
      const wanderK = A.wander
        ? (this._volumetric
            ? 0.35 * Math.sin(2 * Math.PI * this.breathRate_Hz * t + 0.7 + 0.5 * (2 * hashU(this.noiseSeed * 0.097 + k * 41.3 + 5.3) - 1))
              + 0.2 * Math.sin(2 * Math.PI * 0.08 * t + 0.5 * (2 * hashU(this.noiseSeed * 0.101 + k * 43.7 + 6.4) - 1))
            : wander) * (1 + 0.1 * Math.cos(k * 1.3))
        : 0;
      if (this.noiseModel === 'measured') {
        // Measured patch model (js/noiseModelMeasured.js): all terms are fractions of the measured median pulse
        // amplitude A; A_pF = pulseRef / max_over_median so the twin's best-coupled pad matches the measured best pad.
        if (!this._measured) this._measured = new MeasuredNoiseGenerator(NOISE_MODEL_V1);
        const A_pF = pulseRef_pF / NOISE_MODEL_V1.pulse.max_over_median;
        const mv = this._measured.sample(k, tIdx, t, this.sampleRate_Hz, positions.length,
          { seed: this.noiseSeed, motionLevel, motionGain: motionGainA });
        const noiseM = mv.noise * A_pF * this.noiseLevel * noiseGainA * Math.sqrt(areaScale);   // white + pink (+ common mode)
        const wanderM = mv.wander * A_pF * (A.wander ? 3 : 1) * areaScale;                       // respiration + attachment drift
        const motionM = mv.motion * A_pF * areaScale;                                             // posture-change transients + spikes (rate ∝ motionGain, motionLevel)
        // v1.1: per-pad pulse-visibility × slow gain random walk multiplies the ARTERIAL pulse only (coupling inhomogeneity
        // of the real patch — 4/12 pulse pads, MRC lock flips; docs/NOISE_MODEL.md §6). DC / noise / drift unchanged.
        const gainM = mv.gain != null ? mv.gain : 1;
        let v = this.baselineC_pF + arterialComponent * gainM + motionComponent + pressureComponent + noiseM + wanderM + motionM
              + humK // no mains line was measured; the hum toggle keeps its synthetic 60 Hz
              + venousComponent;
        const qstep = NOISE_MODEL_V1.quant.step_frac * A_pF;                                      // 1 ADC count
        res[k] = this._saturate(Math.round(v / qstep) * qstep);
        continue;
      }
      // Front-end noise: white Gaussian (σ 6 fF per 1 kHz sample, CDC-class) + 1/f-like random walk (AR(1), σ≈4 fF), seeded → reproducible.
      // Noise scales with √area (parasitics grow with pad size) so SNR ∝ √area rather than ∝ area (audit B-6).
      if (st.idx !== tIdx) { st.idx = tIdx; st.rw = 0.995 * st.rw + 0.0004 * gauss(this.noiseSeed + k * 7919 + tIdx * 0.001 + 0.37); st.white = 0.006 * gauss(this.noiseSeed + k * 104729 + tIdx * 0.001); }
      const noise = (st.white + st.rw) * this.noiseLevel * noiseGainA * Math.sqrt(areaScale);
      res[k] = this._saturate(this.baselineC_pF + arterialComponent + motionComponent + pressureComponent + noise
             + humK + wanderK
             + venousComponent);
    }
    return res;
  }

  // ---- (D) §6.23 · front-end range clipping ---------------------------------------------------------
  // HARD clip, not soft. Justification: the front-end is a capacitance-to-digital converter and the
  // measured recordings are 10-bit ADC codes whose quality mask tests saturation at code ≥ 1023 directly
  // (docs/NOISE_MODEL.md §1) — a converter's output code has a hard rail, not a compressive knee. A soft
  // knee would be the right model for an analogue amplifier stage, which this is not.
  // The range is FITTED from the measured recordings: the resting baseline sits at 358 of 1023 counts, so
  // full scale = (1023/358)·baseline. The floor is 0 (the measured re-zero/dropout events read code 0).
  _saturate(v) {
    if (!this._volumetric) return v;                 // legacy: no clipping at all — bit-identical
    const hi = this.baselineC_pF * FRONTEND.fullScaleOverBaseline;
    return v > hi ? hi : (v < FRONTEND.floor_pF ? FRONTEND.floor_pF : v);
  }

  // Full electrode grid snapshot at time t: number[rows][cols] (for heatmap/3D viz).
  sampleGrid(t, cardiac, arteryOffset, motionLevel) {
    if (this.layout) return null; // custom layouts are not a rectangular grid
    const flat = this.sampleAllChannels(t, cardiac, arteryOffset, motionLevel);
    const grid = new Array(this.rows);
    for (let r = 0; r < this.rows; r++) {
      grid[r] = new Array(this.cols);
      for (let c = 0; c < this.cols; c++) grid[r][c] = flat[r * this.cols + c];
    }
    return grid;
  }

  // Electrode with the strongest arterial coupling for the current artery position.
  // BUGFIX (§6.23): the coupling kernel is now SIGNED, so "strongest" is the largest MAGNITUDE. The old
  // `g > bestG` ranked a signed value and would have preferred a weak positive pad over a strong inverted
  // one. With the fitted kernel the peak is always positive, so this changes nothing today (verified: the
  // legacy and volumetric branches pick the same pad on every stock layout) — but ranking a signed
  // quantity by its raw value is a latent bug, not a tuning choice, so it is fixed rather than left.
  bestElectrode(arteryOffset) {
    let best = null, bestG = -1;
    for (const p of this.electrodePositions_mm()) {
      const g = Math.abs(this.electrodeGeometry(p, arteryOffset).coupling);
      if (g > bestG) { bestG = g; best = p; }
    }
    return best;
  }

  // Oracle (true-geometry) coupling per channel, used as the "reference beamformer" weights.
  // §6.23: these are SIGNED. That is correct and required — a maximal-ratio combiner must weight an
  // inverted channel negatively to add its energy rather than cancel it. Consumers that assumed
  // non-negative weights are the ones that need fixing, not this function.
  oracleCouplings(arteryOffset) {
    return this.electrodePositions_mm().map((p) => { const g = this.electrodeGeometry(p, arteryOffset); return g.coupling * g.boneDamp; });
  }
}
