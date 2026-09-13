# Regional skin inspection

갱신: 2026-09-13 · 현재 코드 기준 구현 기록. 재생성 명령은 `web` 루트에서 실행합니다.


The 12 selectable regions use representative tissue windows rather than subject-specific imaging. Dimensions and curvature radii are illustrative millimetre presets, not clinical measurements. The wrist window is 24 × 24 mm; fingertip and earlobe windows are smaller. Both transverse and longitudinal curvature are applied by the same CPU/GPU map to layers, vessels, supporting structures and optical paths.

- Wrist: radial artery between the FCR and brachioradialis tendon landmarks, with radius deeper in the window. The vein is offset to avoid the FCR tendon.
- Fingertip: thick epidermis, fibrofatty pulp and septa, distal phalanx and lateral digital neurovascular structures.
- Earlobe: fibrofatty tissue, without invented cartilage or bone.
- Forehead: frontalis and frontal bone; neck: platysma and a deeper muscle window.
- Chest: pectoral tissue and rib landmarks; abdomen: rectus sheath, rectus and linea alba.
- Arm/forearm/thigh/calf/back: distinct fascia, muscle bundles and, where in the selected depth window, bone or tendon landmarks.

Deep structures have extruded geometry, vessel apertures and procedural fascicle, collagen or cortical/cancellous detail. Elliptical cross-sections and longitudinal extrusion simplify the actual 3D anatomy. Skin microstructure and optical paths remain illustrative; the light transport does not constitute a calibrated scattering solver for every deep tissue type.

The pulse field is restricted inside bone and reduced near tendon/fascia. Tissue outside those supports retains the prior approximately area-preserving map; exact area preservation is not claimed in the support blending zones. Bone cross-sections do not expand with the pulse. Breathing applies a shared smooth displacement, not a force-balanced rib or abdominal mechanics model. No individual material calibration or full 3D FEM is implied.

Top view uses the rendered, deformed height directly in the fragment shader. Minor contours are 0.25 mm, major contours 1 mm, and the transverse/longitudinal grid spacing is 2 mm in the reference coordinates. The height datum is the centre of the resting patch. Contours include the selected pulse visualization gain; numeric displacement readouts subtract resting curvature and remain at 1×.

Validation: regional geometry and deformation regression tests, including the thinnest and thickest fat settings. `node scripts/validate-section-shaders.mjs` optionally compiles the actual Three material hooks for every region with `glslangValidator` (132 shader stages); no browser or screenshot is used. The validator alpha-renames Three's `average` helper to avoid a naming conflict in recent glslang language tables.

Anatomical references:
- [Forearm neurovascular relationships, HRUS pictorial essay](https://pmc.ncbi.nlm.nih.gov/articles/PMC8630952/)
- [Digital pulp microscopic anatomy](https://pubmed.ncbi.nlm.nih.gov/14758214/)
- [Skin layers, OpenStax](https://openstax.org/books/anatomy-and-physiology-2e/pages/5-1-layers-of-the-skin)
- [Skeletal muscle organization, OpenStax](https://openstax.org/books/anatomy-and-physiology-2e/pages/10-2-skeletal-muscle)
- [External ear anatomy, NCBI Bookshelf](https://www.ncbi.nlm.nih.gov/books/NBK470359/)

## 현재 화면에서 사용하기

전신 트윈의 피부계를 켜고 피부 표시점 또는 영역 이름을 선택하면 3D 단면 모달을 엽니다. 전체·표면 등고선·진피·혈관 초점과 지방 두께·광학 경로·맥동 표시 배율을 탐색할 수 있습니다. 손목 센싱의 `3D 조직 단면`/`표면 등고선`은 같은 대표 구조를 신호 생성의 조직 변위와 연결합니다. 아틀라스 보기와 이 대표 블록의 차이는 [변형 모델](skin-section-model.md)에 설명합니다.

[웹 사용자 문서](../manual/skin.md) · [관련 테스트](../../tests/skin-section-mechanics.test.mjs)
