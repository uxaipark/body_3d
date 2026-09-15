# Sleep apnea experiment

## Getting started

Open Sleep apnea immediately after Whole-body twin in the top navigation. The epigastric patch shows three capacitive electrodes (C1–C3), ECG and an accelerometer. Skin and Patch focus controls reveal the exterior and thorax. The view reuses the full-body anatomical meshes.

Capacitance is the default respiratory input. Allow about 20–32 seconds of clean data. Optionally add ECG baseline respiration, accelerometer, breathing audio envelope and radar displacement. Compatible periods are fused by quality. Quality means periodicity, not clinical accuracy or a confidence interval.

Choose Supine, Left side, Right side or Turn in bed. The 3D pose and generated sensor data share a continuously changing orientation. Turning follows a 64-second cycle with two transitions and quiet intervals. Sleep transitions are authored, joint/contact-constrained animations, not captured sleep motions.

## Physical and electrical model

The single-compartment lung obeys R·dV/dt + V/C_L = P_mus. V is volume above functional residual capacity (litres), C_L is compliance (L/cmH₂O), and R is airway resistance (cmH₂O·s/L). Integrating this equation produces flow and volume from muscular pressure and passive relaxation. Thoracic excursion follows volume and respiratory effort, with millimetre-scale motion under the default normal conditions.

Each pad uses C_total = C_parasitic + ε₀·ε_eff·A_eff/d_eff. The model includes effective area strain, electrical gap changes, contact movement and noise. Effective permittivity and gap are calibration parameters approximating a fringe field. The pads do not form literal parallel plates across the lung, and capacitance is not a direct absolute lung-volume measurement. A detailed extension needs individual CT/MRI segmentation, electrical FEM and simultaneous airflow/spirometer calibration.

ECG is an original P–QRS–T component model with respiratory baseline swing, R-wave amplitude modulation and respiratory heart-rate variation. It draws on the public ECGSYN description without implementing its code or claiming its validation. Acceleration follows a_sensor = Rᵀ·g + d²x/dt² + noise, combining orientation-dependent gravity, epigastric dynamics and noise.

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
- ACC x is the calibrated respiratory/tilt-sensitive axis. Align device axes at the gateway if necessary.

The browser does not process raw TCP, RTSP or radar IQ. Extract audio RMS, snore probability, video motion and radar displacement/position at the device/gateway. Raw audio/video can be monitored separately through a browser-supported HTTP(S) file or stream. This version does not include a trained snore classifier or video pose-estimation model.

## Local gateway

In the web folder, run npm ci, then npm run sleep:demo. Connect the local page to ws://localhost:8765/stream to receive the physical simulator over an actual socket. For devices, run npm run sleep:gateway. Producers send v1 JSON packets to ws://localhost:8765/input; the browser subscribes at /stream. Demo mode does not accept device input.

The default interface is 127.0.0.1. Set SOMA_SLEEP_HOST for LAN input and SOMA_SLEEP_PORT for the port. Mac/Linux: SOMA_SLEEP_HOST=0.0.0.0 npm run sleep:gateway. Windows PowerShell: $env:SOMA_SLEEP_HOST='0.0.0.0'; npm run sleep:gateway.

Use WSS from the public HTTPS site, or WS from the local HTTP demo. The sample gateway has no authentication and is for local research; Internet deployment requires a gateway with authentication and TLS. The browser processes data locally without additional cloud storage.

Export saves the latest 12 seconds of raw buffers, current estimates, up to 500 label transitions and synthetic settings as JSON. It is not a complete overnight or raw-media recorder.

## Sources and validation scope

Epigastric capacitive respiratory monitoring: https://pubmed.ncbi.nlm.nih.gov/32643322/ . This supports the choice of approach, not the accuracy of this simulator.

ECG synthesis reference: https://physionet.org/content/ecgsyn/1.0.0/ . Respiratory event scoring and effort/airflow distinction: https://pmc.ncbi.nlm.nih.gov/articles/PMC3459210/ . WebSocket gateway: https://github.com/websockets/ws . Company details, clinical performance figures and internal schedules from the supplied concept deck are not reproduced in this public manual.
