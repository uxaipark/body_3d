import test from'node:test';import assert from'node:assert/strict';import *as T from'three';
import{chamberContraction,cardiacDisplacement,bindCardiacMotion}from'../lib/cardiac.ts';
test('atrial contraction precedes ventricular contraction, with continuous relaxation',()=>{
 assert.ok(chamberContraction(.86,true)>.9);assert.ok(chamberContraction(.86)<.01);
 assert.ok(chamberContraction(.19)>.9);assert.ok(chamberContraction(.19,true)<.01);
 for(const atrial of[false,true])for(let i=0;i<1000;i++){
  const t=i/1000,a=chamberContraction(t,atrial),b=chamberContraction(t+.001,atrial);
  assert.ok(a>=0&&a<=1);assert.ok(Math.abs(a-b)<.035);
 }
 assert.ok(Math.abs(chamberContraction(.999999)-chamberContraction(.000001))<1e-9);
});
test('cardiac deformation twists/shortens smoothly without jumps or rigid scaling',()=>{
 const a=new T.Vector3(.06,1.25,.055),b=new T.Vector3(-.015,1.31,.04);
 assert.ok(cardiacDisplacement(a,0,1,.19).length()>.002);
 assert.ok(cardiacDisplacement(b,1,1,.19).length()<1e-6);
 for(let i=0;i<400;i++){
  const p=cardiacDisplacement(a,0,1,i/400),next=cardiacDisplacement(a,0,1,(i+1)/400);
  assert.ok(p.length()<.015);assert.ok(p.distanceTo(next)<.0005);
 }
 assert.ok(cardiacDisplacement(a,0,0,.19).length()<1e-10);
});
test('heart root motion is localized and attenuated; descending vessels only retain wall pulse',()=>{
 for(const name of ['Descending aorta','Abdominal aorta','Inferior vena cava (abdominal part)','Brachial artery.r.001']){
  const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute([.03,1.29,.04,0,1.16,.01],3));bindCardiacMotion(g,name);
  assert.equal(g.getAttribute('cardiacData').getY(0),0);assert.equal(g.getAttribute('cardiacData').getY(1),0);
 }
 const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute([.009,1.329,.012,.01,1.19,.01],3));bindCardiacMotion(g,'Ascending aorta');
 assert.ok(g.getAttribute('cardiacData').getY(0)<=.25);assert.ok(g.getAttribute('cardiacData').getY(0)>.2);assert.equal(g.getAttribute('cardiacData').getY(1),0);
 for(let i=0;i<100;i++)assert.ok(cardiacDisplacement(new T.Vector3(.03,1.30,.04),0,.25,i/100).length()<.0015);
});
