'use client';
import {useEffect,useState,type MutableRefObject} from 'react';
import {SomaSelect} from '@/components/soma-select';
import {useLanguage} from './language';
import {readQualityPreference,resolveQuality,type QualityChoice,type QualityTier} from '@/lib/render-quality';
type QualityTarget={qualityTier:QualityTier;setQuality:(choice:QualityChoice)=>void};
export function useRenderQuality(sceneRef:MutableRefObject<QualityTarget|null>,onInitialLow:()=>void=()=>{}){
 useEffect(()=>{
  if(resolveQuality(readQualityPreference())==='low')onInitialLow();
  const change=(event:Event)=>{if(event instanceof StorageEvent&&event.key!=='soma.body.quality')return;const value=(event as CustomEvent).detail;sceneRef.current?.setQuality(['auto','low','balanced','high'].includes(value)?value:readQualityPreference())};
  const status=()=>{if(sceneRef.current)window.dispatchEvent(new CustomEvent('soma-quality-status',{detail:sceneRef.current.qualityTier}))};
  window.addEventListener('soma-quality-change',change);window.addEventListener('storage',change);
  const id=setInterval(status,1000);return()=>{clearInterval(id);window.removeEventListener('soma-quality-change',change);window.removeEventListener('storage',change)};
 },[]);
}
export default function RenderQualityControl(){
 const language=useLanguage(),en=language==='en',names=en?{low:'Low-power',balanced:'Balanced',high:'High detail'}:{low:'저사양',balanced:'균형',high:'고화질'};
 const [choice,setChoice]=useState<QualityChoice>('auto'),[tier,setTier]=useState<QualityTier>('balanced');
 useEffect(()=>{
  const sync=(event?:StorageEvent)=>{if(event&&event.key!=='soma.body.quality')return;const saved=readQualityPreference();setChoice(saved);setTier(resolveQuality(saved))};sync();
  const status=(event:Event)=>{const tier=(event as CustomEvent).detail;if(['low','balanced','high'].includes(tier))setTier(tier)};
  const message=(event:MessageEvent)=>{if(event.origin!==location.origin||event.data?.type!=='soma-quality-status')return;if(![...document.querySelectorAll('iframe')].some(frame=>frame.contentWindow===event.source))return;if(['low','balanced','high'].includes(event.data.tier))setTier(event.data.tier)};
  window.addEventListener('storage',sync);window.addEventListener('soma-quality-status',status);window.addEventListener('message',message);
  return()=>{window.removeEventListener('storage',sync);window.removeEventListener('soma-quality-status',status);window.removeEventListener('message',message)};
 },[]);
 function change(value:QualityChoice){setChoice(value);try{localStorage.setItem('soma.body.quality',value)}catch{}setTier(resolveQuality(value));window.dispatchEvent(new CustomEvent('soma-quality-change',{detail:value}));document.querySelectorAll('iframe').forEach(frame=>frame.contentWindow?.postMessage({type:'soma-quality-change',choice:value},location.origin))}

 return <div className="render-quality-control"><span>{en?'Performance':'성능 모드'}</span><SomaSelect aria-label={en?'Rendering quality':'렌더링 품질'} value={choice} onChange={e=>change(e.target.value as QualityChoice)} options={[{value:'auto',label:en?`Auto · ${names[tier]}`:`자동 · ${names[tier]}`},...(['low','balanced','high'] as const).map(value=>({value,label:names[value]}))]}/></div>;
}
