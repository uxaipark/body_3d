// Finger PPG ring model (index finger): red/IR absorption -> AC/DC ratio -> SpO2,
// using the standard empirical R-ratio calibration curve. Pulsatile AC component is
// driven by the propagated arterial pulse at the digital artery (longest path from
// heart), with posture-dependent perfusion (gravity effect on inflow/venous pooling).
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// 피부 광학 · 관류 레이어 (2026-08-25, ROADMAP §2.1-3) — ⚠ 정직성 노트, 반드시 함께 읽을 것
// ─────────────────────────────────────────────────────────────────────────────────────────────
// 이 파일의 광학/관류 계수는 **전부 모델 가정(문헌 보정 필요)** 이다. 문헌에서 가져온 값이 아니며,
// 인용 가능한 출처도 아직 없다. 특히 **모델이 내는 SpO₂ 편향 크기는 이 트윈의 가정값이지
// 임상적으로 검증된 추정치가 아니다** — 어디에서 인용하든 그렇게 표기할 것(UI 툴팁·문서·결과 파일).
//
// 왜 넣는가: 광학식 손가락 PPG의 **알려진 기기 한계 우려**(짙은 피부톤·저관류에서 맥박산소측정
// 정확도가 나빠질 수 있다는 우려, patent/01 §2 "광학 특성 의존")를 트윈 안에서 **재현 가능한
// 시뮬레이션**으로 만들어, 우리 알고리즘(특히 PPG 단독 추정기의 AC/DC 단서)이 그 조건에서 어떻게
// 무너지는지 시험하기 위한 것이다. 이 파일은 그 우려의 **정성적 방향**만 모델링하며, 임상 수치를
// 재현하거나 검증하지 않는다.
//
// (1) 멜라닌 — Beer–Lambert 일관성이 핵심이다. 표피 멜라닌은 입사·출사 두 번의 경로에서 Red(660 nm)를
//     IR(940 nm)보다 강하게 흡수하므로 **DC와 AC가 같은 계수로 함께 줄어든다** → 1차적으로는 R-비가
//     불변이고 광자 예산(=SNR)만 나빠진다. 이 파일은 그 1차 효과를 그대로 두고(DC 감쇠는 R에서 정확히
//     상쇄된다), 편향은 **2차 효과 하나**로만 만든다: 표피 흡수가 커질수록 진피 맥동층을 지나는 유효
//     광경로가 짧아지고 그 단축이 Red에서 더 크다는 가정(MEL_PATH_*). 그 결과 측정 R이 낮아져
//     SpO₂가 **높게** 읽힌다(= 짙은 피부에서 저산소증을 놓칠 수 있다는 우려의 방향). 크기(기본 가정:
//     Fitzpatrick VI에서 ≈ +1.2 %p)는 **선택한 가정값**이다.
// (2) 말초 관류·온도 — 손가락 온도 → 혈관운동 긴장도 → 관류지수(PI) → AC 진폭. 별도의 두 번째 긴장도
//     축을 만들지 않고 **기존 `arteryToneScalar`에 국소(손가락) 배수를 곱하는 방식**으로 붙였다.
//     기존 "저관류(차가운 손) AC ×0.35" 토글은 이 사슬의 20 °C 끝점으로 **정확히** 매핑된다.
// (3) 손가락 조직 경로 — `js/anthropometry.js`의 `deriveFingerOptics()`(체형 → 손가락 연부조직 두께,
//     효과는 의도적으로 작음)를 `setBodyOptics()`로 받는다. 기준 체형(170 cm/70 kg) → 정확히 ×1.
//
// **기본값 비트 동일성(필수)**: 기본 피부톤 FITZ_DEFAULT(3.5, I–VI의 중앙) · 기본 손가락 온도
// FINGER_TEMP_REF_C(33 °C) · 기준 체형에서 모든 신규 계수는 **정확히 1.0**(Math.exp(-0) === 1,
// Math.pow(x, 0) === 1)이고 곱셈 순서를 바꾸지 않았으므로 Red/IR/SpO₂ 스트림이 도입 전과 비트 동일하다
// (docs/CLINICAL_AUDIT.md §6.14의 sha256 증명 참조).
//
// 평가 전용 오버라이드 훅(브라우저에는 영향 없음): 환경변수 `DT_PPG_FITZ`(1–6) · `DT_PPG_TEMP_C`(20–36)를
// 주면 새로 만드는 모든 PpgSpo2Model의 기본값이 바뀐다 — `eval/esh_eval.mjs`처럼 광학 노브가 없는
// 하네스를 **수정하지 않고** 극단값 스윕을 돌리기 위한 것이다. 미설정 시 기본값 = 위의 비트 동일 지점.

