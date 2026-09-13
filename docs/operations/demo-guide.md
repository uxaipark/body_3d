# SOMA 로컬 데모 설치·실행

갱신: 2026-09-13. 배포 폴더는 빌드된 전신·손목 시뮬레이터와 매뉴얼을 포함합니다. 원본 프로젝트, Blender, Python, Cloudflare 계정은 데모 실행에 필요하지 않습니다.

## 지원 환경

- macOS 13.5 이상: Apple Silicon 또는 Intel.
- Windows 11 이상: x64. ARM64 장치는 x64 실행 환경을 사용하며 별도 실기기 확인이 필요합니다.
- Linux: glibc 2.35 이상, x64 또는 ARM64. Ubuntu 22.04 이상 권장. Alpine/musl은 지원하지 않습니다.

Node.js 24.21.0과 Wrangler 4.92.0을 고정합니다. Node는 공식 배포본의 SHA-256을 확인한 뒤 데모 폴더의 `.runtime`에 설치합니다. 전역 Node나 시스템 PATH는 변경하지 않습니다. 첫 설치에는 인터넷이 필요하며, 설치가 끝나면 데모 실행에 외부 계정이 필요하지 않습니다.

## macOS

1. ZIP을 쓰기 가능한 폴더에 완전히 풉니다.
2. `Install-macOS.command`를 실행합니다.
3. `Start-macOS.command`를 실행하고 표시되는 로컬 주소를 엽니다.
4. `Verify-macOS.command`로 별도 검증 서버를 띄워 페이지·스크립트·3D 모델 파일을 검사할 수 있습니다.

터미널에서도 `bash Install-macOS.command`, `bash Start-macOS.command --port 3000`, `bash Verify-macOS.command --port 3001`로 실행할 수 있습니다. 다운로드 파일 실행이 macOS에서 차단되면 내용을 확인한 뒤 터미널에서 해당 명령을 사용하세요.

## Windows

`Install-Windows.cmd`, `Start-Windows.cmd`, `Verify-Windows.cmd` 순으로 사용합니다. 포트를 바꾸려면 터미널에서 `Start-Windows.cmd -Port 3001`을 실행합니다.

Windows 기본 PowerShell 5.1 이상을 사용합니다. 실행 정책 예외는 해당 PowerShell 프로세스에만 적용하며 시스템 정책을 변경하지 않습니다. 설치 프로그램은 관리자 권한이나 MSI 설치 없이 ZIP 형식의 Node를 폴더 안에 준비합니다.

## Linux

`bash Install-Linux.sh`, `bash Start-Linux.sh`, `bash Verify-Linux.sh --port 3001`을 실행합니다. 셸은 Bash입니다. curl·tar·gzip이 없으면 설치 스크립트가 apt/dnf/zypper/pacman으로 필요한 다운로드 도구를 설치하며, 이 경우에만 root 또는 sudo가 필요합니다.

## 주소·종료·재실행

기본 주소는 `http://127.0.0.1:3000`입니다. 서버가 준비될 때까지 잠시 기다린 뒤 접속합니다. 중지는 터미널에서 Ctrl+C입니다. 이후에는 Start만 실행하면 됩니다. 설치는 재실행해도 같은 버전과 잠금 파일이면 기존 패키지를 재사용합니다.

다른 장치에서 접속할 데모는 macOS/Linux에서 `--host 0.0.0.0`, Windows에서 `-BindHost 0.0.0.0`을 지정하고 해당 컴퓨터의 LAN IP와 포트를 사용합니다. 기본값은 로컬 컴퓨터만 허용합니다. 방화벽 허용 여부는 OS에서 확인합니다.

## 검증과 문제 해결

Verify는 서버를 직접 시작하고 홈·전신·손목·연구·매뉴얼·원본 실험 화면, 페이지 스크립트와 실제 GLB를 검사한 뒤 종료합니다. 결과는 `.runtime/verification.json`, 서버 출력은 `.runtime/verification-server.log`입니다. 브라우저에서 실제 WebGL 렌더링이나 FPS를 검사하는 절차는 아닙니다.

- 포트 사용 중: 다른 포트를 지정합니다. 스크립트는 기존 서버를 종료하지 않습니다.
- 체크섬/파일 손상: ZIP을 새 폴더에 다시 풉니다.
- 설치 실패: 인터넷과 디스크 공간, 폴더 쓰기 권한을 확인한 뒤 Install을 다시 실행합니다.
- 모델이 안 보임: 최신 브라우저의 WebGL/하드웨어 가속을 확인합니다.
- 다른 OS로 이동: ZIP 원본을 사용하세요. 이미 설치된 `node_modules`와 `.runtime`을 OS 간 복사하지 않습니다.

## 모델 출처

모델의 출처와 이용 조건은 `dist/client/models/ATTRIBUTION.md` 및 동작 자산의 출처 문서에 보존됩니다. 이 패키지는 연구 데모이며 임상 정확도 또는 모든 자산의 상업 이용 권한을 보장하지 않습니다.

## 환경 근거

[Node.js 24 공식 배포](https://nodejs.org/download/release/v24.21.0/)와 [Wrangler 지원 환경](https://developers.cloudflare.com/workers/wrangler/install-and-update/)을 기준으로 작성했습니다.
