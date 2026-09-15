# 한국어·영어 지원

2026-09-15. 상단 한국어 / EN 선택은 `soma_language` 쿠키에 1년 저장한다. 같은 브라우저의 메뉴 이동·새로고침에 적용하며 기본 언어는 한국어다. 전환은 현재 경로와 해시를 유지한 페이지 재로드다. 실행 중 시뮬레이션은 초기화되므로 필요한 데이터는 먼저 내보낸다.

## 구성

- `app/language.tsx`: React 언어 컨텍스트, 표시 문구 컴포넌트, 언어 선택. 이벤트·모델 값·ID·URL은 번역하지 않는다.
- `lib/i18n/server.ts`: 요청 쿠키로 서버 렌더링 언어를 결정한다. HTML lang·메타데이터·문서 본문에 적용한다.
- `locales/en.json`: 한국어 원문을 키로 사용하는 영어 UI 사전. `public/i18n/messages.js`는 생성물이다.
- `public/i18n/locale.js`: 명시적인 React 표시와 손목 엔진의 텍스트·HTML·캔버스 출력에서 공유한다. 전역 DOM 감시나 신호 데이터 변환은 하지 않는다.
- `docs/manual/en/`, `docs/operations/demo-guide.en.md`: 영어 매뉴얼 원본.
- `public/research/hand-wrist/en/`: 영어 연구 기록. 문헌 검토일과 모델 한계는 한국어 기록을 보존한다.
- `public/manual/en/`: 생성된 영어 매뉴얼 Markdown. 두 문서 빌더가 한국어·영어를 묶은 JSON을 생성한다.
- 문서 다운로드는 쿠키 또는 명시적인 `?lang=en`/`?lang=ko`를 따르며 UTF-8 BOM과 Content-Language를 제공한다. 언어별 다운로드를 공유 캐시하지 않는다.

## 유지보수와 검사

새 UI 문구는 영어 사전에 추가한다. 수치가 들어가는 실시간 문구는 값·단위를 보존하는 라벨 번역을 확인한다. 사용자 매뉴얼과 연구 기록 변경은 양쪽 언어에 반영한다. 의료적 가정·모델 진값·관측값·향후 계획을 번역에서 혼동하지 않는다.

`npm run docs:build`로 사전과 문서를 생성하고 `npm run docs:check`, `npm test`, `npx tsc --noEmit`을 실행한다. 손목 bridge에 포함되는 코드나 번역을 변경하면 `node scripts/research/build-bridge.mjs` 후 사이트를 빌드한다. 로컬 서버에서 `node scripts/docs/check-language-routes.mjs http://localhost:4393`으로 두 언어의 페이지·문서 다운로드·쿠키 격리·UTF-8를 확인한다.