import { ARTERIAL_PATH, findSegmentIndex, cumulativeDelay_s, amplificationFactor } from './anatomy.js';
import { deriveFingerOptics, referenceFingerOptics } from './anthropometry.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ── 피부 광학 · 관류 상수 — 전부 모델 가정(문헌 보정 필요) ───────────────────────────────────────
export const PPG_OPTICS = {
  // Fitzpatrick I–VI를 연속 파라미터로 다룬다. 기본 3.5 = I–VI의 산술 중앙 = 트윈의 기존(광학 중립) 지점.
  FITZ_MIN: 1, FITZ_MAX: 6, FITZ_DEFAULT: 3.5,
  // 정규화 멜라닌 지수 mel = (F − 3.5)/2.5 ∈ [−1(I), +1(VI)].
  FITZ_SPAN: 2.5,
  // 표피 왕복 흡수의 DC 감쇠 지수: DC_λ = exp(−K_λ·mel). Red(660 nm)가 IR(940 nm)보다 강하게 흡수된다는
  // **정성적** 사실만 사용했고(멜라닌 흡수는 파장이 길어질수록 가파르게 감소), 비 K_RED/K_IR = 2.5와
  // 절대 크기는 **자릿수만 맞춘 플레이스홀더**다. Fitz VI에서 DC Red ×0.58 / IR ×0.80, Fitz I에서 ×1.73 / ×1.25.
  MEL_DC_RED: 0.55, MEL_DC_IR: 0.22,
  // 맥동 유효 광경로 단축 지수: (AC/DC)_λ ×= exp(−P_λ·mel). 표피 흡수가 커질수록 진피 맥동층을 길게
  // 지나온 광자가 먼저 사라져 유효 경로가 짧아진다는 가정. **이 두 값의 차(P_RED − P_IR)만이 SpO₂ 편향을
  // 만든다** — 공통 성분(P_IR)은 AC/DC를 함께 낮출 뿐 R을 바꾸지 않는다.
  // P_RED − P_IR = 0.096은 "Fitz VI에서 모델 편향 ≈ +1.2 %p(SpO₂ 97.5 % 기준)"가 되도록 **선택한 가정값**이며,
  // 임상적으로 검증된 편향 추정치가 아니다.
  MEL_PATH_IR: 0.04, MEL_PATH_RED: 0.136,
  // 광자 예산 감소에 따른 부가 잡음(산탄잡음형): amp_λ = NOISE_REF·max(0, 1/√DC_λ − 1).
  // 기본 피부톤에서 정확히 0(트윈은 기본 상태에서 PPG 잡음 바닥이 없다 — 그래서 **증분**만 모델한다).
  // ⚠ **중요한 정직성 항목**: 이 잡음은 SpO₂에 위 경로 편향과 **반대 부호**로 작용한다. 코어의
  // `spo2_from_ppg`가 AC를 창 전체의 표준편차로 잡기 때문에(맥박 동기 추출이 아님) 부가 잡음이
  // AC를 위로 편향시키고, Red 쪽 잡음이 더 커서 측정 R이 올라가 SpO₂가 **낮게** 읽힌다.
  // NOISE_REF = 0.001은 "가정한 경로 편향이 순효과에서 지배적으로 남도록" 고른 값이며, 이 값을
  // 키우면 순 SpO₂ 편향의 **부호가 뒤집힌다**(측정: Fitz VI에서 0 → +1.05 %p, 0.001 → +0.92,
  // 0.002 → +0.56, 0.003 → +0.01, 0.006 → −2.60). 즉 **순 SpO₂ 편향 수치는 이 상수 선택에 강하게
  // 의존하며 견고한 결론이 아니다** — docs/CLINICAL_AUDIT.md §6.14의 한계 항목 참조.
  MEL_NOISE_REF: 0.001,
  // 부가 잡음의 대역: 1차 저역 통과(τ ≈ 50 ms, 코너 ≈ 3.2 Hz)로 맥파 대역에 걸치게 한다(백색잡음이면
  // 하류 대역통과에서 대부분 사라져 SNR 저하가 표현되지 않는다). 16 kHz 샘플 기준 상수.
  NOISE_TAU_S: 0.05,
  // 손가락 온도 → 관류. REF(33 °C) = 기존 동작과 비트 동일한 지점, COLD(20 °C) = 기존 "저관류(차가운 손)"
  // 토글의 AC ×0.35 지점. 두 점을 지수보간: perf(T) = 0.35^((33−T)/13) — 20 °C에서 정확히 0.35, 33 °C에서 정확히 1.
  FINGER_TEMP_MIN_C: 20, FINGER_TEMP_MAX_C: 36, FINGER_TEMP_REF_C: 33, FINGER_TEMP_COLD_C: 20,
  COLD_PERFUSION: 0.35,
};

