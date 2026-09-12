import test from'node:test';import assert from'node:assert/strict';import *as T from'three';import{cardiacSpaceDistance,applyCardiacClearance}from'../lib/cardiac-space.ts';import{isCardiacChamber,cardiacDisplacement,bindCardiacMotion}from'../lib/cardiac.ts';
import{NodeIO}from'@gltf-transform/core';import{ALL_EXTENSIONS}from'@gltf-transform/extensions';import draco from'draco3dgltf';
test('all moving cardiac chambers stay inside the pulmonary exclusion envelope',async()=>{
 const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco.createDecoderModule()}),doc=await io.read('public/models/cardiovascular-web.glb');let count=0;
 for(const n of doc.getRoot().listNodes())if(n.getMesh()&&isCardiacChamber(n.getName()))for(const p of n.getMesh().listPrimitives()){
  const g=new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(p.getAttribute('POSITION').getArray().slice(),3)).applyMatrix4(new T.Matrix4().fromArray(n.getWorldMatrix()));bindCardiacMotion(g,n.getName());const pos=g.getAttribute('position'),d=g.getAttribute('cardiacData');
  for(let i=0;i<pos.count;i+=5)for(let phase=0;phase<40;phase++)for(const breath of[0,1]){
   const point=new T.Vector3().fromBufferAttribute(pos,i),moved=point.clone().add(cardiacDisplacement(point,d.getX(i),d.getY(i),phase/40));moved.y-=.002*breath;
   assert.ok(cardiacSpaceDistance(moved)<-.0024,'pulmonary fragment could survive inside a cardiac chamber');count++;
  }
 }
 assert.ok(count>10000);
});
test('pulmonary clearance uses pre-rig coordinates and clips before depth writes',()=>{
 const material=new T.MeshStandardMaterial();let called=false;material.onBeforeCompile=()=>{called=true};applyCardiacClearance(material);
 const shader={uniforms:{},vertexShader:'transformed=rigPosition(rigR,rigD,transformed);',fragmentShader:'#include <clipping_planes_fragment>'};material.onBeforeCompile(shader,{});
 assert.ok(called);assert.match(shader.vertexShader,/vThoracicPoint=transformed;\ntransformed=rigPosition/);assert.match(shader.fragmentShader,/cardiacClearance<0.0\)discard/);assert.equal(shader.uniforms.uCardiacSpace.value.length,42);
});
