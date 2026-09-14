# SOMA 문서 안내

갱신: 2026-09-13. 실행 코드는 `scripts`, 사용자·개발·운영 문서는 `docs`에 둡니다. 웹에서 직접 제공하는 연구 원본과 자산 출처는 `public`에 유지합니다.

새 세션에서 이어서 작업할 때는 [세션 인계 문서](operations/session-handoff.md)를 먼저 읽습니다. 작업 경로·저장/배포 상태·검증 범위·실행 명령·다음 단계가 정리되어 있습니다.

## 문서 위치와 편집 기준

| 위치 | 역할 | 편집 방법 |
| --- | --- | --- |
| `docs/manual`, `docs/operations/demo-guide.md` | 사용자 매뉴얼 원본 5개 | 원본 수정 후 `npm run docs:build` |
| `public/manual`, `app/manual/content.json`, `app/documents/content.json` | 웹 매뉴얼·문서 뷰어 자동 생성본 | 직접 수정하지 않음 |
| `docs/anatomy`, `docs/motion` | 현재 구현과 자산 재생성 | 해당 코드와 함께 갱신 |
| `docs/operations` | 설치·검증·문서 관리 | 실행 결과와 사용자 보고를 구분 |
| `public/research/hand-wrist` | 웹 연구 기록 원본 | 현재 구현·연구 계획·과거 측정을 구분 |
| `docs/research/VALIDATION.md`, `docs/archive` | 검증 이력·이전 구현 | 과거 기록은 보존하고 최신 안내를 연결 |
| `public/models/ATTRIBUTION.md`, `public/motions/ATTRIBUTION.md` | 자산 출처·라이선스 | 자산 변경 시 함께 갱신 |

데모 폴더의 문서는 패키징 시점의 복사본입니다. 소스에서 수정한 뒤 데모를 다시 패키징해야 반영됩니다. 기존 배포본의 문서만 직접 고치면 무결성 검사와 일치하지 않습니다.

## 사용자 매뉴얼

- [시작](manual/start.md)
- [전신 트윈](manual/body.md)
- [손목 센싱과 회전 조작](manual/wrist.md)
- [피부 단면 관찰](manual/skin.md)
- [로컬 설치·실행](operations/demo-guide.md)

웹에서는 `/manual`에서 읽습니다. 사용자 문서를 빌드 시 웹 콘텐츠와 다운로드용 Markdown으로 생성합니다. 설치 안내의 단일 원본은 `operations/demo-guide.md`입니다.

연구 문서와 개별 매뉴얼은 `/documents/research/문서명`, `/documents/manual/문서명`에서 웹으로 읽습니다. 원본을 UTF-8로 엄격하게 읽으며, 잘못된 바이트나 대체 문자 발견 시 빌드를 중단합니다. 다운로드는 UTF-8 응답과 BOM을 사용합니다. 개인정보·내부 저장소 경로·배포 식별자·내부 실험 기록은 공개 문서에 넣지 않습니다.

## 현재 구현·재생성

- [아틀라스 외피와 심폐·간 표시 경계](anatomy/skin-source.md) — 기존 `scripts/SKIN-SOURCE.md`의 현재 구현.
- [국소 단면 변형 모델](anatomy/skin-section-model.md) — 기존 `scripts/SKIN-SECTION-MODEL.md`.
- [부위별 피부 단면 구조](anatomy/regional-skin-sections.md) — 기존 `scripts/SKIN-SECTIONS.md`.
- [흉복부 혈관 경계 보정](anatomy/vessel-clearance.md) — 기존 `scripts/VESSEL-CLEARANCE.md`.
- [임상 작업·손 쥐기·침대 동작](motion/clinical-motions.md) — 기존 `scripts/CLINICAL-MOTIONS.md`.
- [데모 패키징과 검증](operations/demo-validation.md).

## 연구와 이력

- [연구 문서 원본 안내](research/README.md): 손목·CBP 확장 설계와 문헌은 `public/research/hand-wrist`가 원본입니다.
- [구현 검증 이력](research/VALIDATION.md): 과거 수치는 해당 시점의 검사 결과이며 현재 결과와 구분합니다.
- [MakeHuman 외피 과거 기록](archive/makehuman-exterior.md): 현재 뷰어에 로드되지 않는 이전 자산과 절차.

[이번 문서 분류·정정 근거](operations/documentation-audit.md)

## 갱신 규칙

기능을 바꾸면 관련 사용자 문서와 구현 문서를 함께 수정합니다. 실제로 실행한 검사와 정적 분석, 계획을 구분합니다. 재생성 명령은 웹 루트에서 실행하며 고비용 Blender 파이프라인을 일반 데모 설치에 포함하지 않습니다.

```sh
npm run docs:build
npm run docs:check
```

`docs:check`는 Markdown의 상대 파일 링크, 매뉴얼 생성본 동기화와 `scripts` 내 Markdown 혼재를 검사합니다. 외부 URL의 응답, 문헌의 최신성, 브라우저 렌더링을 검사하지는 않습니다. 웹 빌드도 매뉴얼을 자동 생성합니다.
