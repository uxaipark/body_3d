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

## Skeletal registration

The restored source GLB stays unchanged. `lib/skin-registration.js` registers all exterior meshes at load time, before rig weights are assigned: cranial centre and eye level, both limb axes, and paired-bone wrist/ankle envelopes. Source landmarks are measured after the original MakeHuman repose; target centres come from the visible atlas bone cross-sections. Eyes, eyebrows, hair and the body share the same smooth field. The central perineum keeps a single pelvis anchor. This is template registration, not subject-specific tissue reconstruction.
