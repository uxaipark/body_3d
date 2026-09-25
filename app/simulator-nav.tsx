
import RenderQualityControl from './render-quality-control';
import {L,LanguageSwitch} from './language';
// Each simulator owns a separate WebGL/worker lifecycle. Use document navigation
// so opening a workspace does not depend on the client RSC navigation runtime.
import {Activity} from 'lucide-react';
export function SimulatorNav({active}:{active:'home'|'body'|'sleep'|'wrist'|'research'|'manual'}){return <L as="nav" className="simulator-nav" aria-label="시뮬레이터 메뉴">{([['home','/','시뮬레이터'],['body','/simulators/body','전신 트윈'],['sleep','/simulators/sleep','수면무호흡'],['wrist','/simulators/wrist','손목 센싱'],['research','/research','연구 기록'],['manual','/manual','사용 매뉴얼']] as const).map(([key,href,label])=><L as="a" key={key} href={href} aria-current={active===key?'page':undefined}>{label}</L>)}</L>}
export function LabHeader({active}:{active:'home'|'body'|'sleep'|'wrist'|'research'|'manual'}){return <L as="header" className="topbar portal-topbar"><L as="a" className="brand" href="/" aria-label="SOMA 시뮬레이터 홈"><L as="span" className="brand-mark"><Activity size={23}/></L><L as="span">SOMA<L as="span" className="brand-period">.</L></L><L as="span" className="brand-sub">DIGITAL HUMAN LAB</L></L><SimulatorNav active={active}/><RenderQualityControl/><LanguageSwitch/><L as="span" className="portal-research-badge"><L as="i" className="status-dot"/> RESEARCH WORKSPACE</L></L>}
