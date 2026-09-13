# 데모 패키징과 검증

갱신: 2026-09-13. 빌드된 동일한 앱을 독립 데모 폴더에서 검사했습니다.

## 구성

`npm run build` 후 `npm run demo:prepare`가 소스와 분리된 `../demo/soma-demo`를 준비합니다. `scripts/demo/runtime`은 실행 코드·버전·잠금 파일만 보관합니다. 사용자 설명 원본은 `docs/operations/demo-guide.md`입니다.

런타임은 고정 Node.js 24.21.0, Wrangler 4.92.0과 빌드된 Worker입니다. 전체 개발 의존성, Blender, Python은 데모 컴퓨터에 설치하지 않습니다. OS별 Node 바이너리는 SHA-256 검증 후 `.runtime`에 설치하고, 서버 의존성은 npm 잠금 파일로 고정합니다.

`manifest.json`의 명시적 파일 목록으로 무결성을 검사하고 ZIP을 만듭니다. `.runtime`, `node_modules`, `.env`, Git 및 Sites 설정은 배포 ZIP에 포함하지 않습니다. 이 체크섬은 전자서명을 대신하지 않으며 손상·누락 검사입니다.

## 자동 검증 범위

설치 → 임시 서버 실행 → 여섯 페이지의 실제 내용·스크립트 확인 → 전신/손목 GLB 파일 확인 → 서버 프로세스 정리 순서입니다. 포트 충돌은 기존 프로세스를 종료하지 않고 실패합니다. 웹 브라우저 렌더링·GPU FPS·임상 정확도는 이 검증 범위에 포함되지 않습니다.

## 실행 결과

| 환경 | 설치 | 서버·페이지·모델·WASM | 추가 확인 |
| --- | --- | --- | --- |
| macOS 26.6.2 / ARM64 | 공식 Node 신규 다운로드·해시 검증, npm ci 통과 | 6개 페이지, GLB 2개, WASM 컴파일 통과 | 재설치 재사용, Start 실행, 포트 충돌·손상·잘못된 포트 거부 |
| Ubuntu 22.04 Docker / ARM64 | curl·CA·tar·gzip 설치, 공식 Node 다운로드, npm ci 통과 | 동일 9개 검사 통과 | 공백 포함 독립 경로, 설치 재실행, 검증 후 서버 종료 |
| Windows 스크립트 / macOS의 PowerShell 7.6.6 | 실제 Windows 설치는 미검증 | 실제 Windows 서버는 미검증 | PowerShell AST 구문, CMD 동작 선택·경로 인용·종료 코드, 타 OS 거부 확인 |

Windows 11의 실제 동작은 제공된 `Verify-Windows.cmd`로 확인해야 합니다. Intel Mac, Linux x64, Windows ARM64 실기기는 이번 실행 환경에 포함되지 않습니다. 지원 OS 목록과 실제 검증 OS 목록을 구분합니다.

Mac·Linux 검증 JSON과 로그는 배포 디렉터리 밖 `demo/qa/results`에 보존합니다. 데모 설치 후 각 컴퓨터의 결과는 `.runtime/verification.json`에 생성됩니다. 웹 앱의 기존 96개 회귀 테스트와 TypeScript 검사, 사이트 빌드도 통과했습니다.

## 사용자 실행 확인 — 2026-09-13

사용자가 “도커에서 잘 동작 했어”라고 정상 동작을 확인했습니다. 이는 위 자동 검증과 별개의 사용자 보고입니다. 호스트 OS, Docker 버전, CPU 아키텍처 및 상세 검사 로그는 제공되지 않아 특정 환경의 추가 검증 통과로 확대 기록하지 않습니다.

## 재현 명령

```sh
npm run build
npm run demo:prepare
bash ../demo/soma-demo/Install-macOS.command
bash ../demo/soma-demo/Verify-macOS.command --port 4382
python3 scripts/demo/archive-demo.py ../demo/soma-demo
```

Linux에서는 같은 폴더의 Linux 실행 파일을 사용합니다. Windows 구문 검사 도구는 `scripts/demo/check-windows.ps1`이며, 이 도구 자체가 Windows 서버 검증을 대신하지는 않습니다. `scripts/demo/check-demo-failures.mjs`는 3000번 포트에 실행 중인 해당 데모가 있을 때 오류 처리·기존 서버 보존을 확인합니다.

생성된 데모의 `manifest.json`은 파일 목록·체크섬·소스 커밋을 기록합니다. ZIP에는 OS별 설치 결과나 인증 값이 포함되지 않습니다. 패키징 도구를 실행하려면 원본 소스와 빌드 결과가 필요하며, 데모 사용자에게는 준비된 ZIP만 전달하면 됩니다.
