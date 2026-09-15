# 02. Simulator Architecture and Integration

## Current components

| Component | Function | Interpretation |
| --- | --- | --- |
| Whole-body view | Anatomical systems, joint motion and skin | Atlas-based virtual model |
| Wrist view | Bones, muscles, tendons, vessels, nerves, skin and curved patch | Reference anatomy before individual registration |
| Signal generation | Cardiac, capacitance, optical and motion-related channels | Simulation under specified inputs |
| Analysis | MRC, waveforms, delays, BP/SpO₂ comparisons | Synthetic-model analysis, not clinically validated performance |
| Data flow | Worker-based signals delivered to the display | Display traces remain separate from raw analysis samples |

## Connecting tissue and sensors

Pressure-driven radius changes pass through causal tissue relaxation to surface displacement. Electrode position, area and contact affect capacitance generation. The 3D display gain changes visualization only.

Patch and artery adjustments share coordinates across 3D, cross-sections, snapshots and signal generation. Geometric agreement does not establish tissue-property or contact accuracy.

## Analytical precautions

- Keep waveform alignment/combination separate from the path used for delay measurement.
- Do not use display-decimated samples as the timing-analysis source.
- Keep synthetic truth in evaluation, separate from estimator observations.
- Document filter causality/group delay, inter-channel acquisition timing and coordinate units.
- Generating and inverting the same synthetic relationship does not demonstrate real BP/SpO₂ accuracy.

## Extensions

MVDR, real ECG frames, PAT/PTT/PEP separation, individual wrist registration and independent-data evaluation follow the [signal pipeline](05-signal-pipeline.md) and [validation plan](06-validation.md).
