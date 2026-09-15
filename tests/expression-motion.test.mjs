import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {HumanRig,BONE_NAMES} from '../lib/rig.ts';
import {expressionMocapData} from '../lib/expression-mocap-data.js';
import {motionOptions} from '../lib/clinical-motion.js';
import {defaults,sample} from '../lib/physiology.ts';
const pos=(rig,name)=>rig.bone(name).getWorldPosition(new T.Vector3());

test('greeting and dance are traceable finite CMU clips with rigid normalized bones',()=>{
 for(const [mode,id] of [['wave','141_16'],['dance','103_03']]){
  const clip=expressionMocapData[mode];assert.equal(clip.source,`CMU ${id}`);assert.match(clip.sha256,/^[a-f0-9]{64}$/);assert.ok(clip.frames.length>100);assert.ok(clip.sourceFrames[0]>0);
  const rig=new HumanRig(),lengths=rig.bones.map(b=>b.position.length());
  for(let i=0;i<clip.frames.length;i++){
   const frame=clip.frames[i];assert.equal(frame.length,3+BONE_NAMES.length*4);assert.ok(frame.every(Number.isFinite));
   rig.poseExpression(mode,i/clip.frames.length*clip.duration);
   rig.bones.forEach((b,j)=>{assert.ok(Math.abs(b.quaternion.length()-1)<1e-6);if(j)assert.ok(Math.abs(b.position.length()-lengths[j])<1e-10);assert.deepEqual(b.scale.toArray(),[1,1,1]);});
   for(const side of ['l','r']){const foot=rig.bone(`foot.${side}`),q=foot.getWorldQuaternion(new T.Quaternion()),p=pos(rig,foot.name);for(const z of [-.055,.145])assert.ok(new T.Vector3(0,-.073,z).applyQuaternion(q).add(p).y>=-1e-6);}
  }
  rig.dispose();
 }
});
test('hello raises the right hand with an outward palm, oscillates laterally and keeps the left arm down',()=>{
 const rig=new HumanRig(),clip=expressionMocapData.wave;let raised=0,outward=0,min=Infinity,max=-Infinity,reversals=0,lastX,lastSign=0;
 for(let i=0;i<clip.frames.length;i++){
  rig.poseExpression('wave',i/clip.frames.length*clip.duration);const right=pos(rig,'hand.r'),left=pos(rig,'hand.l');
  assert.ok(left.y<pos(rig,'upperArm.l').y-.3);
  if(right.y>pos(rig,'upperArm.r').y+.08){raised++;const normal=new T.Vector3(0,0,1).applyQuaternion(rig.bone('hand.r').getWorldQuaternion(new T.Quaternion()));if(normal.z>0)outward++;min=Math.min(min,right.x);max=Math.max(max,right.x);if(lastX!==undefined){const sign=Math.sign(right.x-lastX);if(lastSign&&sign&&lastSign!==sign)reversals++;lastSign=sign;}lastX=right.x;}
  for(const side of ['l','r'])assert.ok(pos(rig,`foot.${side}`).distanceTo(rig.bind[BONE_NAMES.indexOf(`foot.${side}`)])<.012);
 }
 assert.ok(raised>40);assert.ok(outward/raised>.85);assert.ok(max-min>.08);assert.ok(reversals>=3);
});
test('dance retains captured knees, torso rhythm and continuous loop seams',()=>{
 const rig=new HumanRig(),clip=expressionMocapData.dance;let minY=Infinity,maxY=-Infinity,maxFlex=0;
 for(let i=0;i<clip.frames.length;i++){rig.poseExpression('dance',i/clip.frames.length*clip.duration);minY=Math.min(minY,rig.bones[0].position.y);maxY=Math.max(maxY,rig.bones[0].position.y);for(const side of ['l','r'])maxFlex=Math.max(maxFlex,pos(rig,`shin.${side}`).sub(pos(rig,`thigh.${side}`)).angleTo(pos(rig,`foot.${side}`).sub(pos(rig,`shin.${side}`))));}
 assert.ok(maxY-minY>.025);assert.ok(maxFlex>.45);
 for(const mode of ['wave','dance']){const d=expressionMocapData[mode].duration;rig.poseExpression(mode,d-.0001);const before=rig.bones.map(b=>b.getWorldPosition(new T.Vector3()));rig.poseExpression(mode,.0001);rig.bones.forEach((b,j)=>assert.ok(b.getWorldPosition(new T.Vector3()).distanceTo(before[j])<.004));}
});
test('new motions blend into and out of existing poses without a one-frame jump; pause is exact',()=>{
 const rig=new HumanRig();for(const motion of ['walk','wave','dance','rest','sitStand','wave','lie','dance']){
  const before=rig.bones.map(b=>b.getWorldPosition(new T.Vector3()));rig.update(1/120,motion);rig.bones.forEach((b,j)=>assert.ok(b.getWorldPosition(new T.Vector3()).distanceTo(before[j])<.045,`${motion}/${b.name}`));
  for(let i=0;i<240;i++)rig.update(1/120,motion);
  const current=rig.bones.map(b=>b.matrixWorld.toArray());rig.update(0,motion);rig.bones.forEach((b,j)=>assert.deepEqual(b.matrixWorld.toArray(),current[j]));
 }
 for(const motion of ['wave','dance']){assert.ok(motionOptions.some(([id])=>id===motion));for(let i=0;i<100;i++)assert.ok(Object.values(sample(i/60,{...defaults,motion})).every(Number.isFinite));}
});
