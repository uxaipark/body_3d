/** Bake CMU BVH locomotion into the atlas rig. Source files stay in .asset-cache.
 * Uses captured joint directions and torso rotations, fixed atlas bone lengths,
 * measured foot clearance, and a short cyclic seam blend. No procedural gait.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as T from 'three';
import {BVHLoader}from'three/addons/loaders/BVHLoader.js';
import {HumanRig,BONE_NAMES}from'../lib/rig.ts';
import {smoothCapture}from'./mocap-filter.mjs';
const V=(x=0,y=0,z=0)=>new T.Vector3(x,y,z),Q=()=>new T.Quaternion();
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
function frame(up,lateral){
 const y=up.clone().normalize(),x=lateral.clone().addScaledVector(y,-lateral.dot(y)).normalize(),z=x.clone().cross(y).normalize();
 return Q().setFromRotationMatrix(new T.Matrix4().makeBasis(x,y,z));
}
const output={};
for(const [mode,id,start,end]of [['walk','35_01',144,278],['run','09_01',8,94]]){
 const raw=fs.readFileSync(`.asset-cache/mocap/${id}.bvh`,'utf8');
 const {skeleton,clip}=new BVHLoader().parse(raw),src=skeleton.bones[0],mixer=new T.AnimationMixer(src);mixer.clipAction(clip).play();
 const sb=Object.fromEntries(skeleton.bones.filter(b=>b.name!=='ENDSITE').map(b=>[b.name,b]));
 const pos=n=>sb[n].getWorldPosition(V()),rot=n=>sb[n].getWorldQuaternion(Q());
 const rig=new HumanRig(),bind=rig.bind.map(p=>p.clone()),dst=Object.fromEntries(rig.bones.map(b=>[b.name,b]));
 const targetLeg=dst['shin.l'].position.length()+dst['foot.l'].position.length();
 const sourceLeg=sb.LeftLeg.position.length()+sb.LeftFoot.position.length(),scale=targetLeg/sourceLeg;
 mixer.setTime(start/120);src.updateMatrixWorld(true);const origin=pos('Hips');
 mixer.setTime(end/120);src.updateMatrixWorld(true);const travel=pos('Hips').sub(origin);travel.y=0;
 const heading=Q().setFromUnitVectors(travel.clone().normalize(),V(0,0,1));
 const frames=[],capture=[];
 for(let f=start;f<=end;f++){
  mixer.setTime(f/120);src.updateMatrixWorld(true);
  const root=pos('Hips'),p=n=>pos(n).sub(root).applyQuaternion(heading),q=n=>heading.clone().multiply(rot(n));
  const hips=p('LeftUpLeg').sub(p('RightUpLeg')),shoulders=p('LeftArm').sub(p('RightArm'));
  for(let i=0;i<rig.bones.length;i++){
   rig.bones[i].quaternion.identity();rig.bones[i].position.copy(bind[i]);
   const parent=rig.bones[i].parent;if(parent)rig.bones[i].position.sub(bind[BONE_NAMES.indexOf(parent.name)]);
  }
  dst.pelvis.position.set(0,0,0);
  const setWorld=(name,world)=>{
   const b=dst[name],parent=b.parent?.getWorldQuaternion(Q())||Q();b.quaternion.copy(parent.invert().multiply(world));b.updateMatrixWorld(true);
  };
  setWorld('pelvis',q('Hips'));
  setWorld('spine',q('Spine'));setWorld('chest',q('Spine1'));setWorld('neck',q('Neck1'));setWorld('head',q('Head'));
  for(const [side,source]of [['l','Left'],['r','Right']]){
   for(const [name,child,from,to,lateral]of [
    [`thigh.${side}`,`shin.${side}`,`${source}UpLeg`,`${source}Leg`,hips],
    [`shin.${side}`,`foot.${side}`,`${source}Leg`,`${source}Foot`,hips],
    [`upperArm.${side}`,`forearm.${side}`,`${source}Arm`,`${source}ForeArm`,shoulders],
    [`forearm.${side}`,`hand.${side}`,`${source}ForeArm`,`${source}Hand`,shoulders],
   ]){
    const rest=frame(dst[child].position.clone().negate(),V(1,0,0));
    setWorld(name,frame(p(from).sub(p(to)),lateral).multiply(rest.invert()));
   }
   // Foot forward direction is captured, but toe noise and roll are damped.
   const forward=p(`${source}ToeBase`).sub(p(`${source}Foot`)).normalize();
   const yaw=T.MathUtils.clamp(Math.atan2(forward.x,Math.abs(forward.z)),-.30,.30),pitch=Math.atan2(-forward.y,forward.z);
   const rest=dst[`toe.${side}`].position,pitchRest=Math.atan2(-rest.y,rest.z);
   setWorld(`foot.${side}`,Q().setFromEuler(new T.Euler(T.MathUtils.clamp(pitch-pitchRest,-.45,1.35),yaw,0,'YXZ')));
   dst[`toe.${side}`].quaternion.identity();
   dst[`patella.${side}`].quaternion.copy(dst[`shin.${side}`].quaternion).slerp(Q(),.5);
   // Source finger/thumb channels are not measured by CMU. Keep hands neutral.
   dst[`hand.${side}`].quaternion.identity();
  }
  dst.pelvis.updateMatrixWorld(true);
  const soles=[];
  for(const side of ['l','r']){
   const foot=dst[`foot.${side}`],ankle=foot.getWorldPosition(V()),fq=foot.getWorldQuaternion(Q());
   for(const point of [V(0,-.073,-.055),V(0,-.073,.145)])soles.push(point.applyQuaternion(fq).add(ankle).y);
  }
  // Source toe/heel support elevations retain the captured flight interval.
  const feet=['Left','Right'].map(side=>{
   const a=pos(side+'Foot'),toe=pos(side+'ToeBase');
   return Math.min(toe.y,a.y-(toe.y-a.y)*.28)-.35;
  });
  capture.push({root:root.toArray(),feet,relativeSole:Math.min(...soles)});
  frames.push({position:[0,0,0],quaternions:rig.bones.map(b=>b.quaternion.toArray())});
 }
 // Remove drift in the capture floor, estimated from successive local foot minima.
 const count=frames.length,period=end-start;
 const floor=[];
 for(let i=0;i<count;i++){
  const lo=Math.max(0,i-25),hi=Math.min(count,i+26);
  floor.push(Math.min(...capture.slice(lo,hi).flatMap(c=>c.feet)));
 }
 const xCenter=mean(capture.map(c=>c.root[0]));
 for(let i=0;i<count;i++){
  const c=capture[i],clearance=Math.max(0,Math.min(...c.feet)-floor[i]);
  // Support is grounded; flight clearance comes from the captured feet.
  const flight=mode==='run'?Math.max(0,clearance-.14)*scale:0;
  const deviation=V(...c.root).sub(origin).sub(travel.clone().multiplyScalar(i/period)).applyQuaternion(heading).multiplyScalar(scale);
  frames[i].position=[deviation.x,-c.relativeSole+flight,0];
 }
 // Endpoint mismatch is removed with a C1 smooth, localized seam correction.
 // Preserve the middle of the captured stride and resample at native 60 Hz.
 const first=frames[0],last=frames.at(-1),window=.14;
 const sample=(phase)=>{
  const index=phase*period,i=Math.min(period-1,Math.floor(index)),t=index-i;
  const a=frames[i],b=frames[i+1],out={position:a.position.map((v,k)=>T.MathUtils.lerp(v,b.position[k],t)),quaternions:[]};
  const u=T.MathUtils.clamp((phase-(1-window))/window,0,1),w=u*u*(3-2*u);
  for(let k=0;k<3;k++)out.position[k]+=(first.position[k]-last.position[k])*w;
  for(let j=0;j<BONE_NAMES.length;j++){
   const q=Q().fromArray(a.quaternions[j]).slerp(Q().fromArray(b.quaternions[j]),t);
   const correction=Q().fromArray(last.quaternions[j]).invert().multiply(Q().fromArray(first.quaternions[j]));
   q.multiply(Q().slerp(correction,w));out.quaternions.push(q.toArray());
  }
  return out;
 };
 const duration=period/120,n=mode==='walk'?2*Math.round(duration*30):Math.round(duration*60),data=[];
 for(let i=0;i<n;i++){const f=sample(i/n);data.push([...f.position,...f.quaternions.flat()].map(v=>+v.toFixed(7)));}
 // Symmetric filtering removes capture/retargeting chatter without delaying
 // footfalls. Shorter running window preserves the faster impact/flight rhythm.
 const smoothingSeconds=mode==='walk'?.050:.040;
 // Balance the retargeted sides using the opposite captured half-stride.
 // A YZ reflection maps q=(x,y,z,w) to (x,-y,-z,w). An even sample count
 // keeps the half-cycle exact and prevents unequal support times/limping.
 const balanced=mode==='walk'?data.map((f,i)=>{
  const other=data[(i+n/2)%n],out=[(f[0]-other[0])/2,(f[1]+other[1])/2,(f[2]+other[2])/2];
  BONE_NAMES.forEach((name,j)=>{
   const opposite=name.endsWith('.l')?name.replace('.l','.r'):name.endsWith('.r')?name.replace('.r','.l'):name;
   const q=Q().fromArray(other,3+BONE_NAMES.indexOf(opposite)*4);q.y*=-1;q.z*=-1;
   out.push(...Q().fromArray(f,3+j*4).slerp(q,.5).toArray());
  });return out;
 }):data;
 const filtered=smoothCapture(balanced,duration,smoothingSeconds).map(f=>f.map(v=>+v.toFixed(7)));
 output[mode]={source:`CMU ${id}`,sha256:crypto.createHash('sha256').update(raw).digest('hex'),sourceFrames:[start,end],duration,smoothingSeconds,frames:filtered};
 console.log(mode,'frames',n,'duration',duration,'height',Math.min(...data.map(f=>f[1])),Math.max(...data.map(f=>f[1])));
 rig.dispose();mixer.stopAllAction();mixer.uncacheRoot(src);
}
fs.writeFileSync('lib/mocap-data.js','// Generated by scripts/build-mocap.mjs from CMU capture data. See public/motions/ATTRIBUTION.md.\nexport const mocapData = '+JSON.stringify(output)+';\n');
