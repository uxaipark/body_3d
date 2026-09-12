'use client';
import {useEffect,useMemo,useRef,useState,type MutableRefObject}from'react';
import {Pause,Play,Layers,Lightbulb,Activity}from'lucide-react';
import {Dialog,DialogContent,DialogTitle,DialogDescription}from'@/components/ui/dialog';
import {Switch}from'@/components/ui/switch';
import {Slider}from'@/components/ui/slider';
import {Tabs,TabsList,TabsTrigger}from'@/components/ui/tabs';
import {sectionState,sectionDisplacement,opticalAbsorption,photonPaths,type SkinRegion}from'@/lib/skin-section';
import type{Parameters}from'@/lib/physiology';
import type{AnatomyScene}from'@/lib/anatomy';
export default function SkinSection({region,params,sceneRef,onClose,onParameters}:{region:SkinRegion|null;params:Parameters;sceneRef:MutableRefObject<AnatomyScene|null>;onClose:()=>void;onParameters:(patch:Partial<Parameters>)=>void}){
 return <Dialog open={!!region} onOpenChange={open=>{if(!open)onClose()}}><DialogContent className="skin-section-dialog"><DialogTitle>{region?.label} <span className="section-chip">피부 단면</span></DialogTitle><DialogDescription>표피부터 피하지방까지의 국소 단면 · 신체와 같은 심박·호흡 시간으로 움직입니다.</DialogDescription>{region&&<SectionCanvas key={region.id+region.position.join(',')} region={region} params={params} sceneRef={sceneRef} onParameters={onParameters}/>}</DialogContent></Dialog>;
}
function SectionCanvas({region,params,sceneRef,onParameters}:{region:SkinRegion;params:Parameters;sceneRef:MutableRefObject<AnatomyScene|null>;onParameters:(patch:Partial<Parameters>)=>void}){
 const canvas=useRef<HTMLCanvasElement>(null),hud=useRef<HTMLDivElement>(null),clock=useRef({time:0,cycles:0});
 const [paused,setPaused]=useState(false),[light,setLight]=useState(true),[gain,setGain]=useState(region.driver==='pulse'?20:5),[fat,setFat]=useState(region.fat),[mode,setMode]=useState('reflection');
 const current=useRef({params,paused,light,gain,fat,mode});current.current={params,paused,light,gain,fat,mode};
 const paths=useMemo(()=>photonPaths(fat+3),[fat]);
 useEffect(()=>{
  const el=canvas.current!,ctx=el.getContext('2d')!;let id=0,last=0,stats=0;
  const draw=(now:number)=>{
   id=requestAnimationFrame(draw);if(now-last<30||document.hidden)return;last=now;
   const c=current.current,w=el.clientWidth,h=el.clientHeight;if(w<1||h<1)return;const dpr=Math.min(devicePixelRatio,2);
   if(el.width!==Math.round(w*dpr)||el.height!==Math.round(h*dpr)){el.width=Math.round(w*dpr);el.height=Math.round(h*dpr)}ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
   if(!c.paused){clock.current.time=sceneRef.current?.time||0;clock.current.cycles=sceneRef.current?.cardiacCycles||0}
   const t=clock.current.time,r={...region,fat:c.fat,arteryDepth:Math.min(region.arteryDepth,c.fat+1)},state=sectionState(r,c.params,t,clock.current.cycles);
   const left=55,right=w-135,width=right-left,total=c.fat+3,maxMotion=(r.driver==='breath'?2.6:r.driver==='heart'?1.42:0)*c.params.tidal/500+r.radius*.025*c.gain*.8,scale=Math.min((h-145)/(total+maxMotion),85),top=65+maxMotion*scale;
   const px=(x:number)=>left+(x+12)/24*width;
   const y=(x:number,depth:number)=>top+depth*scale-sectionDisplacement(x,depth,r,state,c.gain)*scale;
   ctx.fillStyle='#101b23';ctx.fillRect(0,0,w,h);
   const tissue=(a:number,b:number,color:string)=>{ctx.beginPath();for(let i=0;i<=100;i++){const x=-12+i*.24;i?ctx.lineTo(px(x),y(x,a)):ctx.moveTo(px(x),y(x,a))}for(let i=100;i>=0;i--){const x=-12+i*.24;ctx.lineTo(px(x),y(x,b))}ctx.closePath();ctx.fillStyle=color;ctx.fill()};
   tissue(1.6+c.fat,total,'#75434d');tissue(1.6,1.6+c.fat,'#bea153');tissue(.12,1.6,'#be7774');tissue(0,.12,'#ebbb9f');
   // Lobules move with the surrounding field; layers remain separate boundaries.
   ctx.save();ctx.beginPath();ctx.rect(left,top-60,width,h);ctx.clip();
   for(let row=0;row<Math.ceil(c.fat/.85);row++)for(let col=0;col<22;col++){
    const x=-11.6+col*1.1+(row%2)*.45,depth=2+row*.85;if(depth>c.fat+1.2)continue;
    ctx.beginPath();ctx.ellipse(px(x),y(x,depth),width/24*.50,scale*.34,Math.sin(col*2+row)*.25,0,Math.PI*2);ctx.fillStyle=(row+col)%3?'#d6b867':'#e3cb84';ctx.fill();ctx.strokeStyle='#957b4055';ctx.lineWidth=1;ctx.stroke();
   }
   // Papillary capillary loops and a small venule in the dermis.
   for(let i=0;i<16;i++){const x=-11+i*1.45;ctx.beginPath();ctx.moveTo(px(x),y(x,1.45));ctx.bezierCurveTo(px(x),y(x,.4),px(x+.55),y(x,.4),px(x+.55),y(x,1.45));ctx.strokeStyle=i%2?'#904854':'#477790';ctx.lineWidth=2;ctx.stroke()}
   const arteryY=y(0,r.arteryDepth),radius=(r.radius+state.distension*c.gain)*scale,radiusX=(r.radius+state.distension*c.gain)*width/24;
   ctx.beginPath();ctx.ellipse(px(0),arteryY,radiusX,radius,0,0,Math.PI*2);ctx.fillStyle='#a33c4e';ctx.fill();ctx.strokeStyle='#f29694';ctx.lineWidth=3;ctx.stroke();
   ctx.beginPath();ctx.ellipse(px(4),y(4,r.arteryDepth+.2),scale*.6,scale*.4,0,0,Math.PI*2);ctx.fillStyle='#467794';ctx.fill();
   for(let i=0;i<8;i++){const a=t*1.9+i*2.4;ctx.beginPath();ctx.ellipse(px(0)+Math.cos(a)*radiusX*.55,arteryY+Math.sin(a*1.3)*radius*.55,Math.min(4,radius*.18),Math.min(2,radius*.12),a,0,Math.PI*2);ctx.fillStyle='#ef8b8b';ctx.fill()}
   let reflected=0,transmitted=0;
   if(c.light){const color=c.params.wavelength===530?'119,240,160':c.params.wavelength===660?'255,116,124':'191,160,255';
    for(let index=0;index<paths.length;index++){
     const path=paths[index];let energy=1;const steps=Math.max(1,Math.floor(((t*.42+index/paths.length)%1)*path.points.length));
     for(let j=1;j<path.points.length;j++){
      const a=path.points[j-1],b=path.points[j],inBlood=Math.hypot(b[0],b[1]-r.arteryDepth)<state.radius;
      energy*=Math.exp(-opticalAbsorption(b[1],inBlood,c.params.wavelength,c.params.spo2)*Math.hypot(b[0]-a[0],b[1]-a[1]));
      if(j>steps||energy<.025)continue;ctx.strokeStyle=`rgba(${color},${energy*.17})`;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(px(a[0]),y(a[0],a[1]));ctx.lineTo(px(b[0]),y(b[0],b[1]));ctx.stroke();
      if(j===steps){ctx.fillStyle=`rgba(${color},${energy})`;ctx.beginPath();ctx.arc(px(b[0]),y(b[0],b[1]),2,0,Math.PI*2);ctx.fill()}
     }
     if(path.exit==='reflection')reflected+=energy;if(path.exit==='transmission')transmitted+=energy;
    }
   }
   ctx.restore();
   const label=(text:string,depth:number,color:string)=>{ctx.font='12px sans-serif';ctx.fillStyle=color;ctx.textAlign='left';ctx.fillText(text,right+12,y(10,depth)+4)};
   label('표피',0,'#f2c5af');label('진피',.95,'#e4a7a1');label('피하지방',1.6+c.fat*.55,'#e1c981');label('근막 · 심부 조직',total-.35,'#c59ca3');
   ctx.strokeStyle='#79aa9988';ctx.setLineDash([3,5]);ctx.beginPath();ctx.moveTo(left,top);ctx.lineTo(right,top);ctx.stroke();ctx.setLineDash([]);
   ctx.font='11px monospace';ctx.fillStyle='#83a19f';ctx.textAlign='right';for(let d=0;d<=total;d+=total>10?2:1){ctx.fillText(`${d} mm`,left-10,top+d*scale+4)}
   const detectorX=c.mode==='reflection'?3:-3,detectorY=c.mode==='reflection'?y(detectorX,0)-23:top+total*scale+12;
   ctx.fillStyle='#b4e5d1';ctx.fillRect(px(-3)-16,y(-3,0)-23,32,9);ctx.font='12px sans-serif';ctx.textAlign='center';ctx.fillText('LED',px(-3),y(-3,0)-32);
   ctx.fillStyle='#86b6d6';ctx.fillRect(px(detectorX)-17,detectorY,34,9);ctx.fillText('PD',px(detectorX),detectorY+(c.mode==='reflection'?-9:24));
   ctx.fillStyle='#98b2bb';ctx.textAlign='left';ctx.font='12px sans-serif';ctx.fillText(c.paused?'일시 정지':`심박 ${c.params.hr} bpm  ·  호흡 ${c.params.rr}/min`,left,25);
   ctx.textAlign='right';ctx.fillStyle='#bcd4cb';ctx.fillText(`맥동 변위 ${c.gain}× 강조`,right,25);
   if(now-stats>160&&hud.current){stats=now;const centre=sectionDisplacement(0,0,r,state,1),side=sectionDisplacement(Math.max(1.7,r.arteryDepth*.9),0,r,state,1);hud.current.textContent=`중앙 변위 ${centre.toFixed(3)} mm  ·  주변 변위 ${side.toFixed(3)} mm  ·  동맥 반경 ${state.radius.toFixed(3)} mm  ·  ${c.mode==='reflection'?'상부 출사':'하부 출사'} 광량 ${((c.mode==='reflection'?reflected:transmitted)/paths.length*100).toFixed(1)}%`}
  };id=requestAnimationFrame(draw);return()=>cancelAnimationFrame(id);
 },[region,paths,sceneRef]);
 return <><div className="section-tools"><button className="section-play" onClick={()=>setPaused(v=>!v)}>{paused?<Play size={15}/>:<Pause size={15}/>} {paused?'재생':'일시 정지'}</button><label><Lightbulb size={15}/> 광 경로 <Switch checked={light} onCheckedChange={setLight} aria-label="광 경로 표시"/></label><Tabs value={mode} onValueChange={v=>setMode(String(v))}><TabsList><TabsTrigger value="reflection">반사형</TabsTrigger><TabsTrigger value="transmission">투과형</TabsTrigger></TabsList></Tabs><span className="section-drive"><Activity size={14}/>{region.driver==='breath'?'호흡 중심':region.driver==='heart'?'심장 · 호흡':'동맥 맥동'}</span></div><canvas ref={canvas} className="section-canvas" aria-label={`${region.label}의 피부, 지방, 혈관 변형과 광 경로를 보여주는 실시간 2D 단면`}/><div ref={hud} className="section-hud" aria-live="off"/><div className="section-controls"><label><span>파장</span><Tabs value={String(params.wavelength)} onValueChange={v=>onParameters({wavelength:Number(v) as Parameters['wavelength']})}><TabsList>{[530,660,940].map(w=><TabsTrigger key={w} value={String(w)}>{w} nm</TabsTrigger>)}</TabsList></Tabs></label><label><span>SpO₂ 입력 <strong>{params.spo2}%</strong></span><Slider value={[params.spo2]} min={80} max={100} onValueChange={v=>onParameters({spo2:Array.isArray(v)?v[0]:v})} aria-label="단면 산소포화도 입력"/></label><label><span>피하지방 두께 <strong>{fat.toFixed(1)} mm</strong></span><Slider value={[fat]} min={.5} max={16} step={.5} onValueChange={v=>setFat(Array.isArray(v)?v[0]:v)} aria-label="단면 피하지방 두께"/></label><label><span>맥동 변위 강조 <strong>{gain}×</strong></span><Slider value={[gain]} min={1} max={40} onValueChange={v=>setGain(Array.isArray(v)?v[0]:v)} aria-label="맥동 변위 시각 강조 배율"/></label></div><p className="section-note"><Layers size={14}/> 국소 조직과 광 경로의 근사 모델입니다. 피부 두께·광학계수는 예시값이며, 광량은 검출기 측정값이 아닌 단면 밖으로 나가는 경로의 비율입니다. SpO₂ 역산 및 정밀 광학·조직역학 해석은 포함하지 않습니다.</p></>;
}
