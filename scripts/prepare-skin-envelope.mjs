import fs from'node:fs';import *as T from'three';import{NodeIO}from'@gltf-transform/core';import{ALL_EXTENSIONS}from'@gltf-transform/extensions';import draco from'draco3dgltf';
import{registerSkinPoint,skinArmMembership}from'../lib/skin-registration.js';
// Use the same smooth CC0 source that generated the dermal/adipose shells.
// No regional rays: individual muscle/bone triangles must not emboss the skin.
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco.createDecoderModule()});
const doc=await io.read('public/models/skin-web.glb'),meshes=[];
for(const n of doc.getRoot().listNodes()){
 if(!n.getMesh())continue;const m=new T.Matrix4().fromArray(n.getWorldMatrix());
 for(const [primitive,p]of n.getMesh().listPrimitives().entries()){
  const g=new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(p.getAttribute('POSITION').getArray().slice(),3)).setIndex(new T.BufferAttribute(p.getIndices().getArray().slice(),1)).applyMatrix4(m),a=g.getAttribute('position'),arms=skinArmMembership(g),positions=[],sourcePositions=[],pelvic=[];
  for(let i=0;i<a.count;i++){
   const source=new T.Vector3().fromBufferAttribute(a,i);
   sourcePositions.push(source.toArray());positions.push(registerSkinPoint(source,arms[i]).toArray());
   pelvic.push(Math.abs(source.x)<.038&&source.y>.78&&source.y<.99?1:0);
  }
  meshes.push({name:n.getName(),primitive,positions,sourcePositions,indices:Array.from(p.getIndices().getArray()),arms:Array.from(arms),pelvic});
 }
}
fs.writeFileSync('/tmp/soma-skin-envelope-input.json',JSON.stringify({meshes}));
console.log('Prepared smooth tissue reference:',meshes.length,'meshes');
