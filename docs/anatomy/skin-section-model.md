# 3D local skin section

갱신: 2026-09-13 · 현재 코드 기준 구현 기록. 재생성 명령은 `web` 루트에서 실행합니다.


The modal uses a separate, disposable Three.js scene. Six closed, extruded tissue bands share undulating interfaces. A cylindrical arterial lumen is surrounded by intimal, medial and adventitial shells; a flattened thin-wall vein occupies a separate channel. Tissue fragments inside the original vessel channels are discarded before shading, so solid layer geometry does not fill the lumens. The block can be rotated and inspected at full-depth, dermal and vascular scales.

The original, deterministic histology texture depicts keratinocytes, rete ridges, papillary capillary loops, interwoven collagen and finer elastin, irregular Voronoi adipose lobules and their septa, smaller adipocytes, cutaneous nerve bundles, and eccrine ducts/coils. The finger-pad preset has no hair follicles. These fine features are **illustrated on the cut surfaces**, not individually segmented 3D cells. Some microstructures are enlarged for legibility. No external histology photograph or patient dataset is bundled.

All surfaces, wall layers and optical paths use one deformation map in millimetres:

1. A Kelvin–Voigt-like exponential relaxation follows the body's prescribed arterial, respiratory and cardiac drives. It has a user-adjustable time constant; it is not a fitted material law.
2. Expanding the cylindrical cavity maps surrounding radius `r` to `sqrt(r² + R_new² - R_rest²)`, preserving annular cross-sectional area outside the lumen. The blood lumen is intentionally allowed to increase in area.
3. Four midpoint integration steps apply a divergence-free stream field for central lift and adjacent settling.
4. Respiratory and cardiac drive add a smooth vertical lift (`exp(-x²/230)`). The current code does not apply the previously documented reciprocal transverse stretch or respiratory shear.

The section is extruded with no through-plane strain. It is a **reduced plane-strain approximation displayed in 3D**, not a full 3D finite-element model. The viscoelastic response and microstructural appearance are illustrative. Regional thickness presets are not patient measurements. Normals use the deformation Jacobian; optical paths follow the same map while attenuation uses the unamplified arterial radius. Exit energy remains an illustrative path statistic, not photodiode collection efficiency or an SpO2 inversion.

The texture and geometry are generated when a region is opened or a thickness edit is committed. Deformation is performed in vertex shaders. Optical vertex buffers are reused, animation runs at approximately 30 updates/s, and closing the modal releases the extra WebGL context, geometry, materials and texture.

Validation: `tests/skin-section-mechanics.test.mjs` checks all 12 region presets, 0.5–16 mm fat extremes, ordered interfaces, positive tissue Jacobians and near-unit cross-sectional area, adjacent surface settling, frame-rate-independent relaxation, and pause/recovery. Browser visual inspection is not part of this validation.

References informing the organization and qualitative mechanics (not fitted parameter sources):

- Histology, Dermis: https://www.ncbi.nlm.nih.gov/books/NBK535346/
- Skin Anatomy: https://pmc.ncbi.nlm.nih.gov/articles/PMC10373447/
- Viscoelastic Response of Human Skin to Low Magnitude Physiologically Relevant Shear: https://pmc.ncbi.nlm.nih.gov/articles/PMC2584606/
- Characterization of the anisotropic mechanical properties of excised human skin: https://pubmed.ncbi.nlm.nih.gov/22100088/

## 손목 센싱 전용 경로

전신 피부 모달과 손목 센싱의 S/T 보기는 같은 `SkinSectionScene`을 사용하지만 변형식은 다릅니다. `lib/wrist/soma-bridge.ts`의 `makeWristSection`이 `coupledWrist=true`를 설정합니다. 이 경로는 `wristMechanics.js`의 `surroundingDisplacement`를 CPU/GPU에서 공유하며 골·힘줄 주변 이동성을 제한합니다. 환상 면적 보존 식을 손목 경로에 적용한다고 해석하면 안 됩니다.

요골동맥의 수동 좌우·깊이와 체형/자세 편위는 `arteryTether`로 위치에 따라 완화합니다. 원본 해부학 메시의 distal 동맥 접속을 보존하는 공간 근사이며 혈류·접촉 FEM은 아닙니다. S/T 블록은 대표 조직 창으로, 전체 아틀라스를 실제 Boolean 절단한 형상이 아닙니다.

손목 보기의 조작은 [손목 사용 안내](../manual/wrist.md)에 정리합니다. 원본 X축과 단면 Z축이 혈관 길이 방향이며, 중앙/Alt 드래그의 축 회전, 상하단 화면 회전과 수평축 기울이기를 제공합니다.
