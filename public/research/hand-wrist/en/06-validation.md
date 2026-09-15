# 06. Validation plan and completion criteria

## Recorded verification status

At the 2026-09-13 documentation review, the last completed regression suite had 96 passing tests, with TypeScript and site builds passing. Demo installation, server, and assets were checked on macOS ARM64 and Ubuntu 22.04 Docker ARM64. Windows scripts received static checks; actual Windows execution was not verified.

These are historical implementation/demo results, not a claim that the suite was rerun during that document review. Detailed source records are in `docs/research/VALIDATION.md` and `docs/operations/demo-validation.md`. The matrix and stages B–F below remain planned validation.

## Initial wrist integration — historical scope

- The original 79 SOMA tests covered rigging, walking/running, skin binding, head stability, palms, chair/bed interaction, lungs, heart, vessels, and skin sections.
- Six added tests covered causal step response and duplicate-sample freezing, PWV² units, uplift/depression, atlas depth in CAP generation, fat-dependent channel changes with preserved timestamps, 29 bones and WASM structure, and section/contour/anatomy mode contracts.
- TypeScript passed. An offline GLSL compiler checked 138 regional-section vertex/fragment shaders. Browser-compatible loaders parsed 127 new GLB meshes, and existing WASM analysis returned results from 6.4 seconds of synthetic data.
- These checked numerical/software behavior, not clinical accuracy, human tissue modulus, photon transport, or BP error thresholds.

## Validation matrix

| Layer | Reference or test | Proposed completion criteria |
|---|---|---|
| Anatomy | Matched CT/MRI/US and segmentation review | Coordinates, side, units, landmark/surface error distributions, vessel normal depth/diameter uncertainty |
| Mesh | Self-intersection, watertightness, Jacobian, minimum element angle | No inverted solver elements; boundary and segmentation uncertainty recorded |
| Mechanics | Pressure–diameter curve, US displacement/strain, contact force | Independent frequency-dependent amplitude/phase and uplift/depression comparisons; ROM/FEM error bounds |
| Electrodes | Bench phantom, micromotion, impedance/CDC counts | Independent Cij, guard, temperature, moisture, gap, and preload sensitivity |
| Timing | Common trigger, scan metadata, known-delay phantom | Residual synchronization/skew/drift well below target PTT; otherwise mark PTT invalid |
| MRC/MVDR | Known delays, correlated noise, signed channels, motion seed, rank loss | Report fiducial bias, distortion, latency, rejection/coverage as well as SNR |
| SpO₂ | Optical phantom and suitable SaO₂ reference | Site/pigmentation/perfusion/motion bias, precision, missingness; independent generation/calibration data |
| BP | Independent people, sessions, reapplication, devices, valid reference | Compare with calibration-only baseline; within/between-person, trend, absolute error, drift, coverage |
| Web | Representative desktop/mobile workloads | Render/analysis cadence, memory, load, dropout; bound UI work without losing acquisition samples |

Freeze numerical error targets after defining use and hardware resolution. For example, 1 ms timestamp quantization may dominate a 0.5 ms local delay. Meeting an FPS target does not establish timing accuracy.

## Scenarios

Include rest, slow breathing, standing/sitting, grip/release, wrist flexion/extension, forearm pronation/supination, wrist-height changes, walking/running and recovery, lying down, preload sweeps, slipping, dropout, low perfusion, pigmentation/temperature changes, arrhythmia, independent stiffness/PEP variation, and long-term drift. Prefer factorial experiments separating physiology from sensor artifacts.

Check false BP changes when HR/PEP changes at constant true BP, and detection of BP changes at constant HR. Shared synthetic equations in training and testing demonstrate inverse-model self-consistency only.

## Stages

| Stage | Deliverables | Completion criteria |
|---|---|---|
| A. Integration | Hub, native body/wrist, ROM-channel coupling, records | Routes/assets, feature regression, generated-signal tests, build |
| B. Anatomy calibration | Matched-subject US sections, arterial centerline, tendon positions, atlas registration | Quantified normal-depth and sensor-position error; separate atlas and personal values |
| C. Sensor forward model | Mechanical/electrostatic phantoms, ROM LUTs | Independent amplitude/phase/contact/curvature validation; parameter confidence/provenance |
| D. Analysis core | Causal preprocessing, MRC/MVDR, timing-preserving dual beams, ECG frames | Runs without truth; known-delay, complex convention, unstable covariance, latency tests |
| E. Optics | Wrist reflectance/finger transmission, MCX LUTs, calibration | Energy/mesh/photon convergence and independent site-specific calibration |
| F. BP validation | Calibration protocol; independent cohorts/sessions/devices | PEP, exercise, posture, reapplication, drift reporting and failed-quality rejection |

## Next work and required evidence

Schemas, tests, adapters, MRC/MVDR porting, and scenarios can progress from the current code. Patient-specific anatomy, tissue properties, and clinical accuracy require real US/ECG/electrode recordings and reference measurements. Without them, complete human microanatomy or BP accuracy cannot be established.
