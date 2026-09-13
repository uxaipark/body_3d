# 현재 아틀라스 외피와 심폐·간 표시 경계

갱신: 2026-09-13 · 확인 코드: `lib/anatomy.ts`, `lib/hepatic.js`, `lib/cardiac-space.ts`, `scripts/*atlas-skin*`. 명령은 `web` 루트에서 실행합니다.

피부계는 초기 미선택이며, 켜면 원본 외피 위에서 국소 단면 위치를 선택합니다. 진피·지방의 전신 외피는 현재 뷰어에 별도로 로드되지 않습니다. 손목 센싱은 같은 신체 아틀라스에서 추출한 `public/models/wrist/atlas.glb`를 사용합니다.

## 현재 외피

The viewer loads `public/models/skin-atlas-web.glb`, based on **BodyParts3D 3.0 / 20110915, FMA7163 (Skin)**. The MakeHuman exterior and registration scripts are documented in [the archive](../archive/makehuman-exterior.md); they remain historical inputs and they are not loaded by the current viewer.

Source: https://github.com/kevin-mattheus-moerman/BodyParts3D/tree/main/assets/BodyParts3D_data/stl (DBCLS BodyParts3D data, converted from OBJ to STL by Kevin Mattheus Moerman). Cache `FMA7163.stl` as `.asset-cache/bodyparts3d-skin-v3.stl`, and `FMA24474.stl`, `FMA23130.stl`, `FMA52788.stl`, `FMA24477.stl` under their own names in `.asset-cache/`.

One global similarity transform is fitted against four independent atlas bones (maximum bounding-landmark residual 1.64 mm). No separate arm/leg warp, radial muscle projection or local silhouette inflation is applied. The source contains nested tissue faces; offline 1.5 mm rasterization, exterior flood-fill and isosurface extraction remove these internal faces. The cleaned surface is reduced to 110,000 triangles with consistent outward normals. Twelve offline Taubin smoothing pairs reduce extraction/decimation ripples, with displacement capped at 1 mm per vertex and a 0.5% volume-change guard. Face inversion is rejected. Bone-heat weights are solved after smoothing; the browser adds no smoothing pass or extra triangles. This processing changes sub-voxel detail and is not a preservation of every source vertex.

Blender bone-heat binding solves weights on the connected exterior. The pelvic midline uses a continuous anchoring transition. Runtime dual-quaternion skinning shares the anatomy's motion phase and uses support samples from the actual new feet. Skin pores are rest-space procedural shading; the source has no photographic texture map.

Rebuild (Blender 5.1.1 and Python with NumPy, SciPy, scikit-image):

```sh
node --experimental-strip-types scripts/prepare-atlas-skin.mjs
/Applications/Blender.app/Contents/MacOS/Blender --background --python-exit-code 1 --python scripts/build-atlas-skin.py
python3 scripts/clean-atlas-surface.py
/Applications/Blender.app/Contents/MacOS/Blender --background --python-exit-code 1 --python scripts/rig-atlas-skin.py
node scripts/export-atlas-skin.mjs
```

The optional local Python dependencies can be installed beneath `.asset-cache/python`; this directory is not shipped. Verify atlas containment with `scripts/check-atlas-fit.py` in Blender after preparing `scripts/check-cardiorespiratory.mjs` data. Run `npm test` for native motion, ground support and cardiac display-envelope checks.

## Cardiac/pulmonary display separation

The supplied atlas meshes intersect in the mediastinum. The renderer reserves a convex envelope around the cardiac contraction/respiratory sweep with 3 mm display clearance and discards pulmonary fragments within it. Both organs share the chest transform; cardiac tissue is excluded from outward abdominal expansion. The standalone continuous pleural sheet is omitted from display. Distinct materials and edge shading make the boundary readable. This is a **render-space anatomical correction**, not a Boolean repair of the source meshes or a physical contact simulation.

Rebuild the envelope with `node --experimental-strip-types scripts/check-cardiorespiratory.mjs` followed by `node scripts/build-cardiac-space.mjs`. `scripts/check-cardiorespiratory.py` verifies rib clearance and coverage of the rendered cardiac envelope across breathing/contraction states.

## Liver respiratory placement

`lib/hepatic.js` places the liver and gallbladder 12 mm posteriorly, with transverse/AP scale factors 0.90/0.78. They share the chest bone and undergo at most 6 mm of inferior respiratory translation, without abdominal XPBD expansion. Run `node scripts/check-liver-bounds.mjs`, then Blender with `--background --python-exit-code 1 --python scripts/check-liver-bounds.py` to check 21 respiratory poses against actual rib/sternum/thoracic vertebra triangles.
