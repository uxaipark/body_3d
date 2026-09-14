export const simulators=[
 {id:'body',href:'/simulators/body',number:'01',title:'전신 디지털 트윈',en:'WHOLE-BODY ANATOMY',image:'/thumbnails/body.jpg',alt:'전신 골격, 순환계와 장기를 겹쳐 표시한 SOMA 해부학 모델',description:'신체 구조와 움직임을 살펴보고, 센싱 위치와 생리 조건을 바꾸며 합성 신호를 탐색합니다.',features:['6개 신체 계통 · 투명도 제어','걷기·달리기·손 쥐기·자세 전환','12개 피부 부위 · 3D 조직 단면','ECG·PPG·EEG·EMG·호흡 · CSV'],status:'실행 가능',action:'전신 트윈 열기'},
 {id:'wrist',href:'/simulators/wrist',number:'02',title:'손목 센싱',en:'RADIAL PULSE & OPTICAL SENSING',image:'/thumbnails/wrist.jpg',alt:'손목 피부 단면의 요골동맥, 피하지방, 힘줄과 뼈',description:'요골동맥 위의 정전용량 배열을 배치하고, 채널 결합·맥파 지연·손가락 광학 신호를 비교합니다.',features:['손목 패치 배치 · 채널 히트맵','MRC · 지연 보상 · PTT/PWV 연구','검지 Red/IR · SpO₂ 합성 모델','혈압 추정 연구 · 접촉·조직 변위'],status:'해부학 · 조직 역학 연결',action:'손목 실험 열기'},
] as const;
