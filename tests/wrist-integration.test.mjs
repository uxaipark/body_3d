import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {TwinEngine} from '../public/simulators/radial/js/engine.js';
import {WRIST_MECHANICS,radiusPerPressure,surfaceTransfer,WristRelaxation,surroundingDisplacement} from '../public/simulators/radial/js/wristMechanics.js';
import {atlasProfile,atlasArteryAt} from '../public/simulators/radial/js/atlasProfile.js';
import * as T from 'three';
import {HumanRig,BONE_NAMES} from '../lib/rig.ts';
import {Avatar} from '../public/simulators/radial/bridge/soma-bridge.js';
import {mocapData} from '../lib/mocap-data.js';
import {GAIT,PostureController} from '../public/simulators/radial/js/kinematics.js';

test('wrist acquisition clock uses the whole-body captured stride duration',()=>{
 assert.equal(GAIT.stride_Hz,1/mocapData.walk.duration);
 assert.equal(GAIT.cadence_Hz,2/mocapData.walk.duration);
 const posture=new PostureController();posture.setBodyPosture('walking');
 for(let i=0;i<120;i++){
  posture.update(mocapData.walk.duration/120);
  const expected=(posture.t/mocapData.walk.duration)%1;
  const difference=Math.abs(posture.torso.gaitPhase-expected);
  assert.ok(Math.min(difference,1-difference)<1e-10);
 }
});

test('walking wrist avatar preserves both captured arms and palm orientation across the complete stride',()=>{
 const rig=new HumanRig(),skinRig=new HumanRig(),reference=new HumanRig(),view={rig,skinRig,bodyBounds:new T.Sphere(),renderExternal(){},focus(){},
  uniforms:Object.fromEntries(['uLungInflation','uResp','uBeat','uCardiacCycles','uPulseGain'].map(k=>[k,{value:0}])),
  softBody:{update(){}},chair:{},bedGroup:{},controls:{update(){}},renderer:{render(){}}};
 const avatar=Object.create(Avatar.prototype);Object.assign(avatar,{view,lastTime:0,orbit:{},lastOrbit:'{}'});avatar.setBodyPosture('walking');
 let previous=null;
 for(let i=0;i<=120;i++){
  const phase=i/120;reference.pose(phase,1,0);
  // Even a lingering arm preset must not overwrite the walking right arm.
  avatar.update({shoulderAbd:95,elbowFlex:95,wristPron:30,wristFlex:20},{heart:.5},null,{walking:true,gaitPhase:phase},{t:phase,instantHR:72});
  const hands=[];
  for(const side of ['l','r'])for(const part of ['upperArm','forearm','hand']){
   const name=`${part}.${side}`,actual=rig.bone(name),expected=reference.bone(name);
   assert.ok(actual.quaternion.angleTo(expected.quaternion)<1e-6,`${name}: captured rotation was overwritten`);
   assert.ok(skinRig.bone(name).quaternion.angleTo(actual.quaternion)<1e-6,`${name}: skin pose differs`);
   if(part==='hand')hands.push(actual.getWorldPosition(new T.Vector3()));
  }
  if(previous)hands.forEach((p,j)=>assert.ok(p.distanceTo(previous[j])<.03,'wrist jumped between adjacent stride samples'));
  previous=hands;
 }
 avatar.setBodyPosture('standing');avatar.update({shoulderAbd:30,elbowFlex:95,wristPron:0,wristFlex:0},{heart:0},null,{walking:false,gaitPhase:0},{t:2,instantHR:72});
 assert.ok(Math.abs(rig.bone('forearm.r').rotation.x+95*Math.PI/180)<1e-8,'standing sensor arm control must remain active');
});

test('shipped wrist avatar holds a seated pelvis and bent knees with planted feet, then returns to standing',()=>{
 const rig=new HumanRig(),skinRig=new HumanRig(),view={rig,skinRig,bodyBounds:new T.Sphere(),renderExternal(){},focus(){},
  uniforms:Object.fromEntries(['uLungInflation','uResp','uBeat','uCardiacCycles','uPulseGain'].map(k=>[k,{value:0}])),
  softBody:{update(){}},chair:{visible:false},bedGroup:{visible:false},controls:{update(){}},renderer:{render(){}}};
 const avatar=Object.create(Avatar.prototype);Object.assign(avatar,{view,lastTime:0,orbit:{},lastOrbit:'{}'});
 const update=t=>avatar.update({shoulderAbd:30,elbowFlex:95,wristPron:0,wristFlex:0},{heart:.5},null,{walking:false,gaitPhase:0},{t,instantHR:72});
 avatar.setBodyPosture('standing');update(0);const standing=rig.bones[0].position.y;
 avatar.setBodyPosture('sitting');
 for(const t of [1,10,120]){
  update(t);assert.ok(standing-rig.bones[0].position.y>.25);assert.equal(view.chair.visible,true);assert.equal(view.bedGroup.visible,false);
  assert.ok(skinRig.bones[0].position.distanceTo(rig.bones[0].position)<1e-9);
  for(const side of ['l','r']){
   const p=name=>rig.bone(`${name}.${side}`).getWorldPosition(new T.Vector3()),hip=p('thigh'),knee=p('shin'),foot=p('foot');
   assert.ok(knee.clone().sub(hip).angleTo(foot.clone().sub(knee))>1.2);
   assert.ok(foot.distanceTo(rig.bind[BONE_NAMES.indexOf(`foot.${side}`)])<1e-8);
  }
 }
 avatar.setBodyPosture('standing');update(121);assert.ok(Math.abs(rig.bones[0].position.y-standing)<1e-8);assert.equal(view.chair.visible,false);
});

