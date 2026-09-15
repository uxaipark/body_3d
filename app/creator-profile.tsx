
import {L} from './language';
import {ArrowUpRight} from 'lucide-react';

export function CreatorProfile() {
  return <L as="section" className="creator-profile" aria-labelledby="creator-name">
    <L as="div" className="creator-identity">
      <L as="span" className="portal-kicker">ABOUT THE CREATOR</L>
      <L as="h2" id="creator-name">박성진</L>
      <L as="p" className="creator-focus">AI · Biosensing · Digital Twins</L>
    </L>
    <L as="p" className="creator-summary">AI와 생체신호처리를 바탕으로, 웨어러블 센서 실험을 위한 디지털 트윈 <L as="strong">SOMA</L>를 개발합니다.</L>
    <L as="a" className="creator-link" href="https://www.linkedin.com/in/park-sung-jin/" target="_blank" rel="noopener noreferrer" aria-label="박성진 LinkedIn 프로필 보기">LinkedIn<ArrowUpRight size={16}/></L>
  </L>;
}
