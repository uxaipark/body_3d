import fs from'node:fs';import{NodeIO}from'@gltf-transform/core';import{ALL_EXTENSIONS}from'@gltf-transform/extensions';import draco from'draco3dgltf';import *as T from'three';import{HumanRig,BONE_NAMES}from'../lib/rig.ts';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco.createDecoderModule()});const doc=await io.read('public/models/skeleton-web.glb');const pairs=[];
for(const[file,name]of[['FMA24474.stl','Femur.r.001'],['FMA23130.stl','Humerus.r.001'],['FMA52788.stl','Parietal bone.r.001'],['FMA24477.stl','Tibia.r.001']]){
 const node=doc.getRoot().listNodes().find(n=>n.getName()===name),positions=[],m=new T.Matrix4().fromArray(node.getWorldMatrix());for(const p of node.getMesh().listPrimitives()){const a=p.getAttribute('POSITION').getArray();for(let i=0;i<a.length;i+=3)positions.push(new T.Vector3().fromArray(a,i).applyMatrix4(m).toArray());}pairs.push({file,positions});
}
const rig=new HumanRig(),bones=rig.bones.map((b,i)=>({name:BONE_NAMES[i],head:rig.bind[i].toArray(),parent:b.parent?.name||null}));
fs.writeFileSync('/tmp/soma-atlas-skin-reference.json',JSON.stringify({pairs,bones}));
