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
- `hair/short02/`
- `eyebrows/eyebrow005/`

The source cache is excluded from version control; the exported model is self-contained and contains the eye and eyebrow textures. All inputs are CC0. See `public/models/ATTRIBUTION.md`.


## Adult portrait revision

The `portrait_targets` list in `build-skin.py` adds face-local adult facial morphs (oval contour, narrower/softer jaw, subtle eye and lip shaping). Download each listed `.target` from the same MakeHuman data source to `.asset-cache/makehuman/targets/`. The original body scale is retained; rigid head displacement from macro targets is removed before export. Body vertices below the face mask are unchanged. The brows use `eyebrow005` from the same CC0 system asset pack. `cinematic-hair.py` builds original volumetric side-part locks and uses the crown only of the CC0 hair helper. The skin has a matte, solid cinematic material; the old photographic hair cards are no longer exported. Hair meshes are merged by material. Knee and ankle landmarks are registered to the anatomical atlas in the rest pose, with the hands and central perineum excluded from leg fitting.