// 피부톤 → 광학 계수. mel = 0(기본 3.5)에서 모든 계수가 **정확히 1.0**.
export function skinToneOptics(fitzpatrick = PPG_OPTICS.FITZ_DEFAULT) {
  const O = PPG_OPTICS;
  const mel = (clamp(fitzpatrick, O.FITZ_MIN, O.FITZ_MAX) - O.FITZ_DEFAULT) / O.FITZ_SPAN;
  const dcRed = Math.exp(-O.MEL_DC_RED * mel);
  const dcIr = Math.exp(-O.MEL_DC_IR * mel);
  const pathRed = Math.exp(-O.MEL_PATH_RED * mel);
  const pathIr = Math.exp(-O.MEL_PATH_IR * mel);
  return { mel, dcRed, dcIr, pathRed, pathIr, rGain: pathRed / pathIr };
}

// 모델이 내는 SpO₂ 편향(%p, + = 실제보다 **높게** 읽음) — **이 트윈의 가정값이며 임상 추정치가 아니다.**
// 측정 R = R_true·(pathRed/pathIr) 이고 SpO₂ = 110 − 25R 이므로 Δ = −25·R_true·(rGain − 1).
export function spo2BiasFromSkinTone(fitzpatrick = PPG_OPTICS.FITZ_DEFAULT, spo2Truth = 97.5) {
  const R = (110 - spo2Truth) / 25;
  return -25 * R * (skinToneOptics(fitzpatrick).rGain - 1);
}

// 손가락 온도 → 국소 관류 배수(1 = 기본 33 °C). 33 °C에서 정확히 1, 20 °C에서 정확히 0.35.
export function fingerPerfusionFactor(tempC = PPG_OPTICS.FINGER_TEMP_REF_C) {
  const O = PPG_OPTICS;
  const T = clamp(tempC, O.FINGER_TEMP_MIN_C, O.FINGER_TEMP_MAX_C);
  return Math.pow(O.COLD_PERFUSION, (O.FINGER_TEMP_REF_C - T) / (O.FINGER_TEMP_REF_C - O.FINGER_TEMP_COLD_C));
}

// 평가 전용 기본값 오버라이드(Node 한정; 브라우저에서는 항상 미설정).
const _env = (typeof process !== 'undefined' && process && process.env) ? process.env : {};
const _envNum = (k, lo, hi) => { const v = parseFloat(_env[k]); return Number.isFinite(v) ? clamp(v, lo, hi) : null; };
const ENV_FITZ = _envNum('DT_PPG_FITZ', PPG_OPTICS.FITZ_MIN, PPG_OPTICS.FITZ_MAX);
const ENV_TEMP = _envNum('DT_PPG_TEMP_C', PPG_OPTICS.FINGER_TEMP_MIN_C, PPG_OPTICS.FINGER_TEMP_MAX_C);

export class PpgSpo2Model {
  constructor() {
    this.baselineSpo2 = 97.5; // physiological TRUTH (SaO₂); R is derived from it — the measurement path is separate
    this.breathRate_Hz = 0.25; // ~15 breaths/min
    this.arteryToneScalar = 1.0;
    this.ageStiffness = 1.0;
    this.pwvGain = 1.0;
    // ---- skin-optics / perfusion layer (모델 가정 — 위 노트 참조) ----
    this.fitzpatrick = ENV_FITZ != null ? ENV_FITZ : PPG_OPTICS.FITZ_DEFAULT; // I–VI (연속), 기본 3.5 = 기존 동작
    this.fingerTemp_C = ENV_TEMP != null ? ENV_TEMP : PPG_OPTICS.FINGER_TEMP_REF_C; // °C, 기본 33 = 기존 동작
    this.tissueDcGain = 1; // 체형 → 손가락 연부조직 두께에 의한 DC 감쇠 (기준 체형 = 1)
    this.tissueAcGain = 1; // 같은 경로의 맥동분율 희석 (기준 체형 = 1)
    this._noiseState = { red: 0, ir: 0, s: 0x2f6e2b1 >>> 0 }; // 부가 광자잡음의 1차 필터 상태 + LCG 시드
    // Optional external noise / artifact sources (toggled from the UI)
    this.artifacts = { ambient: false, wander: false, motionGain: 1, lowPerf: false };
    // 마지막 샘플의 유도값(UI 읽기 전용 — 파형에는 영향 없음)
    this.lastPerfusionIndex = 0;
  }

