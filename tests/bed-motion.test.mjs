import {updateDeformedBounds} from '../lib/rig-view.ts';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import crypto from 'node:crypto';import *as T from 'three';import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';import draco from 'draco3dgltf';
import {HumanRig,surfaceFootSupport,BONE_NAMES} from '../lib/rig.ts';import {bed,bedSurface,aboveBed,worldToBed,bedToWorld} from '../lib/bed.js';import {bedSourceHash} from '../lib/bed-support.js';import {taskState} from '../lib/clinical-motion.js';import {defaults,csv} from '../lib/physiology.ts';
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
 rig.poseBed(2.5);assert.ok(rig.bones[0].position.z<-.3);near(rig.bones[0].position.x,0);assert.ok(new T.Vector3(0,0,1).applyQuaternion(rig.bone('head').getWorldQuaternion(new T.Quaternion())).z>.99);
 rig.poseBed(7.3);const sideFace=new T.Vector3(0,0,1).applyQuaternion(rig.bone('head').getWorldQuaternion(new T.Quaternion()));assert.ok(sideFace.z>.99);assert.ok(rig.bone('head').getWorldPosition(new T.Vector3()).x<rig.bones[0].position.x-.5);
 rig.poseBed(14);for(const side of ['l','r']){const hip=rig.bone(`thigh.${side}`).getWorldPosition(new T.Vector3()),knee=rig.bone(`shin.${side}`).getWorldPosition(new T.Vector3()),ankle=rig.bone(`foot.${side}`).getWorldPosition(new T.Vector3());assert.ok(knee.clone().sub(hip).angleTo(ankle.clone().sub(knee))<.22,'both legs finish extended');}
});
test('full native skin clears the actual mattress and remains supported through the complete transfer',async()=>{
 const file='public/models/skin-atlas-web.glb';assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),bedSourceHash);
 const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco.createDecoderModule()}),doc=await io.read(file),primitive=doc.getRoot().listMeshes()[0].listPrimitives()[0];
 const p=new T.BufferAttribute(primitive.getAttribute('POSITION').getArray(),3),ix=new T.BufferAttribute(primitive.getAttribute('_RIG_INDEX').getArray(),4),w=new T.BufferAttribute(primitive.getAttribute('_RIG_WEIGHT').getArray(),4),g=new T.BufferGeometry().setAttribute('position',p).setAttribute('rigIndex',ix).setAttribute('rigWeight',w),points=[],rig=new HumanRig();rig.floorSamples=surfaceFootSupport(g);
 for(let i=0;i<p.count;i++)points.push({point:new T.Vector3().fromBufferAttribute(p,i),w:{indices:[ix.getX(i),ix.getY(i),ix.getZ(i),ix.getW(i)],weights:[w.getX(i),w.getY(i),w.getZ(i),w.getW(i)]}});
 let worst=Infinity;
 for(let i=0;i<=126;i++){
  const time=i/6,load=taskState('lie',time).recline;rig.poseBed(time);const bounds=updateDeformedBounds(rig.bones,new T.Sphere());
  for(const sample of points){const v=rig.transform(sample.point,sample.w);assert.ok(v.distanceTo(bounds.center)<bounds.radius,'posed visibility bounds must enclose the full exterior');assert.ok(v.y>-.008,'body penetrates floor');const [x,z]=worldToBed(v.x,v.z,rig.bedAnchor);if(aboveBed(x,z)){const gap=v.y-bedSurface(x,z,load);worst=Math.min(worst,gap);assert.ok(gap>.0005,`mattress penetration at ${time}: ${gap} / ${sample.point.toArray()}`);}}
 }
 assert.ok(worst<.006,'support constraint must not leave the whole body hovering');
 rig.poseBed(14);const contacts={head:Infinity,back:Infinity,pelvis:Infinity,heels:Infinity,leftHand:Infinity,rightHand:Infinity};
 for(const s of points){const v=rig.transform(s.point,s.w);const [x,z]=worldToBed(v.x,v.z,rig.bedAnchor);if(!aboveBed(x,z))continue;const region=s.point.y>1.5?'head':s.point.y>1.05?'back':s.point.y>.75?'pelvis':s.point.y<.13?'heels':null;if(region)contacts[region]=Math.min(contacts[region],v.y-bedSurface(x,z,1));if(s.point.y>.66&&s.point.y<.84&&Math.abs(s.point.x)>.24){const side=s.point.x>0?'leftHand':'rightHand';contacts[side]=Math.min(contacts[side],v.y-bedSurface(x,z,1));}}
 for(const [region,gap]of Object.entries(contacts))assert.ok(gap<.025,`${region} floats ${gap}m above support`);
 rig.poseBed(2.5);let handGap=Infinity;
 for(const s of points){if(s.point.x>-.24||s.point.y>.84||s.point.y<.66)continue;const v=rig.transform(s.point,s.w),[x,z]=worldToBed(v.x,v.z,rig.bedAnchor);if(aboveBed(x,z))handGap=Math.min(handGap,v.y-bedSurface(x,z,rig.bedLoad));}
 assert.ok(handGap<.025,`supporting hand floats ${handGap}m over the bed while sitting`);
 rig.poseBed(12);let leftGap=Infinity;
 for(const s of points){if(s.point.x<.24||s.point.y>.84||s.point.y<.66)continue;const v=rig.transform(s.point,s.w),[x,z]=worldToBed(v.x,v.z,rig.bedAnchor);if(aboveBed(x,z))leftGap=Math.min(leftGap,v.y-bedSurface(x,z,rig.bedLoad));}
 assert.ok(leftGap<.025,`extended left hand floats ${leftGap}m when the roll ends`);


});
test('bed task pauses and restarts on the shared clock and CSV records its phase',()=>{
 const rig=new HumanRig();for(let i=0;i<500;i++)rig.update(1/60,'lie',1);
 const before=rig.bones.map(b=>b.quaternion.toArray()),time=rig.taskTime;rig.update(0,'lie',1);near(rig.taskTime,time);rig.bones.forEach((b,i)=>assert.deepEqual(b.quaternion.toArray(),before[i]));
 const load=rig.bedLoad;rig.update(0,'lie',2);near(rig.bedLoad,load);rig.bones.forEach((b,i)=>assert.deepEqual(b.quaternion.toArray(),before[i]));
 const first=rig.bone('head').getWorldPosition(new T.Vector3());rig.update(1/60,'lie',2);assert.ok(rig.bone('head').getWorldPosition(new T.Vector3()).distanceTo(first)<.03);assert.ok(rig.taskTime<.02);
 const rows=csv({...defaults,motion:'lie',motionStartedAt:10},1,10,28).split('\n');assert.ok(rows[1].includes('lie,18.00000,누운 자세 · 안정 호흡'));
});

