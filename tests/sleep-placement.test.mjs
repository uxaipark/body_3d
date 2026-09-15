import test from'node:test';import assert from'node:assert/strict';import *as T from'three';
import{defaultPatchGeometry,heartCenter,bipolarPotential,cardiacLead,patchCoupling,accelerometer,patchFrame}from'../lib/sleep/sensing.js';import{updateEcgDerived,measuredHeartRate}from'../lib/sleep/ecg-derived.js';import{HumanRig}from'../lib/rig.ts';import{poseSupportedSleep}from'../lib/sleep/posture.ts';import{bedSurface,worldToBed,aboveBed}from'../lib/bed.js';
const translate=(g,d)=>({electrodes:g.electrodes.map(p=>p.map((v,i)=>v+d[i])),up:g.up.map((v,i)=>v+d[i])});
test('ECG follows an electrical lead field, preserving voltage units and conductor scaling',()=>{
 const e=defaultPatchGeometry.electrodes,m=[.00005,-.00008,.00001],v=bipolarPotential(e,heartCenter,m,.2);assert.notEqual(v,0);assert.ok(Math.abs(bipolarPotential(e,heartCenter,m,.4)-v/2)<1e-10);assert.ok(Math.abs(bipolarPotential([...e].reverse(),heartCenter,m,.2)+v)<1e-10);
 const p=[.4,.68].map(t=>cardiacLead(t,.5,[0,0,0])),other=translate(defaultPatchGeometry,[.05,.08,0]),q=[.4,.68].map(t=>cardiacLead(t,.5,[0,0,0],other));assert.ok(Math.abs(p[0]-q[0])>.05);assert.ok(Math.abs(p[1]/p[0]-q[1]/q[0])>.02,'lead movement changes morphology as well as gain');
});
test('CAP coupling depends on actual lung footprint, abdominal effort, pad location and fat',()=>{
 const chest=translate(defaultPatchGeometry,[.05,.18,-.03]),remote=translate(defaultPatchGeometry,[.30,-.05,0]),a=patchCoupling(chest),b=patchCoupling(remote);assert.ok(a[1].gain>b[1].gain*10);assert.ok(a.every(c=>c.direct<c.lung),'deep direct dielectric sensitivity must attenuate');assert.ok(patchCoupling(chest,20)[1].gain<patchCoupling(chest,3)[1].gain);assert.notEqual(a[0].gain,a[2].gain);
});
test('ACC returns all three sensor-frame axes and proper gravitational magnitude',()=>{
 const frame=patchFrame(defaultPatchGeometry);for(const axis of frame)assert.ok(Math.abs(Math.hypot(...axis)-1)<1e-12);for(const roll of[0,1.2,-1.2]){const a=accelerometer(defaultPatchGeometry,roll,0,0,0,0,0,()=>0);assert.ok(Math.abs(Math.hypot(...a)-9.80665)<1e-8);}const v=accelerometer(defaultPatchGeometry,.8,.2,.1,.4,.3,.01,()=>.002);assert.equal(v.length,3);assert.ok(v.every(Number.isFinite));
});
test('ECG-derived respiration and HR work with independent, inverted acquired ECG, without physiological truth',()=>{
 for(const polarity of[1,-1]){const c={kind:'ecg'},values=[];for(let i=0;i<45*250;i++){const t=i/250,phase=t%1,s=polarity*(.15*Math.exp(-.5*((phase-.4)/.012)**2))+.09*Math.sin(t*2*Math.PI*.2),v=updateEcgDerived(c,s,t,.004);if(t>10)values.push({t,v});}assert.ok(Math.abs(measuredHeartRate([c],45)-60)<1);const crossings=values.filter((p,i)=>i&&p.v>0&&values[i-1].v<=0);assert.ok(crossings.length>=6);const period=(crossings.at(-1).t-crossings[0].t)/(crossings.length-1);assert.ok(Math.abs(period-5)<.2);assert.equal(measuredHeartRate([c],50),null);}
});
test('sleep turns preserve bone lengths, support the body and keep arms close without abrupt joint flips',()=>{
 const r=new HumanRig();let previous;for(let i=0;i<=240;i++){const roll=1.2*Math.sin(i/240*Math.PI*2);poseSupportedSleep(r,roll);
  for(const side of['l','r']){const p=n=>r.bone(`${n}.${side}`).getWorldPosition(new T.Vector3()),shoulder=p('upperArm'),elbow=p('forearm'),hand=p('hand');assert.ok(Math.abs(shoulder.distanceTo(elbow)-r.bone(`forearm.${side}`).position.length())<1e-7);assert.ok(Math.abs(elbow.distanceTo(hand)-r.bone(`hand.${side}`).position.length())<1e-7);if((side==='l'?1:-1)*roll<=0)assert.ok(hand.y<shoulder.y+.02,'upper arm rests down toward the body');else{const [hx,hz]=worldToBed(hand.x,hand.z,r.bedAnchor);assert.ok(hand.y-bedSurface(hx,hz,1)<.16,'lower arm reaches along the mattress');}assert.ok(elbow.clone().sub(shoulder).angleTo(hand.clone().sub(elbow))<.45,'relaxed, nearly extended elbows');}
  let minimum=Infinity;for(const s of r.bedSamples){const p=r.transform(s.point,s.w),[x,z]=worldToBed(p.x,p.z,r.bedAnchor);if(aboveBed(x,z))minimum=Math.min(minimum,p.y-bedSurface(x,z,1));}assert.ok(minimum>.0039&&minimum<.005,'body stays supported by mattress');if(previous)r.bones.forEach((b,j)=>assert.ok(b.quaternion.angleTo(previous[j])<.12));previous=r.bones.map(b=>b.quaternion.clone());
 }r.dispose();
});
