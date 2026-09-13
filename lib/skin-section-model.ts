import {surroundingDisplacement} from '../public/simulators/radial/js/wristMechanics.js';
import type {SkinRegion} from './skin-section';
/** Regional topology presets in millimetres. Representative cutaneous windows,
 * not patient imaging or a claim that every vessel is a named major artery. */
export type StructureKind='bone'|'tendon'|'muscle'|'fascia'|'nerve';
export interface SectionStructure {kind:StructureKind;label:string;x:number;depth:number;rx:number;ry:number}
export interface RegionalAnatomy {width:number;length:number;curveX:number;curveZ:number;deep:number;arteryX:number;arteryLabel:string;veinX:number;description:string;structures:SectionStructure[]}
export function regionalAnatomy(id:string,softDepth:number):RegionalAnatomy{
 const s=(kind:StructureKind,label:string,x:number,depth:number,rx:number,ry:number):SectionStructure=>({kind,label,x,depth,rx,ry});
 const d=softDepth,base:RegionalAnatomy={width:24,length:24,curveX:55,curveZ:180,deep:8,arteryX:0,arteryLabel:'피부 동맥 분지',veinX:2.5,description:'피부·피하조직과 국소 심부 조직',structures:[]};
 switch(id){
 case 'wrist':return {...base,curveX:28,curveZ:130,deep:9,veinX:-2.1,arteryLabel:'요골동맥',description:'손바닥쪽 요측 손목 · 요골동맥의 양옆 힘줄과 심부 요골',structures:[s('tendon','요측수근굴근 힘줄',3.6,3.5,1.15,1.25),s('tendon','상완요골근 힘줄',-6,3.4,1.1,.85),s('bone','요골 · 피질골과 해면골',-2.8,Math.max(d+4.1,8.8),5.2,3),s('muscle','방형회내근',6.8,d+3,3.1,1.6)]};
 case 'finger':return {...base,width:14,length:18,curveX:10,curveZ:35,deep:6,arteryX:-4.6,veinX:4.8,arteryLabel:'수지 동맥 분지',description:'손가락 지문면 · 두꺼운 표피, 지방 패드와 섬유 격막, 말절골',structures:[s('bone','말절골',0,d+3,3.1,2),s('nerve','수지 신경',-5.3,3.4,.38,.42)]};
 case 'ear':return {...base,width:14,length:16,curveX:14,curveZ:20,deep:1,description:'귓볼 · 섬유지방 조직과 미세 혈관망, 연골 없는 부위',structures:[]};
 case 'forehead':return {...base,curveX:75,curveZ:110,deep:6,description:'이마 · 전두근, 느슨한 결합조직과 두개골',structures:[s('muscle','전두근',0,d+.85,10,.65),s('bone','전두골',0,d+3.8,11.7,1.7)]};
 case 'chest':return {...base,curveX:110,curveZ:150,deep:10,description:'흉부 · 대흉근과 늑골 위 연부조직, 심박·호흡 전달',structures:[s('muscle','대흉근',0,d+3,11.5,2.2),s('bone','늑골',-7,d+7.2,2.4,1.9),s('bone','늑골',7,d+7.2,2.4,1.9)]};
 case 'abdomen':return {...base,curveX:95,curveZ:140,deep:8,description:'복부 · 두꺼운 피하지방, 복직근초와 복직근, 호흡성 표면 변화',structures:[s('fascia','복직근초',0,d+.5,11.5,.35),s('muscle','복직근',-6,d+4,5.2,2.8),s('muscle','복직근',6,d+4,5.2,2.8),s('fascia','백선',0,d+3.7,.55,2.8)]};
 case 'arm':return {...base,curveX:43,curveZ:220,deep:10,description:'상완 · 피하 지방, 상완 근막과 근육 다발',structures:[s('fascia','상완 근막',0,d+.5,11.5,.3),s('muscle','상완 근육 다발',0,d+5,10.5,3.6)]};
 case 'forearm':return {...base,curveX:34,curveZ:170,deep:10,description:'전완 · 굴근군과 힘줄, 요골 주변 연부조직',structures:[s('muscle','전완 굴근군',4.5,d+3.5,6,2.7),s('tendon','굴근 힘줄',-4,d+.9,1.4,.65),s('bone','요골',-6,d+6.6,3.3,2.5)]};
 case 'thigh':return {...base,curveX:72,curveZ:250,deep:10,description:'허벅지 · 피하지방과 대퇴근막, 두꺼운 근육 다발',structures:[s('fascia','대퇴근막',0,d+.5,11.5,.35),s('muscle','대퇴 근육 다발',0,d+5,11,3.6)]};
 case 'calf':return {...base,curveX:46,curveZ:180,deep:10,description:'종아리 · 하퇴 근막과 비복근 다발',structures:[s('fascia','하퇴 근막',0,d+.5,11.5,.3),s('muscle','비복근',0,d+5,11,3.6)]};
 case 'back':return {...base,curveX:130,curveZ:240,deep:10,description:'등 · 두꺼운 진피, 흉요근막과 척추 주변 근육',structures:[s('fascia','흉요근막',0,d+.6,11.5,.4),s('muscle','척추 주변 근육',-6,d+5,5.3,3.7),s('muscle','척추 주변 근육',6,d+5,5.3,3.7)]};
 case 'neck':return {...base,curveX:36,curveZ:95,deep:9,description:'목 · 얇은 피하조직, 넓은목근과 목 근육층',structures:[s('muscle','넓은목근',0,d+.7,10,.45),s('muscle','목 근육층',4,d+4.6,6,2.8)]};
 default:return base;
 }
}