test('bed joints retain hinge alignment and bounded angular speed without wrist or ankle flips',()=>{
 const rig=new HumanRig(),identity=new T.Quaternion();let previous;
 for(let i=0;i<=840;i++){
  const t=i/60;rig.poseBed(t);
  if(previous)rig.bones.forEach((b,j)=>assert.ok(b.quaternion.angleTo(previous[j])*60<2.5,`${b.name} rotates too abruptly at ${t}`));
  previous=rig.bones.map(b=>b.quaternion.clone());
  for(const side of ['l','r']){
   const shin=rig.bone(`shin.${side}`).quaternion;
   assert.ok(Math.hypot(shin.y,shin.z)<.04,`knee twists away from its hinge: ${side} at ${t}`);
   for(const [name,limit]of [['thigh',2.0],['shin',2.15],['upperArm',1.1],['forearm',2.2],['hand',1.15],['foot',.50]])assert.ok(rig.bone(`${name}.${side}`).quaternion.angleTo(identity)<limit,`${name}.${side} exceeds the authored rotation envelope at ${t}`);
   const hip=rig.bone(`thigh.${side}`).getWorldPosition(new T.Vector3()),knee=rig.bone(`shin.${side}`).getWorldPosition(new T.Vector3()),ankle=rig.bone(`foot.${side}`).getWorldPosition(new T.Vector3());
   assert.ok(knee.clone().sub(hip).angleTo(ankle.clone().sub(knee))<=2.101,'knee flexion stays below 121 degrees');
  }
 }
});

