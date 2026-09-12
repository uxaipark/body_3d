import test from 'node:test';
import assert from 'node:assert/strict';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import draco from 'draco3dgltf';
import * as THREE from 'three';

test('exported fat and dermis stay within millimetres of the original body, including their inner walls',async()=>{
 const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco.createDecoderModule()});
 const read=layer=>io.read(new URL(`../public/models/${layer}-web.glb`,import.meta.url).pathname);
 const skin=await read('skin'),bounds=new THREE.Box3();
 for(const n of skin.getRoot().listNodes()){
  if(n.getName()!=='Male skin'||!n.getMesh())continue;
  const m=new THREE.Matrix4().fromArray(n.getWorldMatrix());
  for(const p of n.getMesh().listPrimitives()){
   const a=p.getAttribute('POSITION').getArray();
   for(let i=0;i<a.length;i+=3)bounds.expandByPoint(new THREE.Vector3().fromArray(a,i).applyMatrix4(m));
  }
 }
 assert.ok(!bounds.isEmpty());
 for(const [layer,maxThickness]of [['dermis',.0016],['adipose',.0156]]){
  const doc=await read(layer),limit=bounds.clone().expandByScalar(maxThickness+.0003);
  let count=0;const tissueBounds=new THREE.Box3();
  for(const n of doc.getRoot().listNodes()){
   if(!n.getMesh())continue;const m=new THREE.Matrix4().fromArray(n.getWorldMatrix());
   for(const p of n.getMesh().listPrimitives()){
    const a=p.getAttribute('POSITION').getArray();
    for(let i=0;i<a.length;i+=3){
     const v=new THREE.Vector3().fromArray(a,i).applyMatrix4(m);
     assert.ok(v.toArray().every(Number.isFinite));
     assert.ok(limit.containsPoint(v),`${layer} spike at ${v.toArray()}`);
     tissueBounds.expandByPoint(v);count++;
    }
   }
  }
  assert.ok(count>100000,'both sides of the tissue shell must be present');
  assert.ok(tissueBounds.getSize(new THREE.Vector3()).y>1.69,'shell covers the full body');
 }
});
