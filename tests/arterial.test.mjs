import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import{isArtery,arterialPulse,systolicPulse,distensionFraction,bindArterialPulse}from'../lib/arterial.ts';
test('only arteries receive systolic wall distension',()=>{
 for(const n of ['Ascending aorta','Aortic arch','Radial artery','Perforating femoral arteries'])assert.equal(isArtery(n),true);
 for(const n of ['Radial veins','Pulmonary vein','Left ventricle','Aortic valve'])assert.equal(isArtery(n),false);
});
test('wall distension follows contraction with an increasing peripheral delay',()=>{
 const hr=72,pwv=6,peak=.19;
 assert.ok(systolicPulse(peak)>.999);
 for(const distance of [.05,.65,1.1])assert.ok(arterialPulse(peak+(.025+distance/pwv)*hr/60,hr,pwv,distance)>.999);
 assert.ok(arterialPulse(peak,hr,pwv,.65)<arterialPulse(peak,hr,pwv,.05));
});
test('arterial wall motion is small, finite and decreases with stiffness',()=>{
 const g=new THREE.CylinderGeometry(.0014,.0014,.08,16);bindArterialPulse(g,'Radial artery.r');const p=g.getAttribute('pulseData');
 assert.ok(distensionFraction(100)<distensionFraction(0));
 for(let i=0;i<p.count;i++){assert.ok(p.getX(i)>0);assert.ok(p.getX(i)*distensionFraction(0)<.00005);assert.ok(Number.isFinite(p.getY(i)));}
 for(let i=-100;i<200;i++){const v=arterialPulse(i/100,180,4,.65);assert.ok(v>=0&&v<=1);}
});
