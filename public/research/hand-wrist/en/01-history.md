# 01. Development Overview and Current Features

The [feature history](git-history.md) summarizes the public simulator. Historical surface models are distinguished from the current anatomy.

## Whole-body platform

| Requirement or issue | Current behavior | Evidence / limitation |
| --- | --- | --- |
| Whole-body circulatory, respiratory and neural experiments | Separate skeleton, muscle, cardiovascular, visceral, neural and skin layers | Simplified atlas GLBs; not every microvessel or organ electrophysiology |
| Skin and sensor selection | Skin starts off; multiple sensors or none; bilateral muscle display | Anatomy and sensor controls |
| Surface/anatomy registration | BodyParts3D skin shares the body atlas | Historical MakeHuman assets are not the current surface |
| Surface folding at joints | Native skin, smoothing, bone-heat binding and dual-quaternion deformation | Not whole-body material FEM |
| Bent bones and centerline splitting | Joint rotations, rigid bone binding and connected pelvis | 51-bone rig, up to four weights, articulated fingers |
| Gait, knee motion, head stability and palm orientation | Retargeted captures, cycle filtering, ground contact and vertical displacement | CMU walk 35_01 / run 09_01; not a clinical gait-analysis model |
| Lung/liver/vessel rib penetration | Respiratory display boundaries, inward liver adjustment and vessel coupling | Precomputed geometric constraints |
| Rigid-looking heart motion and unclear lung boundary | Continuous contraction/twist/relaxation and cardiac display space | Not heart–lung contact mechanics |
| Arterial pulsation | Small radius changes with peripheral delay | Display pulse-wave model |
| Motion-dependent tissue response | Shared reduced soft-tissue displacement field | Respiratory, abdominal and anterior-vessel coupling |

## Sensors, skin and interface

- Sensor sites include wrist, finger, earlobe, forehead, chest and upper arm. Multiple sites or none may be active.
- ECG, PPG, EEG, EMG, respiration and capacitance synthetic channels support CSV export. Settings follow signal modality.
- Side panels collapse, sensor tips close, and the left scrollbar gutter prevents layout shifts.
- Twelve skin regions open a 3D section with epidermis, dermis, fat, vessels and region-specific bone/muscle/tendon structures.
- Radial uplift and surrounding depression, curved surfaces, longitudinal context, grids and contours are shown with deep-support constraints.
- Optical paths are educational illustrations. Whole-body SpO₂ is an input, not a validated inverse estimate. Noninvasive glucose estimation is not implemented.

## Postural tasks

Standing, repeated sit-to-stand, hand grip and bed transfer are available. Seated skin support constrains chair penetration. The bed is behind the standing body; the body sits at its left edge, supports itself with one hand, lowers sideways, extends the legs and rolls supine. The left arm remains extended during lowering. Distal joint instability and close-up visibility were corrected.

Comfort mode starts on and hides external genital anatomy without an artificial cover sphere. Bones, muscles, skin and sensors share the rig. Task CSV includes phase, repetitions and effort/activity indicators. Effort is an input/synthetic curve, not validated physiological workload.

## Principles to retain

The current skin is `skin-atlas-web.glb` in the shared anatomical frame. Do not restore historical skin/rigging inadvertently. Joint motion must not be replaced by half-body splitting or nonuniform bone scaling. Ground, chair and bed support use native skin samples. Sensors and skin remain optional; comfort mode starts enabled.
