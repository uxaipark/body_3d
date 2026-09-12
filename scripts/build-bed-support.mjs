/** Native exterior witnesses for the bed support surface. Full mesh tests are independent. */
import fs from 'node:fs';import crypto from 'node:crypto';import *as T from 'three';import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';import draco from 'draco3dgltf';
import {HumanRig,surfaceFootSupport} from '../lib/rig.ts';import {aboveBed} from '../lib/bed.js';
const file='public/models/skin-atlas-web.glb',io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco.createDecoderModule()}),doc=await io.read(file),primitive=doc.getRoot().listMeshes()[0].listPrimitives()[0];
const p=new T.BufferAttribute(primitive.getAttribute('POSITION').getArray(),3),ix=new T.BufferAttribute(primitive.getAttribute('_RIG_INDEX').getArray(),4),w=new T.BufferAttribute(primitive.getAttribute('_RIG_WEIGHT').getArray(),4),g=new T.BufferGeometry().setAttribute('position',p).setAttribute('rigIndex',ix).setAttribute('rigWeight',w),rig=new HumanRig();rig.bedSamples=[];rig.floorSamples=surfaceFootSupport(g);
const candidates=[];for(let i=0;i<p.count;i++)candidates.push({point:new T.Vector3().fromBufferAttribute(p,i),w:{indices:[ix.getX(i),ix.getY(i),ix.getZ(i),ix.getW(i)],weights:[w.getX(i),w.getY(i),w.getZ(i),w.getW(i)]}});
const chosen=new Set();
for(let time=0;time<=21;time+=.5)for(const lift of [0,.07,.16]){
 rig.poseBed(time);rig.bones[0].position.y+=lift;rig.bones[0].updateMatrixWorld(true);rig.updatePalette();const cells=new Map();
 for(let i=0;i<candidates.length;i++){const c=candidates[i],v=rig.transform(c.point,c.w);if(!aboveBed(v.x,v.z))continue;const key=[Math.floor(v.x/.10),Math.floor(v.z/.10)].join(',');if(!cells.has(key)||cells.get(key).y>v.y)cells.set(key,{i,y:v.y});}
 for(const cell of cells.values())chosen.add(cell.i);
}
fs.writeFileSync('lib/bed-support.js','// Generated from native exterior by scripts/build-bed-support.mjs. Atlas asset licensing applies.\nexport const bedSourceHash='+JSON.stringify(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'))+';\nexport const bedSupport='+JSON.stringify([...chosen].map(i=>({point:candidates[i].point.toArray(),w:candidates[i].w})))+';\n');console.log(`${chosen.size} bed support witnesses`);
