import test from 'node:test';import assert from 'node:assert/strict';import *as T from 'three';
import{NodeIO}from'@gltf-transform/core';import{ALL_EXTENSIONS}from'@gltf-transform/extensions';import draco from'draco3dgltf';
import{HumanRig,weightsAt,BONE_NAMES}from'../lib/rig.ts';import{bindTissueGeometry}from'../lib/tissue-binding.ts';import{refineFlexibleTissue}from'../lib/flexible-tissue.ts';import{expressionMocapData}from'../lib/expression-mocap-data.js';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco.createDecoderModule()}),doc=await io.read('public/models/nervous-web.glb');
const meshes=new Map();for(const n of doc.getRoot().listNodes()){if(!n.getMesh()||!/brachial plexus|(?:median|ulnar|radial|axillary|musculocutaneous) nerve|anterior root of spinal nerve/i.test(n.getName()))continue;for(const p of n.getMesh().listPrimitives()){const g=new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(new Float32Array(p.getAttribute('POSITION').getArray()),3)).applyMatrix4(new T.Matrix4().fromArray(n.getWorldMatrix()));g.setIndex(new T.BufferAttribute(p.getIndices().getArray(),1));refineFlexibleTissue(g,n.getName());bindTissueGeometry(g,n.getName());const v=g.getAttribute('position'),ix=g.getAttribute('rigIndex'),w=g.getAttribute('rigWeight');meshes.set(n.getName(),Array.from({length:v.count},(_,i)=>({p:new T.Vector3().fromBufferAttribute(v,i),w:{indices:[0,1,2,3].map(j=>ix.getComponent(i,j)),weights:[0,1,2,3].map(j=>w.getComponent(i,j))}})));}}
test('cervical plexus roots remain attached to the neck during the complete greeting and jazz loops',()=>{
 const rig=new HumanRig(),roots=['l','r'].flatMap(side=>meshes.get(`Roots of brachial plexus.${side}.001`));assert.ok(roots.length>800);
 for(const vertex of roots)vertex.w.indices.forEach((id,j)=>{if(vertex.w.weights[j]>.0001)assert.ok(!/Arm|forearm|hand/.test(BONE_NAMES[id]));});
 for(const mode of ['wave','dance'])for(let f=0;f<expressionMocapData[mode].frames.length;f++){
  rig.poseExpression(mode,f/expressionMocapData[mode].frames.length*expressionMocapData[mode].duration);
  for(const vertex of roots)assert.ok(rig.transform(vertex.p,vertex.w).distanceTo(rig.transform(vertex.p,weightsAt(0,vertex.p.y,vertex.p.z)))<1e-6,'root pulled away from cervical anchor');
 }rig.dispose();
});
test('adjacent neural branches stay connected across mesh boundaries while the shoulder moves',()=>{
 const pairs=[['Roots of brachial plexus','Superior trunk of brachial plexus'],['Roots of brachial plexus','Middle trunk of brachial plexus'],['Roots of brachial plexus','Inferior trunk of brachial plexus'],['Superior trunk of brachial plexus','Posterior division of superior trunk of brachial plexus'],['Posterior division of superior trunk of brachial plexus','Posterior cord of brachial plexus'],['Posterior cord of brachial plexus','Axillary nerve'],['Posterior cord of brachial plexus','Radial nerve'],['Anterior division of inferior trunk of brachial plexus','Ulnar nerve']],rig=new HumanRig();
 for(const side of ['l','r'])for(const [from,to]of pairs){const a=meshes.get(`${from}.${side}.001`),b=meshes.get(`${to}.${side}.001`);assert.ok(a&&b);let distance=Infinity,pair;for(const v of a)for(const u of b){const d=v.p.distanceTo(u.p);if(d<distance){distance=d;pair=[v,u];}}assert.ok(distance<.02,`missing atlas junction ${from}/${to}: ${distance} m`);
  for(const mode of ['wave','dance'])for(let f=0;f<32;f++){rig.poseExpression(mode,f/32*expressionMocapData[mode].duration);const [v,u]=pair,moved=rig.transform(v.p,v.w).distanceTo(rig.transform(u.p,u.w));assert.ok(moved<distance+.006,`${from}/${to}: ${moved} m`);}
 }rig.dispose();
});
test('refinement preserves a closed tube, smooth normals and baked attributes with a bounded vertex budget',()=>{
 const g=new T.CylinderGeometry(.003,.003,.18,8,1);g.translate(-.21,1.09,0);const original=g.getAttribute('position').count;g.setAttribute('_rib_chest',new T.Float32BufferAttribute(Array(original).fill(.3),1));g.setAttribute('_rib_guard',new T.Float32BufferAttribute(Array.from({length:original},()=>[0,0,1,-.05]).flat(),4));refineFlexibleTissue(g,'Ulnar nerve.r.001');const p=g.getAttribute('position');assert.ok(p.count>original);assert.ok(p.count<original*35);assert.equal(g.getAttribute('_rib_chest').count,p.count);
 for(let i=0;i<p.count;i++){assert.ok(Math.abs(g.getAttribute('_rib_chest').getX(i)-.3)<1e-6);const normal=new T.Vector3().fromBufferAttribute(g.getAttribute('normal'),i);assert.ok(Math.abs(normal.length()-1)<1e-5);}
 // Weld only the original cylinder seam for the manifold check.
 const ids=new Map(),key=i=>[p.getX(i),p.getY(i),p.getZ(i)].map(v=>v.toFixed(6)).join('/'),edges=new Map();for(let i=0;i<p.count;i++){const k=key(i);if(!ids.has(k))ids.set(k,ids.size);}
 for(let i=0;i<g.index.count;i+=3)for(let j=0;j<3;j++){const a=ids.get(key(g.index.getX(i+j))),b=ids.get(key(g.index.getX(i+(j+1)%3))),k=a<b?`${a}/${b}`:`${b}/${a}`;edges.set(k,(edges.get(k)||0)+1);}assert.ok([...edges.values()].every(v=>v===2),'subdivision opened the nerve tube');g.dispose();
});
