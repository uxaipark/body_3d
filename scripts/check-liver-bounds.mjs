import fs from'node:fs';import {NodeIO}from'@gltf-transform/core';import{ALL_EXTENSIONS}from'@gltf-transform/extensions';import draco from'draco3dgltf';import *as T from'three';import{hepaticPoint,isHepatic}from'../lib/hepatic.js';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco.createDecoderModule()});
const bones=await io.read('public/models/skeleton-web.glb'),organs=await io.read('public/models/visceral-web.glb');
const ribs={points:[],faces:[]},liver=[];
function extract(n){const m=new T.Matrix4().fromArray(n.getWorldMatrix());return n.getMesh().listPrimitives().map(p=>{const a=p.getAttribute('POSITION').getArray(),positions=[];for(let i=0;i<a.length;i+=3)positions.push(new T.Vector3().fromArray(a,i).applyMatrix4(m));return {positions,indices:Array.from(p.getIndices().getArray())};});}
for(const n of bones.getRoot().listNodes())if(n.getMesh()&&/rib|sternum|vertebra t/i.test(n.getName()))for(const g of extract(n)){const base=ribs.points.length;ribs.points.push(...g.positions.map(v=>v.toArray()));for(let i=0;i<g.indices.length;i+=3)ribs.faces.push(g.indices.slice(i,i+3).map(j=>j+base));}
for(const n of organs.getRoot().listNodes())if(n.getMesh()&&isHepatic(n.getName()))for(const g of extract(n))liver.push({name:n.getName(),indices:g.indices,rest:g.positions.map(p=>hepaticPoint(p,0).toArray()),inhale:g.positions.map(p=>hepaticPoint(p,1).toArray())});
fs.writeFileSync('/tmp/soma-liver-check.json',JSON.stringify({ribs,liver}));
