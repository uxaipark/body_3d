# 문서 정리와 갱신 기록

검토일: 2026-09-13. `scripts`의 Markdown 5개를 읽고 현재 런타임·자산 생성 코드와 대조했습니다. 실행 코드는 이동하지 않았습니다.

| 기존 문서 | 새 분류 | 갱신 내용 |
| --- | --- | --- |
| CLINICAL-MOTIONS.md | motion/clinical-motions.md | 전신 임상 작업과 손목 자세 메뉴를 구분하고 공통 보행·센서 팔 제어 범위를 추가 |
| SKIN-SECTION-MODEL.md | anatomy/skin-section-model.md | 실제 호흡 변형을 수직 lift로 정정; 손목 coupledWrist 전달식과 전신 모달의 다른 변형식을 구분 |
| SKIN-SECTIONS.md | anatomy/regional-skin-sections.md | 피부계에서 모달을 여는 흐름과 손목 S/T 대표 단면 사용을 추가 |
| SKIN-SOURCE.md | anatomy/skin-source.md + archive/makehuman-exterior.md | 현재 BodyParts3D 외피와 과거 MakeHuman·fitted 외피를 분리하고 현재 피부계 초기 상태 반영 |
| VESSEL-CLEARANCE.md | anatomy/vessel-clearance.md | 흉복부 경계 보정과 손목 요골동맥 연결 변형의 적용 영역을 구분 |

판단 근거는 `lib/anatomy.ts`, `lib/rig.ts`, `lib/clinical-motion.js`, `lib/skin-section-model.ts`, `lib/skin-section-scene.ts`, `lib/wrist/soma-bridge.ts`, 손목의 `nativeAtlas.js`, `arteryDeformation.js`, `viewInteraction.js` 및 재생성 스크립트입니다. 모델 재생성용 Blender 작업을 다시 실행했다는 뜻은 아닙니다.

프로젝트 README의 과거 외피·2D 모달 설명도 현재 기능과 문서 링크로 교체했습니다. 자산 출처 문서의 이동된 경로를 갱신했으며, 연구 검증 이력은 과거 기록으로 보존합니다.

## 웹 매뉴얼 분리

`docs/manual`에는 시작·전신·손목·피부 조작을 둡니다. 설치 안내 원본은 `docs/operations/demo-guide.md`입니다. 빌드 스크립트가 이 다섯 원본을 `/manual` 페이지 콘텐츠와 다운로드용 Markdown으로 생성하므로 이중 편집하지 않습니다.

해부학 재생성·운동학·과거 자산 문서는 개발·연구 문서로 유지합니다. 웹 사용자 매뉴얼에는 실행과 조작에 필요한 내용만 옮겼습니다. 검증의 실제 환경과 미검증 환경은 [데모 검증 기록](demo-validation.md)에 명시합니다.
