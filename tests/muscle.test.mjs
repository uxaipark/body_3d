import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {mergeGeometries}from'three/addons/utils/BufferGeometryUtils.js';
import {muscleTissue,muscleFrame,applyMuscleSurface}from'../lib/muscle.ts';
test('fascia and tendon covers are distinguished from muscle bellies',()=>{
 for(const n of ['Pectoral fascia','Fascia lata','Rectus sheath','Subdeltoid bursa'])assert.equal(muscleTissue(n),'fascia');
 for(const n of ['Calcaneal tendon','Plantar aponeurosis','Iliotibial tract','Inguinal ligament'])assert.equal(muscleTissue(n),'tendon');
 for(const n of ['Biceps brachii','Rectus abdominis muscle','Gastrocnemius'])assert.equal(muscleTissue(n),'muscle');
});
test('fibre coordinates follow long axes and survive merged rendering batches',()=>{
 const a=new THREE.CapsuleGeometry(.03,.3,4,8),b=a.clone().rotateZ(.8).translate(.2,1,0);
 const fa=muscleFrame(a,'biceps'),fb=muscleFrame(b,'biceps');assert.ok(Math.abs(fa.axis.y)>.99);assert.ok(Math.abs(fb.axis.x)>.6);
 const merged=mergeGeometries([a,b]);assert.equal(merged.getAttribute('fiberCoord').count,merged.getAttribute('position').count);
 assert.ok([...merged.getAttribute('fiberCoord').array].every(Number.isFinite));
});
test('muscle shader preserves prior deformation hooks and filters small fibres',()=>{
 const m=new THREE.MeshStandardMaterial();m.onBeforeCompile=s=>{s.vertexShader+='\n// existing rig';};applyMuscleSurface(m,'muscle');
 const s={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};m.onBeforeCompile(s,{});
 assert.ok(s.vertexShader.includes('// existing rig'));assert.ok(s.vertexShader.includes('vFiberCoord=fiberCoord;'));
 assert.ok(s.fragmentShader.includes('fwidth(p)'));assert.ok(s.fragmentShader.includes('normal=fibreNormal(normal,fibreHeight,-vViewPosition)'));
 assert.equal(s.fragmentShader.split('float fibreHeight=').length,2);
});
