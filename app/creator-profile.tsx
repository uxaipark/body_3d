import {ArrowUpRight} from 'lucide-react';

export function CreatorProfile() {
  return <section className="creator-profile" aria-labelledby="creator-name">
    <div className="creator-identity">
      <span className="portal-kicker">ABOUT THE CREATOR</span>
      <h2 id="creator-name">박성진</h2>
      <p className="creator-focus">AI · Biosensing · Digital Twins</p>
    </div>
    <div className="creator-story">
      <p className="creator-intro">아이디어를 실험 가능한 소프트웨어로.</p>
      <p>AI 소프트웨어 개발 경험을 바탕으로 생체신호와 인체 구조를 연결하는 가상 실험 환경을 설계합니다. <strong>SOMA</strong>에서는 웨어러블 센서 시뮬레이션과 신호처리 알고리즘을 탐구합니다.</p>
      <a className="creator-link" href="https://www.linkedin.com/in/park-sung-jin/" target="_blank" rel="noopener noreferrer">LinkedIn에서 프로필 보기<ArrowUpRight size={18}/></a>
    </div>
  </section>;
}
