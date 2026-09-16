'use client';
import {L} from './language';

import {useEffect,useRef,useState,type MutableRefObject}from'react';
import type {AnatomyScene,Layers}from'@/lib/anatomy';
import type{SkinRegion}from'@/lib/skin-section';
import type{Parameters,Site}from'@/lib/physiology';
export default function Viewport({bloodVesselsVisible,comfortMode,params,layers,selectedSites,skinInspection,onSkin,sceneRef,onStats,onPick,onTime,onSite}:{bloodVesselsVisible:boolean;comfortMode:boolean;params:Parameters;layers:Layers;selectedSites:Site[];skinInspection:boolean;onSkin:(region:SkinRegion)=>void;sceneRef:MutableRefObject<AnatomyScene|null>;onStats:(fps:number,triangles:number)=>void;onPick:(s:string)=>void;onTime:(t:number)=>void;onSite:(s:Site)=>void}){
 const host=useRef<HTMLDivElement>(null);const [progress,setProgress]=useState(0);const[error,setError]=useState('');const callbacks=useRef({stats:onStats,pick:onPick,time:onTime,site:onSite,skin:onSkin});callbacks.current={stats:onStats,pick:onPick,time:onTime,site:onSite,skin:onSkin};
 const current=useRef({params,layers,bloodVesselsVisible,comfortMode,selectedSites,skinInspection});current.current={params,layers,bloodVesselsVisible,comfortMode,selectedSites,skinInspection};
 useEffect(()=>{
  let scene:AnatomyScene|undefined,active=true;
  // DRACO creates browser asset URLs at module initialization. Import it only
  // after mounting: a Worker SSR module URL cannot resolve these asset paths.
  import('@/lib/anatomy').then(({AnatomyScene})=>{
   if(!active||!host.current)return;
   const state=current.current;
   try{
    scene=new AnatomyScene(host.current,state.params,state.layers,{stats:(...a)=>callbacks.current.stats(...a),pick:s=>callbacks.current.pick(s),time:t=>callbacks.current.time(t),site:s=>callbacks.current.site(s),skin:r=>callbacks.current.skin(r)});
    sceneRef.current=scene;scene.setBloodVesselsVisible(state.bloodVesselsVisible);scene.setComfortMode(state.comfortMode);scene.setSensors(state.selectedSites);scene.setSkinInspection(state.skinInspection);
    scene.load(n=>{if(active)setProgress(n)}).catch(()=>{if(active)setError('해부학 모델을 불러오지 못했습니다. 연결을 확인하고 새로고침해 주세요.')});
   }catch{if(active)setError('WebGL 2를 사용할 수 없습니다. 브라우저의 하드웨어 가속을 켜 주세요.');}
  }).catch(()=>{if(active)setError('3D 뷰어를 불러오지 못했습니다. 연결을 확인하고 새로고침해 주세요.');});
  return()=>{active=false;scene?.dispose();sceneRef.current=null;};
 },[]);
 useEffect(()=>{sceneRef.current?.setBloodVesselsVisible(bloodVesselsVisible)},[bloodVesselsVisible]);
 useEffect(()=>{sceneRef.current?.setComfortMode(comfortMode)},[comfortMode]);
 useEffect(()=>{sceneRef.current?.setSkinInspection(skinInspection)},[skinInspection]);
 useEffect(()=>{sceneRef.current?.setSensors(selectedSites)},[selectedSites]);
 useEffect(()=>{sceneRef.current?.setParameters(params)},[params]);useEffect(()=>{sceneRef.current?.setLayers(layers)},[layers]);
 return <><L as="div" ref={host} className="anatomy-canvas" aria-label="전신 3D 해부학 모델. 드래그로 회전, 스크롤로 확대, 점을 눌러 센서 선택."/>{(progress<100||error)&&<L as="div" className="model-loading" role="status">{error||`해부학 레이어 불러오는 중 · ${progress}%`}{!error&&<L as="div" style={{width:`${progress}%`}}/>}</L>}</>;
}
