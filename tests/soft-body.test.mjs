import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {SoftBody}from'../lib/soft-body.ts';
test('breathing moves lung, anterior vessels and abdominal wall through one non-inverting field',()=>{
 const body=new SoftBody();
 for(let i=0;i<300;i++){
  body.update(1/60,(1+Math.sin(i/60*2*Math.PI*.45))/2,1000);
  assert.ok(body.minimumVolumeRatio()>.85);
  for(const y of [1.03,1.20,1.32]){
   const points=[.09,.12,.14].map(z=>new THREE.Vector3(.07,y,z));
   const posed=points.map(p=>p.clone().add(body.sample(p)));
   assert.ok(posed[1].z-posed[0].z>.025);assert.ok(posed[2].z-posed[1].z>.016);
  }
 }
 assert.ok(body.sample(new THREE.Vector3(.06,1.03,.12)).length()>.001);
 assert.ok(body.positions.every(p=>p.toArray().every(Number.isFinite)));
});
test('pause freezes the tissue state and expiration returns to rest',()=>{
 const body=new SoftBody();for(let i=0;i<120;i++)body.update(1/60,1,500);
 const atPeak=body.displacement.map(v=>v.clone());body.update(0,0,500);assert.ok(atPeak.every((p,i)=>p.equals(body.displacement[i])));
 for(let i=0;i<180;i++)body.update(1/60,0,500);
 assert.ok(Math.max(...body.displacement.map(p=>p.length()))<1e-5);
});
test('fixed physics substeps agree across display frame rates',()=>{
 const a=new SoftBody(),b=new SoftBody();for(let i=0;i<120;i++)a.update(1/60,1,800);for(let i=0;i<60;i++)b.update(1/30,1,800);
 assert.ok(Math.max(...a.positions.map((p,i)=>p.distanceTo(b.positions[i])))<1e-7);
});
