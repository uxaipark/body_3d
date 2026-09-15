# Locomotion capture

The data used in this project was obtained from mocap.cs.cmu.edu.
The database was created with funding from NSF EIA-0196217.

- Capture: [CMU Graphics Lab Motion Capture Database](https://mocap.cs.cmu.edu/).
- Walk: subject 35, trial 01, source frames 144–278 at 120 Hz.
- Run: subject 09, trial 01, source frames 8–94 at 120 Hz.
- BVH conversion: Bruce Hahne, [cgspeed](https://sites.google.com/a/cgspeed.com/cgspeed/motion-capture/cmu-bvh-conversion).
- Download mirror: [una-dinosauria/cmu-mocap](https://github.com/una-dinosauria/cmu-mocap).

CMU permits use in research and commercial products; the source motion dataset must not be resold directly, including converted copies. The converter imposes no additional restrictions.

The walking clip uses a steady straight-walking stride, selected between successive left-foot forward peaks; the opposite peak lies near the midpoint. The two sides are balanced against the mirrored opposite half-stride after retargeting. Captures are cyclically filtered offline, and walking gaze is stabilized horizontally.

The application distributes only short rig-specific derived animation cycles, not the source motion library. Joint directions and torso rotations are retargeted to the atlas skeleton with fixed bone lengths; horizontal travel is removed, foot heading noise and loop seams are corrected, and sole penetration is corrected at the shared pelvis. The capture's noisy and unmeasured finger channels are not used. This is animation retargeting, not a force-based musculoskeletal solver.

Rebuild with `node --experimental-strip-types scripts/build-mocap.mjs` after downloading the two BVHs into `.asset-cache/mocap/`. Exact input hashes and clip ranges are embedded in `lib/mocap-data.js`.

## Greeting and dance captures

- **Wave hello:** CMU subject 141, trial 16, “Wave Hello”; source frames 3–290, frame interval 0.0083333 s. The calibration frame is excluded. Right-arm greeting, 2.3916571 s loop.
- **Dance:** [CMU subject 103, trial 03](https://mocap.cs.cmu.edu/search.php?subjectnumber=103), “charleston_01” (jazz dance); source frames 31–423, frame interval 0.0083333 s, 3.2666536 s loop. A recurrent pose/velocity pair is selected inside the action.
- Source conversion and trial descriptions: [CMU BVH mirror](https://github.com/una-dinosauria/cmu-mocap), including its motion index and READMEFIRST terms. Original capture: [CMU Graphics Lab](https://mocap.cs.cmu.edu/).

Rebuild these clips with `node --experimental-strip-types scripts/build-expression-mocap.mjs` after placing `141_16.bvh` and `103_03.bvh` in `.asset-cache/mocap/`. Hashes, frame ranges, frame interval, and smoothing are embedded in `lib/expression-mocap-data.js`. The distributed files are short, rig-specific derived poses; the original motion library is not bundled.

Measured joint orientations and directions drive the motion, resampled near 60 Hz with quaternion interpolation and 35 ms offline cyclic smoothing. Loop correction removes endpoint mismatch. The greeting's feet use atlas-length IK and bounded pelvis sway; its palm convention is aligned to the atlas. Dance retains captured torso/knee motion and removes net horizontal travel. The unmeasured CMU finger channels are ignored; digits keep the open atlas pose. Retargeting and signal activity presets are illustrative, not clinical or force-based musculoskeletal validation.
