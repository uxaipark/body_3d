import type {SkinRegion} from './skin-section';

export interface SectionProfile {width:number;thickness:number;epidermis:number;papillary:number;dermis:number;fat:number;total:number;arteryDepth:number;radius:number;wall:number;hair:boolean}
export interface TissueDrive {distension:number;respiratory:number;cardiac:number}
export function sectionProfile(region:SkinRegion,fat=region.fat):SectionProfile{
 const epidermis=region.id==='finger'?.28:region.id==='ear'?.09:.12;
 const dermis=region.id==='ear'?1.05:region.id==='finger'?1.65:region.id==='back'?2.1:1.6;
 const wall=.055+region.radius*.16,total=dermis+fat+1.1;
 return {width:24,thickness:5,epidermis,papillary:epidermis+.27,dermis,fat,total,wall,radius:region.radius,arteryDepth:Math.max(epidermis+.45+region.radius,Math.min(region.arteryDepth,total-region.radius-wall-.15)),hair:region.id!=='finger'&&region.id!=='ear'};
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
 * Cavity expansion preserves surrounding annular area exactly. A divergence-
 * free stream field redistributes tissue; respiratory stretch has unit area.
 * The lumen itself changes volume intentionally. */
export function deformSection(x:number,depth:number,z:number,p:SectionProfile,state:TissueDrive,gain=1):[number,number,number]{
 const delta=Math.min(state.distension*gain,p.radius*.32),dy=depth-p.arteryDepth,r=Math.hypot(x,dy),R=p.radius;
 const factor=r<R?(R+delta)/R:Math.sqrt(1+((R+delta)**2-R*R)/Math.max(r*r,1e-10));
 let u=x*factor,v=p.arteryDepth+dy*factor;
 const width=Math.max(1.7,p.arteryDepth*.9),A=delta*.65;
 const velocity=(a:number,b:number)=>{
  const q=a/width,h=(b-p.arteryDepth)/5,e=Math.exp(-q*q),f=Math.exp(-h*h*.3);
  return [A*a*e*f*(-.12*h),-A*(1-2*q*q)*e*f];
 };
 for(let i=0;i<4;i++){const a=velocity(u,v),b=velocity(u+a[0]/8,v+a[1]/8);u+=b[0]/4;v+=b[1]/4;}
 const lift=state.respiratory+state.cardiac,stretch=1+lift*.006;
 u*=stretch;v=v/stretch-lift*Math.exp(-u*u/230);
 return [u,-v,z];
}

// GPU mirror of deformSection, shared by all section materials.
export const sectionDeformationGLSL=`
uniform float uSectionDepth;uniform float uSectionRadius;uniform float uSectionExpansion;uniform float uSectionLift;
vec2 tissueVelocity(vec2 p,float A,float width){
 float q=p.x/width,h=(p.y-uSectionDepth)/5.0,e=exp(-q*q),f=exp(-h*h*.3);
 return vec2(A*p.x*e*f*(-.12*h),-A*(1.0-2.0*q*q)*e*f);
}
vec3 sectionWarp(vec3 p){
 float R=uSectionRadius,delta=min(uSectionExpansion,R*.32),dy=-p.y-uSectionDepth,r=length(vec2(p.x,dy));
 float f=r<R?(R+delta)/R:sqrt(1.0+((R+delta)*(R+delta)-R*R)/max(r*r,1e-10));
 vec2 q=vec2(p.x*f,uSectionDepth+dy*f);float width=max(1.7,uSectionDepth*.9),A=delta*.65;
 for(int i=0;i<4;i++){vec2 a=tissueVelocity(q,A,width),b=tissueVelocity(q+a/8.0,A,width);q+=b/4.0;}
 float stretch=1.0+uSectionLift*.006;q.x*=stretch;q.y=q.y/stretch-uSectionLift*exp(-q.x*q.x/230.0);
 return vec3(q.x,-q.y,p.z);
}
`;
