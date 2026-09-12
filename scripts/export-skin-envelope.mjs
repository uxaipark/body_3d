import fs from'node:fs';import *as T from'three';import{NodeIO}from'@gltf-transform/core';import{ALL_EXTENSIONS}from'@gltf-transform/extensions';import draco from'draco3dgltf';
import{bindGeometry,relaxSurfaceBinding}from'../lib/rig.ts';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco.createDecoderModule(),'draco3d.encoder':await draco.createEncoderModule()});
const doc=await io.read('public/models/skin-web.glb'),fits=JSON.parse(fs.readFileSync('/tmp/soma-skin-envelope-fitted.json','utf8'));
for(const f of fits){
 const n=doc.getRoot().listNodes().find(n=>n.getName()===f.name),p=n.getMesh().listPrimitives()[f.primitive],inverse=new T.Matrix4().fromArray(n.getWorldMatrix()).invert(),buffer=p.getAttribute('POSITION').getBuffer();
 const positions=new Float32Array(f.positions.flatMap(v=>new T.Vector3(...v).applyMatrix4(inverse).toArray()));
 p.setAttribute('POSITION',p.getAttribute('POSITION').clone().setArray(positions));
 for(const [name,array]of [['_SKIN_ARM_SIDE',f.arms],['_PELVIC_ANCHOR',f.pelvic]])p.setAttribute(name,doc.createAccessor().setType('SCALAR').setArray(new Float32Array(array)).setBuffer(buffer));
 const geometry=new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(positions,3)).setIndex(new T.BufferAttribute(p.getIndices().getArray(),1));geometry.computeVertexNormals();
 p.setAttribute('NORMAL',p.getAttribute('NORMAL').clone().setArray(geometry.getAttribute('normal').array));
 geometry.applyMatrix4(new T.Matrix4().fromArray(n.getWorldMatrix()));geometry.setAttribute('skinArmSide',new T.Float32BufferAttribute(f.arms,1));bindGeometry(geometry,undefined,true);
 for(let i=0;i<f.pelvic.length;i++)if(f.pelvic[i]){geometry.getAttribute('rigIndex').setXYZW(i,0,0,0,0);geometry.getAttribute('rigWeight').setXYZW(i,1,0,0,0);}
 relaxSurfaceBinding(geometry);
 for(const [key,attribute]of [['_RIG_INDEX','rigIndex'],['_RIG_WEIGHT','rigWeight']])p.setAttribute(key,doc.createAccessor().setType('VEC4').setArray(geometry.getAttribute(attribute).array).setBuffer(buffer));
}
await io.write('public/models/skin-fitted-web.glb',doc);console.log('Exported fitted skin with source topology and anatomical arm/pelvis anchors');
