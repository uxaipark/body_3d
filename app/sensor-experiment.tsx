'use client';
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
 return <div className="parameter"><div><span>{label}</span><strong>{value}<small>{unit}</small></strong></div><Slider aria-label={label} value={[value]} min={min} max={max} onValueChange={v=>onChange(Array.isArray(v)?v[0]:v)}/></div>;
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
 return <aside className={`right-panel panel ${collapsed?'collapsed':''}`}>
  <div className="panel-collapse-header"><span>센서 실험</span><button className="icon-button" aria-label={collapsed?'센서 패널 펼치기':'센서 패널 접기'} aria-expanded={!collapsed} aria-controls="sensor-panel-content" onClick={onCollapse}>{collapsed?<PanelRightOpen size={19}/>:<PanelRightClose size={19}/>}</button></div>
  <div id="sensor-panel-content" className="panel-content" hidden={collapsed}>
   <div className="sensor-sites">
    <div className="sensor-header"><span className="section-label">측정 위치</span><span className="connected"><span className="status-dot"/>{selectedSites.length?`${selectedSites.length}개 선택`:'미선택'}</span></div>
    <div className="site-picker">{Object.entries(sites).map(([key,site])=>{
     const checked=selectedSites.includes(key as Site);
     return <button key={key} type="button" role="switch" aria-checked={checked} aria-label={`${site.label} 센서`} className={`site-option ${checked?'selected':''}`} onClick={()=>onToggle(key as Site)}><span className="sensor-round-switch" aria-hidden="true"/>{site.label}</button>;
    })}</div>
    <div className="sensor-detail"><span>{selectedSites.length?'멀티 선택 가능':'측정 위치를 켜 주세요'}</span>{selectedSites.length>0&&<button onClick={onClear}>모두 해제</button>}</div>
    {selectedSites.length>0&&<div className="sensor-legend">{selectedSites.map(site=><button key={site} onClick={()=>onFocus(site)} aria-pressed={params.site===site} aria-label={`${sites[site].label} 센서로 화면 이동`}><i style={{background:sensorColors[site]}}/>{sites[site].label}<Crosshair size={12}/></button>)}</div>}
   </div>
   <div className="right-section signal-section">
    <div className="section-title">신호 모달리티 <Settings2 size={14}/></div>
    <Tabs value={channel} onValueChange={v=>setChannel(v as Channel)}>
     <TabsList className="channel-tabs" aria-label="신호 모달리티">{(Object.keys(channels) as Channel[]).map(c=><TabsTrigger key={c} value={c}>{c}</TabsTrigger>)}</TabsList>
     <TabsContent value={channel} key={channel} className="modality-content">
      <div className="signal-heading"><div><span className="signal-dot" style={{background:signal.color}}/><strong>{signal.label}</strong><small>{signal.unit}</small></div><span className="live-label">{!selectedSites.length?'OFF':running?'LIVE':'PAUSED'}</span></div>
      {electrical&&<p className="channel-note">{channel==='ECG'?'고정 가상 ECG 채널':channel==='EEG'?'고정 가상 두피 채널 · 6 / 10 Hz':'고정 가상 근육 채널 · 하단 움직임에 연동'}</p>}
      <Waveform channel={channel} params={params} selectedSites={selectedSites} sceneRef={sceneRef} windowSeconds={seconds} displayGain={gains[channel]/100}/>
      <div className="time-axis"><span>−{seconds}s</span><span>−{seconds/2}s</span><span>현재</span></div>
      <div className="signal-controls"><span>시간 범위</span><button aria-label={`파형 시간 범위 ${seconds}초, 전환`} onClick={()=>setSeconds(v=>v===5?10:5)}>{seconds} s <ChevronRight size={12}/></button><span className="synthetic-badge">합성 신호</span></div>
      <div className="modality-settings">
       <div className="section-title">{channel==='PPG'?'광학 센서 설정':channel==='RESP'?'호흡 설정':channel==='CAP'?'정전용량 센서 설정':`${signal.label} 설정`}</div>
       {channel==='PPG'&&<>
        <div className="wavelengths">{[[530,'Green'],[660,'Red'],[940,'Infrared']].map(([n,label])=><button key={n} aria-pressed={params.wavelength===n} onClick={()=>onChange('wavelength',Number(n))} className={params.wavelength===n?'selected':''}><span style={{background:n===530?'#a4e4d0':n===660?'#de8586':'#b7a1d5'}}/>{label}<small>{n} nm</small></button>)}</div>
        <Setting label="센서 접촉도" value={params.contact} min={0} max={100} unit="%" onChange={v=>onChange('contact',v)}/>
        <Setting label="동맥 경직도" value={params.stiffness} min={0} max={100} unit="%" onChange={v=>onChange('stiffness',v)}/>
       </>}
       {channel==='ECG'&&<Setting label="심박수" value={params.hr} min={40} max={180} unit="bpm" onChange={v=>onChange('hr',v)}/>}
       {electrical&&<Setting label="파형 표시 배율" value={gains[channel]} min={25} max={200} unit="%" onChange={v=>setGains(g=>({...g,[channel]:v}))}/>}
       {(channel==='RESP'||channel==='CAP')&&<>
        <Setting label="호흡수" value={params.rr} min={6} max={40} unit="/min" onChange={v=>onChange('rr',v)}/>
        <Setting label="일회 호흡량" value={params.tidal} min={200} max={1000} unit="mL" onChange={v=>onChange('tidal',v)}/>
       </>}
       {channel==='CAP'&&<p className="channel-note modality-note">모델 감도 0.004 pF/mL · 최대 변화 {(params.tidal*.004).toFixed(2)} pF</p>}
      </div>
      {channel==='PPG'&&<div className="timing-card"><div className="section-title"><span><Zap size={15}/> 맥파 전달 시간</span><span className="subtle">모델값</span></div>{selectedSites.length?<table className="sensor-timing-table"><thead><tr><th>센서</th><th>PAT</th><th>PTT</th></tr></thead><tbody>{selectedSites.map(site=>{const timing=metrics({...params,site});return <tr key={site}><th><i style={{background:sensorColors[site]}}/>{sites[site].label}</th><td>{Math.round(timing.pat)} <small>ms</small></td><td>{Math.round(timing.ptt)} <small>ms</small></td></tr>})}</tbody></table>:<p className="sensor-empty">선택된 센서가 없습니다.</p>}<p>PAT = PEP + PTT · 입력 거리 / 맥파 속도</p></div>}
     </TabsContent>
    </Tabs>
   </div>
  </div>
 </aside>;
}
