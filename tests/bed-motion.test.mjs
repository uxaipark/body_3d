import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import crypto from 'node:crypto';import *as T from 'three';import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';import draco from 'draco3dgltf';
import {HumanRig,surfaceFootSupport,BONE_NAMES} from '../lib/rig.ts';import {bed,bedSurface,aboveBed} from '../lib/bed.js';import {bedSourceHash} from '../lib/bed-support.js';import {taskState} from '../lib/clinical-motion.js';import {defaults,csv} from '../lib/physiology.ts';
const near=(a,b,tol=1e-5)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
test('bed transfer preserves limb lengths, faces upward at rest, passes through a true side-lying pose, extends legs and holds supine',()=>{
 const rig=new HumanRig();let previous;
 for(let i=0;i<=1320;i++){
  const t=i/60;rig.poseBed(t);
  for(const side of ['l','r'])for(const [parent,child]of [['thigh','shin'],['shin','foot'],['upperArm','forearm'],['forearm','hand']]){
   const a=rig.bone(`${parent}.${side}`),b=rig.bone(`${child}.${side}`);near(a.getWorldPosition(new T.Vector3()).distanceTo(b.getWorldPosition(new T.Vector3())),b.position.length());
  }
  const p=rig.bone('head').getWorldPosition(new T.Vector3());if(previous)assert.ok(p.distanceTo(previous)<.04,`head jumps at ${t}`);previous=p;
  assert.ok(rig.bones[0].position.y<.94,'contact must not catapult the body above standing height');
 }
 rig.poseBed(14);const hold=rig.bones.map(b=>b.matrixWorld.clone());const normal=new T.Vector3(0,0,1).applyQuaternion(rig.bone('head').getWorldQuaternion(new T.Quaternion()));assert.ok(normal.y>.99);
 rig.poseBed(24);rig.bones.forEach((b,i)=>b.matrixWorld.elements.forEach((v,j)=>near(v,hold[i].elements[j])));
 assert.equal(taskState('lie',22).complete,true);assert.equal(taskState('lie',22).repetitions,1);
 rig.poseBed(22);assert.ok(new T.Vector3(0,0,1).applyQuaternion(rig.bone('head').getWorldQuaternion(new T.Quaternion())).y>.99);
 rig.poseBed(2.5);assert.ok(rig.bones[0].position.x<-.3);near(rig.bones[0].position.z,-1.2);assert.ok(new T.Vector3(0,0,1).applyQuaternion(rig.bone('head').getWorldQuaternion(new T.Quaternion())).x<-.99);
 rig.poseBed(7.3);const sideFace=new T.Vector3(0,0,1).applyQuaternion(rig.bone('head').getWorldQuaternion(new T.Quaternion()));assert.ok(sideFace.x<-.99);assert.ok(rig.bone('head').getWorldPosition(new T.Vector3()).z<rig.bones[0].position.z-.5);
 rig.poseBed(14);for(const side of ['l','r']){const hip=rig.bone(`thigh.${side}`).getWorldPosition(new T.Vector3()),knee=rig.bone(`shin.${side}`).getWorldPosition(new T.Vector3()),ankle=rig.bone(`foot.${side}`).getWorldPosition(new T.Vector3());assert.ok(knee.clone().sub(hip).angleTo(ankle.clone().sub(knee))<.22,'both legs finish extended');}
});
test('full native skin clears the actual mattress and remains supported through the complete transfer',async()=>{
 const file='public/models/skin-atlas-web.glb';assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),bedSourceHash);
 const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco.createDecoderModule()}),doc=await io.read(file),primitive=doc.getRoot().listMeshes()[0].listPrimitives()[0];
 const p=new T.BufferAttribute(primitive.getAttribute('POSITION').getArray(),3),ix=new T.BufferAttribute(primitive.getAttribute('_RIG_INDEX').getArray(),4),w=new T.BufferAttribute(primitive.getAttribute('_RIG_WEIGHT').getArray(),4),g=new T.BufferGeometry().setAttribute('position',p).setAttribute('rigIndex',ix).setAttribute('rigWeight',w),points=[],rig=new HumanRig();rig.floorSamples=surfaceFootSupport(g);
 for(let i=0;i<p.count;i++)points.push({point:new T.Vector3().fromBufferAttribute(p,i),w:{indices:[ix.getX(i),ix.getY(i),ix.getZ(i),ix.getW(i)],weights:[w.getX(i),w.getY(i),w.getZ(i),w.getW(i)]}});
 let worst=Infinity;
 for(let i=0;i<=126;i++){
  const time=i/6,load=taskState('lie',time).recline;rig.poseBed(time);
  for(const sample of points){const v=rig.transform(sample.point,sample.w);assert.ok(v.y>-.008,'body penetrates floor');if(aboveBed(v.x,v.z)){const gap=v.y-bedSurface(v.x,v.z,load);worst=Math.min(worst,gap);assert.ok(gap>.0005,`mattress penetration at ${time}: ${gap} / ${sample.point.toArray()}`);}}
 }
 assert.ok(worst<.006,'support constraint must not leave the whole body hovering');
 rig.poseBed(14);const contacts={head:Infinity,back:Infinity,pelvis:Infinity,heels:Infinity};
 for(const s of points){const v=rig.transform(s.point,s.w);if(!aboveBed(v.x,v.z))continue;const region=s.point.y>1.5?'head':s.point.y>1.05?'back':s.point.y>.75?'pelvis':s.point.y<.13?'heels':null;if(region)contacts[region]=Math.min(contacts[region],v.y-bedSurface(v.x,v.z,1));}
 for(const [region,gap]of Object.entries(contacts))assert.ok(gap<.025,`${region} floats ${gap}m above support`);
});
test('bed task pauses and restarts on the shared clock and CSV records its phase',()=>{
 const rig=new HumanRig();for(let i=0;i<500;i++)rig.update(1/60,'lie',1);
 const before=rig.bones.map(b=>b.quaternion.toArray()),time=rig.taskTime;rig.update(0,'lie',1);near(rig.taskTime,time);rig.bones.forEach((b,i)=>assert.deepEqual(b.quaternion.toArray(),before[i]));
 const load=rig.bedLoad;rig.update(0,'lie',2);near(rig.bedLoad,load);rig.bones.forEach((b,i)=>assert.deepEqual(b.quaternion.toArray(),before[i]));
 const first=rig.bone('head').getWorldPosition(new T.Vector3());rig.update(1/60,'lie',2);assert.ok(rig.bone('head').getWorldPosition(new T.Vector3()).distanceTo(first)<.03);assert.ok(rig.taskTime<.02);
 const rows=csv({...defaults,motion:'lie',motionStartedAt:10},1,10,28).split('\n');assert.ok(rows[1].includes('lie,18.00000,누운 자세 · 안정 호흡'));
});
