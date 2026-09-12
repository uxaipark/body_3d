import * as THREE from 'three';
import {mocapData} from './mocap-data.js';

// All bind landmarks are in the atlas's metre / Y-up frame. No scale is animated.
const specs: [string, string | null, [number, number, number]][] = [
 ['pelvis',null,[0,.92,-.015]],['spine','pelvis',[0,1.06,-.025]],
 ['chest','spine',[0,1.25,-.035]],['neck','chest',[0,1.44,-.035]],['head','neck',[0,1.52,-.02]],
];
for (const [side,s] of [['l',1],['r',-1]] as const) specs.push(
 [`thigh.${side}`,'pelvis',[s*.072,.867,-.006]],
 [`shin.${side}`,`thigh.${side}`,[s*.083,.438,-.027]],
 [`foot.${side}`,`shin.${side}`,[s*.078,.073,-.035]],
 [`toe.${side}`,`foot.${side}`,[s*.078,.025,.075]],
 [`patella.${side}`,`thigh.${side}`,[s*.083,.438,-.027]],
 [`upperArm.${side}`,'chest',[s*.167,1.375,-.019]],
 [`forearm.${side}`,`upperArm.${side}`,[s*.222,1.098,-.035]],
 [`hand.${side}`,`forearm.${side}`,[s*.283,.863,.012]],
);
export const BONE_NAMES=specs.map(s=>s[0]);
export const BONE_COUNT=specs.length;
const ids=Object.fromEntries(BONE_NAMES.map((n,i)=>[n,i]));
const clamp=THREE.MathUtils.clamp;
const smooth=(a:number,b:number,x:number)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
export interface Weights { indices:number[]; weights:number[] }
export function surfaceTissueWeight(w:Weights){return w.weights.reduce((sum,v,i)=>sum+(w.indices[i]<=2?v:0),0);}

/** Anatomical envelopes. The perineum is bound to ONE pelvis, never to a side. */
export function weightsAt(x:number,y:number,z:number,surface=false):Weights {
 const ax=Math.abs(x), side=x<0?'r':'l';
 // The original avatar's thumb extends medially beside the upper thigh.
 if(y>.65&&y<.84&&ax>.19)return {indices:[ids[`hand.${side}`],0,0,0],weights:[1,0,0,0]};
 const w=new Map<number,number>();
 const add=(name:string,v:number)=>{if(v>1e-7)w.set(ids[name],(w.get(ids[name])||0)+v);};
 // The central genital/perineal surface has zero leg influence on both sides.
 // Below the perineum the two disjoint legs can each have their own envelope.
 const groinGuard=1-smooth(.67,.79,y)*(1-smooth(.038,.085,ax));
 const leg=(1-smooth(.84,.98,y))*groinGuard*(1-smooth(.60,.68,y)*smooth(.17,.225,ax));
 const arm=smooth(.135,.195,ax)*smooth(.12,.19,ax+Math.max(0,1.37-y)*.07)*smooth(.60,.67,y)*(1-smooth(1.36,1.44,y));
 // A chest surface cannot be classified as an arm just because it is lateral.
 let armEnvelope=smooth(.14+Math.max(0,1.37-y)*.04,.18+Math.max(0,1.37-y)*.04,ax)*arm;
 // The restored exterior has a narrower waist and a clear arm/torso gap.
 // Follow that gap so the medial elbow is not partly pinned to the trunk.
 if(surface){const edge=.15+Math.max(0,1.12-y)*.30;const lower=smooth(edge-.01,edge+.01,ax)*smooth(.60,.67,y);armEnvelope=THREE.MathUtils.lerp(lower,armEnvelope,smooth(1.15,1.25,y));}
 const a=armEnvelope*(1-leg);
 if(leg>0){
   const knee=1-smooth(.405,.477,y),ankle=1-smooth(.06,.11,y);
   add(`thigh.${side}`,leg*(1-knee));add(`shin.${side}`,leg*knee*(1-ankle));add(`foot.${side}`,leg*knee*ankle);
 }
 if(a>0){const elbow=1-smooth(1.055,1.125,y),wrist=1-smooth(.843,.888,y);
   add(`upperArm.${side}`,a*(1-elbow));add(`forearm.${side}`,a*elbow*(1-wrist));add(`hand.${side}`,a*elbow*wrist);
 }
 const torso=1-leg-a;
 if(torso>0){
   if(y<1.13){const t=smooth(.98,1.13,y);add('pelvis',torso*(1-t));add('spine',torso*t);}
   else if(y<1.3){const t=smooth(1.13,1.3,y);add('spine',torso*(1-t));add('chest',torso*t);}
   else if(y<1.48){const t=smooth(1.37,1.48,y);add('chest',torso*(1-t));add('neck',torso*t);}
   else {const t=smooth(1.48,1.54,y);add('neck',torso*(1-t));add('head',torso*t);}
 }
 const entries=[...w].sort((a,b)=>b[1]-a[1]).slice(0,4),sum=entries.reduce((s,e)=>s+e[1],0);
 return {indices:entries.map(e=>e[0]).concat([0,0,0,0]).slice(0,4),weights:entries.map(e=>e[1]/sum).concat([0,0,0,0]).slice(0,4)};
}

