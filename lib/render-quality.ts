export type QualityChoice='auto'|'low'|'balanced'|'high';
export type QualityTier=Exclude<QualityChoice,'auto'>;
export {renderPresets as qualitySettings} from '../public/ui/render-budget.js';
export function chooseInitialQuality(cores?:number,memory?:number):QualityTier{
 if((cores!==undefined&&cores<=4)||(memory!==undefined&&memory<=4))return 'low';
 return 'balanced';
}
export function readQualityPreference():QualityChoice{try{const value=localStorage.getItem('soma.body.quality');if(value==='low'||value==='balanced'||value==='high')return value}catch{}return 'auto'}
export function resolveQuality(choice:QualityChoice):QualityTier{return choice==='auto'?chooseInitialQuality(navigator.hardwareConcurrency,(navigator as Navigator&{deviceMemory?:number}).deviceMemory):choice}
