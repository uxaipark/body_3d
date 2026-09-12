import test from 'node:test';import assert from 'node:assert/strict';import * as T from 'three';
import {HumanRig,BONE_NAMES,bindFingerGeometry,rigidBone,surfaceFootSupport} from '../lib/rig.ts';
import {handLandmarks} from '../lib/hand-landmarks.js';import {taskState} from '../lib/clinical-motion.js';
import {sample,csv,defaults} from '../lib/physiology.ts';
import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';import draco from 'draco3dgltf';
const near=(a,b,tol=1e-6)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
test('chair tasks keep both feet planted, bones rigid and gaze level throughout full repetitions',()=>{
 const rig=new HumanRig();let min=Infinity,max=-Infinity,maxFlex=0;
 for(const motion of ['stand','sitStand'])for(let i=0;i<=960;i++){
  rig.poseTask(motion,i/60);const y=rig.bones[0].position.y;min=Math.min(min,y);max=Math.max(max,y);
  for(const side of ['l','r']){
   const hip=rig.bone(`thigh.${side}`).getWorldPosition(new T.Vector3()),knee=rig.bone(`shin.${side}`).getWorldPosition(new T.Vector3()),ankle=rig.bone(`foot.${side}`).getWorldPosition(new T.Vector3());
   near(ankle.distanceTo(rig.bind[BONE_NAMES.indexOf(`foot.${side}`)]),0);near(hip.distanceTo(knee),rig.bone(`shin.${side}`).position.length());near(knee.distanceTo(ankle),rig.bone(`foot.${side}`).position.length());
   maxFlex=Math.max(maxFlex,knee.clone().sub(hip).angleTo(ankle.clone().sub(knee)));
  }
  near(rig.bone('head').getWorldQuaternion(new T.Quaternion()).angleTo(new T.Quaternion()),0);
 }
 assert.ok(max-min>.25&&max-min<.34);assert.ok(maxFlex>1.2&&maxFlex<2);
 rig.poseTask('stand',7);const end=rig.bones.map(b=>b.matrixWorld.clone());rig.poseTask('stand',100);rig.bones.forEach((b,i)=>b.matrixWorld.elements.forEach((v,j)=>near(v,end[i].elements[j])));
});
test('repeated tasks have continuous loop boundaries and single stand remains complete',()=>{
 for(const motion of ['stand','sitStand','grip']){
  const rig=new HumanRig();for(let t=0;t<24;t+=.02){rig.poseTask(motion,t);const previous=rig.bones.map(b=>b.getWorldPosition(new T.Vector3()));rig.poseTask(motion,t+.001);rig.bones.forEach((b,i)=>assert.ok(b.getWorldPosition(new T.Vector3()).distanceTo(previous[i])<.003));}
 }
 assert.equal(taskState('stand',100).repetitions,1);assert.equal(taskState('stand',100).complete,true);assert.equal(taskState('sitStand',23).repetitions,3);
});
test('each phalanx rotates rigidly at its own joint; grip closes and opens without moving wrists',()=>{
 const rig=new HumanRig();rig.poseTask('grip',1.7);const wrists=['l','r'].map(s=>rig.bone(`hand.${s}`).getWorldPosition(new T.Vector3())),open=[];
 for(const side of ['r','l'])for(let d=0;d<5;d++){
  const p=new T.Vector3(...handLandmarks[d][3]);if(side==='l')p.x*=-1;
  const index=BONE_NAMES.indexOf(`finger${d}.2.${side}`),w={indices:[index,0,0,0],weights:[1,0,0,0]};open.push({p,index,w,position:rig.transform(p,w)});
 }
 rig.poseTask('grip',4);['l','r'].forEach((s,i)=>near(wrists[i].distanceTo(rig.bone(`hand.${s}`).getWorldPosition(new T.Vector3())),0));
 for(const {p,index,w,position}of open){assert.ok(rig.transform(p,w).distanceTo(position)>.018);const pivot=rig.bind[index];near(rig.transform(p,w).distanceTo(rig.transform(pivot,w)),p.distanceTo(pivot));}
 rig.poseTask('grip',7);for(const {p,w,position}of open)near(rig.transform(p,w).distanceTo(position),0);
 assert.equal(BONE_NAMES[rigidBone('Middle phalanx of second finger of hand.r.001',new T.Vector3(-.3,.74,.05))],'finger1.1.r');
});
test('motion changes blend, pause freezes and reset restores the common skin/skeleton pose',()=>{
 const rig=new HumanRig(),skin=new HumanRig();
 for(const motion of ['run','stand','sitStand','grip','rest']){
  const before=rig.bone('head').getWorldPosition(new T.Vector3());rig.update(1/120,motion);assert.ok(rig.bone('head').getWorldPosition(new T.Vector3()).distanceTo(before)<.025);
  for(let i=0;i<500;i++)rig.update(1/120,motion);
  const q=rig.bones.map(b=>b.quaternion.clone()),root=rig.bones[0].position.clone(),time=rig.taskTime;rig.update(0,motion);near(rig.taskTime,time);near(root.distanceTo(rig.bones[0].position),0);rig.bones.forEach((b,i)=>assert.deepEqual(b.quaternion.toArray(),q[i].toArray()));
  skin.copyPose(rig);skin.bones.forEach((b,i)=>b.matrixWorld.elements.forEach((v,j)=>near(v,rig.bones[i].matrixWorld.elements[j])));
 }
 rig.reset();near(rig.bones[0].position.distanceTo(rig.bind[0]),0);assert.equal(rig.taskTime,0);
});
test('native skin binding preserves the torso, follows digits and keeps actual soles above the floor',async()=>{
 const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco.createDecoderModule()}),doc=await io.read('public/models/skin-atlas-web.glb');
 const primitive=doc.getRoot().listMeshes()[0].listPrimitives()[0],g=new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(primitive.getAttribute('POSITION').getArray(),3)).setAttribute('rigIndex',new T.BufferAttribute(primitive.getAttribute('_RIG_INDEX').getArray().slice(),4)).setAttribute('rigWeight',new T.BufferAttribute(primitive.getAttribute('_RIG_WEIGHT').getArray().slice(),4));
 const p=g.getAttribute('position'),indices=g.getAttribute('rigIndex'),weights=g.getAttribute('rigWeight'),old=indices.array.slice();bindFingerGeometry(g);let count=0;
 const rig=new HumanRig();rig.floorSamples=surfaceFootSupport(g);const feet=[];
 for(let i=0;i<p.count;i++){
  const ids=[indices.getX(i),indices.getY(i),indices.getZ(i),indices.getW(i)],ws=[weights.getX(i),weights.getY(i),weights.getZ(i),weights.getW(i)];near(ws.reduce((a,b)=>a+b,0),1,.001);
  if(p.getY(i)>1||Math.abs(p.getX(i))<.18)for(let j=0;j<4;j++)assert.equal(ids[j],old[i*4+j]);
  if(ids.some((id,j)=>id>=21&&ws[j]>.01))count++;
  if(p.getY(i)<.13)feet.push({point:new T.Vector3().fromBufferAttribute(p,i),w:{indices:ids,weights:ws}});
 }
 assert.ok(count>100);
 // A fitted hand influence may be 98.9% at one vertex and 99.1% next door.
 // Rebinding must not leave one vertex behind and stretch a skin edge by 18x.
 rig.poseTask('grip',4);const rest=[],moved=[];
 for(let i=0;i<p.count;i++){const point=new T.Vector3().fromBufferAttribute(p,i);rest.push(point);moved.push(rig.transform(point,{indices:[indices.getX(i),indices.getY(i),indices.getZ(i),indices.getW(i)],weights:[weights.getX(i),weights.getY(i),weights.getZ(i),weights.getW(i)]}));}
 const triangles=primitive.getIndices().getArray();let worst=0,over3=0,edges=0,example;
 for(let i=0;i<triangles.length;i+=3)for(const [a,b]of [[triangles[i],triangles[i+1]],[triangles[i+1],triangles[i+2]],[triangles[i+2],triangles[i]]]){
  if(rest[a].y>.67&&rest[a].y<.85&&Math.abs(rest[a].x)>.19){const length=rest[a].distanceTo(rest[b]);if(length>.002){const ratio=moved[a].distanceTo(moved[b])/length;if(ratio>worst)example=[a,b].map(i=>({p:rest[i].toArray(),ix:[indices.getX(i),indices.getY(i),indices.getZ(i),indices.getW(i)].map(v=>BONE_NAMES[v]),w:[weights.getX(i),weights.getY(i),weights.getZ(i),weights.getW(i)]}));worst=Math.max(worst,ratio);if(ratio>3)over3++;edges++;}}
 }
 assert.ok(worst<4,`skin edge stretch ${worst}; ${over3}/${edges} edges over 3x: ${JSON.stringify(example)}`);
 for(const motion of ['stand','sitStand','grip'])for(let i=0;i<30;i++){
  rig.poseTask(motion,i/3);for(const v of feet)assert.ok(rig.transform(v.point,v.w).y>-.008);
 }
});
test('task effort, synthetic EMG and exported phase use the same experiment clock',()=>{
 const p={...defaults,motion:'grip',motionStartedAt:20};const hold=[],rest=[];
 for(let i=0;i<500;i++){hold.push(sample(23.1+i/500,p).EMG);rest.push(sample(25.7+i/500,p).EMG)}
 const rms=a=>Math.sqrt(a.reduce((s,v)=>s+v*v,0)/a.length);assert.ok(rms(hold)>rms(rest)*10);
 const rows=csv(p,1,20,23).split('\n');assert.ok(rows[0].endsWith('motion,task_elapsed_s,task_stage,repetition,grip_fraction,effort_envelope'));assert.ok(rows.slice(1).every(r=>r.split(',').length===rows[0].split(',').length));
 const first=rows[1].split(',');assert.equal(first.at(-6),'grip');near(Number(first.at(-5)),3);near(Number(first.at(-2)),taskState('grip',3).grip,1e-5);
});