/** Whole midline organs must never inherit separate left/right limb transforms. */
export function pelvicOrgan(name:string):boolean {
 return /penis|penile|glans|scrot|testis|epididym|corpus cavernos|corpus spongios/i.test(name);
}

/** Assign an entire named bone to a single rigid transform BEFORE geometry batching. */
export function rigidBone(name:string,center:THREE.Vector3):number {
 const side=center.x<0?'r':'l',n=name.toLowerCase();let bone:string;
 if(/hip bone|sacrum|coccyx/.test(n))bone='pelvis';
 else if(/femur/.test(n))bone=`thigh.${side}`;
 else if(/patella/.test(n))bone=`patella.${side}`;
 else if(/tibia|fibula/.test(n))bone=`shin.${side}`;
 else if(/humerus/.test(n))bone=`upperArm.${side}`;
 else if(/radius|ulna/.test(n))bone=`forearm.${side}`;
 else if(/clavicle|scapula|rib|sternum|xiphoid/.test(n))bone='chest';
 else if(/vertebra l/.test(n))bone='spine';
 else if(/vertebra t/.test(n))bone='chest';
 else if(/vertebra c|atlas|axis|thyroid|cricoid/.test(n))bone='neck';
 else if(center.y<.19)bone=`foot.${side}`;
 else if(Math.abs(center.x)>.22&&center.y<.94)bone=`hand.${side}`;
 else if(center.y>1.47)bone='head';
 else bone=BONE_NAMES[weightsAt(center.x,center.y,center.z).indices[0]];
 return ids[bone];
}

export function bindGeometry(geometry:THREE.BufferGeometry,rigidIndex?:number,surface=false) {
 const p=geometry.getAttribute('position'),indices=new Uint16Array(p.count*4),weights=new Float32Array(p.count*4);
 const skinArms=surface?geometry.getAttribute('skinArmSide'):undefined;
 for(let i=0;i<p.count;i++){
   if(rigidIndex!==undefined){indices[i*4]=rigidIndex;weights[i*4]=1;}
   else if(skinArms?.getX(i)){
     // Membership comes from the connected original arm, not a shifted/widened
     // wrist's X coordinate. Distal arm skin can never inherit trunk/leg bones.
     const side=skinArms.getX(i)<0?'r':'l',y=p.getY(i),elbow=1-smooth(1.055,1.125,y),wrist=1-smooth(.843,.888,y);
     indices.set([ids[`upperArm.${side}`],ids[`forearm.${side}`],ids[`hand.${side}`],0],i*4);
     weights.set([1-elbow,elbow*(1-wrist),elbow*wrist,0],i*4);
   }
   else {const w=weightsAt(p.getX(i),p.getY(i),p.getZ(i),surface);indices.set(w.indices,i*4);weights.set(w.weights,i*4);}
 }
 geometry.setAttribute('rigIndex',new THREE.BufferAttribute(indices,4));geometry.setAttribute('rigWeight',new THREE.BufferAttribute(weights,4));
 // Bounds enclose gait swings; the GPU moves vertices outside the rest box.
 geometry.computeBoundingSphere();if(geometry.boundingSphere)geometry.boundingSphere.radius+=.6;
}

