'use client';
import {L} from './language';

import {useState,type MutableRefObject} from 'react';
import {ChevronRight,Crosshair,PanelRightClose,PanelRightOpen,Settings2,Zap} from 'lucide-react';
import {Slider} from '@/components/ui/slider';
import {Tabs,TabsList,TabsTrigger,TabsContent} from '@/components/ui/tabs';
import {metrics,sites,sensorColors,type Parameters,type Site,type Channel} from '@/lib/physiology';
import type {AnatomyScene} from '@/lib/anatomy';
import Waveform from './waveform';

const channels:Record<Channel,{label:string;unit:string;color:string}>={
 ECG:{label:'심전도',unit:'mV',color:'#a4e4d0'},PPG:{label:'광용적맥파',unit:'a.u.',color:'#e5b886'},
 EEG:{label:'뇌파',unit:'µV',color:'#b4a2e0'},EMG:{label:'근전도',unit:'mV',color:'#e5a2a5'},
 RESP:{label:'호흡 · 폐용적 변화',unit:'mL',color:'#88b8df'},CAP:{label:'정전용량 변화',unit:'pF',color:'#8fcabd'},
};
function Setting({label,value,min,max,unit,onChange}:{label:string;value:number;min:number;max:number;unit:string;onChange:(value:number)=>void}){
 return <L as="div" className="parameter"><L as="div"><L as="span">{label}</L><L as="strong">{value}<L as="small">{unit}</L></L></L><Slider aria-label={label} value={[value]} min={min} max={max} onValueChange={v=>onChange(Array.isArray(v)?v[0]:v)}/></L>;
}
interface Props{
 params:Parameters;selectedSites:Site[];running:boolean;collapsed:boolean;
 sceneRef:MutableRefObject<AnatomyScene|null>;
 onCollapse:()=>void;onToggle:(site:Site)=>void;onFocus:(site:Site)=>void;onClear:()=>void;
 onChange:<K extends keyof Parameters>(key:K,value:Parameters[K])=>void;
}
export default function SensorExperiment({params,selectedSites,running,collapsed,sceneRef,onCollapse,onToggle,onFocus,onClear,onChange}:Props){
 const [channel,setChannel]=useState<Channel>('PPG'),[seconds,setSeconds]=useState(5);
 const [gains,setGains]=useState<Record<Channel,number>>({ECG:100,PPG:100,EEG:100,EMG:100,RESP:100,CAP:100});
 const signal=channels[channel],electrical=['ECG','EEG','EMG'].includes(channel);
 return <L as="aside" className={`right-panel panel ${collapsed?'collapsed':''}`}>
  <L as="div" className="panel-collapse-header"><L as="span">센서 실험</L><L as="button" className="icon-button" aria-label={collapsed?'센서 패널 펼치기':'센서 패널 접기'} aria-expanded={!collapsed} aria-controls="sensor-panel-content" onClick={onCollapse}>{collapsed?<PanelRightOpen size={19}/>:<PanelRightClose size={19}/>}</L></L>
  <L as="div" id="sensor-panel-content" className="panel-content" hidden={collapsed}>
   <L as="div" className="sensor-sites">
    <L as="div" className="sensor-header"><L as="span" className="section-label">측정 위치</L><L as="span" className="connected"><L as="span" className="status-dot"/>{selectedSites.length?`${selectedSites.length}개 선택`:'미선택'}</L></L>
    <L as="div" className="site-picker">{Object.entries(sites).map(([key,site])=>{
     const checked=selectedSites.includes(key as Site);
     return <L as="button" key={key} type="button" role="switch" aria-checked={checked} aria-label={`${site.label} 센서`} className={`site-option ${checked?'selected':''}`} onClick={()=>onToggle(key as Site)}><L as="span" className="sensor-round-switch" aria-hidden="true"/>{site.label}</L>;
    })}</L>
    <L as="div" className="sensor-detail"><L as="span">{selectedSites.length?'멀티 선택 가능':'측정 위치를 켜 주세요'}</L>{selectedSites.length>0&&<L as="button" onClick={onClear}>모두 해제</L>}</L>
    {selectedSites.length>0&&<L as="div" className="sensor-legend">{selectedSites.map(site=><L as="button" key={site} onClick={()=>onFocus(site)} aria-pressed={params.site===site} aria-label={`${sites[site].label} 센서로 화면 이동`}><L as="i" style={{background:sensorColors[site]}}/>{sites[site].label}<Crosshair size={12}/></L>)}</L>}
   </L>
   <L as="div" className="right-section signal-section">
    <L as="div" className="section-title">신호 모달리티 <Settings2 size={14}/></L>
    <Tabs value={channel} onValueChange={v=>setChannel(v as Channel)}>
     <TabsList className="channel-tabs" aria-label="신호 모달리티">{(Object.keys(channels) as Channel[]).map(c=><L as={TabsTrigger} key={c} value={c}>{c}</L>)}</TabsList>
     <TabsContent value={channel} key={channel} className="modality-content">
      <L as="div" className="signal-heading"><L as="div"><L as="span" className="signal-dot" style={{background:signal.color}}/><L as="strong">{signal.label}</L><L as="small">{signal.unit}</L></L><L as="span" className="live-label">{!selectedSites.length?'OFF':running?'LIVE':'PAUSED'}</L></L>
      {electrical&&<L as="p" className="channel-note">{channel==='ECG'?'고정 가상 ECG 채널':channel==='EEG'?'고정 가상 두피 채널 · 6 / 10 Hz':'고정 가상 근육 채널 · 하단 움직임에 연동'}</L>}
      <Waveform channel={channel} params={params} selectedSites={selectedSites} sceneRef={sceneRef} windowSeconds={seconds} displayGain={gains[channel]/100}/>
      <L as="div" className="time-axis"><L as="span">−{seconds}s</L><L as="span">−{seconds/2}s</L><L as="span">현재</L></L>
      <L as="div" className="signal-controls"><L as="span">시간 범위</L><L as="button" aria-label={`파형 시간 범위 ${seconds}초, 전환`} onClick={()=>setSeconds(v=>v===5?10:5)}>{seconds} s <ChevronRight size={12}/></L><L as="span" className="synthetic-badge">합성 신호</L></L>
      <L as="div" className="modality-settings">
       <L as="div" className="section-title">{channel==='PPG'?'광학 센서 설정':channel==='RESP'?'호흡 설정':channel==='CAP'?'정전용량 센서 설정':`${signal.label} 설정`}</L>
       {channel==='PPG'&&<>
        <L as="div" className="wavelengths">{[[530,'Green'],[660,'Red'],[940,'Infrared']].map(([n,label])=><L as="button" key={n} aria-pressed={params.wavelength===n} onClick={()=>onChange('wavelength',Number(n))} className={params.wavelength===n?'selected':''}><L as="span" style={{background:n===530?'#a4e4d0':n===660?'#de8586':'#b7a1d5'}}/>{label}<L as="small">{n} nm</L></L>)}</L>
        <L as={Setting} label="센서 접촉도" value={params.contact} min={0} max={100} unit="%" onChange={(v:number)=>onChange('contact',v)}/>
        <L as={Setting} label="동맥 경직도" value={params.stiffness} min={0} max={100} unit="%" onChange={(v:number)=>onChange('stiffness',v)}/>
       </>}
       {channel==='ECG'&&<L as={Setting} label="심박수" value={params.hr} min={40} max={180} unit="bpm" onChange={(v:number)=>onChange('hr',v)}/>}
       {electrical&&<L as={Setting} label="파형 표시 배율" value={gains[channel]} min={25} max={200} unit="%" onChange={(v:number)=>setGains(g=>({...g,[channel]:v}))}/>}
       {(channel==='RESP'||channel==='CAP')&&<>
        <L as={Setting} label="호흡수" value={params.rr} min={6} max={40} unit="/min" onChange={(v:number)=>onChange('rr',v)}/>
        <L as={Setting} label="일회 호흡량" value={params.tidal} min={200} max={1000} unit="mL" onChange={(v:number)=>onChange('tidal',v)}/>
       </>}
       {channel==='CAP'&&<L as="p" className="channel-note modality-note">모델 감도 0.004 pF/mL · 최대 변화 {(params.tidal*.004).toFixed(2)} pF</L>}
      </L>
      {channel==='PPG'&&<L as="div" className="timing-card"><L as="div" className="section-title"><L as="span"><Zap size={15}/> 맥파 전달 시간</L><L as="span" className="subtle">모델값</L></L>{selectedSites.length?<L as="table" className="sensor-timing-table"><L as="thead"><L as="tr"><L as="th">센서</L><L as="th">PAT</L><L as="th">PTT</L></L></L><L as="tbody">{selectedSites.map(site=>{const timing=metrics({...params,site});return <L as="tr" key={site}><L as="th"><L as="i" style={{background:sensorColors[site]}}/>{sites[site].label}</L><L as="td">{Math.round(timing.pat)} <L as="small">ms</L></L><L as="td">{Math.round(timing.ptt)} <L as="small">ms</L></L></L>})}</L></L>:<L as="p" className="sensor-empty">선택된 센서가 없습니다.</L>}<L as="p">PAT = PEP + PTT · 입력 거리 / 맥파 속도</L></L>}
     </TabsContent>
    </Tabs>
   </L>
  </L>
 </L>;
}
