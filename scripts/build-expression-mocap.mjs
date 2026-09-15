/** Bake short, atlas-specific CMU greeting/dance clips. No generated joint sine waves.
 * Input BVHs are downloaded into the ignored .asset-cache/mocap directory. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as T from 'three';
import {BVHLoader} from 'three/addons/loaders/BVHLoader.js';
import {HumanRig,BONE_NAMES} from '../lib/rig.ts';
import {smoothCapture} from './mocap-filter.mjs';
const V=(x=0,y=0,z=0)=>new T.Vector3(x,y,z),Q=()=>new T.Quaternion();
function frame(direction,secondary){
 if(direction.lengthSq()<1e-8)throw Error('Missing capture direction');
 const y=direction.clone().normalize(),z=secondary.clone().addScaledVector(y,-secondary.dot(y)).normalize();
 if(z.lengthSq()<.01)throw Error('Degenerate capture frame');
 const x=y.clone().cross(z).normalize();return Q().setFromRotationMatrix(new T.Matrix4().makeBasis(x,y,z));
}
const output={};
for(const [mode,id,first,last] of [['wave','141_16',3,290],['dance','103_03',3,435]]){
 const raw=fs.readFileSync(`.asset-cache/mocap/${id}.bvh`,'utf8');
 const frameTime=Number(raw.match(/Frame Time:\s*([\d.]+)/)[1]);
 const {skeleton,clip}=new BVHLoader().parse(raw),src=skeleton.bones[0],mixer=new T.AnimationMixer(src);mixer.clipAction(clip).play();
 const sb=Object.fromEntries(skeleton.bones.filter(b=>b.name!=='ENDSITE').map(b=>[b.name,b]));
 const pos=n=>sb[n].getWorldPosition(V()),rot=n=>sb[n].getWorldQuaternion(Q());
 const rig=new HumanRig(),dst=Object.fromEntries(rig.bones.map(b=>[b.name,b]));
 const localBind=rig.bones.map(b=>b.position.clone());
 const scale=(dst['shin.l'].position.length()+dst['foot.l'].position.length())/(sb.LeftLeg.position.length()+sb.LeftFoot.position.length());
 // Determine facing from the hips at the first action frame, not noisy root travel.
 mixer.setTime(first*frameTime);src.updateMatrixWorld(true);
 const lateral=pos('LeftUpLeg').sub(pos('RightUpLeg'));lateral.y=0;lateral.normalize();
 const forward=lateral.cross(V(0,1,0));const heading=Q().setFromAxisAngle(V(0,1,0),-Math.atan2(forward.x,forward.z));
 const origin=pos('Hips'),captures=[];
 // A source bone's local normal follows measured axial rotation; unlike the
 // shoulder-to-shoulder vector, it cannot become singular when an arm is raised.
 const normals={};mixer.setTime(0);src.updateMatrixWorld(true);
 for(const name of Object.keys(sb))normals[name]=V(0,0,1).applyQuaternion(rot(name).invert());
 for(let f=first;f<=last;f++){
  mixer.setTime(f*frameTime);src.updateMatrixWorld(true);
  const root=pos('Hips'),p=n=>pos(n).sub(root).applyQuaternion(heading),q=n=>heading.clone().multiply(rot(n));
  rig.bones.forEach((b,i)=>{b.position.copy(localBind[i]);b.quaternion.identity();});dst.pelvis.position.set(0,0,0);
  const setWorld=(name,world)=>{const b=dst[name];b.quaternion.copy(b.parent?b.parent.getWorldQuaternion(Q()).invert().multiply(world):world);b.updateMatrixWorld(true);};
  for(const [to,from] of [['pelvis','Hips'],['spine','Spine'],['chest','Spine1'],['neck','Neck1'],['head','Head']])setWorld(to,q(from));
  for(const [side,source] of [['l','Left'],['r','Right']]){
   for(const [name,child,from,to] of [
    [`thigh.${side}`,`shin.${side}`,`${source}UpLeg`,`${source}Leg`],
    [`shin.${side}`,`foot.${side}`,`${source}Leg`,`${source}Foot`],
    [`upperArm.${side}`,`forearm.${side}`,`${source}Arm`,`${source}ForeArm`],
    [`forearm.${side}`,`hand.${side}`,`${source}ForeArm`,`${source}Hand`],
   ]){
    const rest=frame(dst[child].position,V(0,0,1)),normal=(name.startsWith('forearm')?V(0,side==='r'?-1:1,0):normals[from].clone()).applyQuaternion(q(from));
    setWorld(name,frame(p(to).sub(p(from)),normal).multiply(rest.invert()));
   }
   // Captured foot direction and roll, with a stable sideways normal.
   const footDir=p(`${source}ToeBase`).sub(p(`${source}Foot`)),footNormal=V(0,1,0).applyQuaternion(q(`${source}Foot`));
   setWorld(`foot.${side}`,frame(footDir,footNormal).multiply(frame(dst[`toe.${side}`].position,V(0,1,0)).invert()));
   dst[`patella.${side}`].quaternion.copy(dst[`shin.${side}`].quaternion).slerp(Q(),.5);
   // Finger joints are not captured by CMU. Keep open atlas digits and use
   // the captured wrist orientation only; no invented finger oscillation.
   const hand=sb[`${source}Hand`],axis=sb[`${source}HandIndex1`].position.clone().applyQuaternion(q(`${source}Hand`));
   const normal=V(0,side==='r'?-1:1,0).applyQuaternion(q(`${source}Hand`));
   setWorld(`hand.${side}`,frame(axis,normal).multiply(frame(dst[`finger2.0.${side}`].position,V(0,0,1)).invert()));
  }
  dst.pelvis.updateMatrixWorld(true);
  let sole=Infinity;
  for(const side of ['l','r']){const b=dst[`foot.${side}`],a=b.getWorldPosition(V()),q=b.getWorldQuaternion(Q());for(const v of [V(0,-.073,-.055),V(0,-.073,.145)])sole=Math.min(sole,v.applyQuaternion(q).add(a).y);}
  const displacement=root.clone().sub(origin).applyQuaternion(heading).multiplyScalar(scale);
  captures.push({position:[displacement.x,-sole,displacement.z],quaternions:rig.bones.map(b=>b.quaternion.toArray())});
 }
 let start=0,end=captures.length-1;
 if(mode==='dance'){
  // Select a recurrent captured pose with matching velocity; avoid the initial
  // calibration pose and minimize the amount of seam correction required.
  let best=Infinity;
  const indices=['pelvis','chest','thigh.l','shin.l','thigh.r','shin.r','upperArm.l','upperArm.r'].map(n=>BONE_NAMES.indexOf(n));
  for(let a=8;a<captures.length-210;a+=2)for(let b=a+210;b<captures.length-8;b+=2){
   let cost=0;for(const j of indices){const qa=Q().fromArray(captures[a].quaternions[j]),qb=Q().fromArray(captures[b].quaternions[j]);cost+=qa.angleTo(qb)**2;const va=Q().fromArray(captures[a-6].quaternions[j]).invert().multiply(Q().fromArray(captures[a+6].quaternions[j]));const vb=Q().fromArray(captures[b-6].quaternions[j]).invert().multiply(Q().fromArray(captures[b+6].quaternions[j]));cost+=va.angleTo(vb)**2*.8;}
   if(cost<best){best=cost;start=a;end=b;}
  }
 }
 const chosen=captures.slice(start,end+1),duration=(end-start)*frameTime,period=chosen.length-1;
 const initial=chosen[0],final=chosen.at(-1),data=[];
 for(let i=0,n=Math.round(duration*60);i<n;i++){
  const phase=i/n,x=phase*period,k=Math.floor(x),u=x-k,a=chosen[k],b=chosen[k+1];
  const seam=T.MathUtils.smoothstep(phase,.78,1),frame=[];
  for(let j=0;j<3;j++){
   let value=T.MathUtils.lerp(a.position[j],b.position[j],u);
   if(j!==1)value-=T.MathUtils.lerp(initial.position[j],final.position[j],phase);
   else value+=(initial.position[j]-final.position[j])*seam;
   // A greeting stays within a standing base of support; dance keeps captured sway.
   if(mode==='wave'&&j!==1)value=T.MathUtils.clamp(value,-.045,.045);
   frame.push(value);
  }
  for(let j=0;j<BONE_NAMES.length;j++){
   const q=Q().fromArray(a.quaternions[j]).slerp(Q().fromArray(b.quaternions[j]),u);
   q.multiply(Q().slerp(Q().fromArray(final.quaternions[j]).invert().multiply(Q().fromArray(initial.quaternions[j])),seam));frame.push(...q.toArray());
  }
  data.push(frame);
 }
 const smoothingSeconds=.035,frames=smoothCapture(data,duration,smoothingSeconds).map(f=>f.map(v=>+v.toFixed(7)));
 output[mode]={source:`CMU ${id}`,description:mode==='wave'?'Wave Hello (right hand)':'Charleston (jazz dance)',sha256:crypto.createHash('sha256').update(raw).digest('hex'),sourceFrames:[first+start,first+end],sourceFrameTime:frameTime,duration,smoothingSeconds,frames};
 console.log(mode,output[mode].sourceFrames,duration,frames.length);
 rig.dispose();mixer.stopAllAction();mixer.uncacheRoot(src);
}
fs.writeFileSync('lib/expression-mocap-data.js','// Generated by scripts/build-expression-mocap.mjs. See public/motions/ATTRIBUTION.md.\nexport const expressionMocapData = '+JSON.stringify(output)+';\n');