/** Offline topology-based relaxation of shoulder/neck weights. Distal limbs
 * and pelvis stay anchored; nearby surfaces never connect merely by proximity. */
export function relaxSurfaceBinding(geometry:THREE.BufferGeometry){
 const p=geometry.getAttribute('position'),ix=geometry.index,indices=geometry.getAttribute('rigIndex'),weights=geometry.getAttribute('rigWeight');
 const groups=new Map<string,number>(),mapping:number[]=[],members:number[][]=[],neighbors:Set<number>[]=[],values:number[][]=[];
 for(let i=0;i<p.count;i++){
  const key=`${geometry.getAttribute('skinArmSide')?.getX(i)||0}:`+[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e6)).join(',');let id=groups.get(key);
  if(id===undefined){id=members.length;groups.set(key,id);members.push([]);neighbors.push(new Set());values.push(Array(BONE_COUNT).fill(0));}
  mapping.push(id);members[id].push(i);
  for(let j=0;j<4;j++)values[id][indices.getComponent(i,j)]+=weights.getComponent(i,j);
 }
 values.forEach((v,i)=>v.forEach((_,j)=>v[j]/=members[i].length));
 const count=ix?.count||p.count;
 for(let i=0;i+2<count;i+=3){const a=mapping[ix?ix.getX(i):i],b=mapping[ix?ix.getX(i+1):i+1],c=mapping[ix?ix.getX(i+2):i+2];for(const[u,v]of[[a,b],[b,c],[c,a]])if(u!==v){neighbors[u].add(v);neighbors[v].add(u);}}
 let field=values;
 for(let step=0;step<10;step++){
  const next=field.map(v=>v.slice());
  for(let i=0;i<members.length;i++){
   const y=p.getY(members[i][0]);if(y<1.16||y>1.54||!neighbors[i].size)continue;
   for(let j=0;j<BONE_COUNT;j++){let mean=0;for(const neighbor of neighbors[i])mean+=field[neighbor][j];next[i][j]=field[i][j]*.55+mean/neighbors[i].size*.45;}
  }
  field=next;
 }
 for(let i=0;i<members.length;i++){
  const active=field[i].map((w,id)=>({w,id})).sort((a,b)=>b.w-a.w).slice(0,4),sum=active.reduce((a,v)=>a+v.w,0);
  for(const vertex of members[i])for(let j=0;j<4;j++){indices.setComponent(vertex,j,active[j].id);weights.setComponent(vertex,j,active[j].w/sum);}
 }
}

