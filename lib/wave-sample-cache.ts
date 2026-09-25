import {sample,type Parameters,type Site} from './physiology.ts';
let frame=-1,parameters:Parameters|undefined;
const sites=new Map<Site,Map<number,ReturnType<typeof sample>>>();
/** Share synthesis across modality canvases; never change the signal's time
 * grid, CSV path, physiology parameters, or sampling rate. */
export function waveformSample(time:number,p:Parameters,site:Site,frameTime:number){
 if(frame!==frameTime||parameters!==p){frame=frameTime;parameters=p;sites.clear()}
 let values=sites.get(site);if(!values){values=new Map();sites.set(site,values)}
 let value=values.get(time);if(!value){value=sample(time,{...p,site});if(values.size<12000)values.set(time,value)}return value;
}
