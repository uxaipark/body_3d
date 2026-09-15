'use client';
import {t as translateUI} from '../public/i18n/locale.js';

import {L} from './language';

import {useEffect,useMemo,useRef,useState,type MutableRefObject} from 'react';
import {Pause,Play,Layers,Lightbulb,Activity,RotateCcw} from 'lucide-react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Switch} from '@/components/ui/switch';
import {Slider} from '@/components/ui/slider';
import {Tabs,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {sectionState,type SkinRegion} from '@/lib/skin-section';
import {sectionProfile,SectionRelaxation,deformSection,sectionCurvature} from '@/lib/skin-section-model';
import {SkinSectionScene,type SectionView} from '@/lib/skin-section-scene';
import type {Parameters} from '@/lib/physiology';
import type {AnatomyScene} from '@/lib/anatomy';

export default function SkinSection({region,params,sceneRef,onClose,onParameters}:{region:SkinRegion|null;params:Parameters;sceneRef:MutableRefObject<AnatomyScene|null>;onClose:()=>void;onParameters:(patch:Partial<Parameters>)=>void}){
 return <Dialog open={!!region} onOpenChange={open=>{if(!open)onClose()}}><DialogContent className="skin-section-dialog"><L as={DialogTitle}>{region?.label} <L as="span" className="section-chip">3D 조직 단면</L></L><L as={DialogDescription}>부위별 피부 곡면과 피하 조직, 힘줄·근육·뼈의 배치를 단면과 위쪽 시점에서 관찰합니다.</L>{region&&<SectionViewer key={region.id+region.position.join(',')} region={region} params={params} sceneRef={sceneRef} onParameters={onParameters}/>}</DialogContent></Dialog>;
}
function SectionViewer({region,params,sceneRef,onParameters}:{region:SkinRegion;params:Parameters;sceneRef:MutableRefObject<AnatomyScene|null>;onParameters:(patch:Partial<Parameters>)=>void}){
 const host=useRef<HTMLDivElement>(null),hud=useRef<HTMLDivElement>(null),viewer=useRef<SkinSectionScene|null>(null);
 const [paused,setPaused]=useState(false),[light,setLight]=useState(false),[gain,setGain]=useState(8),[fat,setFat]=useState(region.fat),[modelFat,setModelFat]=useState(region.fat),[viscosity,setViscosity]=useState(45),[mode,setMode]=useState('reflection'),[view,setView]=useState<SectionView>('full'),[error,setError]=useState('');
 const profile=useMemo(()=>sectionProfile(region,modelFat),[region,modelFat]);
 const current=useRef({params,paused,light,gain,viscosity,mode,view});current.current={params,paused,light,gain,viscosity,mode,view};
 useEffect(()=>{
  const el=host.current!;let model:SkinSectionScene;
  try{model=new SkinSectionScene(el,profile);viewer.current=model;model.focus(current.current.view);setError('');}catch{setError('3D 단면을 시작하지 못했습니다. 창을 닫았다가 다시 열어 주세요.');return;}
  const observer=new ResizeObserver(()=>model.resize());observer.observe(el);
  const relaxation=new SectionRelaxation();let id=0,last=0,stats=0,clock={time:sceneRef.current?.time||0,cycles:sceneRef.current?.cardiacCycles||0};
  relaxation.state={...sectionState({...region,fat:profile.fat,arteryDepth:profile.arteryDepth},current.current.params,clock.time,clock.cycles)};
  const draw=(now:number)=>{
   id=requestAnimationFrame(draw);if(now-last<32||document.hidden)return;last=now;
   const c=current.current,body=sceneRef.current;
   const next=c.paused?clock:{time:body?.time||0,cycles:body?.cardiacCycles||0};
   const dt=Math.max(0,Math.min(.1,next.time-clock.time));clock=next;
   const regionWithProfile={...region,fat:profile.fat,arteryDepth:profile.arteryDepth},target=sectionState(regionWithProfile,c.params,clock.time,clock.cycles),state=relaxation.update(dt,target,c.viscosity);
   const energy=model.update(state,c.gain,clock.time,c.params.wavelength,c.params.spo2,c.light,c.mode);
   if(now-stats>160&&hud.current){stats=now;const x=profile.arteryX,z=-profile.thickness/2,near=x+Math.max(1.7,profile.arteryDepth*.9),centre=deformSection(x,0,z,profile,state,1)[1]-sectionCurvature(x,z,profile),side=deformSection(near,0,z,profile,state,1)[1]-sectionCurvature(near,z,profile);hud.current.textContent=translateUI(`중앙 변위 ${centre.toFixed(3)} mm · 주변 변위 ${side.toFixed(3)} mm · 내강 반경 ${(profile.radius+state.distension).toFixed(3)} mm${c.light?` · ${c.mode==='reflection'?'상부':'하부'} 출사 광량 ${(energy[c.mode==='reflection'?'reflection':'transmission']*100).toFixed(1)}%`:''}`);}
  };
  id=requestAnimationFrame(draw);return()=>{cancelAnimationFrame(id);observer.disconnect();model.dispose();viewer.current=null;};
 },[profile,region,sceneRef]);
 return <>
  <L as="div" className="section-tools"><L as="button" className="section-play" onClick={()=>setPaused(v=>!v)} aria-pressed={paused}>{paused?<Play size={15}/>:<Pause size={15}/>} {paused?'재생':'일시 정지'}</L><Tabs value={view} onValueChange={v=>{setView(v as SectionView);viewer.current?.focus(v as SectionView)}}><TabsList aria-label="피부 단면 관찰 범위"><L as={TabsTrigger} value="full">전층</L><L as={TabsTrigger} value="top">Top view · 등고선</L><L as={TabsTrigger} value="dermis">표피·진피 확대</L><L as={TabsTrigger} value="vessel">혈관 확대</L></TabsList></Tabs><L as="button" className="section-play" onClick={()=>viewer.current?.focus(view)} aria-label="단면 시점 초기화"><RotateCcw size={15}/></L><L as="label"><Lightbulb size={15}/> 광 경로 <Switch checked={light} onCheckedChange={setLight} aria-label="광 경로 표시"/></L><L as="span" className="section-drive"><Activity size={14}/>{region.driver==='breath'?'호흡 중심':region.driver==='heart'?'심장 · 호흡':'동맥 맥동'}</L></L>
  <L as="div" ref={host} className="section-stage" role="group" aria-label={`${region.label} 3D 피부 조직 단면`}>{error&&<L as="p" className="section-render-error" role="alert">{error}</L>}</L>
  <L as="div" className="section-tissue-legend"><L as="span"><L as="i" style={{background:'#e6c3a7'}}/>각질·표피</L><L as="span"><L as="i" style={{background:'#d59b9a'}}/>유두·망상 진피</L><L as="span"><L as="i" style={{background:'#d2b581'}}/>지방 소엽·섬유 격막</L><L as="span"><L as="i" style={{background:'#ddc8b6'}}/>동맥벽 3층</L><L as="span"><L as="i" style={{background:'#648797'}}/>정맥·모세혈관</L>{profile.structures.some(s=>s.kind==='tendon')&&<L as="span"><L as="i" style={{background:'#e5decc'}}/>힘줄</L>}{profile.structures.some(s=>s.kind==='bone')&&<L as="span"><L as="i" style={{background:'#e4d6ad'}}/>피질골·해면골</L>}{profile.structures.some(s=>s.kind==='muscle')&&<L as="span"><L as="i" style={{background:'#9f4653'}}/>근육 다발</L>}</L>
  <L as="div" className="section-region-summary">{profile.description} <L as="span">관찰 영역 {profile.width} × {profile.thickness} mm · 깊이 {profile.total.toFixed(1)} mm</L></L><L as="div" ref={hud} className="section-hud" aria-live="off"/>
  <L as="div" className="section-controls section-mechanics-controls">
   <L as="label"><L as="span">피하지방 두께 <L as="strong">{fat.toFixed(1)} mm</L></L><Slider value={[fat]} min={.5} max={16} step={.5} onValueChange={v=>setFat(Array.isArray(v)?v[0]:v)} onValueCommitted={v=>setModelFat(Array.isArray(v)?v[0]:v)} aria-label="단면 피하지방 두께"/></L>
   <L as="label"><L as="span">조직 점성 <L as="strong">{viscosity}%</L></L><Slider value={[viscosity]} min={0} max={100} onValueChange={v=>setViscosity(Array.isArray(v)?v[0]:v)} aria-label="조직 점성 반응"/><L as="small">높을수록 변형과 복원이 늦어집니다.</L></L>
   <L as="label"><L as="span">맥동 변위 강조 <L as="strong">{gain}×</L></L><Slider value={[gain]} min={1} max={12} onValueChange={v=>setGain(Array.isArray(v)?v[0]:v)} aria-label="맥동 변위 시각 강조 배율"/><L as="small">변위 수치는 실제 배율 1× 기준</L></L>
  </L>
  {light&&<L as="div" className="section-controls section-optics-controls"><L as="label"><L as="span">광학 배치</L><Tabs value={mode} onValueChange={v=>setMode(String(v))}><TabsList><L as={TabsTrigger} value="reflection">반사형</L><L as={TabsTrigger} value="transmission">투과형</L></TabsList></Tabs></L><L as="label"><L as="span">파장</L><Tabs value={String(params.wavelength)} onValueChange={v=>onParameters({wavelength:Number(v)})}><TabsList>{[530,660,940].map(w=><L as={TabsTrigger} key={w} value={String(w)}>{w} nm</L>)}</TabsList></Tabs></L><L as="label"><L as="span">SpO₂ 입력 <L as="strong">{params.spo2}%</L></L><Slider value={[params.spo2]} min={80} max={100} onValueChange={v=>onParameters({spo2:Array.isArray(v)?v[0]:v})} aria-label="단면 산소포화도 입력"/></L></L>}
  <L as="p" className="section-note"><Layers size={14}/><L as="span">12개 피부 부위의 대표적인 해부학 배치를 참고한 3D 조직 모형입니다. 선택 지점의 개인별 영상이나 전체 조직을 재구성한 모델은 아닙니다. 미세조직의 일부 크기는 가독성을 위해 강조했습니다. 층별 두께와 점성은 예시값이며, 조직 변형은 점성 이완과 뼈·힘줄 주변의 변형 제한을 근사합니다. 개인별 물성으로 보정한 3D 유한요소 해석은 아닙니다. 광 경로는 출사 경향을 보여주며 SpO₂ 역산값을 제공하지 않습니다. <L as="a" href="https://pmc.ncbi.nlm.nih.gov/articles/PMC8630952/" target="_blank" rel="noreferrer">전완 해부학</L> · <L as="a" href="https://pubmed.ncbi.nlm.nih.gov/14758214/" target="_blank" rel="noreferrer">손가락 조직</L> · <L as="a" href="https://www.ncbi.nlm.nih.gov/books/NBK535346/" target="_blank" rel="noreferrer">조직 구조</L> · <L as="a" href="https://pmc.ncbi.nlm.nih.gov/articles/PMC2584606/" target="_blank" rel="noreferrer">점탄성 참고</L></L></L>
 </>;
}
