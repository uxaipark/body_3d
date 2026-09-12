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

Pelvis translation now drives the entire upper-body hierarchy twice per stride. Walking rises over the support leg and lowers during weight transfer (38 mm excursion). Running joins a sinusoidal compliant contact phase to a ballistic flight under 9.81 m/s² gravity, with continuous height and vertical velocity (about 63 mm excursion). Foot contact timing and stride length are synchronized with this trajectory. This is a reduced contact/flight model, not a full-body force-balance or ground-reaction solver.

Skin, vessels, nerves and muscles share normalized dual-quaternion GPU skinning. Normals are rotated with the same quaternion; sensor markers use the matching CPU transform. DQS avoids linear-blend joint collapse and preserves local rigid cross-sections, but does not solve volumetric tissue mechanics or guarantee the integrated volume of an entire muscle. Physiological signals remain illustrative synthetic outputs rather than computed biomechanical sensor measurements.

`npm test` covers rigid bone lengths, actual bone-matrix / DQ agreement, knee flexion, foot clearance, perineal continuity, hand binding and local cross-section volume. `node --experimental-strip-types scripts/check-rig-assets.mjs` checks real GLB meshes and exports posed inspection assets to `/tmp`. These can be rendered in Blender independently of the web app. Browser FPS is reported by the app, not asserted from offline asset checks.


## Muscle appearance and locomotion corrections

Muscle meshes are grouped into muscle bellies, collagenous tendons/aponeuroses, and translucent fascia/bursae. `lib/muscle.ts` builds a local principal-axis fibre frame before batching, with illustrative trunk-direction overrides. The material adds filtered longitudinal fascicle/fibre colour and normal detail in bind coordinates, so the pattern deforms with the tissue. This is a procedural anatomical illustration, not measured histology or a simulation of individual muscle fibres. No additional triangles are introduced by surface detail. The Muscle view button isolates this layer at full opacity.

Abdominal direction reference: [OpenStax, Anatomy and Physiology 2e, §11.4](https://openstax.org/books/anatomy-and-physiology-2e/pages/11-4-axial-muscles-of-the-abdominal-wall-and-thorax). Orientation overrides approximate the external/internal oblique and transverse arrangements; mesh PCA is a visual fallback for other muscles.

Complete named genital meshes at the actual lower organ extents (roughly 0.727–0.828 m) now bind to the pelvis before batching; this semantic binding is independent of the soft-tissue envelopes. Asset-based regression tests cover all seven genital organ meshes. Locomotion also rolls the forearms around the elbow-to-wrist axis so the palms face inward; rest retains the anatomical pose. The original exterior GLB and build script are restored byte-for-byte from 3141ddb while keeping the current runtime joint rig.

The original MakeHuman exterior already has inward-facing palms in its bind pose, whereas the internal atlas has forward-facing palms. The exterior uses a synchronized palette with its own neutral forearm roll, preventing double rotation of the restored hands. Joint positions and gait phase remain shared.


## Shared respiratory soft-body physics and arterial wall motion

`lib/soft-body.ts` is a small XPBD solver: 112 control nodes, 324 tetrahedra, compliant edge/volume/tether constraints, damped velocities and fixed 120 Hz substeps. Prescribed breathing actuation drives a shared thoracoabdominal field. Skin, lungs, abdominal organs, muscles, vessels, nerves and sensor attachments use the same interpolation before joint skinning; the old independent lung and chest scale offsets are removed. Surface normals use the field Jacobian. Rigid skeletal geometry and whole pelvic organs are excluded. Tests check positive tetrahedral volume, layer depth ordering, frame-rate consistency, pause and expiration recovery. This is not patient-calibrated tissue mechanics, separate-organ contact/sliding, a complete collision solver or fluid–structure interaction.

Method reference: [Macklin, Müller & Chentanez, XPBD (2016)](https://mmacklin.com/xpbd.pdf). The implementation and illustrative material parameters are local code.

`lib/arterial.ts` classifies arteries by structure name and adds a small outward wall-normal displacement before tissue and bone deformation. Heart contraction and arterial expansion share a continuous cardiac phase, with an illustrative 25 ms ejection offset plus approximate route distance / model PWV. Resting radii, route lengths and distensibility (0.75–2.5% at 1×) are visual assumptions; stiffness reduces distension. The 8× button magnifies geometry only. Venous vessels are excluded. These motions are not derived from the synthetic CSV pressure/flow solver, and no such solver is claimed.

Concept references: [Mynard et al., arterial pulse wave propagation (2014)](https://pmc.ncbi.nlm.nih.gov/articles/PMC4297358/) and [Photonic sensing of arterial distension (2016)](https://pmc.ncbi.nlm.nih.gov/articles/PMC5030007/).


## Integumentary layers

The former top skin control is replaced by an Integumentary system directly below Muscular. It exposes the original outer skin, a closed dermal shell and a closed subcutaneous-fat shell, each with independent opacity. Enabling a deeper tissue clears its covering layers. Muscle mode clears all integumentary layers and shows bilateral muscles at full opacity; muscle, tendons/aponeuroses and fascia have separate anatomical material families.

`build-skin-tissues.py` reads the unchanged original CC0 skin GLB and derives welded, solidified inward shells, with illustrative region-dependent adipose thickness. These are not measured patient tissue layers. Tissue volume geometry is separate from the procedural fine collagen/fat-lobule surface detail. All three layers share the exterior's neutral hand orientation and respiratory deformation field.

Tissue shell extrusion uses bounded normal offsets instead of even-thickness miters, which previously produced metre-long spikes at near-opposing normals. Regional thickness varies smoothly and inward rays limit depth in thin folds. The generator checks every output vertex against the source surface; exported-asset tests also check the complete shell bounds after Draco decoding.
