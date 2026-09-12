import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import crypto from 'node:crypto';import *as T from 'three';import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';import draco from 'draco3dgltf';
import {HumanRig,surfaceFootSupport,BONE_NAMES} from '../lib/rig.ts';import {chair,aboveSeat} from '../lib/chair.js';import {seatSourceHash} from '../lib/seat-support.js';
test('actual buttock and thigh exterior stays above the seat throughout lowering, rising and replay',async()=>{
 const file='public/models/skin-atlas-web.glb';assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),seatSourceHash,'regenerate contact witnesses when the exterior changes');
 const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco.createDecoderModule()}),doc=await io.read(file),primitive=doc.getRoot().listMeshes()[0].listPrimitives()[0];
 const pos=new T.BufferAttribute(primitive.getAttribute('POSITION').getArray(),3),ix=new T.BufferAttribute(primitive.getAttribute('_RIG_INDEX').getArray(),4),weights=new T.BufferAttribute(primitive.getAttribute('_RIG_WEIGHT').getArray(),4);
 const g=new T.BufferGeometry().setAttribute('position',pos).setAttribute('rigIndex',ix).setAttribute('rigWeight',weights),points=[],rig=new HumanRig();rig.floorSamples=surfaceFootSupport(g);
 for(let i=0;i<pos.count;i++){const point=new T.Vector3().fromBufferAttribute(pos,i);if(point.y>.58&&point.y<1.1&&Math.abs(point.x)<.24)points.push({point,w:{indices:[ix.getX(i),ix.getY(i),ix.getZ(i),ix.getW(i)],weights:[weights.getX(i),weights.getY(i),weights.getZ(i),weights.getW(i)]}});}
 let nearest=Infinity,maximumSeatGap=0;
 const check=label=>{
  let min=Infinity;for(const sample of points){const p=rig.transform(sample.point,sample.w);if(aboveSeat(p.x,p.z))min=Math.min(min,p.y);}
  nearest=Math.min(nearest,min);assert.ok(min>=chair.seatTop+.0005,`${label}: seat penetration ${chair.seatTop-min}`);
  for(const side of ['l','r']){const foot=rig.bone(`foot.${side}`).getWorldPosition(new T.Vector3()),bind=rig.bind[BONE_NAMES.indexOf(`foot.${side}`)];assert.ok(Math.abs(foot.x-bind.x)<1e-5&&Math.abs(foot.z-bind.z)<1e-5,'contact must not slide the feet');}
  return min;
 };
 for(const motion of ['stand','sitStand'])for(let i=0;i<=135;i++){
  rig.poseTask(motion,i/15);const low=check(`${motion} ${i/15}`);if(i/15>=2&&i/15<=3.7)maximumSeatGap=Math.max(maximumSeatGap,low-chair.seatTop);
 }
 assert.ok(nearest<chair.seatTop+.006,'seated skin should actually meet the seat');assert.ok(maximumSeatGap<.006,'a seated body must not hover over the chair');
 // Restart from the seated pose while the chair is still visible.
 rig.poseTask('sitStand',2.5);rig.motion='sitStand';for(let i=0;i<60;i++){rig.update(1/60,'sitStand',1);check(`replay ${i}`);}
});
