/** Bake small contact witnesses from the actual exterior, keeping runtime contact
 * inexpensive. Full-geometry regression tests independently check their coverage. */
import fs from 'node:fs';import crypto from 'node:crypto';import *as T from 'three';import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';import draco from 'draco3dgltf';
import {HumanRig,surfaceFootSupport} from '../lib/rig.ts';import {aboveSeat} from '../lib/chair.js';
const file='public/models/skin-atlas-web.glb',io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco.createDecoderModule()}),doc=await io.read(file),primitive=doc.getRoot().listMeshes()[0].listPrimitives()[0];
const p=new T.BufferAttribute(primitive.getAttribute('POSITION').getArray(),3),ix=new T.BufferAttribute(primitive.getAttribute('_RIG_INDEX').getArray(),4),w=new T.BufferAttribute(primitive.getAttribute('_RIG_WEIGHT').getArray(),4);
const g=new T.BufferGeometry().setAttribute('position',p).setAttribute('rigIndex',ix).setAttribute('rigWeight',w),rig=new HumanRig();rig.seatSamples=[];rig.floorSamples=surfaceFootSupport(g);
const candidates=[];
for(let i=0;i<p.count;i++){
 const point=new T.Vector3().fromBufferAttribute(p,i);if(point.y<.58||point.y>1.1||Math.abs(point.x)>.24)continue;
 candidates.push({point,w:{indices:[ix.getX(i),ix.getY(i),ix.getZ(i),ix.getW(i)],weights:[w.getX(i),w.getY(i),w.getZ(i),w.getW(i)]}});
}
const chosen=new Set();
for(const motion of ['stand','sitStand'])for(const time of [1,1.3,1.6,2,3,3.3,3.7,4,4.3,7.5,8,8.5])for(const lift of [0,.055,.11,.14]){
 rig.poseTask(motion,time);const targets=['l','r'].map(side=>rig.bone(`foot.${side}`).getWorldPosition(new T.Vector3()));rig.bones[0].position.y+=lift;rig.bones[0].updateMatrixWorld(true);for(let i=0;i<2;i++)rig.solveLeg(i?'r':'l',targets[i]);rig.bones[0].updateMatrixWorld(true);rig.updatePalette();
 const cells=new Map();for(let i=0;i<candidates.length;i++){const c=candidates[i],v=rig.transform(c.point,c.w);if(!aboveSeat(v.x,v.z))continue;const key=[Math.floor(v.x/.07),Math.floor(v.z/.07)].join(',');if(!cells.has(key)||cells.get(key).y>v.y)cells.set(key,{i,y:v.y});}
 for(const cell of cells.values())chosen.add(cell.i);
}
const support=[...chosen].map(i=>({point:candidates[i].point.toArray(),w:candidates[i].w}));
fs.writeFileSync('lib/seat-support.js','// Generated from the native exterior by scripts/build-seat-support.mjs. Atlas asset licensing applies.\nexport const seatSourceHash='+JSON.stringify(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'))+';\nexport const seatSupport='+JSON.stringify(support)+';\n');console.log(`${support.length} seat contact witnesses from ${candidates.length} exterior vertices`);
