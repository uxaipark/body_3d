import fs from 'node:fs';
import * as T from 'three';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {draco} from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco3d.createDecoderModule(),'draco3d.encoder':await draco3d.createEncoderModule()});
const doc=await io.read('.asset-cache/cardiovascular-before-costal.glb'),buffer=doc.getRoot().listBuffers()[0];
const data=JSON.parse(fs.readFileSync('/tmp/soma-vessel-clearance.json','utf8'));
for(const node of doc.getRoot().listNodes()){
 const source=data.vessels.find(v=>v.name===node.getName());if(!source)continue;
 const inverse=new T.Matrix4().fromArray(node.getWorldMatrix()).invert();
 for(const p of node.getMesh().listPrimitives()){
  const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(source.positions.flat(),3)).setIndex(source.indices);
  g.applyMatrix4(inverse);g.computeVertexNormals();
  p.getAttribute('POSITION').setArray(g.getAttribute('position').array);
  p.getAttribute('NORMAL').setArray(g.getAttribute('normal').array);
  p.setAttribute('_RIB_GUARD',doc.createAccessor().setType('VEC4').setArray(new Float32Array(source.guard.flat())).setBuffer(buffer));
  p.setAttribute('_RIB_CHEST',doc.createAccessor().setType('SCALAR').setArray(new Float32Array(source.chestBinding)).setBuffer(buffer));
 }
}
doc.getRoot().setExtras({...doc.getRoot().getExtras(),vesselClearance:'Anterior thoracoabdominal vessels: atlas rib/cartilage contact planes, local tube translation, chest-relative contact; illustrative correction'});
await doc.transform(draco());await io.write('public/models/cardiovascular-web.glb',doc);
