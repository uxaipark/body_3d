import * as THREE from 'three';
const NX=4,NY=7,NZ=4;
export const SOFT_NODE_COUNT=NX*NY*NZ;
const MIN=new THREE.Vector3(-.24,.76,-.15),STEP=new THREE.Vector3(.16,.74/6,.11);
const smooth=(a:number,b:number,x:number)=>{const t=THREE.MathUtils.clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const index=(x:number,y:number,z:number)=>x+NX*(y+NY*z);
interface Edge{a:number;b:number;length:number;lambda:number}
interface Tet{ids:number[];volume:number;lambda:number}
/** Small, compliant tetrahedral tissue lattice. Metres, fixed 120 Hz substeps.
 * Breathing is prescribed actuation; these are illustrative material parameters.
 * Every soft anatomy layer samples the SAME field, preserving their registration.
 */
export class SoftBody {
 rest:THREE.Vector3[]=[];positions:THREE.Vector3[]=[];previous:THREE.Vector3[]=[];velocity:THREE.Vector3[]=[];goal:THREE.Vector3[]=[];
 inverseMass:number[]=[];displacement:THREE.Vector3[]=[];edges:Edge[]=[];tets:Tet[]=[];accumulator=0;
 uniforms={uTissue:{value:this.displacement}};
 private scratch=Array.from({length:8},()=>new THREE.Vector3());
 constructor(){
  for(let z=0;z<NZ;z++)for(let y=0;y<NY;y++)for(let x=0;x<NX;x++){
   const p=new THREE.Vector3(MIN.x+x*STEP.x,MIN.y+y*STEP.y,MIN.z+z*STEP.z);
   this.inverseMass.push(x===0||x===NX-1||y===0||y===NY-1||z===0?0:1);this.rest.push(p);this.positions.push(p.clone());this.previous.push(p.clone());this.goal.push(p.clone());this.velocity.push(new THREE.Vector3());this.displacement.push(new THREE.Vector3());
  }
  const seen=new Set<string>();
  for(let z=0;z<NZ-1;z++)for(let y=0;y<NY-1;y++)for(let x=0;x<NX-1;x++){
   const c=[index(x,y,z),index(x+1,y,z),index(x,y+1,z),index(x+1,y+1,z),index(x,y,z+1),index(x+1,y,z+1),index(x,y+1,z+1),index(x+1,y+1,z+1)];
   for(const local of [[0,1,3,7],[0,3,2,7],[0,2,6,7],[0,6,4,7],[0,4,5,7],[0,5,1,7]]){
    const ids=local.map(i=>c[i]);this.tets.push({ids,volume:this.volume(ids,this.rest),lambda:0});
    for(let i=0;i<4;i++)for(let j=i+1;j<4;j++){const a=Math.min(ids[i],ids[j]),b=Math.max(ids[i],ids[j]),key=`${a}:${b}`;if(!seen.has(key)){seen.add(key);this.edges.push({a,b,length:this.rest[a].distanceTo(this.rest[b]),lambda:0});}}
   }
  }
 }
 private volume(ids:number[],p:THREE.Vector3[]){
  const [a,b,c,d]=ids,[u,v,w]=this.scratch;u.copy(p[b]).sub(p[a]);v.copy(p[c]).sub(p[a]);w.copy(p[d]).sub(p[a]);return u.dot(v.cross(w))/6;
 }
 update(dt:number,inspiration:number,tidal:number){
  if(dt<=0)return;const breath=THREE.MathUtils.clamp(inspiration,0,1)*THREE.MathUtils.clamp(tidal/500,.4,2);
  for(let i=0;i<this.rest.length;i++){
   const p=this.rest[i],g=this.goal[i];g.copy(p);
   const side=1-smooth(.12,.24,Math.abs(p.x));
   const chest=smooth(1.05,1.2,p.y)*(1-smooth(1.38,1.5,p.y));
   const abdomen=smooth(.80,.98,p.y)*(1-smooth(1.10,1.22,p.y));
   const front=smooth(-.14,.12,p.z);
   g.x+=p.x*breath*.035*chest*side;
   g.z+=breath*side*front*(chest*.010+abdomen*.009);
   g.y-=breath*side*front*abdomen*.0015;
  }
  this.accumulator+=Math.min(dt,.05);const h=1/120;
  while(this.accumulator>=h){this.step(h);this.accumulator-=h;}
  for(let i=0;i<this.rest.length;i++)this.displacement[i].copy(this.positions[i]).sub(this.rest[i]);
 }
 private step(h:number){
  const invH2=1/(h*h),edgeAlpha=2e-5*invH2,volumeAlpha=2e-5*invH2,tetherAlpha=8e-5*invH2;
  for(let i=0;i<this.positions.length;i++){
   if(!this.inverseMass[i]){this.positions[i].copy(this.goal[i]);this.velocity[i].set(0,0,0);}
   this.previous[i].copy(this.positions[i]);this.velocity[i].multiplyScalar(Math.exp(-12*h));this.positions[i].addScaledVector(this.velocity[i],h);
  }
  for(const e of this.edges){e.lambda=0;e.length=this.goal[e.a].distanceTo(this.goal[e.b]);}
  for(const t of this.tets){t.lambda=0;t.volume=this.volume(t.ids,this.goal);}
  const tetherLambda=new Float64Array(this.positions.length*3);
  const [g0,g1,g2,g3,u,v,w]=this.scratch;
  for(let iteration=0;iteration<5;iteration++){
   for(let i=0;i<this.positions.length;i++)for(let axis=0;axis<3;axis++){
    if(!this.inverseMass[i])continue;
    const c=this.positions[i].getComponent(axis)-this.goal[i].getComponent(axis),j=i*3+axis;
    const dl=(-c-tetherAlpha*tetherLambda[j])/(1+tetherAlpha);tetherLambda[j]+=dl;this.positions[i].setComponent(axis,this.positions[i].getComponent(axis)+dl);
   }
   for(const e of this.edges){u.copy(this.positions[e.a]).sub(this.positions[e.b]);const length=u.length();if(length<1e-9)continue;
    const wa=this.inverseMass[e.a],wb=this.inverseMass[e.b];
    const dl=(-(length-e.length)-edgeAlpha*e.lambda)/(wa+wb+edgeAlpha);e.lambda+=dl;u.multiplyScalar(dl/length);this.positions[e.a].addScaledVector(u,wa);this.positions[e.b].addScaledVector(u,-wb);
   }
   for(const t of this.tets){
    const [ia,ib,ic,id]=t.ids,a=this.positions[ia],b=this.positions[ib],c=this.positions[ic],d=this.positions[id];
    u.copy(b).sub(a);v.copy(c).sub(a);w.copy(d).sub(a);
    g1.copy(v).cross(w).multiplyScalar(1/6);g2.copy(w).cross(u).multiplyScalar(1/6);g3.copy(u).cross(v).multiplyScalar(1/6);g0.copy(g1).add(g2).add(g3).negate();
    const volume=u.dot(g1),scale=1/Math.abs(t.volume);
    const constraint=(volume-t.volume)*scale;
    for(const g of [g0,g1,g2,g3])g.multiplyScalar(scale);
    const weights=t.ids.map(i=>this.inverseMass[i]);
    const norm=g0.lengthSq()*weights[0]+g1.lengthSq()*weights[1]+g2.lengthSq()*weights[2]+g3.lengthSq()*weights[3];
    const dl=(-constraint-volumeAlpha*t.lambda)/(norm+volumeAlpha);t.lambda+=dl;
    a.addScaledVector(g0,dl*weights[0]);b.addScaledVector(g1,dl*weights[1]);c.addScaledVector(g2,dl*weights[2]);d.addScaledVector(g3,dl*weights[3]);
   }
  }
  for(let i=0;i<this.positions.length;i++){
   // Conservative admissible region prevents a bad frame from inverting tissue cells.
   u.copy(this.positions[i]).sub(this.rest[i]);if(u.length()>.035)this.positions[i].copy(this.rest[i]).add(u.setLength(.035));
   this.velocity[i].copy(this.positions[i]).sub(this.previous[i]).multiplyScalar(1/h);
  }
 }
 sample(p:THREE.Vector3){
  if(p.x<MIN.x||p.x>MIN.x+STEP.x*3||p.y<MIN.y||p.y>MIN.y+STEP.y*6||p.z<MIN.z)return new THREE.Vector3();
  const q=p.clone().sub(MIN).divide(STEP),ix=Math.min(2,Math.max(0,Math.floor(q.x))),iy=Math.min(5,Math.max(0,Math.floor(q.y))),iz=Math.min(2,Math.max(0,Math.floor(q.z)));
  const f=new THREE.Vector3(THREE.MathUtils.clamp(q.x-ix,0,1),THREE.MathUtils.clamp(q.y-iy,0,1),THREE.MathUtils.clamp(q.z-iz,0,1)),out=new THREE.Vector3();
  for(let z=0;z<2;z++)for(let y=0;y<2;y++)for(let x=0;x<2;x++)out.addScaledVector(this.displacement[index(ix+x,iy+y,iz+z)],(x?f.x:1-f.x)*(y?f.y:1-f.y)*(z?f.z:1-f.z));
  return out;
 }
 minimumVolumeRatio(){return Math.min(...this.tets.map(t=>this.volume(t.ids,this.positions)/this.volume(t.ids,this.rest)));}
}
export const tissueShader=`
uniform vec3 uTissue[${SOFT_NODE_COUNT}];
void tissueField(vec3 p,out vec3 offset,out mat3 jacobian){
 offset=vec3(0.0);jacobian=mat3(1.0);
 if(p.x<-.24||p.x>.24||p.y<.76||p.y>1.50||p.z<-.15)return;
 vec3 spacing=vec3(.16,.123333333333,.11);
 vec3 q=(p-vec3(-.24,.76,-.15))/spacing;
 ivec3 cell=ivec3(clamp(floor(q),vec3(0.0),vec3(2.0,5.0,2.0)));
 vec3 f=clamp(q-vec3(cell),0.0,1.0);
 for(int z=0;z<2;z++)for(int y=0;y<2;y++)for(int x=0;x<2;x++){
  vec3 s=vec3(float(x),float(y),float(z));vec3 w=mix(1.0-f,f,s);
  int i=(cell.x+x)+4*((cell.y+y)+7*(cell.z+z));vec3 d=uTissue[i];
  offset+=d*w.x*w.y*w.z;
  vec3 gradient=(2.0*s-1.0)*vec3(w.y*w.z,w.x*w.z,w.x*w.y)/spacing;
  if(p.z>.18)gradient.z=0.0;
  jacobian[0]+=d*gradient.x;jacobian[1]+=d*gradient.y;jacobian[2]+=d*gradient.z;
 }
}
`;
