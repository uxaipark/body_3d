# 05. MRC, MVDR, ECG, and continuous BP algorithm design

## Separate observations from truth

Estimators see only available electrode channels, ECG, red/IR, IMU, timestamps, and device calibration. True vessel depth, PWV, pressure, input SaO₂, and oracle coupling are evaluation-only. Recovering synthetic BP by inverting its generating equation checks implementation consistency, not clinical accuracy.

Define the target pressure location. Local radial waveform, central aortic pressure, and cuff-referenced brachial SBP/DBP/MAP are different outputs. The initial target is personally cuff-calibrated estimated SBP/DBP/MAP, quality, confidence intervals, and calibration age. Evaluate beat-to-beat trends separately from absolute accuracy.

## 1. Acquisition and quality

Resolve channel ID–pad position–ADC order. Save ADC timestamps and LED illumination intervals, retain raw data, and make a skew-corrected analysis copy. Flag clipping, flatline, dropout, excessive pressure, poor contact, motion, and timestamp jumps.

Separate CAP/PPG DC and AC while retaining DC changes for contact/optical diagnostics. Real-time filters must be causal and report group delay in waveform timestamps. Display and delay-measurement pipelines need distinct IDs. IMU regression or adaptive cancellation can remove pulse-correlated motion components that contain useful signal; limit weights or reject estimates when quality degrades.

## 2. MRC

For `x_i(t)=g_i s(t−τ_i)+n_i(t)`, independent-noise combining uses `w_i ∝ conjugate(g_i)/σ_i²`. Do not discard negative waveforms solely because coupling is signed. The existing web MRC performs three iterations using a data-derived template and residual variance. Check weight saturation, variance floors, and leave-one-channel-out stability.

Distinguish oracle SNR, which uses reference pressure, from observation-only online SQI/SNR surrogates. Amplitude or variance alone can select a motion-dominated seed; also use beat coherence, saturation, and IMU gating.

## 3. MVDR

Define frequency-bin observations `x(f)`, noise covariance `R_n(f)`, and desired pulse transfer vector `a(f)`.

```
R_loaded = (1−λ) R_n + λ diag(R_n) + α trace(R_n)/M · I
w = solve(R_loaded, a) / (aᴴ solve(R_loaded, a))
y = wᴴ x
```

Use a Hermitian positive-definite solve rather than an explicit inverse. Check weight limits, condition number, white-noise gain, desired-signal distortion, and rank after dropout. Fall back to regularized MRC for unstable covariance or steering, and record the reason. Whole-window covariance can place the target pulse in the noise subspace; compare noise intervals, residuals, and robust steering.

This is not an ultrasound beamformer. Steering combines vascular propagation and tissue–patch–electrical transfer: `a_i(f)=H_i(f) exp(−j2πfτ_i)`. Phase in H includes viscoelastic and electronic delays. Low-frequency pulses over millimeter baselines have small inter-channel propagation phase; much of the combining gain may come from amplitude/noise weighting. Improved local PTT resolution needs separate evidence.

Planned extensions include basic MVDR, shrinkage/diagonal loading, and subband analysis using verified spectral/complex linear algebra and causal preprocessing. The current MRC display is not labeled MVDR.

## 4. Preserve a separate delay path

```
raw calibrated channels
 ├─ whole-array aligned MRC / MVDR → morphology, SNR, display
 └─ proximal cluster beam + distal cluster beam (separate time origins)
       → fiducial/phase-slope/correlation lag → local PTT + uncertainty
ECG R → wrist foot / finger foot → PAT
wrist foot → finger foot → inter-site transit, including modality bias
```

A single beam aligning every channel to one time removes the original proximal–distal delay. Do not estimate local PTT from that beam alone. Preserve differential delay while compensating common delay, with matched filters and timestamps. Test whether feet from different sensing mechanisms represent the same pressure fiducial.

3.5 mm / 5–10 m/s gives 0.35–0.7 ms, below the 1 ms interval of a 1 kHz ADC. Fractional interpolation and cross-spectra can help with sufficient SNR and repeatability but do not create information. Include waveform differences, TDM skew, viscoelastic phase, position error, and contact pressure in the error budget. Reject forced PWV/BP output when delay uncertainty exceeds the effect being measured.

## 5. ECG, HR, and PEP

`HR=60/RR`, `PAT=R→peripheral foot`, and `PAT=PEP+vascular PTT+instrument/fiducial offsets`. ECG-started intervals are not automatically PTT. Adding HR does not remove PEP variation from autonomic state, contractility, preload, or afterload. [Payne et al.](https://pubmed.ncbi.nlm.nih.gov/16141378/).

Record ECG R, aortic opening, radial arrival, and finger arrival separately in truth, but pass only ECG/sensor waveforms to estimators. Treat unmeasured PEP as a nuisance state or uncertainty. Where available, independently validate mechanical onset with ICG/SCG/ultrasound. Use valid-beat RR and foot matching for arrhythmia and extrasystoles.

## 6. SpO₂

Compute `R=(AC_red/DC_red)/(AC_ir/DC_ir)` and use device/site-specific calibration. Preserve sequential red/IR timing and flag ambient subtraction issues, clipping, low perfusion, and motion. Wrist reflectance, index-finger transmission, and index-finger reflectance need separate calibration models.

Inverting the existing synthetic ratio model is not human validation. Develop tissue optical forward models and estimation calibration from independent data. Where possible, stratify pigmentation using objective measurements and separate temperature, perfusion, and wearing pressure. Performance comparisons require an appropriate arterial reference. The research review recorded the [2025 FDA document](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/pulse-oximeters-medical-purposes-non-clinical-and-clinical-performance-testing-labeling-and) as a draft, distinct from the [2013 final guidance](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/pulse-oximeters-premarket-notification-submissions-510ks-guidance-industry-and-food-and-drug); this translation does not update regulatory status.

## 7. BP models and calibration

1. Start with a personally cuff-calibrated baseline using PAT/PTT, HR, morphology, posture, and contact covariates.
2. Constrain SBP/DBP/MAP consistency and quantify uncertainty. Keep radial-to-brachial mapping separate.
3. One-point calibration cannot determine every slope. Specify slope priors plus intercept adjustment versus multipoint calibration.
4. Hold out calibration drift, reapplication, exercise recovery, skin temperature, and vasomotor changes.
5. Return no estimate and a reason when quality fails. Do not silently present an old value as a current estimate.

Hydrostatic offset is `ΔP=ρgΔh`, approximately 0.78 mmHg/cm at ρ=1060. Define height sign and reference. Validate rig coordinates against measured kinematics rather than using an inaccurate surrogate length when the displayed posture changes.

The simulator is for research and does not replace accuracy/reliability validation for clinical use. See the [AHA statement](https://professional.heart.org/en/science-news/cuffless-devices-for-the-measurement-of-blood-pressure).
