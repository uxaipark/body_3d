import * as THREE from 'three';

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

/** Anatomical envelopes. The perineum is bound to ONE pelvis, never to a side. */
export function weightsAt(x:number,y:number,z:number):Weights {
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
 const armEnvelope=smooth(.14+Math.max(0,1.37-y)*.04,.18+Math.max(0,1.37-y)*.04,ax)*arm;
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

export function bindGeometry(geometry:THREE.BufferGeometry,rigidIndex?:number) {
 const p=geometry.getAttribute('position'),indices=new Uint16Array(p.count*4),weights=new Float32Array(p.count*4);
 for(let i=0;i<p.count;i++){
   if(rigidIndex!==undefined){indices[i*4]=rigidIndex;weights[i*4]=1;}
   else {const w=weightsAt(p.getX(i),p.getY(i),p.getZ(i));indices.set(w.indices,i*4);weights.set(w.weights,i*4);}
 }
 geometry.setAttribute('rigIndex',new THREE.BufferAttribute(indices,4));geometry.setAttribute('rigWeight',new THREE.BufferAttribute(weights,4));
 // Bounds enclose gait swings; the GPU moves vertices outside the rest box.
 geometry.computeBoundingSphere();if(geometry.boundingSphere)geometry.boundingSphere.radius+=.6;
}

export class HumanRig {
 bones:THREE.Bone[]=[];skeleton:THREE.Skeleton;bind=specs.map(s=>new THREE.Vector3(...s[2]));
 real=specs.map(()=>new THREE.Vector4(0,0,0,1));dual=specs.map(()=>new THREE.Vector4());
 uniforms={uRigReal:{value:this.real},uRigDual:{value:this.dual}};
 amount=0;runMix=0;phase=0;forearmRoll=Math.PI/2;
 constructor(){
   for(let i=0;i<specs.length;i++){
     const [name,parent]=specs[i],bone=new THREE.Bone();bone.name=name;
     bone.position.copy(this.bind[i]);if(parent){bone.position.sub(this.bind[ids[parent]]);this.bones[ids[parent]].add(bone);}this.bones.push(bone);
   }
   this.bones[0].updateMatrixWorld(true);this.skeleton=new THREE.Skeleton(this.bones);this.skeleton.calculateInverses();this.updatePalette();
 }
 bone(name:string){return this.bones[ids[name]];}
 /** Foot targets use stance/swing phases and two-link IK; bone lengths never change. */
 update(dt:number,motion:'rest'|'walk'|'run'){
   const k=1-Math.exp(-dt*7);this.amount=THREE.MathUtils.lerp(this.amount,motion==='rest'?0:1,k);
   this.runMix=THREE.MathUtils.lerp(this.runMix,motion==='run'?1:0,k);
   this.phase=(this.phase+dt*THREE.MathUtils.lerp(.92,1.5,this.runMix))%1;
   this.pose(this.phase,this.amount,this.runMix);
 }
 pose(phase:number,amount=1,run=0){
   for(const b of this.bones)b.quaternion.identity();
   const p=this.bone('pelvis');p.position.copy(this.bind[0]);
   if(amount<1e-7){p.updateMatrixWorld(true);this.updatePalette();return;}
   const wave=phase*Math.PI*2;
   p.position.y+=amount*(-THREE.MathUtils.lerp(.024,.055,run)+THREE.MathUtils.lerp(.008,.025,run)*Math.cos(2*wave));
   p.position.x=amount*.008*Math.sin(wave);
   p.rotation.set(amount*run*.10,amount*.035*Math.sin(wave),amount*.018*Math.sin(wave));
   this.bone('spine').rotation.set(amount*run*.055,-amount*.045*Math.sin(wave),-amount*.012*Math.sin(wave));
   this.bone('chest').rotation.y=-amount*.045*Math.sin(wave);
   this.bone('neck').rotation.x=-amount*run*.07;
   p.updateMatrixWorld(true);
   for(const [side,offset,s] of [['l',0,1],['r',.5,-1]] as const){
     const u=(phase+offset)%1,duty=THREE.MathUtils.lerp(.62,.4,run),stride=THREE.MathUtils.lerp(.20,.29,run);
     let z:number,lift=0,pitch=0;
     if(u<duty){const t=u/duty;z=stride*(1-2*t);
       pitch=THREE.MathUtils.lerp(-.12,-.08,run)*(1-smooth(0,.16,t))+THREE.MathUtils.lerp(.28,.48,run)*smooth(.76,1,t);
     }else{const t=(u-duty)/(1-duty),v=-2*stride*(1-duty)/duty;
       z=-stride*(2*t*t*t-3*t*t+1)+stride*(-2*t*t*t+3*t*t)+v*(2*t*t*t-3*t*t+t);
       lift=THREE.MathUtils.lerp(.095,.245,run)*Math.sin(Math.PI*t)**2;
       pitch=THREE.MathUtils.lerp(.28,.48,run)*(1-smooth(0,.5,t))-.12*smooth(.65,1,t);
     }
     // Rotate the foot with clearance for its heel/toe rather than driving it through the floor.
     const clearance=Math.max(0,Math.sin(pitch)*.145,-Math.sin(pitch)*.055);
     const ankle=this.bind[ids[`foot.${side}`]].clone();ankle.z+=z*amount;ankle.y+=(lift+clearance)*amount;
     this.solveLeg(side,ankle,pitch*amount);
     const swing=Math.cos(wave+offset*Math.PI*2);
     this.bone(`upperArm.${side}`).rotation.set(amount*THREE.MathUtils.lerp(.28,.65,run)*swing,0,s*amount*-.035);
     this.bone(`forearm.${side}`).rotation.x=-amount*(THREE.MathUtils.lerp(.20,1.35,run)+THREE.MathUtils.lerp(.14,.2,run)*(1-swing));
     // Anatomical rest palms face forward. During locomotion, roll each forearm
     // around its elbow-to-wrist axis so the palm faces the torso, with no wrist kink.
     const forearm=this.bone(`forearm.${side}`),axis=this.bone(`hand.${side}`).position.clone().normalize();
     forearm.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axis,s*amount*this.forearmRoll));
     this.bone(`hand.${side}`).rotation.x=-amount*.06;
   }
   p.updateMatrixWorld(true);this.updatePalette();
 }
 private solveLeg(side:string,target:THREE.Vector3,pitch:number){
   const upper=this.bone(`thigh.${side}`),lower=this.bone(`shin.${side}`),foot=this.bone(`foot.${side}`);
   const hip=upper.getWorldPosition(new THREE.Vector3()),restUpper=lower.position.clone(),restLower=foot.position.clone();
   const a=restUpper.length(),b=restLower.length(),direction=target.clone().sub(hip),distance=clamp(direction.length(),Math.abs(a-b)+.001,a+b-.0001);direction.normalize();
   const along=(a*a-b*b+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,a*a-along*along));
   const pole=new THREE.Vector3(0,0,1).addScaledVector(direction,-direction.z).normalize();
   const knee=hip.clone().addScaledVector(direction,along).addScaledVector(pole,height);
   // Rest axes are oblique; use their full vectors instead of assuming a vertical bone.
   const desiredUpper=new THREE.Quaternion().setFromUnitVectors(restUpper.normalize(),knee.clone().sub(hip).normalize());
   const parentQ=upper.parent!.getWorldQuaternion(new THREE.Quaternion());upper.quaternion.copy(parentQ.invert().multiply(desiredUpper));upper.updateMatrixWorld(true);
   const desiredLower=new THREE.Quaternion().setFromUnitVectors(restLower.normalize(),target.clone().sub(knee).normalize());
   lower.quaternion.copy(desiredUpper.clone().invert().multiply(desiredLower));lower.updateMatrixWorld(true);
   foot.quaternion.copy(desiredLower.clone().invert().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),pitch)));
   // Patella tracks knee flexion without bending its own geometry.
   this.bone(`patella.${side}`).quaternion.copy(lower.quaternion).slerp(new THREE.Quaternion(),.5);
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
