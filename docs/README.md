# SOMA 문서 안내

갱신: 2026-09-13. 실행 코드는 `scripts`, 설명 문서는 `docs`에 둡니다. 아래 문서는 현재 소스에 맞춰 분류했습니다.

## 사용자 매뉴얼

- [시작](manual/start.md)
- [전신 트윈](manual/body.md)
- [손·손목 센싱과 회전 조작](manual/wrist.md)
- [피부 단면 관찰](manual/skin.md)
- [로컬 설치·실행](operations/demo-guide.md)

웹에서는 `/manual`에서 읽습니다. 사용자 문서를 빌드 시 웹 콘텐츠와 다운로드용 Markdown으로 생성합니다. 설치 안내의 단일 원본은 `operations/demo-guide.md`입니다.

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
