// Reference list: which papers / standards / textbooks each feature of the digital twin and the
// analysis core is based on. Rendered in the top-bar "Reference" menu and exported to
// docs/REFERENCES.md (node eval/gen_references.mjs).
//
// Each reference: { id, cite }.  Each feature group: { group, items: [{ feature, where, refs: [ids], note }] }.

export const REFERENCES = [
  // ---- Arterial haemodynamics / pulse physiology -------------------------------------------------
  { id: 'moens1878', cite: 'Moens, A. I. (1878). Die Pulscurve. Leiden: E. J. Brill; Korteweg, D. J. (1878). Über die Fortpflanzungsgeschwindigkeit des Schalles in elastischen Röhren. Annalen der Physik, 241(12), 525–542.' },
  { id: 'bramwell1922', cite: 'Bramwell, J. C., & Hill, A. V. (1922). The velocity of the pulse wave in man. Proceedings of the Royal Society B, 93(652), 298–306.' },
  { id: 'nichols2011', cite: "Nichols, W. W., O'Rourke, M. F., & Vlachopoulos, C. (2011). McDonald's Blood Flow in Arteries: Theoretical, Experimental and Clinical Principles (6th ed.). Hodder Arnold." },
  { id: 'murgo1980', cite: 'Murgo, J. P., Westerhof, N., Giolma, J. P., & Altobelli, S. A. (1980). Aortic input impedance in normal man: relationship to pressure wave forms. Circulation, 62(1), 105–116.' },
  { id: 'westerhof2009', cite: 'Westerhof, N., Lankhaar, J.-W., & Westerhof, B. E. (2009). The arterial Windkessel. Medical & Biological Engineering & Computing, 47(2), 131–141.' },
  { id: 'avolio2009', cite: 'Avolio, A. P., Van Bortel, L. M., Boutouyrie, P., et al. (2009). Role of pulse pressure amplification in arterial hypertension. Hypertension, 54(2), 375–383.' },
  { id: 'kelly1989', cite: "Kelly, R., Hayward, C., Avolio, A., & O'Rourke, M. (1989). Noninvasive determination of age-related changes in the human arterial pulse. Circulation, 80(6), 1652–1659." },
  { id: 'refvalues2010', cite: "The Reference Values for Arterial Stiffness' Collaboration (2010). Determinants of pulse wave velocity in healthy people and in the presence of cardiovascular risk factors: 'establishing normal and reference values'. European Heart Journal, 31(19), 2338–2350." },
  { id: 'netea2003', cite: 'Netea, R. T., Lenders, J. W. M., Smits, P., & Thien, T. (2003). Influence of body and arm position on blood pressure readings: an overview. Journal of Hypertension, 21(2), 237–241.' },
  { id: 'baruch2011', cite: 'Baruch, M. C., Warburton, D. E. R., Bredin, S. S. D., et al. (2011). Pulse decomposition analysis of the digital arterial pulse during hemorrhage simulation. Nonlinear Biomedical Physics, 5(1), 1.' },
  { id: 'chen1997', cite: 'Chen, C.-H., Nevo, E., Fetics, B., et al. (1997). Estimation of central aortic pressure waveform by mathematical transformation of radial tonometry pressure: validation of generalized transfer function. Circulation, 95(7), 1827–1836.' },
  // ---- Cardiac rhythm ----------------------------------------------------------------------------
  { id: 'taskforce1996', cite: 'Task Force of the European Society of Cardiology and the North American Society of Pacing and Electrophysiology (1996). Heart rate variability: standards of measurement, physiological interpretation and clinical use. Circulation, 93(5), 1043–1065.' },
  { id: 'tateno2001', cite: 'Tateno, K., & Glass, L. (2001). Automatic detection of atrial fibrillation using the coefficient of variation and density histograms of RR and ΔRR intervals. Medical & Biological Engineering & Computing, 39(6), 664–671.' },
  // ---- Wrist anatomy / capacitive & tonometric sensing --------------------------------------------
  { id: 'gray2016', cite: "Standring, S. (Ed.) (2016). Gray's Anatomy: The Anatomical Basis of Clinical Practice (41st ed.). Elsevier." },
  { id: 'ashraf2010', cite: 'Ashraf, T., Panhwar, Z., Habib, S., Memon, M. A., Shamsi, F., & Arif, J. (2010). Size of radial and ulnar artery in local population. Journal of the Pakistan Medical Association, 60(10), 817–819.' },
  { id: 'drzewiecki1983', cite: 'Drzewiecki, G. M., Melbin, J., & Noordergraaf, A. (1983). Arterial tonometry: review and analysis. Journal of Biomechanics, 16(2), 141–152.' },
  { id: 'schwartz2013', cite: 'Schwartz, G., Tee, B. C.-K., Mei, J., et al. (2013). Flexible polymer transistors with high pressure sensitivity for application in electronic skin and health monitoring. Nature Communications, 4, 1859.' },
  { id: 'kim2011', cite: 'Kim, D.-H., Lu, N., Ma, R., et al. (2011). Epidermal electronics. Science, 333(6044), 838–843.' },
  // ---- PPG / SpO2 --------------------------------------------------------------------------------
  { id: 'allen2007', cite: 'Allen, J. (2007). Photoplethysmography and its application in clinical physiological measurement. Physiological Measurement, 28(3), R1–R39.' },
  { id: 'webster1997', cite: 'Webster, J. G. (Ed.) (1997). Design of Pulse Oximeters. Bristol: Institute of Physics Publishing.' },
  { id: 'mannheimer2007', cite: 'Mannheimer, P. D. (2007). The light–tissue interaction of pulse oximetry. Anesthesia & Analgesia, 105(6 Suppl), S10–S17.' },
  { id: 'millasseau2002', cite: 'Millasseau, S. C., Kelly, R. P., Ritter, J. M., & Chowienczyk, P. J. (2002). Determination of age-related increases in large artery stiffness by digital pulse contour analysis. Clinical Science, 103(4), 371–377.' },
  { id: 'rubins2008', cite: 'Rubins, U. (2008). Finger and ear photoplethysmogram waveform analysis by fitting with Gaussians. Medical & Biological Engineering & Computing, 46(12), 1271–1276.' },
  // ---- Cuffless BP / PTT / validation ------------------------------------------------------------
  { id: 'mukkamala2015', cite: 'Mukkamala, R., Hahn, J.-O., Inan, O. T., et al. (2015). Toward ubiquitous blood pressure monitoring via pulse transit time: theory and practice. IEEE Transactions on Biomedical Engineering, 62(8), 1879–1901.' },
  { id: 'ding2016', cite: 'Ding, X.-R., Zhang, Y.-T., Liu, J., Dai, W.-X., & Tsang, H. K. (2016). Continuous cuffless blood pressure estimation using pulse transit time and photoplethysmogram intensity ratio. IEEE Transactions on Biomedical Engineering, 63(5), 964–972.' },
  { id: 'chen2000', cite: 'Chen, W., Kobayashi, T., Ichikawa, S., Takeuchi, Y., & Togawa, T. (2000). Continuous estimation of systolic blood pressure using the pulse arrival time and intermittent calibration. Medical & Biological Engineering & Computing, 38(5), 569–574.' },
  { id: 'sola2019', cite: 'Solà, J., & Delgado-Gonzalo, R. (Eds.) (2019). The Handbook of Cuffless Blood Pressure Monitoring: A Practical Guide for Clinicians, Researchers, and Engineers. Springer.' },
  { id: 'stergiou2023', cite: 'Stergiou, G. S., Avolio, A. P., Palatini, P., et al. (2023). European Society of Hypertension recommendations for the validation of cuffless wearable blood pressure measuring devices. Journal of Hypertension, 41(12), 2074–2087.' },
  { id: 'ieee1708', cite: 'IEEE Std 1708-2014 (with amendment 1708a-2019). IEEE Standard for Wearable Cuffless Blood Pressure Measuring Devices. IEEE.' },
  { id: 'iso81060', cite: 'ISO 81060-2:2018. Non-invasive sphygmomanometers — Part 2: Clinical investigation of intermittent automated measurement type. ISO.' },
  { id: 'razminia2004', cite: 'Razminia, M., Trivedi, A., Molnar, J., et al. (2004). Validation of a new formula for mean arterial pressure calculation: the new formula is superior to the standard formula. Catheterization and Cardiovascular Interventions, 63(4), 419–425.' },
  // ---- Array processing / time-delay estimation ---------------------------------------------------
  { id: 'brennan1959', cite: 'Brennan, D. G. (1959). Linear diversity combining techniques. Proceedings of the IRE, 47(6), 1075–1102.' },
  { id: 'vanveen1988', cite: 'Van Veen, B. D., & Buckley, K. M. (1988). Beamforming: a versatile approach to spatial filtering. IEEE ASSP Magazine, 5(2), 4–24.' },
  { id: 'knapp1976', cite: 'Knapp, C. H., & Carter, G. C. (1976). The generalized correlation method for estimation of time delay. IEEE Transactions on Acoustics, Speech, and Signal Processing, 24(4), 320–327.' },
  { id: 'jacovitti1993', cite: 'Jacovitti, G., & Scarano, G. (1993). Discrete time techniques for time delay estimation. IEEE Transactions on Signal Processing, 41(2), 525–533.' },
  { id: 'viola2003', cite: 'Viola, F., & Walker, W. F. (2003). A comparison of the performance of time-delay estimators in medical ultrasound. IEEE Transactions on Ultrasonics, Ferroelectrics, and Frequency Control, 50(4), 392–401.' },
  { id: 'chiu1991', cite: 'Chiu, Y. C., Arand, P. W., Shroff, S. G., Feldman, T., & Carroll, J. D. (1991). Determination of pulse wave velocities with computerized algorithms. American Heart Journal, 121(5), 1460–1470.' },
  { id: 'gaddum2013', cite: 'Gaddum, N. R., Alastruey, J., Beerbaum, P., Chowienczyk, P., & Schaeffter, T. (2013). A technical assessment of pulse wave velocity algorithms applied to non-invasive arterial waveforms. Annals of Biomedical Engineering, 41(12), 2617–2629.' },
  { id: 'pan1985', cite: 'Pan, J., & Tompkins, W. J. (1985). A real-time QRS detection algorithm. IEEE Transactions on Biomedical Engineering, 32(3), 230–236.' },
  // ---- Posture / gait / EMG / IMU ----------------------------------------------------------------
  { id: 'winter1995', cite: 'Winter, D. A. (1995). Human balance and posture control during standing and walking. Gait & Posture, 3(4), 193–214.' },
  { id: 'collins2009', cite: 'Collins, S. H., Adamczyk, P. G., & Kuo, A. D. (2009). Dynamic arm swinging in human walking. Proceedings of the Royal Society B, 276(1673), 3679–3688.' },
  { id: 'pachi2005', cite: 'Pachi, A., & Ji, T. (2005). Frequency and velocity of people walking. The Structural Engineer, 83(3), 36–40.' },
  { id: 'deluca1997', cite: 'De Luca, C. J. (1997). The use of surface electromyography in biomechanics. Journal of Applied Biomechanics, 13(2), 135–163.' },
  { id: 'inan2015', cite: 'Inan, O. T., Migeotte, P.-F., Park, K.-S., et al. (2015). Ballistocardiography and seismocardiography: a review of recent advances. IEEE Journal of Biomedical and Health Informatics, 19(4), 1414–1427.' },
  // ---- Project documents --------------------------------------------------------------------------
];

