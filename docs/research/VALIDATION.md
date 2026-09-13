# 통합 확인 — 2026-09-13

- `npx tsc --noEmit`: 성공.
- `npm test`: 85/85 성공(기존 79 + 손목 통합 6).
- `node scripts/validate-section-shaders.mjs`: 138개 vertex/fragment shader 오프라인 컴파일 성공.
- GLTFLoader로 손목 GLB 직접 파싱: 127개 메시, 각 계통 metadata 확인.
- TwinEngine → acquisition frames → 기존 WASM 코어, 6.4초 입력에서 MRC 및 feature 결과 반환 확인. 임상 정확도 시험이 아님.
- `npm run build`: 4개 route 포함 성공. 기존 큰 3D chunk 경고 있음.
- 로컬 HTTP: `/`, `/simulators/body`, `/simulators/wrist`, `/research`, iframe index/main/bridge, 손목 GLB, 연구 README, WASM 모두 200. 홈에서 실제 hub 문구 확인.
- 가져온 51개 JS 파일의 상대 module path 존재 확인.
- `git diff --check`: 성공.

브라우저에서 직접 조작한 시각 QA와 실기기 FPS 측정은 이번 확인에 포함하지 않는다. FPS 보장이나 의학적 정확도 검증을 위 결과에서 추론하지 않는다. 소스의 해부학 정렬과 원본 간격, 조직 물성 가정, 기존 역모델 재교정 필요성은 공개 연구 문서에 명시했다.

## 메뉴 이동 및 배포 환경 오류 수정

- 메뉴·썸네일·열기 링크를 기본 HTML 링크로 변경하여 독립 시뮬레이터를 문서 탐색으로 연다.
- 전신 페이지의 배포 Worker에서 `DRACOLoader`의 모듈 초기화 중 `Invalid URL string`으로 HTTP 500이 발생함을 재현했다. 기존 개발 서버 HTTP 확인으로는 발견되지 않았던 오류다.
- 서버에서도 사용하는 계통 설정을 순수 모듈로 분리하고, 3D 엔진은 뷰포트 마운트 후 동적으로 불러온다. 로딩 중 설정 변경과 언마운트도 처리한다.
- 프로덕션 빌드 후 Wrangler를 새로 시작하여 `node scripts/check-workspace-routes.mjs`로 네 경로의 HTTP 200, 실제 화면 콘텐츠, 메뉴 목적지를 확인한다. 브라우저 클릭/렌더링 검증을 대체하지는 않는다.

## 손목 앉기 자세와 요골동맥 표시 수정

- 손목 Avatar의 앉기 포즈를 의자 동작의 0초(기립)에서 2.5초(앉은 상태 유지 구간)로 변경했다. 기존 의자 접촉·발 고정·피부 리깅을 그대로 사용한다.
- 배포용 bridge를 직접 불러오는 회귀 테스트로 1/10/120초의 착석 유지, 양쪽 무릎 굴곡, 발 고정, 피부 포즈 동기화, 서기로 복귀 및 의자 표시를 검증했다. 전체 86개 테스트 성공.
- 단면의 동맥 중심을 따라가는 붉은 표식·연결선·이름표를 추가했다. TOP에서는 피부 표면에 투영한 위치를 ‘피부 아래’로 명시한다. 독립 iframe에서도 라벨 캔버스가 3D 화면 위에 배치되도록 스타일을 자체 포함한다.
- TypeScript 검사와 bridge·사이트 빌드 성공. 브라우저 시각 QA는 포함하지 않았다.
