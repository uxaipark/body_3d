import test from 'node:test';import assert from 'node:assert/strict';import * as T from 'three';import {HumanRig} from '../lib/rig.ts';import {updateDeformedBounds,bedViewPoint,followBedView} from '../lib/rig-view.ts';
test('posed anatomy remains inside the camera frustum throughout bed close-ups',()=>{
 const rig=new HumanRig(),sphere=new T.Sphere(),frustum=new T.Frustum(),camera=new T.PerspectiveCamera(31,1.6,.003,30),matrix=new T.Matrix4();let obsoleteBoundsMisses=0;
 const standingOrganBounds=new T.Sphere(new T.Vector3(0,1.2,0),.35);
 for(const t of[0,2,4,6,8,10,12,14]){rig.poseBed(t);updateDeformedBounds(rig.bones,sphere);
  for(const bone of['pelvis','chest','head','hand.r','foot.l'])for(const distance of[.22,.3,.5,.8,1.2,2.5,4])for(const direction of[new T.Vector3(0,.25,1),new T.Vector3(1,.3,0),new T.Vector3(0,1,.01)]){
   const target=rig.bone(bone).getWorldPosition(new T.Vector3());camera.position.copy(target).addScaledVector(direction.clone().normalize(),distance);camera.lookAt(target);camera.updateMatrixWorld(true);matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);frustum.setFromProjectionMatrix(matrix);
   assert.ok(frustum.intersectsSphere(sphere),`anatomy culled at ${t}/${bone}/${distance}`);if(!frustum.intersectsSphere(standingOrganBounds))obsoleteBoundsMisses++;
  }
 }
 assert.ok(obsoleteBoundsMisses>0,'the old resting-organ bounds reproduce close-up culling');
});

test('bed zoom follows the trunk without changing viewing distance or user pan',()=>{
 const rig=new HumanRig(),camera=new T.PerspectiveCamera(),previous=new T.Vector3(),current=new T.Vector3(),pan=new T.Vector3(.03,0,0),offset=new T.Vector3(.05,.10,.22);
 rig.poseBed(0);bedViewPoint(rig.bone('pelvis'),rig.bone('chest'),previous);const target=previous.clone().add(pan);camera.position.copy(target).add(offset);
 for(let i=1;i<=840;i++){rig.poseBed(i/60);bedViewPoint(rig.bone('pelvis'),rig.bone('chest'),current);followBedView(camera,target,previous,current);assert.ok(target.distanceTo(current.clone().add(pan))<1e-8);assert.ok(camera.position.clone().sub(target).distanceTo(offset)<1e-8);}
});
