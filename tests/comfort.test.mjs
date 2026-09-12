import test from 'node:test';import assert from 'node:assert/strict';import *as T from 'three';import {comfortRegion,applyComfortMask} from '../lib/comfort.ts';import {HumanRig} from '../lib/rig.ts';
test('comfort region is local to the external genital area and excludes limbs and the abdomen',()=>{
 for(const p of [[0,.76,.10],[-.025,.74,.055],[.025,.74,.055]])assert.ok(comfortRegion(...p));
 for(const p of [[0,.92,.08],[.08,.76,.06],[-.08,.76,.06],[.28,.76,.06],[0,1.3,.1],[0,.77,-.08]])assert.equal(comfortRegion(...p),false);
 const rig=new HumanRig(),a=new T.Vector3(0,.773,.053),w={indices:[0,0,0,0],weights:[1,0,0,0]};for(const motion of ['stand','sitStand','grip','lie'])for(const t of [0,2,7,14]){rig.poseTask(motion,t);const expected=a.clone().applyMatrix4(rig.skeleton.boneInverses[0]).applyMatrix4(rig.bones[0].matrixWorld);assert.ok(rig.transform(a,w).distanceTo(expected)<1e-6);}
});
test('comfort masking preserves the existing deformation shader and toggles without rebuilding geometry',()=>{
 const material=new T.MeshStandardMaterial(),uniform={value:0};material.onBeforeCompile=s=>{s.vertexShader+='\n// existing DQ hook'};material.customProgramCacheKey=()=> 'prior';applyComfortMask(material,uniform);
 const shader={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <clipping_planes_fragment>'};material.onBeforeCompile(shader,{});assert.match(shader.vertexShader,/existing DQ hook/);assert.match(shader.vertexShader,/vComfortRest=position/);assert.match(shader.fragmentShader,/if\(uComfort>.5/);assert.equal(shader.uniforms.uComfort,uniform);uniform.value=1;assert.equal(shader.uniforms.uComfort.value,1);assert.match(material.customProgramCacheKey(),/^prior-comfort/);
});
