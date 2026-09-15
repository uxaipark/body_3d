# 04. Forward simulator architecture

## Implemented reduced model

This is a first step toward experiments with the causal chain from vessels through tissue to electrodes. Material properties and boundary conditions below are adjustable model assumptions.

```
Cardiac pressure(t) + vascular delay + hydrostatic offset
  → ΔP(t), distensibility, contact/preload
  → Δr_target = r0 × 133.322 × ΔP / (2 ρ PWV²)
  → Δr[n] = Δr[n−1] + (Δr_target−Δr[n−1]) × (1−exp(−Δt/τ))
  → signed surface transfer(depth, lateral distance, fat) × Δr
  → finite pad footprint + support/contact/patch rocking
  → ΔC = effective sensitivity[pF/mm] × displacement[mm] × areaScale
  → electronics/noise/saturation model → acquisition channels
```

Circular radius sensitivity follows the small-strain Bramwell–Hill relation. Representative values are ρ=1060 kg/m³, reference PWV=6 m/s, r0=1.1 mm, τ=0.018 s, and effective capacitance sensitivity=11.15 pF/mm. The original engine also applies stiffness/PWV distensibility; its multiplier must not be applied a second time through PWV². Large compression, vessel collapse, and nonlinear wall responses exceed this linear approximation.

A difference of two Gaussians represents uplift above the artery and depression around it under assumed support/contact conditions. It does not imply that skin displacement must integrate to zero merely because tissue is nearly incompressible. The arterial volume increases; axial and depthwise tissue flow and boundary conditions determine the response.

Relaxation state belongs to each channel's acquisition sample index. Repeated queries at the same index do not advance physics. This branch bypasses the original zero-phase mechanical shaping, preserves synthetic timestamps, and does not use future samples to calculate the present response.

The view receives radius changes and channel surface displacement through `latest.tissue`. Skin, fat, muscle, and vessels share the local displacement-field form; bone meshes remain rigid. CPU/GPU cross-section displacement uses the same reduced relationship. Layer overlap, approximate bone support, finite-pad averaging, and contact mean a channel need not equal one displayed surface point. This is not a complete FEM stress field or a conservative contact solver.

## Target forward model

| Block | Inputs and outputs | Strategy |
|---|---|---|
| Heart | HR/RR, SV, TPR, PEP → central flow/pressure, ECG | Cardiac core plus independent ECG generator; separate ECG R and aortic opening |
| Vascular network | Centerlines, branches, walls, terminal resistance → pressure, flow, reflections | 1D hemodynamics and local compliant wall; calibrated boundaries |
| Soft tissue | Δr, tendon sliding, preload → displacement, stress, contact | Offline nearly incompressible hyperelastic/viscoelastic analysis; online ROM/LUT |
| Electric field | Geometry, gap, sweat, dielectric, guard → Cij | Offline electrostatic FEM/BEM; guarded/self/mutual topology LUTs |
| Optics | μa, μs′, g, n, Hb/HbO₂, LED/PD → red/IR photons | Segmented-volume Monte Carlo, then transfer LUT |
| Sensor/ADC | Drive, charge noise, LED multiplexing, clipping, skew → counts | Compare with AFE circuit and scan table; retain hardware timing |
| Estimator | Observed channels, ECG, timestamps, calibration → BP/SpO₂/quality | No access to truth; independent evaluator |

Anisotropy, fibrous septa, tendon-sheath sliding, and friction matter even when skin and fat are nearly incompressible. Treat bones as rigid bodies, distinguish tendon longitudinal tension from transverse contact, and constrain joints by axes and limits. Uniformly shrinking muscle or fat around an initial skeleton is not a substitute for anatomical layers.

`C=εA/d` is an ideal parallel-plate reference. Wrist curvature, fringing, guards, mutual coupling, and electrode–skin gaps require Cij. The current 11.15 pF/mm is an effective sensitivity, not a measured FDC/CDC calibration coefficient.

Separate wrist reflectance from finger transmission. Wavelength, spacing, absorption, and scattering determine how many paths reach fat or return from superficial plexuses; not all paths cross the main radial artery. [MCX](https://mcx.space/) is a candidate offline solver, with convergence, boundary, and energy checks before web LUT export.

## Electrode array

A virtual example preset has 3 rows × 4 columns, 3 × 3 mm pads, 0.5 mm gaps, 3.5 mm pitch, and a half-pitch stagger in the middle row. Calculate dimensions from coordinates: ordinary four-column width is 13.5 mm and three-row height is 10 mm; a 1.75 mm shifted row can produce a 15.25 mm bounding width. Keep substrate margins, shields, and package dimensions separate from electrode footprints.

Channel names and ADC scan indices are distinct. Physical hardware requires an explicit mapping among pads, circuit pins, scan order, wearing side, and mirrored coordinates.

## Timing and execution

- Acquisition uses integer sample indices and a monotonic master clock. Record device epoch, offset, drift, and per-channel ADC skew.
- Representative native CAP acquisition is 1 kHz; compare other supported rates such as 2 kHz. A 16 kHz zero-order hold does not create 16 kHz independent measurements.
- Preserve native ECG and red/IR timestamps. Resampling metadata records source rate, filter delay, and error.
- Run online analysis in Worker/WASM; render at 30–60 fps, decimate plots, and limit hidden-tab workload. Analysis state must not depend on render frequency.
- Run FEM/Monte Carlo offline. Online ROMs should detect inputs beyond validated bounds.

The proposed [acquisition schema](/research/hand-wrist/acquisition-frame.schema.json) is a v2 ECG extension design, not an immediate replacement of existing Rust frames. Keep truth in separate simulator-only buffers/files, outside estimator input.
