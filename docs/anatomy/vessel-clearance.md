# Thoracoabdominal vessel clearance

갱신: 2026-09-13 · 현재 코드 기준 구현 기록. 재생성 명령은 `web` 루트에서 실행합니다.


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

## 손목 위치 조절과의 구분

이 문서는 흉복부 혈관의 갈비뼈 경계 보정 절차입니다. 손목 요골동맥 연결 유지와 위치 이동은 `public/simulators/radial/js/arteryDeformation.js` 및 `wrist3d/nativeAtlas.js`가 담당합니다. 두 모델의 공간 보정은 서로 다른 영역에 적용되며, 전신 혈류 또는 전신 혈관 접촉 해석을 구성하지 않습니다.

현재 손목은 원본 요골동맥과 손바닥 동맥궁 경로를 보존하고 끝단 고정/중간 이동장을 공유합니다. 맥동은 조직 전달식으로 표현하며 빨간 재질로 표시합니다. 좌우·깊이 슬라이더는 3D 아래에 있습니다.