test('both arms are extended by side lying and remain down through the roll',()=>{
 const rig=new HumanRig();
 for(let i=432;i<=840;i++){
  rig.poseBed(i/60);
  for(const side of ['l','r']){const p=n=>rig.bone(`${n}.${side}`).getWorldPosition(new T.Vector3());
   const a=p('upperArm'),b=p('forearm'),c=p('hand');
   assert.ok(b.clone().sub(a).angleTo(c.clone().sub(b))<.36,'neither elbow remains at 90 degrees');
   const local=rig.bone('chest').matrixWorld.clone().invert();b.applyMatrix4(local);c.applyMatrix4(local);
   assert.ok(c.y<b.y-.20,'wrists extend toward the hips, without raised forearms');
  }
 }
 rig.poseBed(12);const before=rig.bones.map(b=>b.quaternion.clone());rig.poseBed(14);
 for(const side of ['l','r'])for(const part of ['upperArm','forearm','hand'])assert.ok(rig.bone(`${part}.${side}`).quaternion.angleTo(before[BONE_NAMES.indexOf(`${part}.${side}`)])<1e-6);
});

test('bed appears behind the current standing position without relocating or turning the patient',()=>{
 const rig=new HumanRig();rig.poseBed(0);near(rig.bones[0].position.x,0);near(rig.bones[0].position.z,rig.bind[0].z);
 const forward=new T.Vector3(0,0,1).applyQuaternion(rig.bones[0].quaternion);assert.ok(forward.z>.9999);
 for(const x of[-bed.width/2,bed.width/2])for(const z of[bed.centerZ-bed.depth/2,bed.centerZ+bed.depth/2])assert.ok(bedToWorld(x,z)[1]<rig.bind[0].z-.2,'all mattress corners stay behind the standing patient');
 rig.reset();rig.bones[0].position.x=.17;rig.bones[0].position.z=.12;rig.bones[0].updateMatrixWorld(true);rig.update(0,'lie',1);near(rig.bedAnchor.x,.17);near(rig.bedAnchor.z,.135);rig.poseBed(0);near(rig.bones[0].position.x,.17);near(rig.bones[0].position.z,.12);
 const anchor=rig.bedAnchor.clone();rig.poseBed(14);rig.update(0,'lie',2);assert.deepEqual(rig.bedAnchor.toArray(),anchor.toArray(),'replay keeps the existing bed anchor');
});

test('sitting keeps the free arm down and uses a downward-facing supporting hand',()=>{
 const rig=new HumanRig();for(const t of[2,2.5,3]){rig.poseBed(t);const root=rig.bones[0].position,left=rig.bone('hand.l').getWorldPosition(new T.Vector3());assert.ok(left.y<root.y,'free hand stays below the pelvis while sitting');const normal=new T.Vector3(0,0,1).applyQuaternion(rig.bone('hand.r').getWorldQuaternion(new T.Quaternion()));assert.ok(normal.y<-.7,'supporting palm faces toward the mattress');}
});

test('left arm remains extended while lying down and is already resting when supine',()=>{
 const rig=new HumanRig();
 for(let i=0;i<=840;i++){
  rig.poseBed(i/60);const shoulder=rig.bone('upperArm.l').getWorldPosition(new T.Vector3()),elbow=rig.bone('forearm.l').getWorldPosition(new T.Vector3()),wrist=rig.bone('hand.l').getWorldPosition(new T.Vector3());
  assert.ok(elbow.clone().sub(shoulder).angleTo(wrist.clone().sub(elbow))<.36,'left elbow must not fold to a right angle');
  const local=rig.bone('chest').matrixWorld.clone().invert();elbow.applyMatrix4(local);wrist.applyMatrix4(local);assert.ok(wrist.y<elbow.y-.20,'left forearm stays extended toward the hip');
 }
 rig.poseBed(12);const rotations=['upperArm.l','forearm.l','hand.l'].map(n=>rig.bone(n).getWorldQuaternion(new T.Quaternion()));
 rig.poseBed(14);['upperArm.l','forearm.l','hand.l'].forEach((n,i)=>assert.ok(rig.bone(n).getWorldQuaternion(new T.Quaternion()).angleTo(rotations[i])<1e-6,'left arm has no post-roll raise-and-lower gesture'));
});
