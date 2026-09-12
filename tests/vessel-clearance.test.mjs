import test from 'node:test';import assert from 'node:assert/strict';import * as T from 'three';
import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';import draco from 'draco3dgltf';
import {bindGeometry,HumanRig} from '../lib/rig.ts';
import {bindVesselClearance,constrainVessel} from '../lib/vessel-clearance.ts';

test('baked costal contacts stay chest-relative while remote abdominal branches retain their rig',async()=>{
 const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco.createDecoderModule()}),doc=await io.read('public/models/cardiovascular-web.glb');
 let protectedCount=0,remoteCount=0;const rig=new HumanRig();
 for(const node of doc.getRoot().listNodes()){
  if(!node.getMesh())continue;
  for(const p of node.getMesh().listPrimitives()){
   if(!p.getAttribute('_RIB_GUARD'))continue;
   const g=new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(p.getAttribute('POSITION').getArray(),3)).setAttribute('_rib_guard',new T.BufferAttribute(p.getAttribute('_RIB_GUARD').getArray(),4)).setAttribute('_rib_chest',new T.BufferAttribute(p.getAttribute('_RIB_CHEST').getArray(),1));
   g.applyMatrix4(new T.Matrix4().fromArray(node.getWorldMatrix()));bindGeometry(g);
   const oldWeights=g.getAttribute('rigWeight').array.slice(),chest=g.getAttribute('_rib_chest').array.slice();bindVesselClearance(g);
   const pos=g.getAttribute('position'),guard=g.getAttribute('ribGuard'),ix=g.getAttribute('rigIndex'),weight=g.getAttribute('rigWeight');
   for(let i=0;i<pos.count;i++){
    const plane=new T.Vector4().fromBufferAttribute(guard,i),normal=new T.Vector3(plane.x,plane.y,plane.z),point=new T.Vector3().fromBufferAttribute(pos,i);
    if(normal.lengthSq()<.5){if(chest[i]===0){remoteCount++;for(let j=0;j<4;j++)assert.ok(Math.abs(weight.getComponent(i,j)-oldWeights[i*4+j])<1e-6);}continue;}
    protectedCount++;assert.ok(Math.abs(normal.length()-1)<.001);assert.equal(ix.getX(i),2);assert.ok(weight.getX(i)>.999);
    assert.ok(normal.dot(point)-plane.w>-.00015,'rest vessel crosses its protection plane');
    const challenged=point.clone().addScaledVector(normal,-.03),safe=constrainVessel(challenged,plane);
    for(const run of[0,1]){rig.pose(.29,1,run);const w={indices:[2,0,0,0],weights:[1,0,0,0]},a=rig.transform(safe,w),b=rig.transform(point,w);assert.ok(Math.abs(a.distanceTo(b)-safe.distanceTo(point))<1e-6);}
   }
  }
 }
 assert.ok(protectedCount>4000);assert.ok(remoteCount>500);
});
