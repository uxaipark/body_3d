import test from'node:test';import assert from'node:assert/strict';import{NodeIO}from'@gltf-transform/core';import{ALL_EXTENSIONS}from'@gltf-transform/extensions';import draco from'draco3dgltf';import *as T from'three';import{ribCagePlanes}from'../lib/rib-cage-data.js';
test('maximum inspiration stays inside the rib envelope and exhalation has more clearance',async()=>{
 const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco.createDecoderModule()}),doc=await io.read('public/models/visceral-web.glb');let count=0,restClearance=0,fullClearance=0;
 for(const n of doc.getRoot().listNodes()){
  if(!n.getMesh()||!/lung|bronch/i.test(n.getName()))continue;const m=new T.Matrix4().fromArray(n.getWorldMatrix());
  for(const p of n.getMesh().listPrimitives()){
   const a=p.getAttribute('POSITION'),b=p.getAttribute('_LUNG_INHALE');assert.ok(b,n.getName());assert.equal(a.getCount(),b.getCount());
   for(let i=0;i<a.getCount();i++){
    const rest=new T.Vector3().fromArray(a.getArray(),i*3).applyMatrix4(m),full=new T.Vector3().fromArray(b.getArray(),i*3).applyMatrix4(m);let restGap=Infinity,fullGap=Infinity;
    for(const [x,y,z,d]of ribCagePlanes){restGap=Math.min(restGap,d-x*rest.x-y*rest.y-z*rest.z);fullGap=Math.min(fullGap,d-x*full.x-y*full.y-z*full.z)}
    assert.ok(fullGap>.0075,`${n.getName()} inspired vertex outside cage: ${fullGap}`);assert.ok(restGap>.0075);restClearance+=restGap;fullClearance+=fullGap;count++;
   }
  }
 }
 assert.ok(count>10000);assert.ok(restClearance/count>fullClearance/count+.001);
});
