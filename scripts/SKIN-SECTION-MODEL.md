# 3D local skin section

The modal uses a separate, disposable Three.js scene. Six closed, extruded tissue bands share undulating interfaces. A cylindrical arterial lumen is surrounded by intimal, medial and adventitial shells; a flattened thin-wall vein occupies a separate channel. Tissue fragments inside the original vessel channels are discarded before shading, so solid layer geometry does not fill the lumens. The block can be rotated and inspected at full-depth, dermal and vascular scales.

The original, deterministic histology texture depicts keratinocytes, rete ridges, papillary capillary loops, interwoven collagen and finer elastin, irregular Voronoi adipose lobules and their septa, smaller adipocytes, cutaneous nerve bundles, and eccrine ducts/coils. The finger-pad preset has no hair follicles. These fine features are **illustrated on the cut surfaces**, not individually segmented 3D cells. Some microstructures are enlarged for legibility. No external histology photograph or patient dataset is bundled.

All surfaces, wall layers and optical paths use one deformation map in millimetres:

1. A Kelvin–Voigt-like exponential relaxation follows the body's prescribed arterial, respiratory and cardiac drives. It has a user-adjustable time constant; it is not a fitted material law.
2. Expanding the cylindrical cavity maps surrounding radius `r` to `sqrt(r² + R_new² - R_rest²)`, preserving annular cross-sectional area outside the lumen. The blood lumen is intentionally allowed to increase in area.
3. Four midpoint integration steps apply a divergence-free stream field for central lift and adjacent settling.
4. Reciprocal transverse stretch plus respiratory shear preserve area during respiratory motion.

The section is extruded with no through-plane strain. It is a **reduced plane-strain approximation displayed in 3D**, not a full 3D finite-element model. The viscoelastic response and microstructural appearance are illustrative. Regional thickness presets are not patient measurements. Normals use the deformation Jacobian; optical paths follow the same map while attenuation uses the unamplified arterial radius. Exit energy remains an illustrative path statistic, not photodiode collection efficiency or an SpO2 inversion.

The texture and geometry are generated when a region is opened or a thickness edit is committed. Deformation is performed in vertex shaders. Optical vertex buffers are reused, animation runs at approximately 30 updates/s, and closing the modal releases the extra WebGL context, geometry, materials and texture.

Validation: `tests/skin-section-mechanics.test.mjs` checks all 12 region presets, 0.5–16 mm fat extremes, ordered interfaces, positive tissue Jacobians and near-unit cross-sectional area, adjacent surface settling, frame-rate-independent relaxation, and pause/recovery. Browser visual inspection is not part of this validation.

References informing the organization and qualitative mechanics (not fitted parameter sources):

- Histology, Dermis: https://www.ncbi.nlm.nih.gov/books/NBK535346/
- Skin Anatomy: https://pmc.ncbi.nlm.nih.gov/articles/PMC10373447/
- Viscoelastic Response of Human Skin to Low Magnitude Physiologically Relevant Shear: https://pmc.ncbi.nlm.nih.gov/articles/PMC2584606/
- Characterization of the anisotropic mechanical properties of excised human skin: https://pubmed.ncbi.nlm.nih.gov/22100088/
