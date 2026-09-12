import fs from'node:fs';import *as T from'three';import{NodeIO}from'@gltf-transform/core';import{ALL_EXTENSIONS}from'@gltf-transform/extensions';import draco from'draco3dgltf';
import{registerSkinPoint,skinArmMembership,skinTargets}from'../lib/skin-registration.js';
import{rigidBone,BONE_NAMES}from'../lib/rig.ts';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco.createDecoderModule()});
const tissue={body:{points:[],faces:[]},larm:{points:[],faces:[]},rarm:{points:[],faces:[]},lleg:{points:[],faces:[]},rleg:{points:[],faces:[]}};
for(const layer of['skeleton','muscular']){
 const doc=await io.read(`public/models/${layer}-web.glb`);
 for(const n of doc.getRoot().listNodes()){
  if(!n.getMesh())continue;const m=new T.Matrix4().fromArray(n.getWorldMatrix());
  for(const p of n.getMesh().listPrimitives()){
   const a=p.getAttribute('POSITION').getArray(),points=[];for(let i=0;i<a.length;i+=3)points.push(new T.Vector3().fromArray(a,i).applyMatrix4(m));
   const c=new T.Box3().setFromPoints(points).getCenter(new T.Vector3()),side=c.x<0?'r':'l';let region='body';
   if(layer==='skeleton'){
    const name=BONE_NAMES[rigidBone(n.getName().replaceAll('_',' '),c)];
    if(/Arm|forearm|hand/.test(name))region=side+'arm';else if(/thigh|shin|foot|toe|patella/.test(name))region=side+'leg';
   }else if(c.y>.65&&c.y<1.41&&Math.abs(c.x)>.155)region=side+'arm';else if(c.y<.98&&Math.abs(c.x)>.035)region=side+'leg';
   const g=tissue[region],base=g.points.length;g.points.push(...points.map(v=>v.toArray()));
   const ix=p.getIndices().getArray();for(let i=0;i<ix.length;i+=3)g.faces.push([base+ix[i],base+ix[i+1],base+ix[i+2]]);
  }
 }
}
const doc=await io.read('public/models/skin-web.glb'),meshes=[];
for(const n of doc.getRoot().listNodes()){
 if(!n.getMesh())continue;const m=new T.Matrix4().fromArray(n.getWorldMatrix());
 for(const [primitive,p]of n.getMesh().listPrimitives().entries()){
  const g=new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(p.getAttribute('POSITION').getArray().slice(),3)).setIndex(new T.BufferAttribute(p.getIndices().getArray().slice(),1)).applyMatrix4(m),a=g.getAttribute('position'),arms=skinArmMembership(g),positions=[],regions=[],pelvic=[];
  for(let i=0;i<a.count;i++){
   const source=new T.Vector3().fromBufferAttribute(a,i),v=registerSkinPoint(source,arms[i]),side=source.x<0?'r':'l';
   positions.push(v.toArray());pelvic.push(Math.abs(source.x)<.038&&source.y>.78&&source.y<.99?1:0);
   regions.push(arms[i]||source.y>1.23&&source.y<1.48&&Math.abs(source.x)>.145?side+'arm':source.y<.93&&Math.abs(source.x)>.038?side+'leg':'body');
  }
  meshes.push({name:n.getName(),primitive,positions,indices:Array.from(p.getIndices().getArray()),arms:Array.from(arms),regions,pelvic});
 }
}
fs.writeFileSync('/tmp/soma-skin-envelope-input.json',JSON.stringify({tissue,meshes,targets:skinTargets}));
console.log('Prepared',meshes.length,'exterior meshes; regional tissue triangles',Object.fromEntries(Object.entries(tissue).map(([k,g])=>[k,g.faces.length])));
