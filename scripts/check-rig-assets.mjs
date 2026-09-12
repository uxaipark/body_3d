// Offline GLB deformation for numerical and Blender asset inspection; no browser dependency.
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import draco from 'draco3dgltf';
import * as THREE from 'three';
import {HumanRig,rigidBone,pelvicOrgan,weightsAt,BONE_NAMES} from '../lib/rig.ts';
import assert from 'node:assert/strict';
import {muscleFrame,muscleTissue,tissueColors} from '../lib/muscle.ts';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco.createDecoderModule(),'draco3d.encoder':await draco.createEncoderModule()});
const rig=new HumanRig();
for(const [mode,phase,run] of [['walk',.8,0],['run',.75,1]]){
 rig.pose(phase,1,run);
 for(const layer of (process.argv.length>2?process.argv.slice(2):['skin','skeleton'])){
  rig.forearmRoll=['skin','dermis','adipose'].includes(layer)?0:Math.PI/2;rig.pose(phase,1,run);
  const doc=await io.read(`public/models/${layer}-web.glb`);let triangles=0,maxError=0;const counts={};
  for(const node of doc.getRoot().listNodes()){
   const original=node.getMesh();if(!original)continue;
   const mesh=original.clone();node.setMesh(mesh);const world=new THREE.Matrix4().fromArray(node.getWorldMatrix()),inverse=world.clone().invert();
   const box=new THREE.Box3();
   for(const p of original.listPrimitives()){const a=p.getAttribute('POSITION').getArray();for(let i=0;i<a.length;i+=3)box.expandByPoint(new THREE.Vector3().fromArray(a,i).applyMatrix4(world));}
   const rigidIndex=layer==='skeleton'?rigidBone(node.getName(),box.getCenter(new THREE.Vector3())):pelvicOrgan(node.getName())?0:undefined;
   if(rigidIndex!==undefined)counts[BONE_NAMES[rigidIndex]]=(counts[BONE_NAMES[rigidIndex]]||0)+1;
   for(const p0 of [...mesh.listPrimitives()]){
    const p=p0.clone();mesh.removePrimitive(p0).addPrimitive(p);const a=p.getAttribute('POSITION').getArray(),normal=p.getAttribute('NORMAL')?.getArray();
    const out=new Float32Array(a.length),normals=normal?new Float32Array(normal.length):null;
    if(layer==='muscular'){
     const geom=new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(new Float32Array(a),3)).applyMatrix4(world);
     muscleFrame(geom,node.getName());const f=geom.getAttribute('fiberCoord'),uv0=new Float32Array(f.count*2),uv1=new Float32Array(f.count*2);
     for(let j=0;j<f.count;j++){uv0[j*2]=f.getX(j);uv0[j*2+1]=f.getY(j);uv1[j*2]=f.getZ(j);}
     p.setAttribute('TEXCOORD_0',doc.createAccessor().setType('VEC2').setArray(uv0).setBuffer(p.getAttribute('POSITION').getBuffer()));
     p.setAttribute('TEXCOORD_1',doc.createAccessor().setType('VEC2').setArray(uv1).setBuffer(p.getAttribute('POSITION').getBuffer()));
     const tissue=muscleTissue(node.getName()),color=new THREE.Color(tissueColors[tissue]);
     p.setMaterial(doc.createMaterial(tissue).setBaseColorFactor([...color.toArray(),tissue==='fascia'?.13:1]).setAlphaMode(tissue==='fascia'?'BLEND':'OPAQUE').setMetallicFactor(0).setRoughnessFactor(tissue==='tendon'?.4:.57));
    }
    let firstIn,firstOut;
    for(let i=0;i<a.length;i+=3){
     const v=new THREE.Vector3().fromArray(a,i).applyMatrix4(world),w=rigidIndex===undefined?weightsAt(v.x,v.y,v.z):{indices:[rigidIndex,0,0,0],weights:[1,0,0,0]};
     const moved=rig.transform(v,w);assert.ok(moved.toArray().every(Number.isFinite));
     if(!firstIn){firstIn=v.clone();firstOut=moved.clone();}
     if(rigidIndex!==undefined)maxError=Math.max(maxError,Math.abs(v.distanceTo(firstIn)-moved.distanceTo(firstOut)));
     moved.clone().applyMatrix4(inverse).toArray(out,i);
     if(normal){const n=new THREE.Vector3().fromArray(normal,i).transformDirection(world);rig.transform(v.clone().add(n),w).sub(moved).transformDirection(inverse).toArray(normals,i);}
    }
    p.setAttribute('POSITION',p.getAttribute('POSITION').clone().setArray(out));if(normals)p.setAttribute('NORMAL',p.getAttribute('NORMAL').clone().setArray(normals));
    triangles+=(p.getIndices()?.getCount()||a.length/3)/3;
   }
  }
  assert.ok(maxError<1e-6);console.log(mode,layer,{triangles,maxRigidDistanceError:maxError,counts});
  await io.write(`/tmp/soma-${mode}-${layer}.glb`,doc);
 }
}
