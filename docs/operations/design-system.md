# 공통 화면 디자인

갱신: 2026-09-25

홈, 전신 트윈, 수면 무호흡, 손목 센싱, 연구 기록, 사용 매뉴얼 및 문서 뷰어에 같은 디자인 기준을 적용한다. 시뮬레이션 계산과 신호별 색상은 각 모듈에서 유지한다.

## 구성

- `public/ui/soma-theme.css`: 공통 배경, 카드, 텍스트, 강조색 및 간격 변수. React와 손목 iframe이 함께 사용한다.
- `app/page-design.css`: React 페이지의 제목, 카드, 입력창, 버튼, 문서 가독성과 반응형 스타일.
- `public/simulators/radial/css/soma-design.css`: 손목 앱의 기존 스타일 변수를 공통 디자인에 연결한다. 기존 밝은 테마 선택을 지원한다.
- `app/simulator-nav.module.css`: 모든 페이지에서 사용하는 상단 메뉴. 페이지 전용 버튼 규칙이 헤더에 적용되지 않도록 CSS 모듈로 격리한다.

카드 모서리는 10px, 입력창과 버튼은 6px을 사용한다. 기본 카드 간격은 16px이며 작은 화면에서는 12px이다. 페이지 제목은 기본 28px, 작은 화면에서는 24px이다. 신호 그래프의 의미를 담은 색상은 UI 강조색으로 덮어쓰지 않는다.

## 확인 방법

개발 서버 실행 후 다음 명령으로 7개 화면의 데스크톱(1440px)·모바일(390px) 캡처 및 페이지 가로 넘침, 런타임 예외를 확인한다. `CHROME_PATH`로 Chrome 실행 경로를 지정할 수 있다.

```sh
node scripts/profiling/design-review.mjs
SOMA_LANGUAGE=en node scripts/profiling/design-review.mjs
```

이미지는 `outputs/design/`에 저장된다. iframe 내부의 카드나 그래프 잘림은 캡처도 직접 확인해야 한다. 상단 메뉴 전용 검증은 `scripts/profiling/header-layout-smoke.mjs`를 사용한다.
