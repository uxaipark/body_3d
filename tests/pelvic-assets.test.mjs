import test from 'node:test';
import assert from 'node:assert/strict';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import draco from 'draco3dgltf';
import * as THREE from 'three';
import {HumanRig,bindGeometry,pelvicOrgan} from '../lib/rig.ts';

test('actual genital meshes remain one rigid pelvic structure throughout locomotion',async()=>{
 const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco.createDecoderModule()});
 const doc=await io.read(new URL('../public/models/visceral-web.glb',import.meta.url).pathname);
 const points=[];let structures=0;
 for(const node of doc.getRoot().listNodes()){
  if(!node.getMesh()||!pelvicOrgan(node.getName()))continue;structures++;
  const world=new THREE.Matrix4().fromArray(node.getWorldMatrix());
  for(const primitive of node.getMesh().listPrimitives()){
   const a=primitive.getAttribute('POSITION').getArray();
   const geom=new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(new Float32Array(a),3)).applyMatrix4(world);
   bindGeometry(geom,pelvicOrgan(node.getName())?0:undefined);
   const indices=geom.getAttribute('rigIndex'),weights=geom.getAttribute('rigWeight');
   for(let i=0;i<a.length;i+=3){
    const v=new THREE.Vector3().fromArray(a,i).applyMatrix4(world);
    // Check actual organ extents, not a guessed midline above the genitalia.
    assert.equal(indices.getX(i/3),0,node.getName());assert.equal(weights.getX(i/3),1,node.getName());
    if(i%30===0)points.push(v);
   }
  }
 }
 assert.ok(structures>=7);assert.ok(points.some(p=>p.y<.75));
 const rig=new HumanRig();
 for(const run of [0,1])for(let frame=0;frame<32;frame++){
  rig.pose(frame/32,1,run);
  for(const p of points){
   const expected=p.clone().applyMatrix4(rig.skeleton.boneInverses[0]).applyMatrix4(rig.bones[0].matrixWorld);
   assert.ok(rig.transform(p,{indices:[0,0,0,0],weights:[1,0,0,0]}).distanceTo(expected)<1e-6);
  }
 }
});
