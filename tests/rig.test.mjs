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
   assert.ok(n.x*-sign>.85);
  }
 }
});

test('pelvis, chest and head rise and fall twice per stride, with larger running excursion',()=>{
 const rig=new HumanRig();
 for(const run of [0,1]){
  const ys={pelvis:[],chest:[],head:[]};
  for(let i=0;i<200;i++){
   rig.pose(i/200,1,run);
   for(const name of Object.keys(ys))ys[name].push(rig.bone(name).getWorldPosition(new THREE.Vector3()).y);
  }
  for(const [name,values]of Object.entries(ys)){
   const range=Math.max(...values)-Math.min(...values);
   assert.ok(range>(run?.058:.035)&&range<.09,`${name} vertical excursion ${range}`);
  }
  // Lowest near weight transfer in walking, mid-contact compression in running.
  rig.pose(run?.15:.06,1,run);const low=rig.bone('pelvis').position.y;
  rig.pose(run?.40:.31,1,run);assert.ok(rig.bone('pelvis').position.y-low>(run?.058:.035));
 }
});

test('running flight has gravity acceleration and joins support without vertical velocity jumps',async()=>{
 const {gaitHeight}=await import('../lib/rig.ts');
 const cadence=1.5,dt=.00001,h=t=>gaitHeight(t*cadence,1);
 // 0.30..0.50 stride is flight, repeated after half a stride.
 for(const phase of [.34,.4,.46]){
  const t=phase/cadence;
  near((h(t+dt)-2*h(t)+h(t-dt))/(dt*dt),-9.81,.0001);
 }
 for(const phase of [0,.3,.5,.8,1]){
  const t=phase/cadence;
  const left=(h(t)-h(t-dt))/dt,right=(h(t+dt)-h(t))/dt;
  near(left,right,.001);
 }
});

test('running has a real flight interval with both soles clear of the floor',()=>{
 const rig=new HumanRig();
 for(const phase of [.33,.4,.47,.83,.9,.97]){
  rig.pose(phase,1,1);
  for(const side of ['l','r']){
   const foot=rig.bone(`foot.${side}`),ankle=foot.getWorldPosition(new THREE.Vector3()),q=foot.getWorldQuaternion(new THREE.Quaternion());
   for(const p of [new THREE.Vector3(0,-.073,-.055),new THREE.Vector3(0,-.073,.145)]){
    assert.ok(p.applyQuaternion(q).add(ankle).y>.0001);
   }
  }
 }
});
