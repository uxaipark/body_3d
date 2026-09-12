import test from'node:test';import assert from'node:assert/strict';import *as T from'three';import{NodeIO}from'@gltf-transform/core';import{ALL_EXTENSIONS}from'@gltf-transform/extensions';import draco from'draco3dgltf';
import{HumanRig,BONE_NAMES,surfaceTissueWeight}from'../lib/rig.ts';
test('the shipped fitted exterior keeps hands on their arms throughout running',async()=>{
 const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco.createDecoderModule()}),doc=await io.read('public/models/skin-fitted-web.glb');
 const hand={l:[],r:[]},feet=[];let arms=0,pelvis=0;
 for(const n of doc.getRoot().listNodes()){
  if(!n.getMesh())continue;const matrix=new T.Matrix4().fromArray(n.getWorldMatrix());
  for(const p of n.getMesh().listPrimitives()){
   const positions=p.getAttribute('POSITION').getArray(),indices=p.getAttribute('_RIG_INDEX').getArray(),weights=p.getAttribute('_RIG_WEIGHT').getArray(),labels=p.getAttribute('_SKIN_ARM_SIDE').getArray(),anchors=p.getAttribute('_PELVIC_ANCHOR').getArray();
   for(let i=0;i<labels.length;i++){
    const point=new T.Vector3().fromArray(positions,i*3).applyMatrix4(matrix),w={indices:Array.from(indices.slice(i*4,i*4+4)),weights:Array.from(weights.slice(i*4,i*4+4))};
    assert.ok(Math.abs(w.weights.reduce((a,b)=>a+b,0)-1)<.001);assert.ok(point.toArray().every(Number.isFinite));
    if(anchors[i]>.5){assert.ok(w.weights[0]>.999&&w.indices[0]===0);pelvis++;}
    if(Math.abs(labels[i])>.5&&point.y<1.15){
     const side=labels[i]<0?'r':'l';arms++;
     for(let j=0;j<4;j++)if(w.weights[j]>.001)assert.match(BONE_NAMES[w.indices[j]],new RegExp(`^(upperArm|forearm|hand)\\.${side}$`));
     assert.ok(surfaceTissueWeight(w)<.001,'breathing must not pull distal skin toward the trunk');
     if(point.y<.835)hand[side].push({point,w});
    }
    if(point.y<.12)feet.push({point,w});
   }
  }
 }
 assert.ok(arms>14000&&pelvis>100);const rig=new HumanRig();
 for(const run of[0,1])for(let frame=0;frame<40;frame++){
  rig.pose(frame/40,1,run);
  for(const side of['l','r']){
   assert.ok(hand[side].length>5000);const a=hand[side][0],pa=rig.transform(a.point,a.w);
   for(let i=1;i<hand[side].length;i+=41){const b=hand[side][i];assert.ok(Math.abs(pa.distanceTo(rig.transform(b.point,b.w))-a.point.distanceTo(b.point))<.0001,'hand skin stretches away from its palm');}
  }
  for(let i=0;i<feet.length;i+=13)assert.ok(rig.transform(feet[i].point,feet[i].w).y>-.014,'skin foot penetrates the visible ground grid');
 }
});
