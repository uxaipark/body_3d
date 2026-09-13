# 통합 확인 — 2026-09-13

- `npx tsc --noEmit`: 성공.
- `npm test`: 84/84 성공(기존 79 + 손목 통합 5).
- `node scripts/validate-section-shaders.mjs`: 138개 vertex/fragment shader 오프라인 컴파일 성공.
- GLTFLoader로 손목 GLB 직접 파싱: 127개 메시, 각 계통 metadata 확인.
- TwinEngine → acquisition frames → 기존 WASM 코어, 6.4초 입력에서 MRC 및 feature 결과 반환 확인. 임상 정확도 시험이 아님.
- `npm run build`: 4개 route 포함 성공. 기존 큰 3D chunk 경고 있음.
- 로컬 HTTP: `/`, `/simulators/body`, `/simulators/wrist`, `/research`, iframe index/main/bridge, 손목 GLB, 연구 README, WASM 모두 200. 홈에서 실제 hub 문구 확인.
- 가져온 51개 JS 파일의 상대 module path 존재 확인.
- `git diff --check`: 성공.

브라우저에서 직접 조작한 시각 QA와 실기기 FPS 측정은 이번 확인에 포함하지 않는다. FPS 보장이나 의학적 정확도 검증을 위 결과에서 추론하지 않는다. 소스의 해부학 정렬과 원본 간격, 조직 물성 가정, 기존 역모델 재교정 필요성은 공개 연구 문서에 명시했다.
