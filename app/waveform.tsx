'use client';
import {t as translateUI} from '../public/i18n/locale.js';

import {L} from './language';

import {useEffect,useRef,type MutableRefObject}from'react';
import {sensorColors,type Site,type Channel,type Parameters}from'@/lib/physiology';
import type{AnatomyScene}from'@/lib/anatomy';
import {waveformSample} from '@/lib/wave-sample-cache';
const settings:Record<Channel,{color:string;min:number;max:number}>={ECG:{color:'#a4e4d0',min:-.4,max:1.3},PPG:{color:'#e5b886',min:-.2,max:1.5},EEG:{color:'#b4a2e0',min:-40,max:40},EMG:{color:'#e5a2a5',min:-.6,max:.6},RESP:{color:'#88b8df',min:0,max:1000},CAP:{color:'#8fcabd',min:0,max:4}};
export default function Waveform({channel,params,selectedSites,sceneRef,windowSeconds=5,displayGain=1}:{channel:Channel;params:Parameters;selectedSites:Site[];sceneRef:MutableRefObject<AnatomyScene|null>;windowSeconds?:number;displayGain?:number}){
 const canvas=useRef<HTMLCanvasElement>(null);const pref=useRef(params);pref.current=params;const selectedRef=useRef(selectedSites);selectedRef.current=selectedSites;
 useEffect(()=>{const el=canvas.current!;const ctx=el.getContext('2d')!;let id=0,last=0,previous='';let previousParams:Parameters|undefined;const draw=(now:number)=>{id=requestAnimationFrame(draw);if(now-last<32||document.hidden||el.offsetParent===null)return;last=now;
 const frameTime=sceneRef.current?.time||0,signature=[selectedRef.current.length?frameTime:0,selectedRef.current.join(','),el.clientWidth,el.clientHeight,devicePixelRatio].join('/');if(signature===previous&&previousParams===pref.current)return;previous=signature;previousParams=pref.current;
 const w=el.clientWidth,h=el.clientHeight;if(w<1||h<1)return;const dpr=Math.min(devicePixelRatio,2);if(el.width!==Math.round(w*dpr)||el.height!==Math.round(h*dpr)){el.width=Math.round(w*dpr);el.height=Math.round(h*dpr);}ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
 ctx.strokeStyle='#263039';ctx.lineWidth=.5;ctx.beginPath();for(let x=0;x<w;x+=w/20){ctx.moveTo(x,0);ctx.lineTo(x,h)}for(let y=0;y<h;y+=h/5){ctx.moveTo(0,y);ctx.lineTo(w,y)}ctx.stroke();
 if(!selectedRef.current.length){ctx.fillStyle='#9aaeb7';ctx.font='14px sans-serif';ctx.textAlign='center';ctx.fillText(translateUI('센서를 선택해 주세요'),w/2,h/2);return;}
 const end=sceneRef.current?.time||0,s=settings[channel];
 const traces=channel==='PPG'?selectedRef.current:[selectedRef.current[0]];
 for(const site of traces){
  ctx.beginPath();ctx.strokeStyle=channel==='PPG'?sensorColors[site]:s.color;ctx.lineWidth=1.6;ctx.lineJoin='round';
  const points=channel==='EEG'||channel==='EMG'?Math.ceil(w*2):Math.ceil(w);
  for(let i=0;i<=points;i++){const x=i*w/points;const t=end-windowSeconds+i/points*windowSeconds;const v=waveformSample(t,pref.current,site,end)[channel]*displayGain;const y=h-8-(v-s.min)/(s.max-s.min)*(h-16);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.stroke();ctx.fillStyle=ctx.strokeStyle;const val=waveformSample(end,pref.current,site,end)[channel]*displayGain;ctx.beginPath();ctx.arc(w-2,h-8-(val-s.min)/(s.max-s.min)*(h-16),2.5,0,Math.PI*2);ctx.fill();}
 };id=requestAnimationFrame(draw);return()=>cancelAnimationFrame(id);},[channel,windowSeconds,displayGain]);
 return <L as="canvas" ref={canvas} className="wave-canvas" aria-label={`${channel} 합성 생체신호, 최근 ${windowSeconds}초`}/>;
}