/** Extreme points of the actual exterior soles, shared by all body layers. */
export function surfaceFootSupport(geometry:THREE.BufferGeometry){
 const p=geometry.getAttribute('position'),indices=geometry.getAttribute('rigIndex'),weights=geometry.getAttribute('rigWeight'),chosen=new Set<number>();
 for(const side of[-1,1])for(let tilt=0;tilt<=5;tilt++)for(let az=0;az<16;az++){
  const angle=tilt*Math.PI/10,phi=az*Math.PI/8,d=new THREE.Vector3(Math.sin(angle)*Math.cos(phi),-Math.cos(angle),Math.sin(angle)*Math.sin(phi));let best=-1,projection=-Infinity;
  for(let i=0;i<p.count;i++)if(p.getY(i)<.13&&p.getX(i)*side>0){const value=p.getX(i)*d.x+p.getY(i)*d.y+p.getZ(i)*d.z;if(value>projection){projection=value;best=i;}}
  if(best>=0)chosen.add(best);
 }
 return [...chosen].map(i=>({point:new THREE.Vector3().fromBufferAttribute(p,i),w:{indices:[indices.getX(i),indices.getY(i),indices.getZ(i),indices.getW(i)],weights:[weights.getX(i),weights.getY(i),weights.getZ(i),weights.getW(i)]}}));
}
export class HumanRig {
 bones:THREE.Bone[]=[];skeleton:THREE.Skeleton;bind=specs.map(s=>new THREE.Vector3(...s[2]));
 real=specs.map(()=>new THREE.Vector4(0,0,0,1));dual=specs.map(()=>new THREE.Vector4());
 uniforms={uRigReal:{value:this.real},uRigDual:{value:this.dual}};
 amount=0;runMix=0;phase=0;forearmRoll=Math.PI/2;
 floorSamples:{point:THREE.Vector3;w:Weights}[]=[];
 constructor(){
   for(let i=0;i<specs.length;i++){
     const [name,parent]=specs[i],bone=new THREE.Bone();bone.name=name;
     bone.position.copy(this.bind[i]);if(parent){bone.position.sub(this.bind[ids[parent]]);this.bones[ids[parent]].add(bone);}this.bones.push(bone);
   }
   this.bones[0].updateMatrixWorld(true);this.skeleton=new THREE.Skeleton(this.bones);this.skeleton.calculateInverses();this.updatePalette();
 }
 bone(name:string){return this.bones[ids[name]];}
 /** Blend captured cycles at their measured durations; bone lengths never change. */
 update(dt:number,motion:'rest'|'walk'|'run'){
   const k=1-Math.exp(-dt*7);this.amount=THREE.MathUtils.lerp(this.amount,motion==='rest'?0:1,k);
   this.runMix=THREE.MathUtils.lerp(this.runMix,motion==='run'?1:0,k);
   this.phase=(this.phase+dt*THREE.MathUtils.lerp(1/mocapData.walk.duration,1/mocapData.run.duration,this.runMix))%1;
   this.pose(this.phase,this.amount,this.runMix);
 }
 /** Retargeted captured poses, sampled at the recorded cadence. All tissues use
  * this same phase; only the exterior's neutral palm convention differs. */
 pose(phase:number,amount=1,run=0){
   const p=this.bone('pelvis'),identity=new THREE.Quaternion();
   if(amount<1e-7){
     for(const b of this.bones)b.quaternion.identity();
     p.position.copy(this.bind[0]);p.updateMatrixWorld(true);this.updatePalette();return;
   }
   const clip=(mode:'walk'|'run')=>{
     const frames=mocapData[mode].frames,x=((phase%1)+1)%1*frames.length,i=Math.floor(x);
     return {a:frames[i],b:frames[(i+1)%frames.length],t:x-i};
   };
   const walk=clip('walk'),running=clip('run');
   const position=(k:number)=>THREE.MathUtils.lerp(THREE.MathUtils.lerp(walk.a[k],walk.b[k],walk.t),THREE.MathUtils.lerp(running.a[k],running.b[k],running.t),run);
   p.position.set(amount*position(0),THREE.MathUtils.lerp(this.bind[0].y,position(1),amount),this.bind[0].z+amount*position(2));
   const qa=new THREE.Quaternion(),qb=new THREE.Quaternion(),qc=new THREE.Quaternion();
   for(let i=0;i<this.bones.length;i++){
     const offset=3+i*4;
     qa.fromArray(walk.a,offset).slerp(qb.fromArray(walk.b,offset),walk.t);
     qc.fromArray(running.a,offset).slerp(qb.fromArray(running.b,offset),running.t);
     qa.slerp(qc,run);this.bones[i].quaternion.copy(identity).slerp(qa,amount);
   }
   for(const [side,sign]of [['l',1],['r',-1]]as const){
     const forearm=this.bone(`forearm.${side}`),axis=this.bone(`hand.${side}`).position.clone().normalize();
     forearm.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axis,sign*amount*this.forearmRoll));
   }
   p.updateMatrixWorld(true);
   // Stabilize the gaze in world space: cancelling only a local neck roll
   // would still inherit the captured chest lean. Walking keeps level gaze;
   // running retains captured pitch. Both retain yaw and vertical body motion.
   const level=new THREE.Euler(0,0,0,'YXZ');
   const neck=this.bone('neck'),head=this.bone('head');
   neck.getWorldQuaternion(qa);head.getWorldQuaternion(qc);
   for(const [bone,world]of [[neck,qa],[head,qc]]as const){
     level.setFromQuaternion(world,'YXZ');level.z=0;level.x*=run;world.setFromEuler(level);
     bone.quaternion.copy(bone.parent!.getWorldQuaternion(qb).invert()).multiply(world);
     bone.updateMatrixWorld(true);
   }
   // Blending different captured poses can put a sole slightly below the floor.
   // Correct the common root, preserving bone lengths and captured flight.
   let floor=Infinity;
   for(const side of ['l','r']){
     const foot=this.bone(`foot.${side}`),q=foot.getWorldQuaternion(qb),ankle=foot.getWorldPosition(new THREE.Vector3());
     for(const sole of [new THREE.Vector3(0,-.073,-.055),new THREE.Vector3(0,-.073,.145)])floor=Math.min(floor,sole.applyQuaternion(q).add(ankle).y);
   }
   // The imported exterior can have a longer forefoot than the old proxy sole.
   if(this.floorSamples.length){this.updatePalette();floor=Math.min(...this.floorSamples.map(s=>this.transform(s.point,s.w).y))-.001;}
   // Walking always has a supporting foot; retain captured flight only for running.
   p.position.y-=floor<0?floor:floor*(1-run);p.updateMatrixWorld(true);this.updatePalette();
 }
 updatePalette(){
   this.skeleton.update();const matrix=new THREE.Matrix4(),q=new THREE.Quaternion(),t=new THREE.Vector3(),scale=new THREE.Vector3();
   for(let i=0;i<this.bones.length;i++){
     matrix.fromArray(this.skeleton.boneMatrices!,i*16);matrix.decompose(t,q,scale);
     this.real[i].set(q.x,q.y,q.z,q.w);
     this.dual[i].set(.5*(t.x*q.w+t.y*q.z-t.z*q.y),.5*(-t.x*q.z+t.y*q.w+t.z*q.x),.5*(t.x*q.y-t.y*q.x+t.z*q.w),-.5*(t.x*q.x+t.y*q.y+t.z*q.z));
   }
 }
 /** CPU mirror for sensor attachment and offline regression/asset QA. */
 transform(point:THREE.Vector3,w=weightsAt(point.x,point.y,point.z)){
   const r=new THREE.Vector4(0,0,0,0),d=new THREE.Vector4(0,0,0,0),ref=this.real[w.indices[0]];
   for(let j=0;j<4;j++){const i=w.indices[j],weight=w.weights[j]*(ref.dot(this.real[i])<0?-1:1);r.addScaledVector(this.real[i],weight);d.addScaledVector(this.dual[i],weight);}
   const norm=r.length();r.multiplyScalar(1/norm);d.multiplyScalar(1/norm);d.addScaledVector(r,-r.dot(d));
   const q=new THREE.Quaternion(r.x,r.y,r.z,r.w),translation=new THREE.Quaternion(d.x,d.y,d.z,d.w).multiply(q.clone().conjugate());
   return point.clone().applyQuaternion(q).add(new THREE.Vector3(translation.x,translation.y,translation.z).multiplyScalar(2));
 }
 dispose(){this.skeleton.dispose();}
}

