# 06. 검증 계획과 단계별 완료 조건

## 이번 구현의 확인 범위

- 기존 SOMA 79개 테스트 통과: 리그·보행·달리기·피부 바인딩·머리 안정·손바닥·의자·침대·폐·심장·혈관·피부 단면 등.
- 새 6개 테스트 통과: 인과적 이완의 해석적 step response/중복 sample 동결, PWV² 단위 관계, 상승/하강 변위, atlas 깊이의 실제 CAP 경로 반영, 지방 변경 시 실제 채널 변화와 타임스탬프 보존, 29개 골격 및 WASM 구조 검증, 단면/등고선/해부학 모드 전환 계약.
- TypeScript 검사 통과. 138개 지역 단면 vertex/fragment shader를 오프라인 GLSL 컴파일러로 확인했다. 새 GLB 127개 메시의 실제 브라우저용 loader 파싱과 6.4초 합성 데이터를 통한 기존 WASM 분석 결과 반환을 확인했다.
- 이것은 수치/소프트웨어 동작 확인이다. 임상 accuracy, 인체 tissue modulus, photon transport, BP 오차 기준을 통과한 검증은 아니다.

## 검증 행렬

| 계층 | 기준/시험 | 완료 조건(제안) |
|---|---|---|
| 해부학 | 동시 CT/MRI/US, 구조별 segmentation 검토 | 좌표·좌우·단위 확인, landmark error와 surface distance 분포, 혈관 법선 깊이·지름과 측정 오차 표시 |
| 메시 | self-intersection, watertightness, Jacobian, min element angle | solver에서 뒤집힌 요소 없음, 경계 조건·분할 불확실성 기록 |
| 기계 | pressure–diameter curve, US displacement/strain, contact force | 주파수별 진폭·위상·상승/주변 하강을 독립 자료와 비교; ROM/FEM 오차와 적용 범위 정의 |
| 전극 | bench phantom, micromotion, impedance/CDC count | 각 패드 Cij·가드·온도·수분·gap·preload sensitivity를 독립 확인 |
| 시간축 | 공통 trigger, channel scan metadata, known delayed phantom | 동기·skew·clock drift 보정 잔차가 목표 PTT보다 충분히 작음; 미달 시 PTT invalid |
| MRC/MVDR | 알려진 지연과 상관잡음, signed channel, motion seed, rank loss | SNR만 아니라 fiducial bias, waveform distortion, latency, rejection/coverage 보고 |
| SpO₂ | optical phantom + 적절한 SaO₂ 참조 자료 | 부위·색소·저관류·동작별 bias/precision 및 결측률; 모델 생성/역추정 데이터 분리 |
| BP | 독립 피험자·세션·재착용·다른 장치, 유효 참조 혈압 | calibration-only baseline 대비 성능, within/between subject, 추세·absolute·drift·coverage 모두 보고 |
| 웹 | representative desktop/mobile workload | render/analysis cadence·memory·load time·dropout 측정; 해석 원본 샘플 유실 없이 UI 부하 제한 |

오차 목표의 숫자는 실제 사용 목적과 장치 분해능을 정한 뒤 freeze한다. 가령 0.5 ms 국소 지연을 목표로 하면 1 ms timestamp quantization 자체가 지배적일 수 있다. 단순 FPS 목표를 달성했다고 시간 측정 정확도가 확보되는 것은 아니다.

## 시나리오

휴식, 느린 호흡, 기립/앉기, 손 쥐기와 풀기, 손목 굴곡/신전, 전완 회내/회외, 손목 높이 변화, 보행/달리기 및 회복, 눕기, preload sweep, 미끄러짐, 채널 dropout, 낮은 관류, 색소/온도 변화, 부정맥, 혈관 stiffness/PEP 독립 변화, 장시간 drift를 포함한다. 생리 조건과 sensor artifact를 각각 바꾸는 factorial 실험을 우선한다.

BP ground truth가 바뀌지 않는 상태의 HR/PEP 변화에서 BP가 잘못 흔들리는지, 반대로 HR이 일정한 상태의 BP 변화를 검출하는지 확인한다. 같은 synthetic forward equation을 training과 testing에 공유하는 결과는 inverse-model self-consistency로만 보고한다.

## 단계

| 단계 | 산출물 | 완료 기준 |
|---|---|---|
| A. 이번 통합 | hub, native 전신/손목, ROM 채널 결합, 기록 | 앱 경로와 자산, 기존 기능, 생성 신호 테스트 및 빌드 |
| B. 해부학 보정 | 동일 피험자 US 단면/동맥 중심선/건 위치, atlas 정합 | 피부 법선 깊이와 실제 센서 위치 오차를 수치화, atlas 대표값과 개인값 분리 |
| C. 센서 forward | mechanical/electrostatic phantom, ROM LUT | 독립 진폭·위상·contact/curvature 검증, parameter confidence/provenance |
| D. 분석 코어 | causal preprocessing, MRC/MVDR, timing-preserving dual beam, ECG frame | truth 없이 실행, known-delay tests, 복소 convention/불안정 공분산/실시간 latency 검증 |
| E. 광학 | wrist reflectance/finger transmittance, MCX LUT, calibration | 에너지/mesh/photon 수렴, 부위별 ratio calibration 독립 평가 |
| F. BP 검증 | calibration protocol, independent cohort/sessions/devices | PEP·운동·자세·재착용·시간 drift에 대한 보고, 실패 시 출력 거부 |

## 승인 없이 구현 가능한 다음 작업과 외부 의존성

소프트웨어 schema, tests, adapter, MRC/MVDR 코어 이식, simulation scenario는 현재 코드 기반에서 진행할 수 있다. 환자별 구조·조직 물성과 임상 accuracy의 개선은 실제 US/ECG/전극 기록 및 참조 측정에 의존한다. 이런 자료가 없는 상태에서 정상 인체 전체의 미세 구조나 혈압 정확도를 확정할 수 없다.
