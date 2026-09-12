import fs from'node:fs';import *as T from'three';import{NodeIO}from'@gltf-transform/core';import{ALL_EXTENSIONS}from'@gltf-transform/extensions';import draco from'draco3dgltf';import{isCardiacChamber,bindCardiacMotion,cardiacDisplacement}from'../lib/cardiac.ts';import{respiratoryPart}from'../lib/respiratory.js';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco.createDecoderModule()}),output={bones:[],lungs:[],hearts:[]};
for(const layer of['skeleton','visceral','cardiovascular']){
 const doc=await io.read(`public/models/${layer}-web.glb`);
 for(const n of doc.getRoot().listNodes()){
  if(!n.getMesh())continue;const name=n.getName();const category=layer==='skeleton'?'bones':layer==='visceral'&&respiratoryPart(name)?'lungs':layer==='cardiovascular'&&isCardiacChamber(name)?'hearts':null;if(!category)continue;
  const m=new T.Matrix4().fromArray(n.getWorldMatrix());
  for(const p of n.getMesh().listPrimitives()){
   const a=p.getAttribute('POSITION').getArray(),positions=[];for(let i=0;i<a.length;i+=3)positions.push(new T.Vector3().fromArray(a,i).applyMatrix4(m).toArray());
   const record={name,positions,indices:Array.from(p.getIndices().getArray())};
   if(category==='lungs'){const inhale=p.getAttribute('_LUNG_INHALE').getArray();record.inhale=[];for(let i=0;i<inhale.length;i+=3)record.inhale.push(new T.Vector3().fromArray(inhale,i).applyMatrix4(m).toArray());}
   if(category==='hearts'){const geometry=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(positions.flat(),3));bindCardiacMotion(geometry,name);const data=geometry.getAttribute('cardiacData');record.phases=[];for(let phase=0;phase<20;phase++)record.phases.push(positions.map((p,i)=>new T.Vector3(...p).add(cardiacDisplacement(new T.Vector3(...p),data.getX(i),data.getY(i),phase/20)).toArray()));}
   output[category].push(record);
  }
 }
}
fs.writeFileSync('/tmp/soma-cardiorespiratory-check.json',JSON.stringify(output));
