# SOMA — 바이오센싱 디지털 트윈 실험실

React / TypeScript / Three.js 기반 전신 해부학 및 합성 신호 실험 프로토타입.

## 실행

```sh
npm install
npm run dev
```

`npm run build` builds the Cloudflare Worker and static client assets. `npm exec tsc -- --noEmit` checks types. `npm test` tests the signal model invariants.

## 구현

- Z-Anatomy / BodyParts3D에서 유래한 전신 골격·근육·혈관·신경·장기 메시. 모든 미세혈관, 개인별 형상은 미포함. MakeHuman CC0 기반 남성 외피·얼굴·헤어를 별도 레이어로 제공.
- Draco 압축과 메시 경량화, 레이어별 배치 렌더링. 기본 DPR 상한 1.5, 지속 저FPS시 1.0. 실제 FPS 및 삼각형 수 표시.
- 신체 구조 패널 맨 위의 피부 체크박스와 불투명도 조절. 외피는 기본 표시되며 다시 켤 때 마지막 불투명도를 복원. 피부가 100% 불투명하면 가려진 내부 레이어의 렌더링을 생략하고, 낮추면 기존 내부 표시 설정을 복원.
- 회전/줌/전신·심폐·뇌·센서 초점, 구조 선택, 레이어 불투명도 조절.
- GPU 기반 심장·폐·보행의 시각적 근사 변형. 검증된 생체역학 해석이 아님.
- 손목, 손가락, 귓볼, 이마, 흉부, 상완에서 가상 PPG. 고정 가상 ECG/EEG/EMG, 폐용적 및 정전용량 변화.
- PAT = PEP + PTT. PWV와 센서까지의 가정 거리로 지연 계산. 손목→손가락의 두 지점 PTT도 모델 설명에 표시.
- 심박, 호흡, 경직도, 접촉도, 파장, 일회 호흡량, 정지/걷기/달리기 시나리오.
- 현재 설정에서 다음 10초의 합성 신호를 250 Hz CSV로 내보냄. 실측 기록이 아닌 재현 가능한 모델 출력.

## 모델 한계

이 구현은 임상 검증 또는 개인 보정이 된 디지털 트윈이 아니다. `lib/physiology.ts`는 현상론적 신호 생성기이며 장기별 미분방정식, 전신 혈류 CFD, FEM 전기장, 광자 수송, 생화학을 풀지 않는다. 체온, 혈당, 보정된 PPG 혈압 및 광학 SpO₂ 역산은 구현하지 않았다. SpO₂는 입력 시나리오 메타데이터이며 합성 PPG와 인과적으로 연결되지 않는다. 정전용량은 ΔC = 0.004 pF/mL × ΔV라는 임의 전달계수를 사용한다. 광원별 상대 진폭·접촉도·운동잡음은 가정 모델이다. 센서 위치 선택은 PPG에만 영향을 미친다. 애니메이션은 원본 좌표에서의 변형이며 관절·조직 역학 솔버가 아니다.

## 확장 지점

`lib/physiology.ts`: 실측 보정 또는 검증된 외부 생리 솔버의 신호로 대체.
`lib/anatomy.ts`: 해부학 좌표, 메시 배칭, GPU 애니메이션, 센서 선택.
`app/waveform.tsx`: 동일 시뮬레이션 시간에서 그래프 렌더링.
`lib/webmcp.ts`: 지원 브라우저에서 실험 읽기/설정 도구. 이 환경에는 지원 브라우저가 없어 WebMCP 런타임은 검증하지 못함.

## 출처

[Z-Anatomy](https://github.com/Z-Anatomy/Models-of-human-anatomy), [GLB distribution](https://github.com/Liyucheng1997/242_lab-human-anatomy).
모델 및 개별 구성요소의 전체 라이선스는 [ATTRIBUTION.md](public/models/ATTRIBUTION.md) 참조. 일부 원본 참조/포함 자산은 비상업적 조건이 있으므로 일괄 상업 이용 가능 모델로 간주하지 않는다.
[PAT/PTT background](https://pmc.ncbi.nlm.nih.gov/articles/PMC6912608/).

외피 자산 재생성 및 출처: [SKIN-SOURCE.md](scripts/SKIN-SOURCE.md). 피부는 시각화용이며 개별 조직 두께나 물성을 나타내지 않는다.


## Joint animation

`lib/rig.ts` owns a 21-bone THREE.Bone / THREE.Skeleton hierarchy with atlas-space bind landmarks. Whole named skeletal objects receive a single rigid bone index before batching. The old side-dependent vertex offsets have been removed. Foot stance/swing trajectories drive two-link leg IK, with fixed segment lengths, knee flexion, ankle clearance, reciprocal arms and blended mode transitions. A protected central perineal envelope stays with the pelvis; hands are excluded from leg envelopes.

Skin, vessels, nerves and muscles share normalized dual-quaternion GPU skinning. Normals are rotated with the same quaternion; sensor markers use the matching CPU transform. DQS avoids linear-blend joint collapse and preserves local rigid cross-sections, but does not solve volumetric tissue mechanics or guarantee the integrated volume of an entire muscle. Physiological signals remain illustrative synthetic outputs rather than computed biomechanical sensor measurements.

`npm test` covers rigid bone lengths, actual bone-matrix / DQ agreement, knee flexion, foot clearance, perineal continuity, hand binding and local cross-section volume. `node --experimental-strip-types scripts/check-rig-assets.mjs` checks real GLB meshes and exports posed inspection assets to `/tmp`. These can be rendered in Blender independently of the web app. Browser FPS is reported by the app, not asserted from offline asset checks.
