import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {decodeBodyGeometry} from '../lib/body-packed.ts';
import {chooseInitialQuality,readQualityPreference,qualitySettings} from '../lib/render-quality.ts';
import {waveformSample} from '../lib/wave-sample-cache.ts';
import {sample,defaults} from '../lib/physiology.ts';
import {bodySourceHash} from '../scripts/body-source-hash.mjs';

test('automatic defaults conservatively recognize constrained hardware; saved override wins',()=>{
 assert.equal(chooseInitialQuality(4,16),'low');assert.equal(chooseInitialQuality(16,4),'low');
 assert.equal(chooseInitialQuality(12,16),'balanced');assert.equal(chooseInitialQuality(),'balanced');
 assert.equal(qualitySettings.low.fps,30);
 for(const value of ['low','balanced','high','auto','corrupt']){
  globalThis.localStorage={getItem:()=>value};assert.equal(readQualityPreference(),value==='corrupt'?'auto':value);
 }delete globalThis.localStorage;
});
test('shared waveform cache preserves exact samples and responds to parameter changes',()=>{
 for(const site of ['wrist','chest','finger'])for(let t=0;t<4;t+=.013){
  const a=waveformSample(t,defaults,site,4);assert.deepEqual(a,sample(t,{...defaults,site}));
  assert.equal(waveformSample(t,defaults,site,4),a);
 }
 const p={...defaults,hr:120};assert.deepEqual(waveformSample(.7,p,'wrist',4),sample(.7,p));
});
test('shipped LOD assets retain attachment attributes and valid pick ranges',async()=>{
 const manifest=JSON.parse(await readFile('public/models/body/manifest.json','utf8'));
 assert.equal(manifest.source,await bodySourceHash());
 const load=async file=>{const bytes=await readFile('public/models/body/'+file);return decodeBodyGeometry(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength))};
 const skin=await load(manifest.parts.find(p=>p.layer==='skin').file),skinCount=skin.getAttribute('position').count;
 let low=0,high=0;
 for(const part of manifest.parts){
  low+=part.triangles;high+=part.detailTriangles??part.triangles;
  if(['skin','heart','lung','hepatic'].includes(part.part))assert.equal(part.detail,undefined);
  const g=await load(part.file),count=g.getAttribute('position').count;
  assert.equal(g.index.count/3,part.triangles);
  assert.equal(part.userData.ranges.at(-1).end,part.triangles);
  for(const i of g.index.array)assert.ok(i<count);
  if(part.layer==='nervous')for(const i of g.getAttribute('nerveSkinFace').array)assert.ok(i>=0&&i<skinCount);
  if(part.detail){const original=await load(part.detail);assert.equal(original.index.count/3,part.detailTriangles);
   // Simplification only removes vertices: never interpolate discrete skin anchor IDs.
   const names=Object.keys(g.attributes);assert.deepEqual(names,Object.keys(original.attributes));
   const key=(geometry,i)=>names.map(n=>{const a=geometry.getAttribute(n);return Array.from(a.array.slice(i*a.itemSize,(i+1)*a.itemSize)).join(',')}).join('|');
   const originals=new Set();for(let i=0;i<original.getAttribute('position').count;i++)originals.add(key(original,i));
   for(let i=0;i<count;i+=37)assert.ok(originals.has(key(g,i)),'LOD modified a binding');original.dispose();
  }g.dispose();
 }assert.ok(low<high*.4);skin.dispose();
});