test('causal wrist relaxation has the analytic step response, no overshoot or repeated-sample drift',()=>{
 const r=new WristRelaxation(),tau=WRIST_MECHANICS.tau_s;
 for(let i=0;i<100;i++)r.step(0,i,.1,1000);
 const value=r.step(0,99,.1,1000);assert.ok(Math.abs(value-.1*(1-Math.exp(-.1/tau)))<1e-12);
 assert.equal(r.step(0,99,.8,1000),value);assert.ok(r.step(0,100,0,1000)<value);
});
test('radius law respects pressure units and inverse-square PWV; surrounding tissue has signed displacement',()=>{
 const dr=radiusPerPressure(6)*42;assert.ok(dr>.06&&dr<.09);assert.equal(radiusPerPressure(12),radiusPerPressure(6)/4);
 assert.ok(surfaceTransfer(0,4)>0);assert.ok(surfaceTransfer(25,4)<0);
 assert.ok(surroundingDisplacement(0,0,0,4,dr).vertical_mm>0);
 assert.ok(surroundingDisplacement(25,0,0,4,dr).vertical_mm<0);
});
test('atlas centreline is finite, interpolated, and actually used in the acquisition model',()=>{
 assert.ok(atlasProfile.length>=20);const e=new TwinEngine();
 for(let along=-100;along<=0;along+=.5){const a=atlasArteryAt(along),b=e.capArray.arteryAt(along,{lateral_mm:0,depth_mm:1});assert.ok(a.depth_mm>0&&Number.isFinite(a.surfaceY_mm));assert.equal(a.depth_mm,b.depth);assert.equal(a.lateral_mm,b.lateral);}
});
test('fat changes generated sensor channels; 16 kHz timestamps remain identical and tissue stays finite',()=>{
 const a=new TwinEngine(),b=new TwinEngine();b.capArray.tissueFat_mm=6;
 for(let i=0;i<160;i++){a.step(.016);b.step(.016);}
 assert.equal(a.totalSamples,40960);assert.equal(a.totalSamples,b.totalSamples);assert.equal(a.t,b.t);
 const delta=a.latest.capLast.some((v,i)=>Math.abs(v-b.latest.capLast[i])>1e-5);assert.ok(delta);
 for(const e of[a,b])for(const x of e.latest.tissue.displacement_mm)assert.ok(Number.isFinite(x)&&Math.abs(x)<1);
});
test('native wrist contains all 29 bones and named vessels, nerves and tendons, with no lower limb leakage',()=>{
 const m=JSON.parse(fs.readFileSync('public/models/wrist/manifest.json','utf8'));
 assert.equal(m.layers.skeleton.structures.length,29);
 assert.ok(m.layers.cardiovascular.structures.some(s=>s.startsWith('Radial artery.')));
 assert.ok(m.layers.muscular.structures.some(s=>s.startsWith('Flexor carpi radialis.')));
 for(const layer of Object.values(m.layers))assert.ok(layer.triangles>0);
 assert.ok(!JSON.stringify(m).match(/femur|tibia|fibula|phalanx of.*foot/i));
 assert.ok(WebAssembly.validate(fs.readFileSync('public/simulators/radial/js/analysis/dt_core.wasm')));
});
test('wrist mode adapter focuses the section and switches renderer visibility through S/T/A',async()=>{
 const {WristView}=await import('../public/simulators/radial/js/wristView.js');
 const view=Object.create(WristView.prototype),focused=[],native={ready:Promise.resolve(),setMode(){},group:{visible:true}};
 Object.assign(view,{_models:new Map([['0',native]]),renderer:{domElement:{style:{}}},section:{focus(mode){focused.push(mode);},resize(){}},sectionHost:{style:{}},_layoutSheet(){}});
 assert.equal(await view.setHandModel('S'),'S');assert.equal(view.renderer.domElement.style.display,'none');assert.equal(native.group.visible,false);
 assert.equal(await view.setHandModel('T'),'T');assert.deepEqual(focused,['full','top']);
 assert.equal(await view.setHandModel('A'),'A');assert.equal(view.sectionHost.style.display,'none');assert.equal(native.group.visible,true);
});
