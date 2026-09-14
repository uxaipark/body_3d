# 05. MRC·MVDR·ECG·연속 혈압 알고리즘 설계

## 관측과 정답 분리

추정기는 실제 얻을 수 있는 전극 채널, ECG, Red/IR, IMU, 타임스탬프, 장치 교정 정보만 본다. 혈관 깊이의 정답·실제 PWV·실제 압력·입력 SaO₂·oracle coupling은 평가 전용이다. 가상 모델의 역함수로 가상 혈압을 정확히 복구하는 실험은 구현 확인에는 유용하지만 임상 정확도 증거가 아니다.

최종 출력의 혈압 위치를 먼저 정의한다. 패치의 국소 요골동맥 파형, 중심 대동맥압, 커프 기준의 상완 SBP/DBP/MAP를 같은 이름으로 쓰지 않는다. 초기 목표는 ‘상완 커프로 개인 교정한 추정 SBP/DBP/MAP + 품질·신뢰구간·교정 경과시간’이다. 박동 간 추세와 절대 정확도는 별도 평가한다.

## 1. 취득·품질 검사

채널 ID–패드 위치–ADC 순서를 확정한다. ADC timestamp와 LED 점등 구간을 저장하고 skew를 보정한 분석용 copy를 만든다. raw는 보존한다. clipping, flatline, dropout, 과압박, 접촉 불량, motion, timestamp jump를 품질 flags로 기록한다.

CAP 및 PPG의 DC와 AC를 분리하되 DC 변화 자체도 접촉·광학 진단에 남긴다. 실시간 필터는 인과적이어야 하고 필터 group delay를 파형 timestamp에 기록한다. 필터링한 화면 파형과 지연을 측정하는 파형의 파이프라인 ID가 달라야 한다. IMU 회귀나 adaptive cancellation은 맥파와 상관된 움직임에서 유효 성분도 지울 수 있으므로 품질 저하 시 추정 중단/가중치 제한이 필요하다.

## 2. MRC

모델 `x_i(t)=g_i s(t−τ_i)+n_i(t)`에 대해 독립 noise 근사에서 `w_i ∝ conjugate(g_i)/σ_i²`로 결합한다. signed coupling 때문에 음의 파형을 무조건 버리지 않는다. 기존 웹 MRC는 data-derived template과 잔차 분산으로 3회 반복한다. weight saturation, residual variance floor, leave-one-channel-out 안정성을 확인한다.

Oracle SNR(참조 압력을 알아서 구한 값)과 online SQI/SNR surrogate(관측만으로 구한 값)를 UI에서 구별한다. 높은 진폭 또는 큰 variance만으로 seed를 선택하면 큰 움직임 채널을 잘못 고를 수 있어 beat coherence·saturation·IMU gating을 함께 쓴다.

## 3. MVDR

주파수 bin별 관측벡터 `x(f)`, 잡음 공분산 `R_n(f)`, 원하는 맥파의 전달벡터 `a(f)`를 정의한다.

```
R_loaded = (1−λ) R_n + λ diag(R_n) + α trace(R_n)/M · I
w = solve(R_loaded, a) / (aᴴ solve(R_loaded, a))
y = wᴴ x
```

역행렬을 명시적으로 만들기보다 Hermitian positive-definite solve를 사용한다. 가중치 제한, condition number, white-noise gain, 목표 신호 왜곡, dropout 이후 rank를 검사한다. 분산이 나쁘거나 steering 오차가 크면 규제된 MRC로 후퇴하고 사유를 기록한다. 공분산을 한 window 전체에서 얻으면 목표 맥파가 noise subspace에 섞여 제거될 수 있으므로 잡음 구간·잔차·robust steering 방법을 비교한다.

이 배열은 초음파 빔포머가 아니다. steering은 혈관 중심선의 전파지연과 조직–패치–전기 전달 `a_i(f)=H_i(f) exp(−j2πfτ_i)`로 정의한다. `H_i`의 위상에는 점탄성과 전자회로 지연이 있다. 저주파 맥파와 수 mm baseline에서는 채널 간 전파 위상이 작아 공간 결합의 많은 이득이 진폭/잡음 가중에서 생긴다. 국소 PTT 분해능 개선은 별도로 입증해야 한다.

확장 대상은 기본 MVDR, shrinkage/diagonal loading, subband 분석이다. 검증된 스펙트럼·복소 선형대수 연산과 인과적 전처리를 단계적으로 연결한다. 현재 화면의 MRC를 MVDR라고 표기하지 않는다.

## 4. 지연 측정은 별도 경로

```
raw calibrated channels
 ├─ whole-array aligned MRC / MVDR → morphology, SNR, waveform display
 └─ proximal cluster beam + distal cluster beam (separate time origins)
       → fiducial/phase-slope/correlation lag → local PTT + uncertainty
ECG R ──→ wrist foot / finger foot → PAT
wrist foot ──→ finger foot → inter-site differential transit (modality bias included)
```

