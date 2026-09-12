import fs from 'node:fs';
import * as T from 'three';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import draco from 'draco3dgltf';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco.createDecoderModule()});
const output={ribs:[],vessels:[]};
for(const layer of ['skeleton','cardiovascular']){
 const doc=await io.read(layer==='cardiovascular'?'.asset-cache/cardiovascular-before-costal.glb':`public/models/${layer}-web.glb`);
 for(const node of doc.getRoot().listNodes()){
  if(!node.getMesh()||!(layer==='skeleton'?/rib|costal cartilage|sternum|xiphoid/i:/epigastric|musculophrenic|internal thoracic|lateral thoracic/i).test(node.getName()))continue;
  for(const primitive of node.getMesh().listPrimitives()){
   const a=primitive.getAttribute('POSITION').getArray(),m=new T.Matrix4().fromArray(node.getWorldMatrix()),positions=[];
   for(let i=0;i<a.length;i+=3)positions.push(new T.Vector3().fromArray(a,i).applyMatrix4(m).toArray());
   output[layer==='skeleton'?'ribs':'vessels'].push({name:node.getName(),positions,indices:Array.from(primitive.getIndices().getArray())});
  }
 }
}
fs.writeFileSync('/tmp/soma-vessel-contact.json',JSON.stringify(output));
