/** Extract approximate joint centres from adjacent atlas bone end surfaces.
 * Source and licensing remain those of public/models/skeleton-web.glb. */
import fs from 'node:fs';import * as T from 'three';import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';import draco from 'draco3dgltf';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco.createDecoderModule()}),doc=await io.read('public/models/skeleton-web.glb');
const words=['first','second','third','fourth','fifth'],segments={};
for(const n of doc.getRoot().listNodes()){
 const name=n.getName().toLowerCase();if(!name.includes('.r.')||!(/phalanx.*hand/.test(name)||/metacarpal/.test(name)))continue;
 const digit=words.findIndex(w=>name.includes(w)),part=name.includes('metacarpal')?'meta':name.split(' ')[0];
 const p=n.getMesh().listPrimitives()[0].getAttribute('POSITION'),m=new T.Matrix4().fromArray(n.getWorldMatrix()),points=[];
 for(let i=0;i<p.getCount();i++)points.push(new T.Vector3().fromArray(p.getElement(i,[])).applyMatrix4(m));
 const ys=points.map(v=>v.y),min=Math.min(...ys),max=Math.max(...ys);
 const end=upper=>{const selected=points.filter(v=>upper?v.y>max-(max-min)*.18:v.y<min+(max-min)*.18);return selected.reduce((s,v)=>s.add(v),new T.Vector3()).divideScalar(selected.length)};
 segments[`${digit}:${part}`]={prox:end(true),dist:end(false)};
}
const fingers=words.map((_,i)=>{const meta=segments[`${i}:meta`],prox=segments[`${i}:proximal`],dist=segments[`${i}:distal`],mid=segments[`${i}:middle`];const between=(a,b)=>a.clone().lerp(b,.5);const points=i===0?[meta.prox,between(meta.dist,prox.prox),between(prox.dist,dist.prox),dist.dist]:[between(meta.dist,prox.prox),between(prox.dist,mid.prox),between(mid.dist,dist.prox),dist.dist];return points.map(p=>p.toArray().map(v=>Number(v.toFixed(6))))});
fs.writeFileSync('lib/hand-landmarks.js','// Generated from atlas bone ends by scripts/build-hand-landmarks.mjs. Right hand; mirror X for left.\nexport const handLandmarks='+JSON.stringify(fingers)+';\n');
console.log('Extracted five joint chains from the atlas.');
