import * as THREE from 'three';
import {mocapData} from './mocap-data.js';
import {expressionMocapData} from './expression-mocap-data.js';
import {bed,aboveBed,bedSurface,bedPlacement,bedToWorld,worldToBed} from './bed.js';
import {bedSupport} from './bed-support.js';
import {chair,aboveSeat} from './chair.js';
import {seatSupport} from './seat-support.js';
import {handLandmarks} from './hand-landmarks.js';
import {taskState,isClinicalMotion,ease} from './clinical-motion.js';
import type {Motion} from './physiology';

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
// Append digits so existing atlas weights and captured 21-bone clips stay valid.
const CAPTURE_BONE_COUNT=specs.length;
for(const [side,mirror]of [['r',1],['l',-1]]as const)for(let digit=0;digit<5;digit++)for(let joint=0;joint<3;joint++){
 const point=handLandmarks[digit][joint];specs.push([`finger${digit}.${joint}.${side}`,joint?`finger${digit}.${joint-1}.${side}`:`hand.${side}`,[point[0]*mirror,point[1],point[2]]]);
}
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
 if(y>.65&&y<.84&&ax>.19)return fingerWeightsAt(x,y,z)||{indices:[ids[`hand.${side}`],0,0,0],weights:[1,0,0,0]};
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
 if(surface){const edge=.15+Math.max(0,1.12-y)*.30;const lower=smooth(edge-.01,edge+.01,ax)*smooth(.60,.67,y);armEnvelope=THREE.MathUtils.lerp(lower,armEnvelope,smooth(1.15,1.25,y));
  // The axillary fold belongs to the torso envelope. A raised arm opens the
  // fold at its crease, but must not pull the lateral chest wall outward.
  const axilla=smooth(.13,.23,ax)*smooth(1.00,1.30,y)*(1-smooth(1.27,1.36,y));
  armEnvelope*=1-.92*axilla;
  if(ax>.13&&ax<.23&&y>1.00&&y<1.30)armEnvelope=0;
 }
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

/** Closest digit chain in the atlas rest frame; only the distal hand is eligible.
 * Blend along each joint and across the shared webbing with a smooth distance field. */
export function fingerWeightsAt(x:number,y:number,z:number):Weights|null{
 if(y<.65||y>.86||Math.abs(x)<.19||Math.abs(x)>.38)return null;
 const side=x<0?'r':'l',point=new THREE.Vector3(-Math.abs(x),y,z),hand=ids[`hand.${side}`];
 const candidates:{distance:number;segment:number;t:number;digit:number}[]=[];
 for(let digit=0;digit<5;digit++){
  let distance=Infinity,segment=0,t=0;
  for(let j=0;j<3;j++){
   const a=new THREE.Vector3(...handLandmarks[digit][j]),axis=new THREE.Vector3(...handLandmarks[digit][j+1]).sub(a),u=point.clone().sub(a).dot(axis)/axis.lengthSq();
   const d=a.addScaledVector(axis,clamp(u,0,1)).distanceToSquared(point);
   if(d<distance){distance=d;segment=j;t=u;}
  }
  candidates.push({distance,segment,t,digit});
 }
 const minimum=Math.min(...candidates.map(c=>c.distance));if(minimum>.04**2)return null;
 const merged=new Map<number,number>(),add=(id:number,w:number)=>merged.set(id,(merged.get(id)||0)+w);
 // A soft distance field keeps thumb webbing continuous instead of switching
 // suddenly between an unbound palm and a fully rotating neighbouring digit.
 for(const c of candidates){
  const strength=Math.exp(-(c.distance-minimum)/.000196),fade=1-smooth(.024,.04,Math.sqrt(c.distance)),{digit,segment,t}=c;
  const current=ids[`finger${digit}.${segment}.${side}`],parent=segment?ids[`finger${digit}.${segment-1}.${side}`]:hand;
  add(hand,strength*(1-fade));
  if(t<.22){const w=smooth(-.18,.22,t);add(current,strength*fade*w);add(parent,strength*fade*(1-w));}
  else if(segment<2&&t>.78){const w=smooth(.78,1.18,t);add(current,strength*fade*(1-w));add(ids[`finger${digit}.${segment+1}.${side}`],strength*fade*w);}
  else add(current,strength*fade);
 }
 const active=[...merged].sort((a,b)=>b[1]-a[1]).slice(0,4),sum=active.reduce((a,v)=>a+v[1],0);
 return {indices:Array.from({length:4},(_,i)=>active[i]?.[0]||0),weights:Array.from({length:4},(_,i)=>(active[i]?.[1]||0)/sum)};
}
/** Preserve the fitted exterior everywhere except vertices already on the hand. */
export function bindFingerGeometry(geometry:THREE.BufferGeometry){
 const p=geometry.getAttribute('position'),indices=geometry.getAttribute('rigIndex'),weights=geometry.getAttribute('rigWeight');
 for(let i=0;i<p.count;i++){
  const side=p.getX(i)<0?'r':'l';let handWeight=0;for(let j=0;j<4;j++)if(indices.getComponent(i,j)===ids[`hand.${side}`])handWeight+=weights.getComponent(i,j);
  if(handWeight<.001)continue;const w=fingerWeightsAt(p.getX(i),p.getY(i),p.getZ(i));if(!w)continue;
  const mixed=new Map<number,number>();
  for(let j=0;j<4;j++){const index=indices.getComponent(i,j);if(index!==ids[`hand.${side}`])mixed.set(index,(mixed.get(index)||0)+weights.getComponent(i,j));mixed.set(w.indices[j],(mixed.get(w.indices[j])||0)+w.weights[j]*handWeight);}
  const active=[...mixed].filter(([,v])=>v>1e-7).sort((a,b)=>b[1]-a[1]).slice(0,4),sum=active.reduce((a,v)=>a+v[1],0);
  for(let j=0;j<4;j++){indices.setComponent(i,j,active[j]?.[0]||0);weights.setComponent(i,j,(active[j]?.[1]||0)/sum);}
 }
}