  // 체형 → 손가락 연부조직 경로(js/anthropometry.js — 계수는 모델 가정). 기준 체형(170/70) → 정확히 1/1.
  setBodyOptics(height_cm = 170, weight_kg = 70) {
    const ref = referenceFingerOptics();
    const d = deriveFingerOptics({ height_cm, weight_kg });
    this.tissueDcGain = d.dcAtten / ref.dcAtten;
    this.tissueAcGain = d.acAtten / ref.acAtten;
    return d;
  }

  // Perfusion scalar vs hand height — MODEL ASSUMPTION (audit B): the literature is mixed (gravity raises
  // local arterial pressure but the veno-arteriolar reflex and venous pooling reduce the pulsatile
  // fraction), so the effect is kept small: ±10 % per 50 cm, sign = slight increase when dependent.
  _perfusionFactor(wristHeightDelta_cm) {
    const h = wristHeightDelta_cm / 100;
    return Math.max(0.8, Math.min(1.2, 1.0 + h * 0.2));
  }

  // 유효 손가락 온도: 기존 "저관류(차가운 손)" 토글은 사슬의 저온 끝점(20 °C)으로 매핑된다 —
  // 토글이 켜지면 슬라이더 값과 20 °C 중 더 찬 쪽을 쓴다(옛 상수 ×0.35가 정확히 재현된다).
  effectiveFingerTemp_C() {
    const O = PPG_OPTICS;
    const T = clamp(this.fingerTemp_C, O.FINGER_TEMP_MIN_C, O.FINGER_TEMP_MAX_C);
    return this.artifacts.lowPerf ? Math.min(T, O.FINGER_TEMP_COLD_C) : T;
  }

  // 파형 생성 없이 유도값만 — UI 읽어내기용. **spo2Bias_pp 는 모델 가정이지 임상 추정치가 아니다.**
  opticsReadout() {
    const o = skinToneOptics(this.fitzpatrick);
    const perf = fingerPerfusionFactor(this.effectiveFingerTemp_C());
    const dcIr = o.dcIr * this.tissueDcGain;
    return {
      fitzpatrick: this.fitzpatrick, fingerTemp_C: this.effectiveFingerTemp_C(),
      dcRed: o.dcRed * this.tissueDcGain, dcIr,
      acDcGain: o.pathIr * this.tissueAcGain, // IR AC/DC 변화(광학만; 관류 항 제외)
      perfusionFactor: perf, localToneFactor: 1 / perf,
      perfusionIndex: this.lastPerfusionIndex,
      spo2Bias_pp: spo2BiasFromSkinTone(this.fitzpatrick, this.baselineSpo2),
      // 산탄잡음 한계 가정에서의 광자 예산 변화(IR): SNR ∝ √DC → dB = 10·log10(DC).
      snrPenalty_db: 10 * Math.log10(Math.max(1e-6, dcIr)),
    };
  }

  // 광자 예산 감소분에 해당하는 대역제한 부가 잡음(기본 피부톤에서 진폭이 정확히 0 → 비트 동일).
  _photonNoise(dcRed, dcIr) {
    const O = PPG_OPTICS;
    const aRed = O.MEL_NOISE_REF * Math.max(0, 1 / Math.sqrt(Math.max(1e-6, dcRed)) - 1);
    const aIr = O.MEL_NOISE_REF * Math.max(0, 1 / Math.sqrt(Math.max(1e-6, dcIr)) - 1);
    if (aRed <= 0 && aIr <= 0) return { red: 0, ir: 0 };
    const N = this._noiseState;
    const alpha = (1 / 16000) / O.NOISE_TAU_S; // 16 kHz 엔진 그리드 기준 1차 저역 계수
    const gain = Math.sqrt((2 - alpha) / alpha); // 필터 후 단위 표준편차가 되도록 정규화
    const u = () => { N.s = (N.s * 1103515245 + 12345) & 0x7fffffff; return N.s / 0x7fffffff - 0.5; };
    N.red += alpha * (u() * 3.4641016151377544 - N.red); // ×√12 → 균등분포를 단위 분산으로
    N.ir += alpha * (u() * 3.4641016151377544 - N.ir);
    return { red: aRed * gain * N.red, ir: aIr * gain * N.ir };
  }

