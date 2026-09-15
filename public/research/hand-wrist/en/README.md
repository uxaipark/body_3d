# SOMA Development Record and Wrist Sensing Research

Updated: 2026-09-15. This collection describes current simulator features and public research designs. SOMA is the Greek word σῶμα, meaning body; it is not defined as an acronym.

Current implementation, proposed extensions and public literature are distinguished. An implemented research feature does not establish patient-specific anatomy or clinical BP/SpO₂ accuracy.

## Reading order

- [Performance and wrist interaction changes](07-performance.md)

1. [Development overview and current features](01-history.md): anatomy, skin, joints, organs and motion.
2. [Simulator architecture and integration](02-code-audit.md): components, signal flow and extension scope.
3. [Hand/wrist anatomy and modeling](03-anatomy.md): structures, literature values, data, licenses, coordinates and uncertainty.
4. [Forward simulator](04-forward-model.md): hemodynamics, vessel wall, tissue, electrodes, optics and acquisition contracts.
5. [MRC/MVDR/ECG and continuous BP](05-signal-pipeline.md): waveform refinement, timing preservation, calibration and quality.
6. [Validation and roadmap](06-validation.md): numerical, physical, measurement and participant validation.
7. [References](references.md) and [feature history](git-history.md).
8. [Acquisition schema](/research/hand-wrist/acquisition-frame.schema.json) and [example scenario](/research/hand-wrist/scenario.example.json).

## Running features

- `/` introduces the simulators. Navigation connects Whole-body Twin, Wrist Sensing, Research and User Guide. 한국어 / EN selects a persisted interface/document language.
- `/manual` provides operating instructions and macOS/Windows/Linux demo installation. OS validation details are maintained in the source's operational documentation.
- `/simulators/body` preserves the whole-body anatomy, sensors and motion tasks.
- `/simulators/wrist` integrates a separate engine with MRC, local delays, PPG/SpO₂, BP-estimation comparisons and patch placement.
- The avatar uses the whole-body anatomical meshes and joint rig.
- The right hand/distal forearm comes from the same atlas: 29 bone meshes, 52 muscle/tendon/fascia structures, 23 vascular structures and 22 neural structures. These are named mesh counts, not a completeness claim.
- Skin, anatomical layers, 3D tissue sections and surface contours are available. Fat boundaries are representative layers derived from skin, not MRI-segmented fat.
- Pressure drives radial expansion, causal tissue relaxation and finite-pad capacitance. Radius and surface displacement reach the display. Display gain ×1–8 is not multiplied into signals.

## Planned work

Individual ultrasound/MRI registration, segmented fat and tendon volumes, nonlinear contact FEM, optical Monte Carlo validation, frequency-domain MVDR integration, real ECG frames and PEP separation, and independent clinical BP/SpO₂ evaluation remain research work. A design document does not mean implementation or clinical validation is complete.
