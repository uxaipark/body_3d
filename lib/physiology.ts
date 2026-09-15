import {taskState,isClinicalMotion} from './clinical-motion.js';
export type Site = 'wrist' | 'finger' | 'ear' | 'forehead' | 'chest' | 'arm';
export type Motion = 'rest' | 'walk' | 'run' | 'stand' | 'sitStand' | 'grip' | 'lie' | 'wave' | 'dance';
export type Channel = 'ECG'|'PPG'|'EEG'|'EMG'|'RESP'|'CAP';
export interface Parameters { hr:number; rr:number; stiffness:number; spo2:number; tidal:number; contact:number; wavelength:number; motion:Motion; motionStartedAt?:number; motionRevision?:number; site:Site; }
export const defaults:Parameters={hr:72,rr:14,stiffness:35,spo2:98,tidal:500,contact:90,wavelength:530,motion:'rest',site:'wrist'};
export const sites: Record<Site,{label:string;en:string;distance:number;gain:number;position:[number,number,number]}>={
 wrist:{label:'손목',en:'Radial artery',distance:.65,gain:.75,position:[-.282,.865,.02]},
 finger:{label:'손가락',en:'Digital artery',distance:.85,gain:1.1,position:[-.308,.724,.043]},
 ear:{label:'귓볼',en:'Earlobe',distance:.32,gain:.95,position:[-.072,1.592,.005]},
 forehead:{label:'이마',en:'Frontal region',distance:.36,gain:.65,position:[0,1.664,.085]},
 chest:{label:'흉부',en:'Thoracic wall',distance:.15,gain:.45,position:[.06,1.32,.1]},
 arm:{label:'상완',en:'Brachial artery',distance:.39,gain:.6,position:[-.20,1.19,.015]},
};
const tau=Math.PI*2;
const gaussian=(x:number,c:number,w:number)=>Math.exp(-.5*((x-c)/w)**2);
export function metrics(p:Parameters){
 const pwv=4+8*p.stiffness/100;
 const pep=Math.max(45,105-.35*(p.hr-60));
 const ptt=1000*sites[p.site].distance/pwv;
 return {pwv,pep,ptt,pat:pep+ptt,radialToFinger:1000*(sites.finger.distance-sites.wrist.distance)/pwv};
}
// Phenomenological, deterministic synthetic signals. This is not a clinical forward model.
export function sample(t:number,p:Parameters):Record<Channel,number>{
 const period=60/p.hr; const phase=((t%period)+period)%period;
 const {pat}=metrics(p); const q=((t-pat/1000)%period+period)%period;
 const breath=Math.sin(t*tau*p.rr/60);
 const noise=Math.sin(t*123.47)*.43+Math.sin(t*287.13)*.32+Math.sin(t*61.1)*.25;
 const elapsed=t-(p.motionStartedAt||0),task=taskState(p.motion,elapsed);
 const clinical=isClinicalMotion(p.motion);
 const movement=clinical?(elapsed<0?0:task.activity*.12):p.motion==='rest'?0:p.motion==='walk'?.075:p.motion==='wave'?(p.site==='wrist'||p.site==='finger'||p.site==='arm'?.045:.01):p.motion==='dance'?.13:.19;
 const artifact=movement*(Math.sin(t*tau*(p.motion==='run'?2.6:1.6))+.5*noise);
 const ecg=.12*gaussian(phase,.78*period,.035)-.14*gaussian(phase,.97*period,.009)+1.1*(gaussian(phase,0,.012)+gaussian(phase,period,.012))-.22*gaussian(phase,.035,.012)+.27*gaussian(phase,.24*period,.05);
 const pulse=q<0?0:(q/.055)**2*Math.exp(-q/.055)/.5413 + .23*gaussian(q,.29*period,.038);
 const optical=p.wavelength===530?1:p.wavelength===660?.75:.88;
 const emg=clinical?(.015+(elapsed<0?0:task.effort)*.36)*noise:(p.motion==='rest'?.015:p.motion==='walk'?.15:p.motion==='wave'?.10:p.motion==='dance'?.28:.4)*noise*(.35+.65*Math.max(0,Math.sin(t*tau*1.6)));
 return {ECG:ecg+.015*breath+artifact*.2,PPG:pulse*sites[p.site].gain*optical*(p.contact/100)*(1+.05*breath)+artifact+(1-p.contact/100)*noise*.15,EEG:18*Math.sin(t*tau*10)+6*Math.sin(t*tau*6)+3*noise+artifact*80,EMG:emg,RESP:p.tidal*(1+breath)/2,CAP:p.tidal*(1+breath)/2*.004};
}
export function csv(p:Parameters,duration=10,rate=250,start=0){
 const meta=metrics(p);
 const lines=['time_s,ECG_mV,PPG_au,EEG_uV,EMG_mV,lung_delta_mL,capacitance_delta_pF,PAT_ms,PTT_ms,SpO2_input_pct'];
 for(let i=0;i<duration*rate;i++){const t=start+i/rate,s=sample(t,p);lines.push([t,s.ECG,s.PPG,s.EEG,s.EMG,s.RESP,s.RESP*.004,meta.pat,meta.ptt,p.spo2].map(v=>v.toFixed(5)).join(','));}
 if(isClinicalMotion(p.motion)){
  lines[0]+=',motion,task_elapsed_s,task_stage,repetition,grip_fraction,effort_envelope';
  for(let i=1;i<lines.length;i++){const elapsed=start+(i-1)/rate-(p.motionStartedAt||0),task=taskState(p.motion,elapsed);lines[i]+=`,${p.motion},${elapsed.toFixed(5)},${elapsed<0?'before_task':task.stage},${task.repetitions},${(elapsed<0?0:task.grip).toFixed(5)},${(elapsed<0?0:task.effort).toFixed(5)}`;}
 }
 return lines.join('\n');
}

export const sensorColors:Record<Site,string>={wrist:'#e5b886',finger:'#a4e4d0',ear:'#b4a2e0',forehead:'#e5a2a5',chest:'#88b8df',arm:'#d5d985'};
export function toggleSensorSite(selected:Site[],site:Site):Site[]{return selected.includes(site)?selected.filter(s=>s!==site):[...selected,site]}
export function csvSites(p:Parameters,selected:Site[],duration=10,rate=250,start=0){
 if(!selected.length)return '';
 const lines:string[]=[];
 for(const site of selected){const [header,...rows]=csv({...p,site},duration,rate,start).split('\n');if(!lines.length)lines.push('sensor_site,'+header);lines.push(...rows.map(row=>site+','+row))}
 return lines.join('\n');
}
