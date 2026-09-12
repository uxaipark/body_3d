# Current native atlas exterior

The viewer loads `public/models/skin-atlas-web.glb`, based on **BodyParts3D 3.0 / 20110915, FMA7163 (Skin)**. The MakeHuman exterior and registration scripts below are retained as historical inputs; they are not loaded by the current viewer.

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

---

# Historical MakeHuman exterior build inputs

`build-skin.py` is an offline Blender script. Run from the `web` directory:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-skin.py
```

It builds `public/models/skin-web.glb` and renders two local inspection PNGs in `/tmp`. It never needs to run in the browser or production Worker. Blender 5.1.1 was used.

Cache the following source files under `.asset-cache/makehuman/`, preserving paths relative to `makehuman/data/` in https://github.com/makehumancommunity/makehuman/tree/master/makehuman/data :

- `3dobjs/base.obj`
- `targets/macrodetails/caucasian-male-young.target`
- `targets/macrodetails/universal-male-young-maxmuscle-averageweight.target`
- `targets/macrodetails/proportions/male-young-averagemuscle-averageweight-idealproportions.target`
- `targets/eyes/l-eye-height2-incr.target`
- `targets/eyes/r-eye-height2-incr.target`
- `eyes/high-poly/high-poly.obj`
- `eyes/high-poly/high-poly.mhclo`
- `eyes/materials/brown_eye.png`

From the official [MakeHuman system assets pack](https://files2.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip), extract these folders beneath `.asset-cache/mh-assets/`:

- `skins/young_caucasian_male/`
- `hair/short04/`
- `eyebrows/eyebrow005/`

The source cache is excluded from version control; the exported model is self-contained and contains the skin, hair, eye and eyebrow textures. All inputs are CC0. See `public/models/ATTRIBUTION.md`.


## Restored initial portrait

The exterior uses the initial Western adult male morph, photographic skin texture, `short04` hair and `eyebrow005` brows. Later face-local morphs, sculpted cinematic hair and solid skin materials are no longer applied. The GLB and its build script are restored byte-for-byte from the first exterior revision (3141ddb). Current runtime joint animation and organ binding remain separate from this restored asset. All source inputs above are CC0.

## Fitted, articulated exterior

The viewer now loads `skin-fitted-web.glb`. The original `skin-web.glb` remains a reproducible CC0 source, rather than being warped again at runtime.

Rebuild from the web directory:

```sh
node --experimental-strip-types scripts/prepare-skin-envelope.mjs
/Applications/Blender.app/Contents/MacOS/Blender --background --python-exit-code 1 --python scripts/fit-skin-envelope.py
node --experimental-strip-types scripts/export-skin-envelope.mjs
```

Initial landmark registration aligns the cranial centre and limb axes. The source mesh's connected distal arms are classified before registration, including UV seam welding; anatomical labels are retained in the artifact. Neutral palms are rotated into the atlas convention, so skin and skeleton share the same runtime forearm rotation.

The exterior reuses the same smooth original surface as the dermal/adipose shells. An implicit membrane regularizes the landmark displacement along welded mesh edges; it does not push vertices onto individual muscle or bone triangles. This removes the previous radial envelope constraints that embossed the buttocks, elbows, armpits and back neck. Original topology, photographic UVs, face/finger/sole details and the single pelvic anchor are retained. Smooth vertex normals are shared across UV seams, and skin pores, dermal connective texture and fat lobules use rest-space procedural bump shading without vertex displacement. The fit checks edge stretch/compression in all four reported regions. It does not guarantee clearance from every internal atlas muscle. Shoulder and neck weights are diffused over mesh edges. The exported `_RIG_INDEX` and `_RIG_WEIGHT` attributes are used directly in the viewer's dual-quaternion skinning. Torso breathing deformation is masked off on the hands and distal limbs.

This is an illustrative anatomical template fit and elastic surface relaxation, not patient-specific tissue reconstruction or a dynamic whole-body tissue contact solver. See the asset attribution for the fitted geometry and source textures.

## Liver respiratory placement

`lib/hepatic.js` places the liver and gallbladder 12 mm posteriorly, with transverse/AP scale factors 0.90/0.78. They share the chest bone and undergo at most 6 mm of inferior respiratory translation, without abdominal XPBD expansion. Run `node scripts/check-liver-bounds.mjs`, then Blender with `--background --python-exit-code 1 --python scripts/check-liver-bounds.py` to check 21 respiratory poses against actual rib/sternum/thoracic vertebra triangles.
