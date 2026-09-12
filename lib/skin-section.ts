import type {Parameters} from './physiology';
export interface SkinRegion {id:string;label:string;position:[number,number,number];fat:number;arteryDepth:number;radius:number;distance:number;driver:'pulse'|'breath'|'heart';transmission?:boolean}
export const skinRegions:SkinRegion[]=[
 {id:'wrist',label:'손목 · 요골동맥',position:[-.282,.865,.02],fat:3,arteryDepth:3.3,radius:1.1,distance:.65,driver:'pulse'},
 {id:'finger',label:'손가락',position:[-.308,.724,.043],fat:1.5,arteryDepth:2.1,radius:.35,distance:.85,driver:'pulse',transmission:true},
 {id:'ear',label:'귓볼',position:[-.072,1.592,.005],fat:.7,arteryDepth:1.3,radius:.22,distance:.32,driver:'pulse',transmission:true},
 {id:'forehead',label:'이마',position:[0,1.664,.085],fat:2,arteryDepth:2.4,radius:.35,distance:.36,driver:'pulse'},
 {id:'chest',label:'흉부 · 심장',position:[.06,1.32,.10],fat:7,arteryDepth:4.5,radius:.6,distance:.15,driver:'heart'},
 {id:'abdomen',label:'복부 · 호흡',position:[0,1.03,.12],fat:12,arteryDepth:6,radius:.6,distance:.3,driver:'breath'},
 {id:'arm',label:'상완',position:[-.20,1.19,.015],fat:5,arteryDepth:4,radius:.8,distance:.39,driver:'pulse'},
 {id:'forearm',label:'전완',position:[.26,.98,.015],fat:3,arteryDepth:3.2,radius:.7,distance:.52,driver:'pulse'},
 {id:'thigh',label:'허벅지',position:[-.085,.64,.08],fat:8,arteryDepth:6,radius:.8,distance:.7,driver:'pulse'},
 {id:'calf',label:'종아리',position:[.08,.29,.04],fat:4,arteryDepth:3.8,radius:.6,distance:1.1,driver:'pulse'},
 {id:'back',label:'등 · 호흡',position:[0,1.26,-.12],fat:7,arteryDepth:4.5,radius:.5,distance:.3,driver:'breath'},
 {id:'neck',label:'목',position:[.045,1.46,.015],fat:2,arteryDepth:2.8,radius:.65,distance:.20,driver:'pulse'},
];
export function closestSkinRegion(point:[number,number,number]):SkinRegion{
 const [x,y,z]=point;
 let id=y>1.53?'forehead':y>1.40?'neck':y<.46?'calf':y<.79?'thigh':y<1.16?'abdomen':z<-.04?'back':'chest';
 if(Math.abs(x)>.19&&y<1.30)id=y<.81?'finger':y<.91?'wrist':y<1.07?'forearm':'arm';
 if(y>1.54&&y<1.63&&Math.abs(x)>.06)id='ear';
 const preset=skinRegions.find(r=>r.id===id)!;return {...preset,position:point,label:preset.label+' · 선택 지점'};
}
const pulse=(cycles:number)=>{const t=((cycles%1)+1)%1;return t<.38?Math.sin(Math.PI*t/.38)**2:0};
/** Millimetres. Local illustrative tissue response, coupled to the body's clock.
 * Ricker displacement has a positive centre and negative side lobes with zero
 * integral on the infinite cross-section. This approximates tissue redistribution.
 */
export function sectionState(region:SkinRegion,p:Parameters,time:number,cycles=time*p.hr/60){
 const delay=.025+region.distance/(4+8*p.stiffness/100),beat=pulse(cycles-delay*p.hr/60);
 const breath=(1+Math.sin(time*Math.PI*2*p.rr/60))/2;
 const distension=region.radius*(.025*(1-.7*p.stiffness/100))*beat;
 const respiratory=(region.driver==='breath'?2.6:region.driver==='heart'?1.2:0)*p.tidal/500*breath;
 const cardiac=region.driver==='heart'?.22*pulse(cycles):0;
 return {beat,breath,distension,respiratory,cardiac,radius:region.radius+distension};
}
export function sectionDisplacement(x:number,depth:number,region:SkinRegion,state:ReturnType<typeof sectionState>,gain=1){
 const width=Math.max(1.7,region.arteryDepth*.9),q=x/width;
 const redistribution=(1-2*q*q)*Math.exp(-q*q);
 const depthCoupling=.55+.45*Math.exp(-Math.abs(depth-region.arteryDepth)/3);
 return gain*state.distension*.8*redistribution*depthCoupling+(state.respiratory+state.cardiac)*Math.exp(-x*x/230)*(.9+.1*Math.min(depth/(region.fat+2),1));
}
/** Illustrative absorption coefficients (1/mm), not fitted optical properties. */
export function opticalAbsorption(depth:number,inBlood:boolean,wavelength:number,spo2:number){
 if(inBlood){const oxygen=spo2/100;return wavelength===530?1.5:wavelength===660?.20*oxygen+1.25*(1-oxygen):.36*oxygen+.22*(1-oxygen)}
 return depth<.12?(wavelength===530?.28:wavelength===660?.10:.055):depth<1.5?(wavelength===530?.10:.035):.012;
}
export interface PhotonPath {points:[number,number][];exit:'reflection'|'transmission'|'absorbed'}
export function photonPaths(depth:number):PhotonPath[]{
 let seed=7231;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return(seed+.5)/4294967296};
 return Array.from({length:64},()=>{
  let x=-3+(random()-.5)*.5,y=.01,angle=Math.PI/2;const points:[number,number][]=[[x,y]];let exit:PhotonPath['exit']='absorbed';
  for(let j=0;j<65;j++){
   const step=-Math.log(random())*.8;angle+=(random()-.5)*2.5;x+=Math.cos(angle)*step;y+=Math.sin(angle)*step;points.push([x,y]);
   if(y<0){exit='reflection';break}if(y>depth){exit='transmission';break}if(Math.abs(x)>12)break;
  }
  return {points,exit};
 });
}
