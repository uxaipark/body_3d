import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {TwinEngine} from '../public/simulators/radial/js/engine.js';
import {WRIST_MECHANICS,radiusPerPressure,surfaceTransfer,WristRelaxation,surroundingDisplacement} from '../public/simulators/radial/js/wristMechanics.js';
import {atlasProfile,atlasArteryAt} from '../public/simulators/radial/js/atlasProfile.js';

test('causal wrist relaxation has the analytic step response, no overshoot or repeated-sample drift',()=>{
 const r=new WristRelaxation(),tau=WRIST_MECHANICS.tau_s;
 for(let i=0;i<100;i++)r.step(0,i,.1,1000);
 const value=r.step(0,99,.1,1000);assert.ok(Math.abs(value-.1*(1-Math.exp(-.1/tau)))<1e-12);
 assert.equal(r.step(0,99,.8,1000),value);assert.ok(r.step(0,100,0,1000)<value);
});
test('radius law respects pressure units and inverse-square PWV; surrounding tissue has signed displacement',()=>{
 const dr=radiusPerPressure(6)*42;assert.ok(dr>.06&&dr<.09);assert.equal(radiusPerPressure(12),radiusPerPressure(6)/4);
 assert.ok(surfaceTransfer(0,4)>0);assert.ok(surfaceTransfer(25,4)<0);
 assert.ok(surroundingDisplacement(0,0,0,4,dr).vertical_mm>0);
 assert.ok(surroundingDisplacement(25,0,0,4,dr).vertical_mm<0);
});
test('atlas centreline is finite, interpolated, and actually used in the acquisition model',()=>{
 assert.ok(atlasProfile.length>=20);const e=new TwinEngine();
 for(let along=-100;along<=0;along+=.5){const a=atlasArteryAt(along),b=e.capArray.arteryAt(along,{lateral_mm:0,depth_mm:1});assert.ok(a.depth_mm>0&&Number.isFinite(a.surfaceY_mm));assert.equal(a.depth_mm,b.depth);assert.equal(a.lateral_mm,b.lateral);}
});
test('fat changes generated sensor channels; 16 kHz timestamps remain identical and tissue stays finite',()=>{
 const a=new TwinEngine(),b=new TwinEngine();b.capArray.tissueFat_mm=6;
 for(let i=0;i<160;i++){a.step(.016);b.step(.016);}
 assert.equal(a.totalSamples,40960);assert.equal(a.totalSamples,b.totalSamples);assert.equal(a.t,b.t);
 const delta=a.latest.capLast.some((v,i)=>Math.abs(v-b.latest.capLast[i])>1e-5);assert.ok(delta);
 for(const e of[a,b])for(const x of e.latest.tissue.displacement_mm)assert.ok(Number.isFinite(x)&&Math.abs(x)<1);
});
test('native wrist contains all 29 bones and named vessels, nerves and tendons, with no lower limb leakage',()=>{
 const m=JSON.parse(fs.readFileSync('public/models/wrist/manifest.json','utf8'));
 assert.equal(m.layers.skeleton.structures.length,29);
 assert.ok(m.layers.cardiovascular.structures.some(s=>s.startsWith('Radial artery.')));
 assert.ok(m.layers.muscular.structures.some(s=>s.startsWith('Flexor carpi radialis.')));
 for(const layer of Object.values(m.layers))assert.ok(layer.triangles>0);
 assert.ok(!JSON.stringify(m).match(/femur|tibia|fibula|phalanx of.*foot/i));
 assert.ok(WebAssembly.validate(fs.readFileSync('public/simulators/radial/js/analysis/dt_core.wasm')));
});
test('wrist mode adapter focuses the section and switches renderer visibility through S/T/A',async()=>{
 const {WristView}=await import('../public/simulators/radial/js/wristView.js');
 const view=Object.create(WristView.prototype),focused=[],native={ready:Promise.resolve(),setMode(){},group:{visible:true}};
 Object.assign(view,{_models:new Map([['0',native]]),renderer:{domElement:{style:{}}},section:{focus(mode){focused.push(mode);},resize(){}},sectionHost:{style:{}},_layoutSheet(){}});
 assert.equal(await view.setHandModel('S'),'S');assert.equal(view.renderer.domElement.style.display,'none');assert.equal(native.group.visible,false);
 assert.equal(await view.setHandModel('T'),'T');assert.deepEqual(focused,['full','top']);
 assert.equal(await view.setHandModel('A'),'A');assert.equal(view.sectionHost.style.display,'none');assert.equal(native.group.visible,true);
});