export interface SectionProfile extends RegionalAnatomy {coupledWrist?:boolean;regionId:string;thickness:number;epidermis:number;papillary:number;dermis:number;fat:number;total:number;arteryDepth:number;radius:number;wall:number;hair:boolean}
export interface TissueDrive {distension:number;respiratory:number;cardiac:number}
export function sectionProfile(region:SkinRegion,fat=region.fat):SectionProfile{
 const epidermis=region.id==='finger'?.28:region.id==='ear'?.09:.12;
 const dermis=region.id==='ear'?1.05:region.id==='finger'?1.65:region.id==='back'?2.1:1.6;
 const anatomy=regionalAnatomy(region.id,dermis+fat),wall=.055+region.radius*.16,total=Math.max(dermis+fat+anatomy.deep,...anatomy.structures.map(s=>s.depth+s.ry+.4));
 return {...anatomy,regionId:region.id,thickness:anatomy.length,epidermis,papillary:epidermis+.27,dermis,fat,total,wall,radius:region.radius,arteryDepth:Math.max(epidermis+.45+region.radius,Math.min(region.arteryDepth,total-region.radius-wall-.15)),hair:region.id!=='finger'&&region.id!=='ear'};
}
/** Convex rest surface; x is transverse, z follows the length of the skin patch. */
export function sectionCurvature(x:number,z:number,p:SectionProfile){return -x*x/(2*p.curveX)-(z+p.thickness/2)**2/(2*p.curveZ);}
export function sectionMobility(x:number,depth:number,p:SectionProfile){
 let restriction=0;
 for(const s of p.structures){const stiffness=s.kind==='bone'?1:s.kind==='tendon'?.8:s.kind==='fascia'?.15:0;if(!stiffness)continue;const r=Math.hypot((x-s.x)/s.rx,(depth-s.depth)/s.ry),t=Math.max(0,Math.min(1,(r-1)/(s.kind==='fascia'?1.8:.45)));restriction=Math.max(restriction,stiffness*(1-t*t*(3-2*t)));}
 return 1-restriction;
}
/** Millimetres; regional values are illustrative presets, not measured histology. */
export function tissueBoundary(x:number,layer:number,p:SectionProfile){
 const surface=.012*Math.sin(x*3.7)+.006*Math.sin(x*9.3);
 const rete=.045*(.5+.5*Math.cos(x*8.6+.24*Math.sin(x*2.3)));
 return layer===0?surface:layer===1?surface+p.epidermis*.22:layer===2?p.epidermis+rete:layer===3?p.papillary+.025*Math.sin(x*3.1):layer===4?p.dermis+.06*Math.sin(x*1.8)+.025*Math.sin(x*4.2):layer===5?p.dermis+p.fat+.06*Math.sin(x*1.1):p.total;
}
/** Stable viscoelastic relaxation of prescribed actuation. There is no solver
 * drift during pause. This is a reduced plane-strain illustration, not FEM. */
export class SectionRelaxation{
 state:TissueDrive={distension:0,respiratory:0,cardiac:0};
 update(dt:number,target:TissueDrive,viscosity:number){
  if(dt<=0)return this.state;
  const tau=.012+Math.max(0,Math.min(100,viscosity))*.0012;
  for(const key of ['distension','respiratory','cardiac'] as const){const alpha=1-Math.exp(-Math.min(dt,.1)/(tau*(key==='respiratory'?1.8:1)));this.state[key]+=(target[key]-this.state[key])*alpha;}
  return this.state;
 }
}
/** One deformation for layer surfaces, septa, vessels and optical paths.
 * Away from structural supports, an annular and divergence-free field
 * redistributes tissue. Bone/tendon restrictions alter local area conservation.
 * The lumen itself changes volume intentionally. */
