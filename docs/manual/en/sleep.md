# Sleep apnea experiment

## Getting started

Open Sleep apnea immediately after Whole-body twin in the top navigation. The epigastric patch shows three capacitive electrodes (C1–C3), ECG and an accelerometer. Skin and Patch focus controls reveal the exterior and thorax. The view reuses the full-body anatomical meshes.

Capacitance is the default respiratory input. Allow about 20–32 seconds of clean data. Optionally add ECG baseline respiration, accelerometer, breathing audio envelope and radar displacement. Compatible periods are fused by quality. Quality means periodicity, not clinical accuracy or a confidence interval.

Choose Supine, Left side, Right side or Turn in bed. The 3D pose and generated sensor data share a continuously changing orientation. Turning follows a 64-second cycle with two transitions and quiet intervals. Sleep transitions are authored, joint/contact-constrained animations, not captured sleep motions.

## Patch placement

Drag the patch directly, or enable Move patch and click the anterior chest. Camera rotation remains available away from the patch when move mode is off. Touch dragging is supported. Lateral placement ranges from 8 cm right to 8 cm left in the patient's frame; height ranges from 6 cm below to 20 cm above the initial epigastric position. Sliders remain usable when side lying hides the patch. The circular-arrow icon resets only its position.

The curved patch follows the actual fitted skin triangles during breathing and posture changes. Export records patchPlacement in atlas-bind metres (X toward the patient's left, Y upward). In simulation mode, actual skin coordinates of all three electrodes update the ECG lead voltage and regional CAP coupling. Repositioning marks an artifact interval. External socket samples are never modified or synthesized when the patch moves.

## Physical and electrical model

The single-compartment lung obeys R·dV/dt + V/C_L = P_mus. V is volume above functional residual capacity (litres), C_L is compliance (L/cmH₂O), and R is airway resistance (cmH₂O·s/L). Integrating this equation produces flow and volume from muscular pressure and passive relaxation. Thoracic excursion follows volume and respiratory effort, with millimetre-scale motion under the default normal conditions.

Each pad uses C_total = C_parasitic + ε₀·ε_eff·A_eff/d_eff. The model includes effective area strain, electrical gap changes, contact movement and noise. Effective permittivity and gap are calibration parameters approximating a fringe field. The pads do not form literal parallel plates across the lung, and capacitance is not a direct absolute lung-volume measurement. A detailed extension needs individual CT/MRI segmentation, electrical FEM and simultaneous airflow/spirometer calibration.

ECG sums three-dimensional current dipoles for P, Q, R, S and T and evaluates φ = p·r/(4πσ|r|³) in a homogeneous quasi-static volume conductor. Positions use metres, dipole moments A·m and conductivity S/m; potentials are converted to mV. The modeled lead is C3−C1, with C2 as reference. This is an explicit research wiring assumption, not verified device wiring. Placement changes amplitude, polarity and P/QRS/T ratios; distance alone need not change amplitude monotonically. Respiration changes source orientation/position and the local electrode-interface baseline. Default conductivity (0.2 S/m) and dipole magnitude are effective research parameters, not individual calibration.

Regional CAP coupling uses 541 anterior-surface samples from the actual five lung lobes and each pad's skin coordinates. A 30 mm spatial kernel, depth attenuation, an abdominal effort footprint and effective fat thickness determine local excursion, which changes A_eff and d_eff. The small direct dielectric term decays as exp(−2π·depth/28 mm) for coplanar electrodes. The default epigastric site lies below the lungs and mainly follows abdominal mechanical coupling. This is not an electrical FEM resolving deep lung sensing. Default fat thickness (8 mm), kernels and attenuation lengths are uncalibrated assumptions. scripts/build-sleep-anatomy.mjs regenerates the spatial samples and input-mesh hashes.

Acceleration combines orientation, angular and centripetal acceleration, local respiratory acceleration and noise: a_sensor = Rᵀ[g + α×r + ω×(ω×r) + a_resp] + noise. Patch X runs from C1 to C3, Y follows the skin toward the head, and Z points outward. All three axes include gravity and noise; the stationary vector magnitude is approximately 9.81 m/s². Respiratory fusion evaluates all three axes and uses the strongest valid periodicity candidate.

## Reading the traces

Eight separate rows show CAP C1/C2/C3, ECG, ACC X/Y/Z and EDR. CAP and ACC share a scale within each modality, with separate channel centers and numeric axes in original units. ECG uses a selectable fixed ±0.5/1/2/5 mV range, with a CLIP indicator outside the range. Automatic gain therefore cannot hide placement-dependent ECG amplitude. For multiple external channels of the same kind, the newest channel is drawn; active channels remain available to analysis.

EDR comes from acquired ECG through causal 200/600 ms median filters and low-frequency baseline processing, with filter delay. It is not drawn from respiratory-rate or lung-volume truth. HR uses polarity-independent adaptive detection and measured beat intervals.

During sleep, the upper arm gathers toward the front of the body and the lower arm reaches toward the mattress. Continuous joint poses replace the extra rotations that raised the arms with the torso. Exterior support samples constrain mattress contact; this is authored animation, not captured sleep motion or personalized contact FEM.

All parameters are research examples. Calibrate geometry, dielectric properties, effective electrical distance, device noise and mechanics against the actual patch.

## Estimation and labels

Capacitance uses the three-pad mean. ECG supplies a low-frequency baseline and a separate R-peak heart-rate estimate. ACC, radar and audio provide additional respiratory candidates. Up to 32 seconds are uniformly resampled, detrended and evaluated by autocorrelation over 6–35 breaths/min. Candidates must pass periodicity and median-rate agreement tests, then combine with squared-quality weights. Reference respiratory rate and volume never enter the estimator.

ACC motion/gravity changes, rapid capacitance changes and camera motion features classify artifacts. ACC/video motion gating remains active independently of respiratory-fusion switches. A 2.5-second post-motion guard precedes collecting a new clean window. Missing, stale, discontinuous or poorly periodic signals do not receive a fabricated respiratory rate.

The obstructive scenario increases resistance at seconds 25–43 of each 60-second cycle while retaining effort. The central comparison removes respiratory drive over the same interval. These event labels are scenario truth, not detected diagnoses. CAP alone cannot establish airflow cessation, clinical AHI, sleep stages or apnea type.

## Socket protocol

Select WebSocket / IP and connect to a WS/WSS gateway. Switching between synthetic and external modes clears the buffers. One connection multiplexes up to 32 channel IDs. All producers must timestamp against a common session start in seconds. Device clock synchronization and transport-delay correction belong at the gateway.

Example JSON packet: {"version":1,"channel":"patch-1","kind":"cap","unit":"pF","t0":10.0,"fs":25,"samples":[[14.21,15.07,15.88],[14.23,15.09,15.90]]}

- version: 1. channel: unique device/channel string, up to 64 characters. kind: one of the types below.
- t0: first sample time in session seconds. fs: 1–2000 Hz. Sample i occurs at t0 + i/fs.
- samples: 1–2000 per packet. Maximum JSON frame: 1 MB. Duplicate or reversed channel timestamps, invalid units/dimensions and nonfinite values are rejected.
- cap: [C1,C2,C3], pF. ecg: scalar, mV. acc: [ax,ay,az], m/s2, including gravity.
- breathAudio: nonnegative RMS envelope, rms. snore: probability in [0,1], probability.
- camera: motion score in [0,1], motion. radar: [respiratory displacement,x,y,z], mm. airflow: signed flow, L/s.
- Send all patch-frame ACC XYZ components. Align device axes and units at the gateway. Fusion selects the strongest valid periodic axis.

The browser does not process raw TCP, RTSP or radar IQ. Extract audio RMS, snore probability, video motion and radar displacement/position at the device/gateway. Raw audio/video can be monitored separately through a browser-supported HTTP(S) file or stream. This version does not include a trained snore classifier or video pose-estimation model.

## Local gateway

In the web folder, run npm ci, then npm run sleep:demo. Connect the local page to ws://localhost:8765/stream to receive the physical simulator over an actual socket. For devices, run npm run sleep:gateway. Producers send v1 JSON packets to ws://localhost:8765/input; the browser subscribes at /stream. Demo mode does not accept device input.

The default interface is 127.0.0.1. Set SOMA_SLEEP_HOST for LAN input and SOMA_SLEEP_PORT for the port. Mac/Linux: SOMA_SLEEP_HOST=0.0.0.0 npm run sleep:gateway. Windows PowerShell: $env:SOMA_SLEEP_HOST='0.0.0.0'; npm run sleep:gateway.

Use WSS from the public HTTPS site, or WS from the local HTTP demo. The sample gateway has no authentication and is for local research; Internet deployment requires a gateway with authentication and TLS. The browser processes data locally without additional cloud storage.

Export saves the latest 12 seconds of raw buffers, current estimates, up to 500 label transitions and synthetic settings as JSON. It is not a complete overnight or raw-media recorder.

## Sources and validation scope

Epigastric capacitive respiratory monitoring: https://pubmed.ncbi.nlm.nih.gov/32643322/ . This supports the choice of approach, not the accuracy of this simulator.

ECG synthesis reference: https://physionet.org/content/ecgsyn/1.0.0/ . Respiratory event scoring and effort/airflow distinction: https://pmc.ncbi.nlm.nih.gov/articles/PMC3459210/ . WebSocket gateway: https://github.com/websockets/ws . Company details, clinical performance figures and internal schedules from the supplied concept deck are not reproduced in this public manual.

Lead-field reference: [Three-dimensional ECG dipole model](https://www.mit.edu/~gari/papers/eurasipReza06.pdf). Chest-wall capacitance reference: [Capacitive respiratory patch study](https://pmc.ncbi.nlm.nih.gov/articles/PMC6956860/). Spatial kernels and coefficients in this implementation are separate research approximations.
