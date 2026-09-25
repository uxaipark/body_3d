import RenderQualityControl from './render-quality-control';
import {L,LanguageSwitch} from './language';
import {Activity} from 'lucide-react';
import styles from './simulator-nav.module.css';
type Page='home'|'body'|'sleep'|'wrist'|'research'|'manual';
// Document navigation gives every simulator its own WebGL/worker lifecycle.
export function SimulatorNav({active}:{active:Page}){return <L as="nav" className={styles.nav} aria-label="시뮬레이터 메뉴">{([['home','/','시뮬레이터'],['body','/simulators/body','전신 트윈'],['sleep','/simulators/sleep','수면무호흡'],['wrist','/simulators/wrist','손목 센싱'],['research','/research','연구 기록'],['manual','/manual','사용 매뉴얼']] as const).map(([key,href,label])=><L as="a" key={key} href={href} aria-current={active===key?'page':undefined}>{label}</L>)}</L>}
export function LabHeader({active}:{active:Page}){return <header className={styles.header} data-site-header>
 <L as="a" className={styles.brand} href="/" aria-label="SOMA 시뮬레이터 홈"><span className={styles.mark}><Activity size={23}/></span><span>SOMA<span className={styles.period}>.</span></span><span className={styles.subtitle}>DIGITAL HUMAN LAB</span></L>
 <SimulatorNav active={active}/>
 <div className={styles.preferences}><RenderQualityControl/><LanguageSwitch/></div>
 </header>}