export function deformSection(x:number,depth:number,z:number,p:SectionProfile,state:TissueDrive,gain=1):[number,number,number]{
 if(p.coupledWrist){const u=surroundingDisplacement(x,depth,p.arteryX,p.arteryDepth,Math.min(state.distension*gain,p.radius*.32),p.fat),mobility=sectionMobility(x,depth,p);const xx=x+u.lateral_mm*mobility;return [xx,-depth+u.vertical_mm*mobility+sectionCurvature(xx,z,p),z];}
 const delta=Math.min(state.distension*gain,p.radius*.32),dy=depth-p.arteryDepth,rx=x-p.arteryX,r=Math.hypot(rx,dy),R=p.radius;
 const factor=r<R?(R+delta)/R:Math.sqrt(1+((R+delta)**2-R*R)/Math.max(r*r,1e-10));
 let u=rx*factor,v=p.arteryDepth+dy*factor;
 const width=Math.max(1.7,p.arteryDepth*.9),A=delta*.65;
 const velocity=(a:number,b:number)=>{
  const q=a/width,h=(b-p.arteryDepth)/5,e=Math.exp(-q*q),f=Math.exp(-h*h*.3);
  return [A*a*e*f*(-.12*h),-A*(1-2*q*q)*e*f];
 };
 for(let i=0;i<4;i++){const a=velocity(u,v),b=velocity(u+a[0]/8,v+a[1]/8);u+=b[0]/4;v+=b[1]/4;}
 u+=p.arteryX;const mobility=sectionMobility(x,depth,p);u=x+(u-x)*mobility;v=depth+(v-depth)*mobility;
 const lift=state.respiratory+state.cardiac;v-=lift*Math.exp(-u*u/230);
 return [u,-v+sectionCurvature(u,z,p),z];
}

// GPU mirror of deformSection, shared by all section materials.
export const sectionDeformationGLSL=(profile:SectionProfile)=>{
 const f=(x:number)=>x.toFixed(8);
 const supports=profile.structures.filter(s=>s.kind==='bone'||s.kind==='tendon'||s.kind==='fascia').map(s=>`restriction=max(restriction,${f(s.kind==='bone'?1:s.kind==='tendon'?.8:.15)}*(1.0-smoothstep(1.0,${f(s.kind==='fascia'?2.8:1.45)},length((p-vec2(${f(s.x)},${f(s.depth)}))/vec2(${f(s.rx)},${f(s.ry)})))));`).join('\n');
 return `
uniform float uSectionDepth;uniform float uSectionRadius;uniform float uSectionExpansion;uniform float uSectionLift;
vec2 tissueVelocity(vec2 p,float A,float width){
 float q=p.x/width,h=(p.y-uSectionDepth)/5.0,e=exp(-q*q),f=exp(-h*h*.3);
 return vec2(A*p.x*e*f*(-.12*h),-A*(1.0-2.0*q*q)*e*f);
}
float sectionMobility(vec2 p){float restriction=0.0;${supports}return 1.0-restriction;}
float sectionCurve(float x,float z){return -x*x/${f(2*profile.curveX)}-(z+${f(profile.thickness/2)})*(z+${f(profile.thickness/2)})/${f(2*profile.curveZ)};}
${profile.coupledWrist?`vec3 sectionWarp(vec3 p){
 float x=p.x-${f(profile.arteryX)},d=max(0.0,-p.y),y=uSectionDepth-d,R=1.1,r=length(vec2(x,y));
 float dr=min(uSectionExpansion,uSectionRadius*.32),radial=dr*R/max(R,r),support=exp(-max(0.0,d-uSectionDepth)/4.0),skinWeight=exp(-d/1.8);
 float width=max(2.5,uSectionDepth*1.2+${f(profile.fat)}*.25),q=x/width;
 float kernel=(exp(-q*q/2.0)-exp(-q*q/8.0)/4.0)/.75*exp(-max(0.0,uSectionDepth-1.1)/(3.0+${f(profile.fat)}));
 float mobility=sectionMobility(vec2(p.x,d));
 float xx=p.x+radial*x/max(R,r)*support*mobility;
 float yy=p.y+((1.0-skinWeight)*radial*y/max(R,r)+skinWeight*kernel*dr)*support*mobility;
 return vec3(xx,yy+sectionCurve(xx,p.z),p.z);
}
vec3 unusedOriginalWarp(vec3 p){`:'vec3 sectionWarp(vec3 p){'}
 float R=uSectionRadius,delta=min(uSectionExpansion,R*.32),dy=-p.y-uSectionDepth,r=length(vec2(p.x-(${f(profile.arteryX)}),dy));
 float f=r<R?(R+delta)/R:sqrt(1.0+((R+delta)*(R+delta)-R*R)/max(r*r,1e-10));
 vec2 q=vec2((p.x-(${f(profile.arteryX)}))*f,uSectionDepth+dy*f);float width=max(1.7,uSectionDepth*.9),A=delta*.65;
 for(int i=0;i<4;i++){vec2 a=tissueVelocity(q,A,width),b=tissueVelocity(q+a/8.0,A,width);q+=b/4.0;}
 q.x+=${f(profile.arteryX)};float mobility=sectionMobility(vec2(p.x,-p.y));q=mix(vec2(p.x,-p.y),q,mobility);
 q.y-=uSectionLift*exp(-q.x*q.x/230.0);
 return vec3(q.x,-q.y+sectionCurve(q.x,p.z),p.z);
}
`;
};
