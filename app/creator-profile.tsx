import {ArrowUpRight} from 'lucide-react';

export function CreatorProfile() {
  return <section className="creator-profile" aria-labelledby="creator-name">
    <div className="creator-identity">
      <span className="portal-kicker">ABOUT THE CREATOR</span>
      <h2 id="creator-name">박성진</h2>
      <p className="creator-focus">AI · Biosensing · Digital Twins</p>
    </div>
    <p className="creator-summary">AI와 생체신호처리를 바탕으로, 웨어러블 센서 실험을 위한 디지털 트윈 <strong>SOMA</strong>를 개발합니다.</p>
    <a className="creator-link" href="https://www.linkedin.com/in/park-sung-jin/" target="_blank" rel="noopener noreferrer" aria-label="박성진 LinkedIn 프로필 보기">LinkedIn<ArrowUpRight size={16}/></a>
  </section>;
}
