# Thoracoabdominal vessel clearance

The 24 epigastric, musculophrenic, internal thoracic and lateral thoracic artery/vein meshes are checked against the actual atlas ribs, sternum and costal cartilages. Local supporting planes include a 3 mm margin and a 25 mm neighbourhood. A continuous displacement envelope with slope at most 0.35 moves neighbouring tube sections together, avoiding independent wall-vertex flattening. The superficial/lateral vessels retain the outside route; deep thoracic vessels retain the inside route. This prevents bone penetration, not the display of anatomically internal vessels inside the chest cavity. It is an illustrative contact correction, not validated vascular mechanics.

Vertices within 20 mm of the original rib surface share its chest transform; that influence fades out by 45 mm. The shader projects onto the admissible half-space **after** breathing, cardiac motion and arterial distension and **before** the common chest transform. Unrelated cardiovascular meshes have a zero contact attribute. No per-frame mesh collision search or additional draw call is required.

To rebuild, first restore the unmodified input into `.asset-cache/cardiovascular-before-costal.glb` from commit `a38d2c78c64097da68c99a2c9a2281d9ec7cb081` (`public/models/cardiovascular-web.glb`). Both preparation and export read that cache so repeat runs do not compound the correction.

```sh
node scripts/prepare-vessel-clearance.mjs
/Applications/Blender.app/Contents/MacOS/Blender --background --python-exit-code 1 --python scripts/fit-vessel-clearance.py
node scripts/export-vessel-clearance.mjs
node --experimental-strip-types scripts/check-vessel-clearance.mjs
/Applications/Blender.app/Contents/MacOS/Blender --background --python-exit-code 1 --python scripts/check-vessel-clearance.py
```

The offline check decodes the exported asset and checks triangle intersections against actual ribs/cartilages in 75 rest/walk/run/blended-motion and breathing states, including simultaneous maximum arterial distension. This is a sampled regression check, not a proof of continuous collision freedom for arbitrary future motions.
