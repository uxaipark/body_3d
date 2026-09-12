import test from'node:test';import assert from'node:assert/strict';import *as T from'three';
import{registerSkinPoint,registerSkinGeometry,skinLandmarks,skinTargets}from'../lib/skin-registration.js';
import{NodeIO}from'@gltf-transform/core';import{ALL_EXTENSIONS}from'@gltf-transform/extensions';import draco from'draco3dgltf';
test('exterior limb landmarks register to both sides of the visible skeletal axes',()=>{
 for(const side of [-1,1])for(const [name,p]of Object.entries(skinLandmarks)){
  const source=new T.Vector3(...p);source.x*=side;
  const target=new T.Vector3(...skinTargets[name]);target.x*=side;
  assert.ok(registerSkinPoint(source).distanceTo(target)<.002,`${name} is misregistered`);
 }
});
test('registration keeps the midline continuous and attached to a single pelvis',()=>{
 const points=[];
 for(let y=.79;y<.98;y+=.01){
  const a=registerSkinPoint(new T.Vector3(-.000001,y,.08)),b=registerSkinPoint(new T.Vector3(.000001,y,.08));
  assert.ok(a.distanceTo(b)<.000003);points.push(-.000001,y,.08,.000001,y,.08);
 }
 const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(points,3));
 assert.equal(registerSkinGeometry(g).length,points.length/3);
});
test('registered scalp encloses the cranial bounds and eyes move with the face',async()=>{
 const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco.createDecoderModule()});
 const skin=await io.read('public/models/skin-web.glb'),skeleton=await io.read('public/models/skeleton-web.glb');
 const head=new T.Box3(),skull=new T.Box3();let eyes=0;
 for(const n of skin.getRoot().listNodes()){
  if(!n.getMesh())continue;const m=new T.Matrix4().fromArray(n.getWorldMatrix());
  for(const primitive of n.getMesh().listPrimitives()){
   const a=primitive.getAttribute('POSITION').getArray();
   for(let i=0;i<a.length;i+=3){const v=new T.Vector3().fromArray(a,i).applyMatrix4(m),p=registerSkinPoint(v);
    assert.ok(p.toArray().every(Number.isFinite));
    if(n.getName()==='Male skin'&&v.y>1.49)head.expandByPoint(p);
    if(n.getName()==='high-poly'){assert.ok(v.z-p.z>.025&&v.z-p.z<.04);eyes++;}
   }
  }
 }
 for(const n of skeleton.getRoot().listNodes())if(n.getMesh()&&/parietal|occipital|^frontal bone/i.test(n.getName())){
  const m=new T.Matrix4().fromArray(n.getWorldMatrix());for(const primitive of n.getMesh().listPrimitives()){
   const a=primitive.getAttribute('POSITION').getArray();for(let i=0;i<a.length;i+=3)skull.expandByPoint(new T.Vector3().fromArray(a,i).applyMatrix4(m));
  }
 }
 assert.ok(eyes>100);assert.ok(head.min.z<skull.min.z-.004);
 assert.ok(head.min.x<skull.min.x-.003&&head.max.x>skull.max.x+.003);
 assert.ok(head.max.y>skull.max.y+.004);assert.ok(head.max.z<.13,'the face is no longer offset far in front of the skull');
});