/** Whole midline organs must never inherit separate left/right limb transforms. */
export function pelvicOrgan(name:string):boolean {
 return /penis|penile|glans|scrot|testis|epididym|corpus cavernos|corpus spongios/i.test(name);
}

/** Assign an entire named bone to a single rigid transform BEFORE geometry batching. */
export function rigidBone(name:string,center:THREE.Vector3):number {
 const side=center.x<0?'r':'l',n=name.toLowerCase();let bone:string;
 const digit=['first','second','third','fourth','fifth'].findIndex(v=>n.includes(v));
 if(digit>=0&&/phalanx.*hand/.test(n)){const joint=digit===0?(n.includes('proximal')?1:2):n.includes('proximal')?0:n.includes('middle')?1:2;return ids[`finger${digit}.${joint}.${side}`];}
 if(/first metacarpal/.test(n))return ids[`finger0.0.${side}`];
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
   else if(skinArms?.getX(i)&&!(surface&&Math.abs(p.getX(i))>.13&&Math.abs(p.getX(i))<.23&&p.getY(i)>1.00&&p.getY(i)<1.30)){
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
 motion:Motion='rest';taskTime=0;revision=0;transition=1;transitionFloorwork=false;bedLoad=0;transitionBedLoad=0;bedExtension=0;bedFootPlant=1;bedHingeAxis=new THREE.Vector3(1,0,0);bedAnchor=new THREE.Vector3();
 transitionQuaternions:THREE.Quaternion[]=[];transitionFeet:THREE.Vector3[]=[];transitionRoot=new THREE.Vector3();
 seatSamples:{point:THREE.Vector3;w:Weights}[]=seatSupport.map(s=>({point:new THREE.Vector3(...s.point),w:s.w}));
 bedSamples:{point:THREE.Vector3;w:Weights}[]=bedSupport.map(s=>({point:new THREE.Vector3(...s.point),w:s.w}));
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
 update(dt:number,motion:Motion,revision=0){
   const changed=motion!==this.motion||revision!==this.revision;
   if(changed){
    if(motion==='lie'&&this.motion!=='lie')this.bedAnchor.set(this.bones[0].position.x,0,this.bones[0].position.z-this.bind[0].z);
    this.transitionBedLoad=this.bedLoad;this.transitionQuaternions=this.bones.map(b=>b.quaternion.clone());this.transitionRoot.copy(this.bones[0].position);this.transitionFeet=['l','r'].map(side=>this.bone(`foot.${side}`).getWorldPosition(new THREE.Vector3()));
    this.transitionFloorwork=motion==='dance'||this.motion==='dance';
    this.transition=isClinicalMotion(motion)||isClinicalMotion(this.motion)||['wave','dance'].includes(motion)||['wave','dance'].includes(this.motion)?0:1;
    this.motion=motion;this.revision=revision;this.taskTime=0;
   }
   if(dt<=0)return;
   this.taskTime+=dt;if(motion!=='lie')this.bedLoad=0;
   if(motion==='wave'||motion==='dance')this.poseExpression(motion,this.taskTime);
   else if(isClinicalMotion(motion))this.poseTask(motion,this.taskTime);
   else{
    const k=1-Math.exp(-dt*7);this.amount=THREE.MathUtils.lerp(this.amount,motion==='rest'?0:1,k);
    this.runMix=THREE.MathUtils.lerp(this.runMix,motion==='run'?1:0,k);
    this.phase=(this.phase+dt*THREE.MathUtils.lerp(1/mocapData.walk.duration,1/mocapData.run.duration,this.runMix))%1;
    this.pose(this.phase,this.amount,this.runMix);
   }
   if(this.transition<1){
    this.transition=Math.min(1,this.transition+dt/(motion==='lie'?1.4:this.transitionFloorwork?2.4:.65));const blend=ease(0,1,this.transition);
    this.bedLoad=THREE.MathUtils.lerp(this.transitionBedLoad,this.bedLoad,blend);
    const feet=['l','r'].map(side=>this.bone(`foot.${side}`).getWorldPosition(new THREE.Vector3()));
    this.bones[0].position.lerpVectors(this.transitionRoot,this.bones[0].position.clone(),blend);
    this.bones.forEach((b,i)=>b.quaternion.slerpQuaternions(this.transitionQuaternions[i],b.quaternion.clone(),blend));
    this.bones[0].updateMatrixWorld(true);
    if(motion==='stand'||motion==='sitStand')for(let i=0;i<2;i++){const side=i===0?'l':'r',rotation=this.bone(`foot.${side}`).getWorldQuaternion(new THREE.Quaternion());this.solveLeg(side,this.transitionFeet[i].clone().lerp(feet[i],blend));this.setWorldRotation(`foot.${side}`,rotation);}
    this.bones[0].updateMatrixWorld(true);this.updatePalette();this.groundTask(false);if(this.transitionFloorwork)this.groundFloorwork();if(motion==='lie')this.constrainBed(this.bedLoad);if(motion==='stand'||motion==='sitStand')this.constrainSeat();
   }
 }
 /** One final palette is shared by skeleton, native skin, vessels and markers. */
 copyPose(source:HumanRig){
  if(source===this)return;
  this.bedLoad=source.bedLoad;
  this.bones.forEach((b,i)=>{b.position.copy(source.bones[i].position);b.quaternion.copy(source.bones[i].quaternion)});
  this.bones[0].updateMatrixWorld(true);this.updatePalette();
 }
 reset(){this.bedAnchor.set(0,0,0);this.bedLoad=0;this.motion='rest';this.taskTime=0;this.revision=0;this.amount=0;this.runMix=0;this.phase=0;this.transition=1;this.pose(0,0,0);}
 setWorldRotation(name:string,world:THREE.Quaternion){const bone=this.bone(name);bone.quaternion.copy(bone.parent?bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world):world);bone.updateMatrixWorld(true);}
 /** Analytic two-link IK keeps both ankles fixed and limb lengths invariant. */
 solveLeg(side:string,target:THREE.Vector3,poleDirection=new THREE.Vector3(0,0,1),footRotation=new THREE.Quaternion()){
  const thigh=this.bone(`thigh.${side}`),shin=this.bone(`shin.${side}`),foot=this.bone(`foot.${side}`),hip=thigh.getWorldPosition(new THREE.Vector3());
  const a=shin.position.length(),b=foot.position.length(),direction=target.clone().sub(hip),distance=clamp(direction.length(),Math.abs(a-b)+1e-6,a+b-1e-7);direction.normalize();
  const along=(a*a-b*b+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,a*a-along*along));
  const pole=poleDirection.clone().addScaledVector(direction,-poleDirection.dot(direction));if(pole.lengthSq()<1e-8)pole.set(1,0,0);pole.normalize();
  const knee=hip.clone().addScaledVector(direction,along).addScaledVector(pole,height);
  this.setWorldRotation(thigh.name,new THREE.Quaternion().setFromUnitVectors(shin.position.clone().normalize(),knee.clone().sub(hip).normalize()));
  this.setWorldRotation(shin.name,new THREE.Quaternion().setFromUnitVectors(foot.position.clone().normalize(),target.clone().sub(knee).normalize()));
  this.setWorldRotation(foot.name,footRotation);
  this.bone(`patella.${side}`).quaternion.copy(shin.quaternion).slerp(new THREE.Quaternion(),.5);
 }
 poseTask(motion:Motion,time:number){
  if(motion==='lie'){this.poseBed(time);return;}
  const state=taskState(motion,time),p=this.bones[0];for(const bone of this.bones)bone.quaternion.identity();
  p.position.copy(this.bind[0]);p.position.y-=.39*state.seat;p.position.z-=.36*state.seat;
  p.rotation.x=state.lean*.12;this.bone('spine').rotation.x=state.lean*.58;this.bone('chest').rotation.x=state.lean*.30;p.updateMatrixWorld(true);
  this.setWorldRotation('neck',new THREE.Quaternion());this.setWorldRotation('head',new THREE.Quaternion());
  for(const [side,sign]of [['l',1],['r',-1]]as const){
   const ankle=this.bind[ids[`foot.${side}`]].clone();this.solveLeg(side,ankle);
   const arm=state.arm;
   this.setWorldRotation(`upperArm.${side}`,new THREE.Quaternion().setFromEuler(new THREE.Euler(-.12*arm,0,sign*.08*arm)));
   this.setWorldRotation(`forearm.${side}`,new THREE.Quaternion().setFromEuler(new THREE.Euler(-(motion==='grip'?1.42:.92)*arm,0,sign*.08*arm)));
   const forearm=this.bone(`forearm.${side}`),axis=this.bone(`hand.${side}`).position.clone().normalize();
   forearm.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axis,sign*arm*this.forearmRoll));
   for(let digit=0;digit<5;digit++)for(let joint=0;joint<3;joint++){
    const bone=this.bone(`finger${digit}.${joint}.${side}`),curl=state.grip;
    // Existing atlas fingers already have a little flexion. Added rotations
    // close around a small virtual grip, leaving room for the finger pads.
    if(digit===0){bone.rotation.set(-[.22,.45,.55][joint]*curl,0,-sign*[.42,.10,0][joint]*curl);}
    else bone.rotation.x=-[1.0,1.05,.40][joint]*curl;
   }
  }
  p.updateMatrixWorld(true);this.updatePalette();this.groundTask(true);
  if(motion==='stand'||motion==='sitStand')this.constrainSeat();
 }
 /** Two-link bed IK transports a shared hinge frame through both segments.
  * Matching only segment directions leaves axial twist undetermined, especially
  * when the body rotates through side lying. Limits are authored animation bounds. */
 solveBedLimb(upperName:string,lowerName:string,endName:string,target:THREE.Vector3,poleDirection:THREE.Vector3,maxFlex:number,arm=false){
  const upper=this.bone(upperName),lower=this.bone(lowerName),end=this.bone(endName),origin=upper.getWorldPosition(new THREE.Vector3());
  const a=lower.position.length(),b=end.position.length(),direction=target.clone().sub(origin);
  const minimum=Math.sqrt(a*a+b*b+2*a*b*Math.cos(maxFlex));
  const maximum=Math.sqrt(a*a+b*b+2*a*b*Math.cos(arm?.25:.10));
  let distance=clamp(direction.length(),minimum,maximum);
  if(arm&&direction.length()>maximum-.04)distance=maximum-.04+.04*Math.tanh((direction.length()-maximum+.04)/.04);
  direction.normalize();
  const pole=poleDirection.clone().addScaledVector(direction,-poleDirection.dot(direction));
  if(pole.lengthSq()<1e-8){pole.set(0,1,0).addScaledVector(direction,-direction.y);if(pole.lengthSq()<1e-8)pole.set(1,0,0);}
  pole.normalize();const along=(a*a-b*b+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,a*a-along*along));
  const joint=origin.clone().addScaledVector(direction,along).addScaledVector(pole,height),tip=origin.clone().addScaledVector(direction,distance);
  const normal=new THREE.Vector3().crossVectors(pole,direction).normalize();
  const frame=(axis:THREE.Vector3,normal:THREE.Vector3)=>{const y=axis.clone().normalize(),x=normal.clone().addScaledVector(y,-normal.dot(y)).normalize(),z=new THREE.Vector3().crossVectors(x,y);return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,y,z));};
  const localNormal=new THREE.Vector3(arm?-1:1,0,0);
  this.setWorldRotation(upperName,frame(joint.clone().sub(origin),normal).multiply(frame(lower.position,localNormal).invert()));
  this.setWorldRotation(lowerName,frame(tip.sub(joint),normal).multiply(frame(end.position,localNormal).invert()));
 }
 /** Keep wrist/ankle orientation near its parent instead of forcing a world
  * orientation through a bent limb. Smooth saturation avoids a hard angular stop. */
 orientBedEnd(name:string,desired:THREE.Quaternion,limit:number){
  const bone=this.bone(name),parent=bone.parent!.getWorldQuaternion(new THREE.Quaternion()),relative=parent.clone().invert().multiply(desired),angle=new THREE.Quaternion().angleTo(relative);
  const bounded=limit*Math.tanh(angle/limit);bone.quaternion.identity().slerp(relative,angle>1e-8?bounded/angle:0);bone.updateMatrixWorld(true);
 }
 solveBedLeg(side:string,target:THREE.Vector3,rotation:THREE.Quaternion){
  const direction=target.clone().sub(this.bone(`thigh.${side}`).getWorldPosition(new THREE.Vector3())).normalize();
  const bend=new THREE.Vector3().crossVectors(direction,this.bedHingeAxis).normalize();
  this.solveBedLimb(`thigh.${side}`,`shin.${side}`,`foot.${side}`,target,bend,2.10);
  const foot=this.bone(`foot.${side}`);
  if(this.bedFootPlant>0){this.orientBedEnd(foot.name,rotation,.70);foot.quaternion.slerp(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),.08),1-this.bedFootPlant);}
  else foot.rotation.set(.08,0,0);foot.updateMatrixWorld(true);
  this.bone(`patella.${side}`).quaternion.copy(this.bone(`shin.${side}`).quaternion).slerp(new THREE.Quaternion(),.5);
 }
 /** Enter at the middle of the long edge; lower sideways with bent knees,
  * extend the legs along the mattress, then roll onto the back and settle. */
 poseBed(time:number){
  this.poseBedLocal(time);
  const root=this.bones[0],[x,z]=bedToWorld(root.position.x,root.position.z,this.bedAnchor);root.position.x=x;root.position.z=z;
  root.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),bedPlacement.angle));root.updateMatrixWorld(true);this.updatePalette();
 }
 private poseBedLocal(time:number){
  const state=taskState('lie',time),lower=state.sideLower||0,lift=state.legLift,extend=state.extend||0,roll=state.roll||0,p=this.bones[0];this.bedLoad=lower;this.bedExtension=extend;this.bedFootPlant=1-ease(0,.35,lift);
  for(const b of this.bones)b.quaternion.identity();
  const yaw=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-Math.PI/2),supine=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.PI/2);
  const body=yaw.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI/2*lower)).slerp(supine,roll);
  p.position.set(-.79+.38*state.seat+.12*lower+.29*roll,.92-.35*state.seat-.01*lower-.07*roll,-1.2);p.quaternion.copy(body);
  this.bone('spine').rotation.x=.08*state.seat*(1-lower);this.bone('chest').rotation.x=.04*state.seat*(1-lower);p.updateMatrixWorld(true);
  this.setWorldRotation('neck',body.clone());this.setWorldRotation('head',body.clone());
  this.bedHingeAxis.set(1,0,0).applyQuaternion(body);
  const sideFoot=yaw.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI/2));
  for(const [side,sign]of [['l',1],['r',-1]]as const){
   const ankle=this.bind[ids[`foot.${side}`]],footRotation=yaw.clone().slerp(sideFoot,lift).slerp(supine,roll);
   const inBed=ease(.40,.95,lift),target=new THREE.Vector3(THREE.MathUtils.lerp(-.77,-.37,inBed),THREE.MathUtils.lerp(ankle.y,.59+sign*.045,ease(0,.65,lift))+.05*Math.sin(Math.PI*lift),THREE.MathUtils.lerp(-1.2+sign*.078,-.78+sign*.025,ease(0,.65,lift)));
   target.x=THREE.MathUtils.lerp(target.x,sign*.078,roll);target.z=THREE.MathUtils.lerp(target.z,-.35,extend);target.y=THREE.MathUtils.lerp(target.y,.52,roll);
   this.solveBedLeg(side,target,footRotation);
   // The left/free arm stays extended alongside the torso throughout the
   // transfer. Its shoulder settles with the body roll, not a late elbow lift.
   // Release and extend the supporting elbow during side lowering, before rolling.
   const gather=ease(3,6.5,time),settle=ease(5.0,7.2,time),tuck=gather*(1-settle),seated=state.seat*(1-gather);
   this.bone(`upperArm.${side}`).rotation.set(-.22*seated-(side==='l'?.10:.22)*tuck+.30*settle,0,-sign*(.20*tuck+.13*settle));
   this.bone(`forearm.${side}`).rotation.set(-(side==='l'?.08:.42)*tuck-.08*settle-.07*seated,0,side==='l'?0:-sign*.12*tuck);
   const forearm=this.bone(`forearm.${side}`),axis=this.bone(`hand.${side}`).position.clone().normalize();
   forearm.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axis,sign*(.40*tuck+.65*settle)));
  }
  p.updateMatrixWorld(true);
  // The near hand follows the mattress edge while sitting/lowering; the free
  // arm stays down until the trunk begins to recline. No lateral elbow pole.
  const support=ease(.6,2,time)*(1-ease(4.4,6.8,time));
  if(support>0){
   const names=['upperArm.r','forearm.r','hand.r'],rest=names.map(n=>this.bone(n).quaternion.clone());
   const contact=new THREE.Vector3(-.40,.52,-1.46),pole=new THREE.Vector3(0,0,-1).applyQuaternion(body);
   this.solveBedLimb(names[0],names[1],names[2],contact,pole,2.35,true);
   this.bone('hand.r').rotation.set(1.10,0,0);
   names.forEach((name,i)=>{const bone=this.bone(name);bone.quaternion.copy(rest[i].slerp(bone.quaternion.clone(),support));});
  }
  p.updateMatrixWorld(true);this.updatePalette();this.groundTask(false);this.constrainBed(lower,true);
 }
 constrainBed(load:number,localFrame=false){
  if(!this.bedSamples.length)return;
  const targets=['l','r'].map(side=>this.bone(`foot.${side}`).getWorldPosition(new THREE.Vector3())),rotations=['l','r'].map(side=>this.bone(`foot.${side}`).getWorldQuaternion(new THREE.Quaternion()));
  this.bedHingeAxis.set(1,0,0).applyQuaternion(this.bones[0].quaternion);
  for(let iteration=0;iteration<10;iteration++){
   let penetration=0;const feet=[0,0];
   for(const sample of this.bedSamples){const point=this.transform(sample.point,sample.w);const [x,z]=localFrame?[point.x,point.z]:worldToBed(point.x,point.z,this.bedAnchor);if(!aboveBed(x,z))continue;const depth=bedSurface(x,z,load)+bed.clearance-point.y;
    if(sample.point.y<.18){const side=sample.point.x>0?0:1;feet[side]=Math.max(feet[side],depth);}else penetration=Math.max(penetration,depth);
   }
   if(Math.max(penetration,...feet)<.00005)break;
   this.bones[0].position.y+=penetration;this.bones[0].updateMatrixWorld(true);
   // Heel skin blends ankle and shin transforms, so use its actual DQ position
   // for contact instead of treating the entire foot as a rigid proxy box.
   for(let i=0;i<2;i++){
    const side=i?'r':'l',target=targets[i];target.y+=feet[i];
    if(this.bedExtension>0){
     const hip=this.bone(`thigh.${side}`).getWorldPosition(new THREE.Vector3()),length=this.bone(`shin.${side}`).position.length()+this.bone(`foot.${side}`).position.length()-.001;
     const [hx,hz]=localFrame?[hip.x,hip.z]:worldToBed(hip.x,hip.z,this.bedAnchor),[tx,tz]=localFrame?[target.x,target.z]:worldToBed(target.x,target.z,this.bedAnchor);
     const reach=THREE.MathUtils.lerp(tz,hz+Math.sqrt(Math.max(.01,length*length-(tx-hx)**2-(target.y-hip.y)**2)),this.bedExtension);
     const [x,z]=localFrame?[tx,reach]:bedToWorld(tx,reach,this.bedAnchor);target.x=x;target.z=z;
    }
    this.solveBedLeg(side,target,rotations[i]);
   }
   this.bones[0].updateMatrixWorld(true);this.updatePalette();
  }
 }
 /** Unilateral seat contact acts on the whole body, never clips the buttock mesh.
  * Re-solve the legs after raising the pelvis so the feet do not float upward. */
 constrainSeat(){
  if(!this.seatSamples.length)return;
  const targets=['l','r'].map(side=>this.bone(`foot.${side}`).getWorldPosition(new THREE.Vector3()));
  for(let iteration=0;iteration<6;iteration++){
   let penetration=0;
   for(const sample of this.seatSamples){const point=this.transform(sample.point,sample.w);if(aboveSeat(point.x,point.z))penetration=Math.max(penetration,chair.seatTop+chair.clearance-point.y);}
   if(penetration<.00005)break;
   this.bones[0].position.y+=penetration;this.bones[0].updateMatrixWorld(true);
   for(let i=0;i<2;i++)this.solveLeg(i===0?'l':'r',targets[i]);
   this.bones[0].updateMatrixWorld(true);this.updatePalette();
  }
 }
 groundTask(always:boolean){
  let floor=0;
  if(this.floorSamples.length)floor=Math.min(...this.floorSamples.map(s=>this.transform(s.point,s.w).y))-.001;
  else for(const side of ['l','r']){const foot=this.bone(`foot.${side}`),q=foot.getWorldQuaternion(new THREE.Quaternion()),p=foot.getWorldPosition(new THREE.Vector3());for(const z of [-.055,.145])floor=Math.min(floor,new THREE.Vector3(0,-.073,z).applyQuaternion(q).add(p).y);}
  if(always||floor<0){this.bones[0].position.y-=floor;this.bones[0].updateMatrixWorld(true);this.updatePalette();}
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
     if(i>=CAPTURE_BONE_COUNT){this.bones[i].quaternion.identity();continue;}
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
 /** Sample measured greeting/dance rotations; do not apply locomotion palm or gaze overrides. */
 poseExpression(mode:'wave'|'dance',time:number){
  const clip=expressionMocapData[mode],frames=clip.frames,x=((time%clip.duration)+clip.duration)%clip.duration/clip.duration*frames.length,i=Math.floor(x),u=x-i;
  const a=frames[i],b=frames[(i+1)%frames.length],root=this.bone('pelvis'),q=new THREE.Quaternion();
  root.position.set(THREE.MathUtils.lerp(a[0],b[0],u),THREE.MathUtils.lerp(a[1],b[1],u),this.bind[0].z+THREE.MathUtils.lerp(a[2],b[2],u));
  this.bones.forEach((bone,j)=>bone.quaternion.fromArray(a,3+j*4).slerp(q.fromArray(b,3+j*4),u));
  root.updateMatrixWorld(true);
  if(mode==='wave'){
   // Retarget a standing greeting onto the atlas leg lengths with planted feet.
   let lowerBy=0;
   for(const side of ['l','r']){
    const hip=this.bone(`thigh.${side}`).getWorldPosition(new THREE.Vector3()),target=this.bind[ids[`foot.${side}`]],reach=this.bone(`shin.${side}`).position.length()+this.bone(`foot.${side}`).position.length()-.004;
    const horizontal=(hip.x-target.x)**2+(hip.z-target.z)**2;
    lowerBy=Math.max(lowerBy,hip.y-target.y-Math.sqrt(Math.max(0,reach*reach-horizontal)));
   }
   root.position.y-=lowerBy;root.updateMatrixWorld(true);
   for(const side of ['l','r']){this.solveLeg(side,this.bind[ids[`foot.${side}`]].clone());this.setWorldRotation(`foot.${side}`,new THREE.Quaternion());}
  }
  this.updatePalette();this.groundTask(false);
  if(mode==='dance')this.groundFloorwork();
 }
 groundFloorwork(){
   const root=this.bones[0];
   // Floorwork can be supported by palms, forearms or the back. A feet-only
   // ground correction sinks an inverted dancer through the floor.
   let minimum=Infinity;for(const sample of this.bedSamples)minimum=Math.min(minimum,this.transform(sample.point,sample.w).y);
   if(Number.isFinite(minimum)){root.position.y+=.004-minimum;root.updateMatrixWorld(true);this.updatePalette();}
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
