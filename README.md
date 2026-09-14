# SOMA — 바이오센싱 디지털 트윈

전신 해부학과 손목 센싱을 탐색하는 React·Three.js 연구 시뮬레이터. 현재 외피는 BodyParts3D 아틀라스의 `skin-atlas-web.glb`입니다. 과거 MakeHuman 외피는 현재 뷰어에서 사용하지 않습니다.

## 로컬 데모

배포용 폴더의 `Install-macOS.command` / `Install-Windows.cmd` / `Install-Linux.sh`로 전용 Node와 서버 패키지를 설치하고, 같은 OS의 Start 파일로 실행합니다. 기본 주소는 `http://127.0.0.1:3000`입니다.

[운영체제별 설치·실행 안내](docs/operations/demo-guide.md) · [검증 결과와 패키징](docs/operations/demo-validation.md)

## 개발 환경

Node.js 24.21.0 권장. 프로젝트 루트인 `web`에서 실행합니다.

```sh
npm ci
npm run dev
```

```sh
npm test
npx tsc --noEmit
npm run build
npm run start -- --port 4320
```

빌드는 매뉴얼 콘텐츠와 Cloudflare Worker·클라이언트 자산을 생성합니다. 손목 bridge를 변경하면 먼저 `node scripts/research/build-bridge.mjs`를 실행합니다. 모델 재생성은 별도의 Blender/Python 파이프라인이며 일반 설치에 필요하지 않습니다.

## 데모 배포 폴더 만들기

```sh
npm run build
npm run demo:prepare
python3 scripts/demo/archive-demo.py ../demo/soma-demo
```

기본 결과는 소스와 분리된 `../demo/soma-demo`와 ZIP입니다. 다른 경로는 `npm run demo:prepare -- /path/to/soma-demo`로 지정합니다. 인증 정보·`.env`·Sites 설정·설치된 OS별 패키지는 ZIP에 포함하지 않습니다.

## 기능과 문서

- 전신: 계통별 투명도, 근육·피부, 공통 보행, 일어서기·반복·손 쥐기·침대 작업, 국소 피부 단면.
- 손목: 아틀라스 해부학, 곡면 패치, 요골동맥 연결·맥동·주변 변위, 정전용량/PPG 합성 신호와 분석.
- `/manual`: 설치와 조작을 설명하는 웹 사용자 매뉴얼.
- [docs 목차](docs/README.md): 현재 구현, 재생성 절차, 과거 자산 기록.
- [문서 점검 기록](docs/operations/documentation-audit.md): 원본·생성본 분류와 정정 근거. `npm run docs:check`로 상대 파일 링크와 매뉴얼 동기화를 검사합니다.
- [연구 기록](public/research/hand-wrist/README.md): CBP 확장, MRC/MVDR·ECG-PAT 계획과 검증 범위.

형상·변형·신호에는 대표값과 축약 모델이 포함됩니다. 모든 미세혈관·신경을 재현하거나 환자별 FEM/혈류/광학·임상 정확도를 검증한 모델은 아닙니다. 구현된 기능과 향후 확장 계획은 연구 기록에서 구분합니다.

모델·동작 자산의 라이선스는 [ATTRIBUTION](public/models/ATTRIBUTION.md)와 [동작 출처](public/motions/ATTRIBUTION.md)를 참조하세요.
