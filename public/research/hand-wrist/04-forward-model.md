# 04. 정방향 시뮬레이터 아키텍처

## 구현된 축약 모델

혈관·조직·전극의 실제 인과 관계를 실험하기 위한 첫 단계다. 다음 식의 물성·경계 조건은 보정 가능한 모델 가정이다.

```
Cardiac pressure(t) + vascular delay + hydrostatic offset
  → ΔP(t), distensibility, contact/preload
  → Δr_target = r0 × 133.322 × ΔP / (2 ρ PWV²)
  → Δr[n] = Δr[n−1] + (Δr_target−Δr[n−1]) × (1−exp(−Δt/τ))
  → signed surface transfer(depth, lateral distance, fat) × Δr
  → finite pad footprint + support/contact/patch rocking
  → ΔC = effective sensitivity[pF/mm] × displacement[mm] × areaScale
  → original electronics/noise/saturation model → acquisition channels
```

Bramwell–Hill의 작은 변형 관계에서 원형 단면 반경 민감도를 유도했다. ρ=1060 kg/m³, 기준 PWV=6 m/s, r0=1.1 mm, τ=0.018 s, 유효 정전용량 감도=11.15 pF/mm를 사용한다. 원래 엔진의 stiffness/PWV distensibility가 추가 적용되므로 해당 배율을 다시 PWV²에 중복 반영하지 않는다. 큰 압박·혈관 허탈·비선형 벽 응답은 이 선형 반경 근사의 유효 범위 밖이다.

표면 커널은 두 Gaussian의 차로 직상부 상승과 주변 하강을 나타낸다. 이는 선택한 지지·접촉 조건을 표현한 가정이다. ‘조직이 비압축성이라 피부 면적 적분은 반드시 0’이라는 주장을 하지 않는다. 동맥 내부 체적은 실제로 늘고, 주변 조직의 축방향·깊이 방향 유출과 경계가 결과를 결정한다.

시간 이완 상태는 채널별 취득 샘플 index에 귀속된다. 같은 sample index의 반복 질의가 물리를 다시 진행시키지 않는다. 원본의 영위상 mechanical shaping은 이 분기에서 우회한다. 합성 엔진의 타임스탬프는 그대로이며 미래 샘플로 현재 이완을 계산하지 않는다.

화면은 `latest.tissue`의 반경 변화와 채널 표면 변위를 전달받는다. 3D 피부·지방·근육·혈관에는 동일한 형태의 주변 변위장을 적용하고, 뼈 메시를 변형하지 않는다. 새 단면 모드의 CPU/GPU 변위는 같은 축약 관계를 사용한다. 레이어 중첩, bone support 근사, 유한 패드 평균·접촉은 표시 표면의 한 점과 정확히 같지 않을 수 있다. 이 단계는 FEM의 완전한 응력장이나 접촉 보존 해법이 아니다.

## 목표 정방향 모델

| 블록 | 입력/출력 | 구현 전략 |
|---|---|---|
| 심장 | HR/RR, SV, TPR, PEP → central flow/pressure, ECG | 기존 cardiac 코어와 독립 ECG 발생기. ECG R과 aortic opening을 따로 보유 |
| 혈관망 | 중심선·분지·벽·말단 저항 → 압력·유량·반사파 | 1D 혈역학 + 국소 compliant wall. 경계는 측정/문헌 후 보정 |
| 연부조직 | Δr, tendon sliding, preload → displacement/stress/contact | 오프라인 nearly-incompressible hyperelastic + viscoelastic 해석, 온라인 ROM/LUT |
| 전기장 | geometry, gap, sweat, dielectric, guard → capacitance matrix Cij | 오프라인 electrostatic FEM/BEM; guarded/self/mutual topology별 LUT |
| 광학 | μa, μs′, g, n, Hb/HbO₂, LED/PD → Red/IR photons | 분할 체적 Monte Carlo, 이후 유효 transfer LUT |
| 센서/ADC | drive, charge noise, LED multiplex, clipping, skew → raw counts | 실제 AFE 회로·스캔 표와 비교, 하드웨어 시간 기록 |
| 분석 | 관측 채널·ECG·타임스탬프·calibration → BP/SpO₂/quality | truth 접근 금지, 별도 평가기 |

피부·지방은 거의 비압축성이어도 이방성, 섬유 격막, 건초의 미끄럼과 마찰이 중요하다. 뼈는 강체, 힘줄은 장축 인장과 횡방향 접촉을 나누고, 관절은 축/제한으로 움직인다. 초기 골격 경계 위에 무조건 근육이나 지방을 균일 축소한 레이어를 겹치지 않는다.

정전용량 `C=εA/d`는 이상적인 평행판 기준식이다. 손목 곡면·프린징·가드·인접 채널 mutual capacitance·전극–피부 공극에는 행렬 Cij가 필요하다. 현재 11.15 pF/mm는 유효 감도이고 실제 FDC/CDC 보정 계수라고 주장하지 않는다.

광학은 반사형 손목과 투과형 손가락을 분리한다. 빛이 지방까지 내려가는 경로와 표재 혈관총에서 돌아오는 경로의 비율은 파장·간격·조직 흡수/산란에 따라 달라진다. 모든 경로가 주 요골동맥을 관통하도록 강제하지 않는다. MCX를 후보 정방향 해석기로 삼고 수렴·경계·에너지 시험 후 표 형태로 웹에 가져온다. [MCX 공식 프로젝트](https://mcx.space/).

## 전극 배열

첫 하드웨어 프리셋은 3행×4열, 패드 3×3 mm, gap 0.5 mm, pitch 3.5 mm, 중간 행 half-pitch stagger다. 총 면적은 좌표에서 산출한다. 일반 4열 너비 13.5 mm, 세 행 높이 10 mm이며 한 행을 1.75 mm 이동하면 bounding width가 15.25 mm가 될 수 있다. 기판 여백/실드/패키지 치수와 전극 footprint를 섞지 않는다.

채널 이름과 ADC 스캔 index는 별개다. 원본 문서의 위/가운데/아래 이름은 각각 `C1 B0 B1 A6`, `C0 C2 B5 B2`, `B6 B3 B4 C3`이며, 실제 `electrodeLayout.js` 행 원점은 근위→원위 방향이다. 회로 핀·좌/우 착용·거울 좌표를 별도 매핑한다.

## 시간축과 실행 위치

- Acquisition: integer sample index + monotonic master clock. 장치 시계 epoch, offset, drift, per-channel ADC skew를 기록한다.
- CAP 실제 샘플링: 대표 1 kHz, 하드웨어가 허용하면 2 kHz 등 비교. 16 kHz ZOH를 16 kHz 독립 측정으로 해석하지 않는다.
- ECG와 Red/IR은 각 native timestamp를 보존한다. resampling은 소스 rate·필터 지연·오차를 메타데이터에 남긴다.
- 온라인 분석: Worker/WASM. 렌더 30–60 fps, 그래프 decimation, 숨겨진 탭은 작업량 제한. 해석 상태는 렌더 빈도에 종속시키지 않는다.
- FEM/Monte Carlo: 오프라인. 온라인 ROM 평가와 검증 범위 밖 입력 감지를 제공한다.

새 계약은 [acquisition-frame.schema.json](acquisition-frame.schema.json)을 따른다. 현재 기존 Rust 프레임을 즉시 변경하지 않았으며 이 스키마는 ECG 확장을 위한 v2 설계다. `truth`는 시뮬레이터 전용 별도 버퍼/파일에 두고 estimator 입력 스키마에 넣지 않는다.
