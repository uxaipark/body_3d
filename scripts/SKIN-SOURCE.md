# Male exterior build inputs

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