// Normalized dual-quaternion blending avoids linear skinning's collapsing joints.
// It preserves rigid transforms locally, not the global volume of a tissue FEM.
export const rigShader=`
attribute vec4 rigIndex;
attribute vec4 rigWeight;
uniform vec4 uRigReal[${BONE_COUNT}];
uniform vec4 uRigDual[${BONE_COUNT}];
float rigTorsoInfluence(){float w=0.0;for(int i=0;i<4;i++){if(rigIndex[i]<=2.0)w+=rigWeight[i];}return w;}
vec3 rigRotate(vec4 q,vec3 p){return p+2.0*cross(q.xyz,cross(q.xyz,p)+q.w*p);}
void rigBlend(out vec4 r,out vec4 d){
 vec4 reference=uRigReal[int(rigIndex.x)];r=vec4(0.0);d=vec4(0.0);
 for(int j=0;j<4;j++){
  int i=int(rigIndex[j]);float w=rigWeight[j]*(dot(reference,uRigReal[i])<0.0?-1.0:1.0);
  r+=w*uRigReal[i];d+=w*uRigDual[i];
 }
 float n=max(length(r),0.00001);r/=n;d/=n;d-=r*dot(r,d);
}
vec3 rigPosition(vec4 r,vec4 d,vec3 p){return rigRotate(r,p)+2.0*(r.w*d.xyz-d.w*r.xyz+cross(r.xyz,d.xyz));}
`;
