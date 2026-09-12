import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {HumanRig,weightsAt,rigidBone,BONE_NAMES,bindGeometry}from'../lib/rig.ts';
const near=(a,b,tol=1e-6)=>assert.ok(Math.abs(a-b)<tol,`${a} ≠ ${b}`);
const rigid=(index)=>({indices:[index,0,0,0],weights:[1,0,0,0]});
test('rest is exactly the bind pose for skin and skeleton',()=>{
 const r=new HumanRig();r.pose(.23,0,0);
 for(const p of [[0,.8,.1],[.08,.438,0],[.28,.86,0],[0,1.6,.08]]){
  const v=new THREE.Vector3(...p);near(v.distanceTo(r.transform(v)),0);
 }
});
test('each long bone remains a rigid body through walking and running',()=>{
 const r=new HumanRig();for(const run of [0,1])for(let i=0;i<40;i++){
  r.pose(i/40,1,run);
  for(const name of ['thigh.l','shin.l','upperArm.r','forearm.r']){
   const index=BONE_NAMES.indexOf(name),a=r.bind[index].clone(),b=a.clone().add(new THREE.Vector3(.02,-.26,.03));
   near(a.distanceTo(b),r.transform(a,rigid(index)).distanceTo(r.transform(b,rigid(index))));
  }
  for(const side of ['l','r']){
   const hip=r.bone(`thigh.${side}`).getWorldPosition(new THREE.Vector3());
   const knee=r.bone(`shin.${side}`).getWorldPosition(new THREE.Vector3());
   const ankle=r.bone(`foot.${side}`).getWorldPosition(new THREE.Vector3());
   near(hip.distanceTo(knee),r.bone(`shin.${side}`).position.length());
   near(knee.distanceTo(ankle),r.bone(`foot.${side}`).position.length());
  }
 }
});
test('knees flex in swing; feet clear the floor and reach stance targets',()=>{
 const r=new HumanRig();for(const run of [0,1]){
  let maxFlex=0,maxLift=0;
  for(let i=0;i<100;i++){
   r.pose(i/100,1,run);const a=r.bone('thigh.l').getWorldPosition(new THREE.Vector3()),b=r.bone('shin.l').getWorldPosition(new THREE.Vector3()),c=r.bone('foot.l').getWorldPosition(new THREE.Vector3());
   const flex=a.clone().sub(b).negate().angleTo(c.clone().sub(b));maxFlex=Math.max(maxFlex,flex);maxLift=Math.max(maxLift,c.y-.073);
   assert.ok(c.y>=.073-1e-5,`ankle penetrates floor ${c.y}`);
   if(i/100<.62*(1-run)+.30*run){
    const angle=r.bone('foot.l').getWorldQuaternion(new THREE.Quaternion());
    const sole=[new THREE.Vector3(0,-.073,-.055),new THREE.Vector3(0,-.073,.145)].map(p=>p.applyQuaternion(angle).add(c));
    assert.ok(Math.min(...sole.map(p=>p.y))>=-1e-4);
   }
  }
  assert.ok(maxFlex>(run?1.45:.65));assert.ok(maxLift>(run?.23:.09));
 }
});
test('genital/perineal midline stays on a single pelvis across the whole gait',()=>{
 const r=new HumanRig();
 for(const y of [.79,.83,.88,.93])for(const x of [-.037,-.00001,0,.00001,.037]){
  const w=weightsAt(x,y,.09);assert.equal(w.indices[0],BONE_NAMES.indexOf('pelvis'));near(w.weights[0],1);
 }
 for(let i=0;i<30;i++){
  r.pose(i/30,1,1);const a=new THREE.Vector3(-.00001,.83,.10),b=new THREE.Vector3(.00001,.83,.10);
  near(r.transform(a).distanceTo(r.transform(b)),.00002);
 }
});
test('named skeleton assignment binds a whole bone to one transform, including both hip bones',()=>{
 for(const [name,center,expected] of [['Femur.l.001',[.08,.6,0],'thigh.l'],['Tibia.r.001',[-.08,.3,0],'shin.r'],['Hip bone.l.001',[.08,.9,0],'pelvis'],['Hip bone.r.001',[-.08,.9,0],'pelvis'],['Patella.l.001',[.08,.44,0],'patella.l']]){
  const index=rigidBone(name,new THREE.Vector3(...center));assert.equal(BONE_NAMES[index],expected);
  const g=new THREE.BoxGeometry(.04,.4,.03);bindGeometry(g,index);const w=g.getAttribute('rigWeight'),ix=g.getAttribute('rigIndex');
  for(let i=0;i<w.count;i++){near(w.getX(i),1);near(w.getY(i),0);assert.equal(ix.getX(i),index);}
 }
});
test('dual quaternion joint cross-sections keep volume under blended rotation',()=>{
 const r=new HumanRig();r.pose(.79,1,1);const w={indices:[BONE_NAMES.indexOf('thigh.l'),BONE_NAMES.indexOf('shin.l'),0,0],weights:[.5,.5,0,0]};
 const origin=new THREE.Vector3(.083,.438,-.027),axes=[new THREE.Vector3(.025,0,0),new THREE.Vector3(0,.025,0),new THREE.Vector3(0,0,.025)];
 const transformed=axes.map(v=>r.transform(origin.clone().add(v),w).sub(r.transform(origin,w)));
 near(Math.abs(transformed[0].dot(transformed[1].clone().cross(transformed[2]))),.025**3,1e-9);
});
test('weights are finite, normalized and at most four influences throughout the body',()=>{
 for(let x=-.35;x<=.35;x+=.023)for(let y=0;y<=1.8;y+=.027){
  const w=weightsAt(x,y,0);near(w.weights.reduce((a,b)=>a+b,0),1);assert.ok(w.weights.every(v=>Number.isFinite(v)&&v>=0));assert.equal(w.indices.length,4);
 }
});
test('hands hanging beside the groin follow arms, never the legs',()=>{
 for(const x of [-.308,.308]){
  const w=weightsAt(x,.724,.043);assert.equal(BONE_NAMES[w.indices[0]],x<0?'hand.r':'hand.l');near(w.weights[0],1);
 }
});
test('DQ palette and sensor transform agree with the actual bone world matrices',()=>{
 const r=new HumanRig();r.pose(.77,1,1);
 for(let i=0;i<BONE_NAMES.length;i++){
  const p=r.bind[i].clone().add(new THREE.Vector3(.02,-.07,.03));
  const expected=p.clone().applyMatrix4(r.skeleton.boneInverses[i]).applyMatrix4(r.bones[i].matrixWorld);
  near(expected.distanceTo(r.transform(p,rigid(i))),0,1e-6);
 }
});
test('ankles and toes never inherit pelvis or arm weights, even at the lateral edge',()=>{
 for(const x of [-.24,-.16,-.08,.08,.16,.24]){
  const w=weightsAt(x,.035,.13);assert.equal(BONE_NAMES[w.indices[0]],x<0?'foot.r':'foot.l');near(w.weights[0],1);
 }
});
test('walking and running palms face inward toward the torso',()=>{
 const r=new HumanRig();for(const run of [0,1])for(let i=0;i<40;i++){
  r.pose(i/40,1,run);
  for(const [side,sign] of [['l',1],['r',-1]]){
   const hand=r.bone(`hand.${side}`),q=hand.getWorldQuaternion(new THREE.Quaternion());
   const palm=new THREE.Vector3(0,0,1).applyQuaternion(q);
   assert.ok(palm.x*-sign>.8,`${side} palm faces outward at phase ${i/40}: ${palm.x}`);
  }
 }
});
test('the restored exterior does not double-rotate its already inward-facing palms',()=>{
 const r=new HumanRig();r.forearmRoll=0;
 // Palm-plane normals from the original MakeHuman metacarpal landmarks.
 for(const run of [0,1])for(let i=0;i<40;i++){
  r.pose(i/40,1,run);
  for(const [side,sign] of [['l',1],['r',-1]]){
   const n=new THREE.Vector3(-sign*.98094,-.04005,-.19014).normalize().applyQuaternion(r.bone(`hand.${side}`).getWorldQuaternion(new THREE.Quaternion()));
   // A captured forearm can cross the torso. Test inward-facing orientation
   // in its transverse plane, rather than requiring a fixed world-X angle.
   const q=r.bone(`hand.${side}`).getWorldQuaternion(new THREE.Quaternion());
   const axis=r.bone(`hand.${side}`).position.clone().normalize().applyQuaternion(q);
   const inward=new THREE.Vector3(-sign,0,0);inward.addScaledVector(axis,-inward.dot(axis)).normalize();
   assert.ok(n.dot(inward)>.85);
  }
 }
});

