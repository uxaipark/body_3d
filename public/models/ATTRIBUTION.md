# Anatomical model assets

SOMA uses anatomical meshes derived from **Z-Anatomy — The libre 3D atlas of anatomy**.
Original project: https://github.com/Z-Anatomy/Models-of-human-anatomy
Authors include Gauthier Kervyn (design, anatomy and 3D), Marcin Zielinski, Lluis Vinent, and the Z-Anatomy contributors.

**BodyParts3D — The Database Center for Life Science (DBCLS)**, Kousaku Okubo.
Original model: CC BY-SA 2.1 Japan. https://dbarchive.biosciencedbc.jp/en/bodyparts3d/desc.html
https://creativecommons.org/licenses/by-sa/2.1/jp/

Z-Anatomy distribution: CC BY-SA 4.0.
https://creativecommons.org/licenses/by-sa/4.0/

GLB conversion distributed by Liyucheng1997 / 242_lab-human-anatomy:
https://github.com/Liyucheng1997/242_lab-human-anatomy/tree/main/public/models

SOMA modifications: removed atlas label meshes; simplified geometry for the web; Draco compression; runtime vertex colors, merged rendering batches and illustrative deformation animations. The modified anatomical assets are shared under CC BY-SA 4.0, subject to upstream component terms below. Mesh names are retained in GLB files. These assets are anatomical illustrations, not patient-specific data, and carry no warranty of medical accuracy.

## Upstream component notices (retained from Z-Anatomy)

- “Brainder” and “White matter” from the University of Washington.
- “Cranial Nerves and Foramina” — University of Dundee, CAHID — CC BY 4.0.
- “Anatomy of the Inner Ear” — University of Dundee School of Medicine — CC BY-NC-SA 4.0.
- “Kidney” — Lissie Cowley — CC BY-NC 4.0.

Some upstream referenced/included components have noncommercial restrictions. Do not assume that all component assets are cleared for commercial redistribution; review the original project's individual provenance before a commercial release.

See upstream full notices: https://github.com/Z-Anatomy/Models-of-human-anatomy#attributions

`cardiovascular-web.glb` modification: local rib/costal-cartilage clearance correction of thoracoabdominal vessel routes, continuous tube displacement, recalculated normals and baked chest-relative contact attributes. The adapted geometry retains its CC BY-SA anatomical source license. This is illustrative contact geometry, not patient-specific reconstruction. See `docs/anatomy/vessel-clearance.md` for the build and limitations.


## Male exterior (`skin-web.glb`)

Base mesh, morph targets, skin texture, eyes, eyebrows and hair: **MakeHuman Community**, CC0 1.0.
Original contributors / rights holders: Manuel Bastioni, Data Collection AB, Joel Palmius, Jonas Hauquier and the MakeHuman team.

- https://github.com/makehumancommunity/makehuman/tree/master/makehuman/data
- https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html
- https://creativecommons.org/publicdomain/zero/1.0/

Used assets: caucasian-male-young, universal-male-young-maxmuscle-averageweight, idealproportions, bilateral eye-height targets, young_caucasian_male skin, high-poly eyes / brown_eye, short04 hair and eyebrow005.
Modifications: adult male morph blending, anatomical landmark registration, relaxed limb pose, one subdivision level for body and eyes, removal of the opaque corneal patch, and Draco compression. The initial Western adult portrait, textured skin and short hair have been restored. The exterior remains CC0.

Runtime animation retains the bone hierarchy, rigid per-bone skeleton binding and dual-quaternion soft-tissue skinning. The exterior asset itself is restored from the initial skin revision; current runtime joint animation and whole-organ pelvic binding remain separate.

Muscular appearance revision: original procedural fibre shading and per-structure material classification distinguish muscle, tendon/aponeurosis and translucent fascia. The underlying CC BY-SA anatomical meshes remain unchanged. Fibre directions are illustrative, not histological measurements.

`dermis-web.glb` and `adipose-web.glb` are CC0 derivatives of the original MakeHuman exterior, generated as closed inset tissue shells with illustrative thicknesses. Their procedural surface detail is original code.

## Archived fitted exterior (`skin-fitted-web.glb`, not displayed)

Derived from the CC0 MakeHuman exterior above and registered to Z-Anatomy/BodyParts3D skeletal landmarks. The fitted geometry is distributed under CC BY-SA 4.0 with the anatomical source notices above retained; the original MakeHuman skin, eye, hair and eyebrow textures remain CC0. Modifications include anatomical registration, smooth displacement registration, UV-seam normal welding, neutral-palm normalization and baked topology-aware joint weights. Face, UVs and original mesh topology are retained.


## Current native exterior (`skin-atlas-web.glb`)

BodyParts3D, © The Database Center for Life Science, licensed under CC Attribution 4.0 International. Creator: Kousaku Okubo / DBCLS. Source dataset: BodyParts3D 3.0 (20110915), FMA7163 Skin; reference bones FMA24474, FMA23130, FMA52788, FMA24477. DOI: https://doi.org/10.18908/lsdba.nbdc00837-000 . Current official license (updated 2025-02-27): https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html .

Downloaded through Kevin Mattheus Moerman's OBJ-to-STL mirror: https://github.com/kevin-mattheus-moerman/BodyParts3D . That mirror retains the original CC BY-SA 2.1 Japan notice; see its README and the official current license above. The bundled adapted geometry is distributed under CC BY-SA 4.0, with these attribution notices retained.

Modifications: one global uniform scale/translation to the Z-Anatomy frame, removal of nested internal tissue surfaces through a 1.5 mm exterior flood-fill, surface simplification, bounded 1 mm Taubin smoothing, outward normals, Blender bone-heat joint weights, continuous pelvic anchoring and glTF/Draco packaging. Surface shading is original procedural code, with no MakeHuman skin/face/hair texture applied to this new model. No patient-specific fit is claimed.

Reference: Mitsuhashi N et al., BodyParts3D: 3D structure database for anatomical concepts. Nucleic Acids Research 37 (2009), D782–D785. https://doi.org/10.1093/nar/gkn613 .
