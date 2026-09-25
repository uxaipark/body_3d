'use client';
import {useEffect,useState,type MutableRefObject} from 'react';
import {SomaSelect} from '@/components/soma-select';
import {useLanguage} from './language';
import {readQualityPreference,resolveQuality,type QualityChoice,type QualityTier} from '@/lib/render-quality';
import type {AnatomyScene} from '@/lib/anatomy';
export default function RenderQualityControl({sceneRef,onInitialLow}:{sceneRef:MutableRefObject<AnatomyScene|null>;onInitialLow:()=>void}){
 const language=useLanguage(),en=language==='en',names=en?{low:'Low-power',balanced:'Balanced',high:'High detail'}:{low:'저사양',balanced:'균형',high:'고화질'};
 const [choice,setChoice]=useState<QualityChoice>('auto'),[tier,setTier]=useState<QualityTier>('balanced');
 useEffect(()=>{const saved=readQualityPreference();setChoice(saved);setTier(resolveQuality(saved));if(resolveQuality(saved)==='low')onInitialLow();const id=setInterval(()=>{if(sceneRef.current)setTier(sceneRef.current.qualityTier)},1000);return()=>clearInterval(id)},[]);
 function change(value:QualityChoice){setChoice(value);try{localStorage.setItem('soma.body.quality',value)}catch{}sceneRef.current?.setQuality(value);setTier(resolveQuality(value))}
 return <div className="render-quality-control"><span>{en?'Performance':'성능 모드'}</span><SomaSelect aria-label={en?'Rendering quality':'렌더링 품질'} value={choice} onChange={e=>change(e.target.value as QualityChoice)} options={[{value:'auto',label:en?`Auto · ${names[tier]}`:`자동 · ${names[tier]}`},...(['low','balanced','high'] as const).map(value=>({value,label:names[value]}))]}/></div>;
}