export const FEATURES = [
  {
    group: '혈역학 · 동맥 경로 모델 (js/anatomy.js, js/cardiac.js, js/engine.js)',
    items: [
      { feature: '분절별 맥파전파속도(PWV) 스케일링: PWV ∝ √(Eh/ρD), 긴장도·경직도 배율', where: 'anatomy.js segmentPWV_ms', refs: ['moens1878', 'nichols2011'], note: 'Moens–Korteweg 식을 분절 직경·벽 경직도에 적용' },
      { feature: 'PWV의 압력 의존(+0.6 %/mmHg, Bramwell–Hill형), PTT↔BP 역관계', where: 'anatomy.js pwvPressureGain, PWV_PER_MMHG', refs: ['bramwell1922', 'mukkamala2015'], note: '0.6 %/mmHg 계수는 [24]의 감도 범위를 참고한 모델 선택값(문헌 직접값 아님)' },
      { feature: '중심(대동맥) 압력 파형: 수축기 피크 + 후기수축 고원 + 반사파 + 중복절흔 + 이완기 지수 감쇠(τ 0.30 s), 박동별 min/max 정규화(DBP/SBP 정확)', where: 'cardiac.js _beatShape/pressureAt', refs: ['murgo1980', 'westerhof2009', 'nichols2011'], note: '양식화 파형(폼팩터 ≈0.36); 계수는 모델 가정' },
      { feature: '반사파 크기 (tone·stiff)^0.7, 반사 시각 tRefl/RR = 0.32 − 0.05·(M−1)', where: 'cardiac.js reflectionGain/reflectionTiming', refs: ['kelly1989', 'millasseau2002', 'nichols2011'], note: '2026-08-23 개정: 반사 귀환시간 tR = 0.27 s / M(절대시간, ∝1/PWV), 수축기 길이 LVET = 0.413 − 0.0017·HR(Weissler), 절흔 −0.10·PP; 지수 0.7·계수는 모델 가정 — 문헌은 방향만 지지' },
      { feature: '말초(요골) 맥압 증폭, 중심 vs 손목 혈압 이중 표시', where: 'anatomy.js peripheral amplification, 헤더 혈압 카드', refs: ['avolio2009', 'chen1997'], note: '증폭 1.35× 고정(연령·HR 무관), 전달함수 없이 중심 파형을 스케일 — [11]의 전달함수는 미구현(배경 문헌)'},
      { feature: '수축기/이완기 파형의 가우시안 합 모델(수축기 + 반사 성분)', where: 'cardiac.js, rust features.rs 테스트 신호', refs: ['baruch2011', 'rubins2008'] },
      { feature: '팔 위치·자세에 따른 정수압 ρgh(손목–심장 높이차) 오프셋', where: 'kinematics.js wristDeltaH, engine.js', refs: ['netea2003', 'nichols2011'] },
      { feature: '나이/경직도 슬라이더 범위(0.8–1.6)와 PWV 기준값', where: 'index.html #stiff', refs: ['refvalues2010'], note: '슬라이더 범위는 [8]의 연령별 PWV 비를 느슨히 반영한 모델 선택값. 2026-08-23 개정: 분절별 지수(경직 1.0→0.3, 긴장 0.1→1.0, 심장→손가락) 적용 — 지수는 모델 가정'},
      { feature: '심장 리듬: 정상동/빈맥/서맥/심방세동/PVC의 RR 변동·불규칙·보상휴지', where: 'cardiac.js RHYTHMS', refs: ['taskforce1996', 'tateno2001'], note: '2026-08-23 개정: HRV = RSA(0.25 Hz, 4.5 %) + LF(0.10 Hz, 3.5 %) + 랜덤 1.8 %(SDNN≈37 ms, [12] 범위), AF = 로그정규 RR(CV≈0.23, [13]) + 박동별 맥압 변동(선행 RR 의존, 맥압 결손), PVC 결합 0.62·RR·보상휴지·후강화 +12 % — 계수는 모델 가정'},
    ],
  },
  {
    group: '손목 해부 · 정전용량 전극 어레이 (js/capacitiveArray.js, js/wristView.js, js/arrayViz.js)',
    items: [
      { feature: '요골동맥 주행(FCR 건 외측, 원위부에서 얕아짐), 요골·건 배치, 단면 타원 전완', where: 'capacitiveArray.js WRIST_ANATOMY, wristView.js', refs: ['gray2016'] },
      { feature: '요골동맥 직경(≈2.3 mm)·깊이(원위 ≈3 mm) 상수', where: 'capacitiveArray.js', refs: ['ashraf2010', 'gray2016'], note: '직경은 [15]; 깊이 2.5 mm·0.06 mm/mm 기울기·측방 12 mm·건/뼈 위치는 모델 가정'},
      { feature: 'ΔC ∝ 맥압 × 팽창성, 접촉압(applanation)에 따른 진폭 변화', where: 'capacitiveArray.js capPerMmHg, contact', refs: ['drzewiecki1983', 'schwartz2013'], note: '2026-08-23 개정: 이득 0.9 pF/42 mmHg(ΔC/C≈18 %, 보정 노브), 팽창성 D ∝ 1/PWV² = 1/(tone·stiff·g)²(Bramwell–Hill 일관), 결합 커널 σ ≈ 1.2·깊이, 노이즈 = 시드 가우시안(백색+1/f) · √면적 스케일, 채널 샘플링 스큐 옵션 — 모두 모델 가정' },
      { feature: '피부 순응 플렉시블 전극 시트(드레이프), 전극 크기/간격 파라미터', where: 'wristView.js sheet, Rows/Cols/간격', refs: ['kim2011', 'schwartz2013'], note: '배경 문헌(파라미터 미인용)'},
      { feature: '동맥 거리 가중 결합 exp(−½(d/5.5 mm)²), 건(tendon) 동작 아티팩트, 뼈 감쇠', where: 'capacitiveArray.js coupling', refs: ['drzewiecki1983', 'nichols2011'], note: '모델 가정(문헌 직접값 아님) — 접촉 역학을 가우시안 커널로 근사' },
      { feature: '센서 노이즈/아티팩트: 60 Hz 험, 호흡·접촉 기저선, 동작 ×, 전자 노이즈', where: 'capacitiveArray.js artifacts', refs: [], note: '모델 가정(결정론적 정현파 — 실측 CDC 노이즈 스펙트럼이 아님)' },
    ],
  },
  {
    group: '검지 PPG 링 · SpO₂ (js/ppgSpo2.js)',
    items: [
      { feature: 'PPG AC/DC 모델(맥동 혈량 ∝ PP/tone × 관류), 호흡 변조, 중력 관류계수', where: 'ppgSpo2.js acFraction/perfScale', refs: ['allen2007', 'netea2003'], note: '중력 관류계수는 ±10 %/50 cm로 축소(2026-08-23, 부호·크기 문헌 혼재 → 모델 가정); [9]는 정수압 행에만 해당'},
      { feature: 'Red/IR 흡광 차이, R = (AC/DC)_R/(AC/DC)_IR, SpO₂ = 110 − 25R 경험식', where: 'ppgSpo2.js, bpEstimator spo2FromPpg, rust spo2_from_ppg', refs: ['webster1997', 'mannheimer2007'], note: '선형 경험식(≈85–100 % 유효). 2026-08-23 개정: 트윈 진값 = SaO₂(97.5 % + 느린 변동), R은 역함수로 생성, 아티팩트는 파형에만 → 재계산은 파형 추출 검증(정확도 검증은 아님)'},
      { feature: 'PPG 노이즈/아티팩트: 주변광 120 Hz, 기저선, 동작 ×3, 저관류(차가운 손)', where: 'ppgSpo2.js artifacts', refs: ['allen2007'] },
      { feature: 'PPG 반사지수(RI = A2/A1)·반사 시각 → 긴장도·경직도 지표', where: 'bpEstimator._morphology, rust features::morphology', refs: ['millasseau2002', 'kelly1989'] },
    ],
  },
  {
    group: '혈압·긴장도·경직도 추정기 (js/bpEstimator.js, rust estimator.rs)',
    items: [
      { feature: 'PTT/PWV ↔ BP 역모델(Bramwell–Hill/Moens–Korteweg), 캘리브레이션 기반 폐형식 역산', where: 'estimate/estimateCap/estimatePpg', refs: ['mukkamala2015', 'bramwell1922', 'chen2000'] },
      { feature: 'PPG 강도/진폭 비를 PTT에 추가한 2-특징 추정', where: 'estimate (ppgAcDc), estimatePpg', refs: ['ding2016', 'sola2019'] },
      { feature: '단일 지점 PPG(맥파 분석) 추정의 한계와 가정(tone = √x)', where: 'estimatePpg', refs: ['sola2019', 'mukkamala2015'] },
      { feature: 'MAP = DBP + PP/3, SBP = MAP + ⅔PP, DBP = MAP − ⅓PP', where: 'calibrate/estimate', refs: ['nichols2011', 'razminia2004'], note: '표준 ⅓ 근사 사용. [31]은 이 근사의 HR 의존 오차를 보고하고 HR 보정식을 제안한 논문 — 지지 근거가 아니라 한계 문헌'},
      { feature: '커프 기준값 3회 측정 평균(기기 편향·잡음 포함), 재캘리브레이션', where: '캘리브레이션 모달, eval/esh_eval.mjs cuffMean', refs: ['iso81060', 'ieee1708'] },
      { feature: 'ESH 커프리스 검증 권고를 흉내 낸 시나리오 시뮬레이션 하네스(단일 가상 피험자; ESH/ISO 검증 아님)', where: 'eval/esh_eval.mjs, eval/results_esh.md', refs: ['stergiou2023', 'ieee1708'] },
      { feature: '비트 검출(역치 + 불응기), 앙상블 평균, HR-적응 베이스라인 창', where: 'detectPeaks/_ensemble, rust dsp.rs', refs: ['pan1985', 'chiu1991'], note: '[39]는 ECG QRS 검출기 — 역치+불응기 원리만 차용'},
      { feature: '손목→손가락 PTT: 최대 상승 기울기 피듀셜(앙상블, 저역통과 후 미분)', where: '_maxSlopeTime, rust max_slope_time', refs: ['chiu1991', 'gaddum2013'] },
    ],
  },
  {
    group: '어레이 신호처리 · 빔포밍 · 지연 추정 (js/beamform.js, rust beamform.rs/features.rs/core.rs)',
    items: [
      { feature: '최대비 결합(MRC): 가중치 ∝ 이득/잡음분산, 데이터 기반 템플릿 반복', where: 'beamform.analyze/blind_mrc', refs: ['brennan1959'] },
      { feature: '빔서치 동맥 위치 추정: 가우시안 조향 벡터 스캔 + 포물선 보간(서브전극 x̂)', where: 'beamSearch / beam_search', refs: ['vanveen1988', 'jacovitti1993'] },
      { feature: '③ 지연-보상 MRC(delay-and-sum): 채널별 도달지연 정렬 후 결합', where: 'rust delay_compensated_mrc, core.rs', refs: ['vanveen1988', 'knapp1976'] },
      { feature: '2-빔 국소 PTT/PWV: Taylor 1차(미분 기반) 서브샘플 지연 추정, 포물선 보간', where: 'taylorDelay_ms / taylor_delay_ms', refs: ['jacovitti1993', 'viola2003', 'knapp1976'] },
      { feature: 'PWV 알고리즘(foot/최대기울기/상호상관) 선택 근거와 오차 특성', where: '_maxSlopeTime, xcorrLag', refs: ['gaddum2013', 'chiu1991'] },
      { feature: '③ IMU 연동 동맥 추적: 회내율 적분 예측 + 빔서치 보정', where: 'rust core.rs push_imu/x_track', refs: ['vanveen1988'], note: '예측-보정 구조는 일반 추적 원리; 회내→측방 이동 계수(3.2·sin)는 트윈 가정. 현재 추적값은 표시용이며 빔 스티어링에는 미연결' },
    ],
  },
  {
    group: '자세 · 보행 · EMG · IMU (js/kinematics.js, js/emg.js, js/imu.js)',
    items: [
      { feature: '정적 자세 동요(AP/ML sway, 호흡 상하), 몸통 미세 움직임 슬라이더', where: 'kinematics.js body idle', refs: ['winter1995'] },
      { feature: '보행: 약 1.8 Hz 보행 주기, 대측성 팔 스윙, 몸통 bob/sway', where: 'kinematics.js walking', refs: ['pachi2005', 'collins2009', 'winter1995'] },
      { feature: 'EMG: 정적(중력 토크) + 동적(각속도) 활성 → 간섭패턴 합성, 근육별 진폭', where: 'emg.js', refs: ['deluca1997'] },
      { feature: 'IMU: 중력·몸통 가속·관절 접선가속·각속도 벡터 결합, 미세 BCG 성분', where: 'imu.js', refs: ['inan2015'] },
      { feature: '누운 자세에서 정수압 0·몸통 sway 없음, 앉기/서기 팔 위치 프리셋', where: 'kinematics.js BODY_POSTURES/ARM_POSITIONS', refs: ['netea2003', 'winter1995'] },
    ],
  },
];

export function refById(id) { return REFERENCES.find((r) => r.id === id); }
export function refNumber(id) { const i = REFERENCES.findIndex((r) => r.id === id); return i >= 0 ? i + 1 : null; }
