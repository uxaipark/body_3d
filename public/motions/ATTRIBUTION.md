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
