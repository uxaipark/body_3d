export type QualityChoice='auto'|'low'|'balanced'|'high';
export type QualityTier=Exclude<QualityChoice,'auto'>;
export const qualitySettings={low:{dpr:.85,fps:30},balanced:{dpr:1.15,fps:60},high:{dpr:1.5,fps:60}};
export function chooseInitialQuality(cores?:number,memory?:number):QualityTier{
 if((cores!==undefined&&cores<=4)||(memory!==undefined&&memory<=4))return 'low';
 return 'balanced';
}
export function readQualityPreference():QualityChoice{try{const value=localStorage.getItem('soma.body.quality');if(value==='low'||value==='balanced'||value==='high')return value}catch{}return 'auto'}
export function resolveQuality(choice:QualityChoice):QualityTier{return choice==='auto'?chooseInitialQuality(navigator.hardwareConcurrency,(navigator as Navigator&{deviceMemory?:number}).deviceMemory):choice}