test('captured vertical motion moves pelvis, chest and head together',()=>{
 const rig=new HumanRig();
 for(const run of [0,1]){
  const ys={pelvis:[],chest:[],head:[]};
  for(let i=0;i<200;i++){
   rig.pose(i/200,1,run);
   for(const name of Object.keys(ys))ys[name].push(rig.bone(name).getWorldPosition(new THREE.Vector3()).y);
  }
  for(const [name,values]of Object.entries(ys)){
   const range=Math.max(...values)-Math.min(...values);
   assert.ok(range>(run?.05:.015)&&range<.13,`${name} vertical excursion ${range}`);
  }
 }
});

test('neck and head stay level through the whole gait and motion blends',()=>{
 const rig=new HumanRig(),q=new THREE.Quaternion();
 for(const amount of [0,.25,.5,1])for(const run of [0,.5,1])for(let i=0;i<120;i++){
  rig.pose(i/120,amount,run);
  for(const name of ['neck','head']){
   rig.bone(name).getWorldQuaternion(q);
   const right=new THREE.Vector3(1,0,0).applyQuaternion(q);
   near(right.y,0,1e-6);
   if(run===0)near(new THREE.Vector3(0,0,1).applyQuaternion(q).y,0,1e-6);
  }
  const neck=rig.bone('neck').getWorldPosition(new THREE.Vector3());
  const head=rig.bone('head').getWorldPosition(new THREE.Vector3());
  near(head.distanceTo(neck),rig.bone('head').position.length());
 }
});