모든 채널을 한 시간으로 정렬한 단일 빔에서는 원래 proximal–distal 지연이 제거된다. 따라서 이 파형만으로 국소 PTT를 다시 구하지 않는다. proximal와 distal의 공통 지연은 맞춰도 차동 지연은 보존하고, 동일한 필터 및 timestamp compensation을 적용한다. 서로 다른 센싱 물리의 foot가 동일한 혈압 fiducial인지 평가한다.

3.5 mm / 5–10 m/s = 0.35–0.7 ms. 1 kHz ADC의 1 ms보다 작다. 분수 샘플 보간·cross-spectrum은 충분한 SNR과 반복성이 있을 때 도움이 되지만 정보를 새로 만들지 않는다. 채널 형태, TDM skew, 점탄성 위상, 위치 오차, contact pressure를 포함한 오차 예산을 함께 제시한다. 지연 신뢰구간이 효과 크기보다 크면 PWV/BP 숫자를 강제로 표시하지 않는다.

## 5. ECG, HR, PEP

`HR=60/RR`, `PAT=R→peripheral foot`, `PAT=PEP+vascular PTT+instrument/fiducial offsets`다. ECG를 시작점으로 쟀다는 이유로 PTT라고 부르지 않는다. HR을 모델에 넣어도 교감신경·수축력·전후부하에 따른 PEP 변화가 사라지지 않는다. [Payne 등: ECG 시작 지연과 혈압](https://pubmed.ncbi.nlm.nih.gov/16141378/).

설계에서는 ECG R, 대동맥판 개방, 요골동맥 도착, 손가락 도착을 각각 truth에 기록하되 estimator에는 ECG/센서 파형만 전달한다. PEP를 직접 얻지 못하면 nuisance state 또는 불확실성으로 처리한다. 가능할 때 ICG/SCG/초음파의 기계적 시작점을 독립 검증 참조로 쓴다. 부정맥·extrasystole에서는 유효 beat별 RR과 foot matching을 시행한다.

## 6. SpO₂

`R=(AC_red/DC_red)/(AC_ir/DC_ir)`로 ratio-of-ratios를 구하고 장치·부위별 calibration으로 SpO₂를 추정한다. Red/IR의 순차 점등 시차를 보존하고 ambient subtraction·clipping·저관류·동작 flags를 적용한다. 손목 반사형, 검지 투과형, 검지 반사형은 별도 calibration 모델을 갖는다.

기존 합성 ratio 모델을 그대로 역산하는 정확도는 실제 사람 검증이 아니다. 다음 단계에서는 조직별 광학 정방향 모델과 추정 calibration을 독립 데이터에서 만든다. 피부색은 가능한 경우 객관적 색소 측정값으로 계층화하고 온도·관류·착용 압력을 분리한다. 실제 성능 비교에는 적절한 arterial reference가 필요하다. FDA의 2025 문서는 확인일 현재 draft이며 2013 final과 상태를 구분한다. [FDA 2025 draft](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/pulse-oximeters-medical-purposes-non-clinical-and-clinical-performance-testing-labeling-and), [FDA 2013 final](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/pulse-oximeters-premarket-notification-submissions-510ks-guidance-industry-and-food-and-drug).

## 7. BP 모델과 교정

1. 개인 커프 기준을 이용한 단순 baseline: PAT/PTT + HR + morphology + posture/contact covariates.
2. 수축기/이완기/평균압의 상호 일관성 제약과 불확실성. radial→brachial mapping은 별도 계층.
3. 1점 교정은 기울기까지 모두 추정할 수 없다. 기울기 prior와 intercept 보정인지 다점 calibration인지 명시한다.
4. calibration drift, 장치 재착용, 운동 회복, 피부 온도·vasomotor tone 변화를 hold-out으로 평가한다.
5. 품질 미달은 결과 없음과 사유를 반환한다. 이전 수치를 최신 추정처럼 조용히 유지하지 않는다.

자세에 따른 높이 차이는 `ΔP=ρgΔh`이며 ρ=1060에서 약 0.78 mmHg/cm다. 높이 부호와 기준점을 명시한다. 전신의 표시 posture만 바뀌었다고 자동으로 부정확한 대체 길이를 쓰지 않도록 실제 리그 좌표와 계측 kinematics를 맞추는 검증이 필요하다.

AHA는 cuffless 기술의 잠재력과 함께 실제 진료 사용 전 정확도·신뢰성의 검증 필요성을 강조한다. 이번 시뮬레이터의 출력은 연구용이며 이 검증을 대체하지 않는다. [AHA 공식 설명](https://professional.heart.org/en/science-news/cuffless-devices-for-the-measurement-of-blood-pressure).