  sample(t, cardiac, wristHeightDelta_cm, motionLevel = 0, hydroWrist_mmHg = 0) {
    const fingerIdx = findSegmentIndex('digital_finger');
    const delay_s = cumulativeDelay_s(fingerIdx, this.arteryToneScalar, this.ageStiffness, this.pwvGain, hydroWrist_mmHg);
    const amp = amplificationFactor(fingerIdx);
    const pulse_mmHg = cardiac.pressureAt(t - delay_s);
    const pp = Math.max(1, cardiac.sbp - cardiac.dbp);
    const pulseNorm = (pulse_mmHg - cardiac.dbp) / pp;

    const perfusion = this._perfusionFactor(wristHeightDelta_cm);
    const breathMod = 1 + 0.06 * Math.sin(2 * Math.PI * this.breathRate_Hz * t);

    // Baseline (DC) absorption differs between wavelengths; AC is pulsatile fraction of DC.
    // Pulsatile volume ∝ pulse pressure × peripheral compliance (vasoconstriction → smaller AC).
    // 피부톤(멜라닌) → 표피 왕복 흡수 → DC 감쇠(Red > IR). Beer–Lambert 일관: DC와 AC가 같은 계수로
    // 줄어들므로 이 항 자체는 측정 R에서 상쇄된다(편향은 아래 path* 차이에서만 나온다).
    const optics = skinToneOptics(this.fitzpatrick);
    const dcRed = optics.dcRed * this.tissueDcGain;
    const dcIr = optics.dcIr * this.tissueDcGain;
    const A = this.artifacts;
    // 손가락 온도 → 혈관운동 긴장도 → 관류. 별도 축을 만들지 않고 **국소 배수**로 기존 tone에 곱한다:
    // localTone = arteryToneScalar × (1/perf). 기본 33 °C → perf = 1 → localTone === arteryToneScalar.
    const perfScale = fingerPerfusionFactor(this.effectiveFingerTemp_C());
    const acFraction = 0.02 * amp * perfusion * perfScale * breathMod * pulseNorm * (pp / 42) / this.arteryToneScalar * this.tissueAcGain;
    // Ambient-light interference (120 Hz flicker from mains-driven lighting) and baseline wander
    const ambient = A.ambient ? 0.006 * Math.sin(2 * Math.PI * 120 * t) : 0;
    const wander = A.wander ? 0.012 * Math.sin(2 * Math.PI * 0.3 * t + 1.1) + 0.006 * Math.sin(2 * Math.PI * 0.07 * t) : 0;
    motionLevel = motionLevel * (A.motionGain || 1);

    // SpO₂ truth = SaO₂ (slow physiological drift around the baseline); the Red/IR amplitude ratio R is
    // DERIVED from it by inverting the empirical calibration curve (SpO₂ ≈ 110 − 25R, valid ≈ 85–100 %).
    // Motion / ambient / wander corrupt ONLY the measured waveforms, never the truth (audit B-8).
    const spo2 = Math.max(70, Math.min(100, this.baselineSpo2 + 0.4 * Math.sin(2 * Math.PI * 0.02 * t)));
    const R = (110 - spo2) / 25;
    // 변조 깊이 (AC/DC). path* = 멜라닌에 따른 맥동 유효 광경로 단축(Red가 더 큼) → 측정 R 편향의 유일한 원천.
    const acDcIr = acFraction * optics.pathIr;
    const acDcRed = acFraction * R * optics.pathRed;

    // Motion artifact: corrupts red and IR differently (different optical paths) → measured R drifts
    const motionArtifact = motionLevel * 0.01 * Math.sin(t * 37 + 1.2);
    // 부가 광자잡음(피부톤에 따른 광자 예산 감소분; 기본 피부톤에서 정확히 0).
    const shot = this._photonNoise(dcRed, dcIr);
    // 주변광·기저선 변동·동작 항은 DC와 함께 축소되지 **않는다** — 검출기 입력 기준의 가산 성분이라는
    // 가정이며, 그 결과 DC가 낮을수록(짙은 피부·두꺼운 조직) 상대 아티팩트가 커진다(= SNR 저하).
    const red = dcRed * (1 + acDcRed) + motionArtifact + ambient + wander + shot.red;
    const ir = dcIr * (1 + acDcIr) + motionArtifact * 0.8 + ambient * 0.9 + wander + shot.ir;

    this.lastPerfusionIndex = Math.abs(acDcIr) * 100;
    return { red, ir, spo2, perfusionIndex: this.lastPerfusionIndex };
  }
}
