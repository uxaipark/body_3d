import test from'node:test';import assert from'node:assert/strict';import *as T from'three';import{NodeIO}from'@gltf-transform/core';import{ALL_EXTENSIONS}from'@gltf-transform/extensions';import draco from'draco3dgltf';
import{HumanRig,BONE_NAMES,surfaceFootSupport,bindGeometry}from'../lib/rig.ts';
import{registerSkinGeometry}from'../lib/skin-registration.js';
test('native atlas exterior has connected soles and arm-only distal bindings through gait',async()=>{
 const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco.createDecoderModule()}),doc=await io.read('public/models/skin-atlas-web.glb');
 assert.equal(doc.getRoot().listMeshes().length,1);
 const p=doc.getRoot().listMeshes()[0].listPrimitives()[0],positions=p.getAttribute('POSITION').getArray(),indices=p.getAttribute('_RIG_INDEX').getArray(),weights=p.getAttribute('_RIG_WEIGHT').getArray();
 const g=new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(positions,3)).setAttribute('rigIndex',new T.BufferAttribute(indices,4)).setAttribute('rigWeight',new T.BufferAttribute(weights,4));
 const rig=new HumanRig();rig.floorSamples=surfaceFootSupport(g);const feet=[],hands=[];
 for(let i=0;i<positions.length/3;i++){
  const point=new T.Vector3().fromArray(positions,i*3),w={indices:Array.from(indices.slice(i*4,i*4+4)),weights:Array.from(weights.slice(i*4,i*4+4))};
  assert.ok(Math.abs(w.weights.reduce((a,b)=>a+b,0)-1)<.001);
  if(point.y<.13)feet.push({point,w});
  if(point.y<1.15&&point.y>.68&&Math.abs(point.x)>.22){
   const side=point.x<0?'r':'l';for(let j=0;j<4;j++)if(w.weights[j]>.02)assert.match(BONE_NAMES[w.indices[j]],new RegExp(`^(upperArm|forearm|hand)\\.${side}$`));
   if(point.y<.80)hands.push({point,w});
  }
  if(Math.abs(point.x)<.02&&point.y>.78&&point.y<.92)assert.ok(w.weights[0]>.999&&w.indices[0]===0,'pelvic midline must stay intact');
 }
 assert.ok(feet.length>500&&hands.length>100);
 for(const run of[0,.5,1])for(let frame=0;frame<60;frame++){
  rig.pose(frame/60,1,run);
  for(const v of feet)assert.ok(rig.transform(v.point,v.w).y>-.008,'native toes penetrate ground');
  for(const v of hands)assert.ok(rig.transform(v.point,v.w).toArray().every(Number.isFinite));
 }
});

test('native axillary skin uses the torso envelope instead of arm-only bindings',async()=>{
 const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco.createDecoderModule()}),doc=await io.read('public/models/skin-atlas-web.glb'),p=doc.getRoot().listMeshes()[0].listPrimitives()[0],g=new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(p.getAttribute('POSITION').getArray().slice(),3)).setIndex(new T.BufferAttribute(p.getIndices().getArray().slice(),1));
 registerSkinGeometry(g);bindGeometry(g,undefined,true);const ix=g.getAttribute('rigIndex'),w=g.getAttribute('rigWeight');let seen=0;
 for(let i=0;i<ix.count;i++){const x=Math.abs(g.getAttribute('position').getX(i)),y=g.getAttribute('position').getY(i);if(x>.13&&x<.23&&y>1&&y<1.3){seen++;for(let j=0;j<4;j++)if(w.getComponent(i,j)>.01)assert.ok(BONE_NAMES[ix.getComponent(i,j)]!=='upperArm.l'&&BONE_NAMES[ix.getComponent(i,j)]!=='upperArm.r','axilla must not be arm-only');}}
 assert.ok(seen>100);g.dispose();
});
