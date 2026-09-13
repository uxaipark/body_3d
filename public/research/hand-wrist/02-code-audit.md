# 02. 기존 CBP 코드 감사 및 통합

## 조사 범위

원본: `/Users/elliotpark/dev/biosignal/cbp_algorithm`.

| 파일/모듈 | 확인한 기능 | 통합 판단 |
|---|---|---|
| `research/digital-twin/js/engine.js` | 16 kHz master clock, cardiac·CAP·PPG·IMU·EMG, ring buffers | 이번 화면에서 재사용 |
| `engineClient.js`, `engineWorker.js` | 256 master sample 블록, UI 분리, transfer/ACK | 유지; 조직 상태는 `latest.tissue`에 추가 |
| `capacitiveArray.js` | signed 공간 커널, 유한 패드, 접촉, rocking, ADC/스캔 skew, noise | 인과적 해부학 ROM 분기 추가; 기존 연구 경로를 삭제하지 않음 |
| `cardiac.js`, `anatomy.js` | 압력 파형, Windkessel 형태, 혈관 경로, PWV·정수압 | 재사용. 계수의 근거와 적용 범위는 별도 보정 필요 |
| `ppgSpo2.js` | Red/IR, ratio, 색소·관류·온도 조건 | 재사용. 실제 photon transport 또는 기기별 임상 교정은 아님 |
| `beamform.js` | blind signed MRC 3회 반복, oracle 진단, 공간 탐색 | 기존 웹 Rust/WASM 분석과 함께 유지 |
| `analysis/core.js`, `rust/dt-core` | 채널 분석, MRC, 지연, BP/SpO₂ | 원본에서 Rust가 주 구현. 웹 번들에는 기존 WASM 바이너리 유지 |
| `bpEstimator.js` | 합성 정방향 관계 기반 BP 추정법 비교 | 원래 모델에 대한 비교 기능; 이번 역학 변경 후의 역모델 교정/성능은 미검증 |
| `electrodeLayout.js` | 최대 48개, grid/stagger/custom, 3×4 프리셋 | 유지 |
| `sources/` | 가상 취득/기록/재생 프레임 | 개인 원시 기록을 배포물에 넣지 않음 |
| `cbp_sensing/beamforming/core/advanced_beamforming.py` | MVDR/robust Capon/eigenspace/subband, ECG R·PAT, BP smoothing | 설계 참조. 이번 웹판으로 이식하지 않았음 |

## 기존 구현에서 유지할 것과 주의할 것

`beamform.js::analyze`의 blind MRC 가중치는 참조 파형을 입력으로 사용하지 않는다. 같은 함수에 들어오는 `ref`는 oracle/SNR 진단에 쓰인다. 후속 프레임 계약에서는 estimator 입력과 evaluator의 truth를 물리적으로 분리한다.

Python `BeamformingConfig`의 `pulse_wave_velocity_units=12`는 추상 좌표/초다. SI 단위 m/s인 PWV로 해석하거나 손목 3.5 mm 피치에 그대로 넣으면 안 된다. `make_steering_vector`의 유클리드 거리/위상은 실제 혈관 중심선과 조직 전달함수 기반으로 바꿔야 한다.

Python의 `subband_mvdr`와 일부 전처리는 `sosfiltfilt`를 사용한다. 오프라인 분석과 실시간 인과적 추정 경로를 나눈다. 복소 MVDR 이식 시 `y=wᴴx`의 공액 방향을 명시하고 단위 테스트로 확인한다. 코드를 읽어 발견한 확인 항목이며, 현재 Python 결과 전체가 잘못됐다고 단정하는 것은 아니다.

원본 CAP의 채널별 기계 크기 필터는 현재 기본이 영위상이며 미래 압력 질의를 이용한다. 이번 해부학 ROM에서는 이 필터를 우회하고, 압력에 따른 반경 변화를 18 ms 대표 시정수로 인과적으로 이완한다. 이 시정수는 실측의 위상 검증값이 아니다. 기존 amplitude-fit 결과를 이 새로운 지연의 근거로 사용하지 않는다.

원본 `docs/ptt_feasibility.md`, `docs/PIPELINE.md`는 해당 기록/하드웨어에서 작은 국소 PTT보다 채널 형태 편향이 크다고 보고한다. 3.5 mm, 5–10 m/s일 때 전파 지연은 0.35–0.7 ms인 반면, 기록의 채널 foot 차이는 수–수십 ms였다. 이는 모든 하드웨어의 국소 PTT가 원리상 불가능하다는 의미가 아니다. 자료의 표본 수, 시간 구간, 기준 혈압 수를 숨기지 않아야 한다.

## 이번에 바뀐 코드

- `js/avatar.js` → `bridge/soma-bridge.js`: SOMA 전신 GLB·관절·피부를 그대로 사용한다.
- `js/wrist3d/nativeAtlas.js`: 전신 아틀라스에서 추출한 오른손/원위 전완, 레이어·국소 지방 경계와 맥동 변위.
- `js/atlasProfile.js`: 실제 피부와 요골동맥 메시에서 추출한 24개 좌표 샘플, 보간 함수. 깊이는 뷰의 volar 축 방향 간격이며 최단 법선 깊이나 초음파 깊이와 같다고 볼 수 없다.
- `js/wristMechanics.js`: 단위가 명시된 반경 압력 민감도, 부호 있는 표면 변위, 주변 조직 변위, 인과적 이완.
- `capacitiveArray.js`: native artery 경로와 조직 결합을 채널 생성에 사용. 패드 면적·접촉·본래 노이즈가 뒤따른다.
- `engine.js`: 샘플 시점 조직 반경/표면 변위를 worker → 화면으로 운반한다.
- `lib/skin-section-model.ts`: 새 손목 창에만 공통 ROM의 CPU/GPU 변위를 선택 적용. 기존 전신 피부 단면은 종전 변형을 유지한다.

3D 창의 조직 확대는 화면에만 적용된다. 16 kHz는 master 시간 표현이며 기본 1 kHz CAP ADC의 정보량을 늘리지 않는다. 화면용 decimation 파형을 다시 PTT 분석 원본으로 쓰지 않는다.

## 재현

앱 루트에서:

```sh
node scripts/research/build-wrist-atlas.mjs
node scripts/research/build-bridge.mjs
npx tsc --noEmit
npm test
npm run build
```

가져온 원본 파일 SHA-256은 `/simulators/radial/source-manifest.json`, 추출된 구조 목록은 `/models/wrist/manifest.json`이다. 가져온 코드 스냅샷을 일괄 덮어쓰면 이번 변경을 지우므로 upstream 갱신은 두 파일의 해시 비교와 Git diff를 검토하며 병합한다. 원본의 NC 선택형 손 GLB와 개인 손 사진은 배포하지 않는다. 사진 기반 2D 디자인 배경은 제외하고 계측 단위 기반 패치 캔버스는 유지한다.