test('replacement walking has balanced support, stride and clearance on both sides',()=>{
 const rig=new HumanRig(),stats={l:[],r:[]};
 for(let i=0;i<240;i++){
  rig.pose(i/240,1,0);
  for(const side of ['l','r']){
   const foot=rig.bone(`foot.${side}`),p=foot.getWorldPosition(new THREE.Vector3()),q=foot.getWorldQuaternion(new THREE.Quaternion());
   const low=Math.min(...[new THREE.Vector3(0,-.073,-.055),new THREE.Vector3(0,-.073,.145)].map(v=>v.applyQuaternion(q).add(p).y));
   stats[side].push({low,z:p.z});
  }
  assert.ok(Math.min(stats.l.at(-1).low,stats.r.at(-1).low)<1e-6);
 }
 const support=side=>stats[side].filter(p=>p.low<.01).length/240;
 const stride=side=>Math.max(...stats[side].map(p=>p.z))-Math.min(...stats[side].map(p=>p.z));
 for(const side of ['l','r'])assert.ok(support(side)>.5&&support(side)<.7);
 near(support('l'),support('r'),.01);near(stride('l'),stride('r'),.005);
});

test('rendered head motion suppresses capture jitter, including the loop seam',async()=>{
 const {mocapData}=await import('../lib/mocap-data.js');
 const rig=new HumanRig();
 for(const mode of ['walk','run']){
  const clip=mocapData[mode],n=clip.frames.length,dt=clip.duration/n,points=[];
  for(let i=0;i<n;i++){
   rig.pose(i/n,1,mode==='run'?1:0);
   points.push(rig.bone('head').getWorldPosition(new THREE.Vector3()));
  }
  const accelerations=points.map((p,i)=>points[(i+1)%n].clone().add(points[(i+n-1)%n]).addScaledVector(p,-2).length()/dt**2);
  const rms=Math.sqrt(accelerations.reduce((sum,a)=>sum+a*a,0)/n);
  // Before smoothing: RMS 13.65 / 32.02 m/s², peaks 61.85 / 89.04.
  assert.ok(rms<(mode==='walk'?5:12),`${mode} head acceleration RMS ${rms}`);
  assert.ok(Math.max(...accelerations)<26);
 }
});

test('captured cycles loop continuously and avoid abrupt foot orientation flips',async()=>{
 const {mocapData}=await import('../lib/mocap-data.js');
 for(const [mode,clip]of Object.entries(mocapData)){
  assert.match(clip.source,/CMU (35_01|09_01)/);assert.equal(clip.sha256.length,64);
  assert.ok(clip.duration>.6&&clip.duration<1.3);
  for(let i=0;i<clip.frames.length;i++){
   const a=clip.frames[i],b=clip.frames[(i+1)%clip.frames.length];
   assert.ok(Math.abs(a[1]-b[1])<.025);
   for(let k=3;k<a.length;k+=4){const qa=new THREE.Quaternion().fromArray(a,k),qb=new THREE.Quaternion().fromArray(b,k);near(qa.length(),1,1e-5);assert.ok(qa.angleTo(qb)<.32,`${mode} frame ${i} flips`);}
  }
  const rig=new HumanRig();rig.pose(1-.00001,1,mode==='run'?1:0);const before=rig.bones.map(b=>b.getWorldPosition(new THREE.Vector3()));rig.pose(.00001,1,mode==='run'?1:0);
  rig.bones.forEach((b,i)=>assert.ok(b.getWorldPosition(new THREE.Vector3()).distanceTo(before[i])<.001));
 }
});
test('captured running alternates contact and flight; blended modes never penetrate the floor',()=>{
 const rig=new HumanRig();let flight=0,contact=0;
 for(const run of [0,.25,.5,.75,1])for(let frame=0;frame<160;frame++){
  rig.pose(frame/160,1,run);let low=Infinity;
  for(const side of ['l','r']){
   const foot=rig.bone(`foot.${side}`),ankle=foot.getWorldPosition(new THREE.Vector3()),q=foot.getWorldQuaternion(new THREE.Quaternion());
   for(const p of [new THREE.Vector3(0,-.073,-.055),new THREE.Vector3(0,-.073,.145)])low=Math.min(low,p.applyQuaternion(q).add(ankle).y);
  }
  assert.ok(low>=-1e-6);
  if(run===1){if(low>.003)flight++;if(low<.001)contact++;}
 }
 assert.ok(flight>20&&contact>20);
});
test('exterior medial elbows follow the arm while adjacent waist vertices stay on the torso',()=>{
 for(const side of [-1,1]){
  const elbow=weightsAt(side*.175,1.09,0,true),waist=weightsAt(side*.14,1.0,0,true);
  assert.ok(elbow.indices.filter((id,i)=>elbow.weights[i]>.01).every(id=>/Arm|forearm/.test(BONE_NAMES[id])));
  assert.ok(waist.indices.filter((id,i)=>waist.weights[i]>.01).every(id=>/pelvis|spine/.test(BONE_NAMES[id])));
 }
});
