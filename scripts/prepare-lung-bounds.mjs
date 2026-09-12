import fs from'node:fs';import {NodeIO}from'@gltf-transform/core';import{ALL_EXTENSIONS}from'@gltf-transform/extensions';import draco from'draco3dgltf';import *as T from'three';import{ConvexHull}from'three/addons/math/ConvexHull.js';
import {respiratoryPart}from'../lib/respiratory.js';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco.createDecoderModule()});
const cache='.asset-cache/visceral-before-lung-fit.glb';if(!fs.existsSync(cache))fs.copyFileSync('public/models/visceral-web.glb',cache);
const ribs=await io.read('public/models/skeleton-web.glb'),verts=[],faces=[];
for(const node of ribs.getRoot().listNodes()){
 if(!node.getMesh()||!/rib|sternum|vertebra t/i.test(node.getName()))continue;
 const m=new T.Matrix4().fromArray(node.getWorldMatrix());for(const p of node.getMesh().listPrimitives()){
  const a=p.getAttribute('POSITION').getArray(),base=verts.length;for(let i=0;i<a.length;i+=3)verts.push(new T.Vector3().fromArray(a,i).applyMatrix4(m).toArray());const ix=p.getIndices()?.getArray()||Array.from({length:a.length/3},(_,i)=>i);for(let i=0;i<ix.length;i+=3)faces.push([base+ix[i],base+ix[i+1],base+ix[i+2]]);
 }
}
const hull=new ConvexHull().setFromPoints(verts.map(v=>new T.Vector3(...v))),planes=hull.faces.map(f=>[...f.normal.toArray(),f.constant]);
const original=await io.read(cache),lungs=[];
for(const node of original.getRoot().listNodes()){
 if(!node.getMesh()||!respiratoryPart(node.getName()))continue;
 const m=new T.Matrix4().fromArray(node.getWorldMatrix());for(const [i,p]of node.getMesh().listPrimitives().entries()){
  const a=p.getAttribute('POSITION').getArray(),positions=[];for(let j=0;j<a.length;j+=3)positions.push(new T.Vector3().fromArray(a,j).applyMatrix4(m).toArray());lungs.push({name:node.getName(),primitive:i,positions,indices:Array.from(p.getIndices()?.getArray()||positions.map((_,i)=>i))});
 }
}
fs.writeFileSync('/tmp/soma-lung-input.json',JSON.stringify({verts,faces,planes,lungs}));console.log('rib vertices',verts.length,'hull planes',planes.length,'lung meshes',lungs.length);
