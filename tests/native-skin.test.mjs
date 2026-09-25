import test from'node:test';import assert from'node:assert/strict';import *as T from'three';import{NodeIO}from'@gltf-transform/core';import{ALL_EXTENSIONS}from'@gltf-transform/extensions';import draco from'draco3dgltf';
import{HumanRig,BONE_NAMES,surfaceFootSupport,weightsAt}from'../lib/rig.ts';
import{expressionMocapData}from'../lib/expression-mocap-data.js';
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

test('actual baked skin separates torso and arm and does not form stretched sails in expression clips',async()=>{
 const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco.createDecoderModule()}),doc=await io.read('public/models/skin-atlas-web.glb'),p=doc.getRoot().listMeshes()[0].listPrimitives()[0];
 const positions=p.getAttribute('POSITION').getArray(),indices=p.getIndices().getArray(),ix=p.getAttribute('_RIG_INDEX').getArray(),w=p.getAttribute('_RIG_WEIGHT').getArray(),rig=new HumanRig();
 // Read the exact baked attributes used by AnatomyScene. Rebinding a copy here
 // would conceal a regression in the actual asset, as the previous test did.
 const points=Array.from({length:positions.length/3},(_,i)=>new T.Vector3().fromArray(positions,i*3)),weights=points.map((_,i)=>({indices:Array.from(ix.slice(i*4,i*4+4)),weights:Array.from(w.slice(i*4,i*4+4))}));
 const edges=[],seen=new Set();for(let f=0;f<indices.length;f+=3)for(let j=0;j<3;j++){const a=indices[f+j],b=indices[f+(j+1)%3],key=a<b?`${a}/${b}`:`${b}/${a}`;if(seen.has(key))continue;seen.add(key);if([points[a],points[b]].every(p=>p.y>.90&&p.y<1.4&&Math.abs(p.x)>.1))edges.push([a,b,points[a].distanceTo(points[b])]);}
 assert.ok(edges.length>1000);
 let maxEdge=0;
 for(const mode of ['wave','dance'])for(let f=0;f<32;f++){
  rig.poseExpression(mode,f/32*expressionMocapData[mode].duration);const posed=points.map((p,i)=>rig.transform(p,weights[i]));
  for(const [a,b,rest]of edges){const length=posed[a].distanceTo(posed[b]);maxEdge=Math.max(maxEdge,length);assert.ok(length<Math.max(.03,rest*3),`${mode}: edge ${points[a].toArray()} / ${points[b].toArray()} grew from ${rest} to ${length} m`);}
  for(let i=0;i<points.length;i+=10){const p=points[i];if(Math.abs(p.x)>.11&&Math.abs(p.x)<.145&&p.y>1.10&&p.y<1.28)assert.ok(posed[i].distanceTo(rig.transform(p,weightsAt(0,p.y,p.z)))<.001,'lateral torso follows raised arm');}
 }console.log({maxAxillaryEdge:maxEdge});rig.dispose();
});
