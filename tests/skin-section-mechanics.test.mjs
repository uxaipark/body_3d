import test from 'node:test';import assert from 'node:assert/strict';
import {skinRegions,sectionState} from '../lib/skin-section.ts';
import {sectionProfile,tissueBoundary,deformSection,SectionRelaxation} from '../lib/skin-section-model.ts';
import {defaults} from '../lib/physiology.ts';

test('regional tissue boundaries remain ordered, including the thinnest adipose preset',()=>{
 for(const region of skinRegions)for(const fat of[.5,region.fat,16]){
  const p=sectionProfile(region,fat);
  for(let x=-12;x<=12;x+=.1)for(let layer=0;layer<6;layer++)assert.ok(tissueBoundary(x,layer+1,p)>tissueBoundary(x,layer,p));
  assert.ok(p.arteryDepth-p.radius-p.wall>0);assert.ok(p.arteryDepth+p.radius+p.wall<p.total);
 }
 assert.equal(sectionProfile(skinRegions.find(r=>r.id==='finger')).hair,false);
});

test('tissue outside the expanding artery stays non-inverted and nearly preserves cross-sectional area',()=>{
 const e=.0001;
 for(const region of skinRegions)for(const fat of[.5,16]){
  const p=sectionProfile(region,fat),state={distension:region.radius*.025,respiratory:region.driver==='breath'?5.2:region.driver==='heart'?2.4:0,cardiac:.22};
  for(const gain of[1,12])for(let x=-10;x<=10;x+=.73)for(let d=.02;d<p.total;d+=.39){
   if(Math.hypot(x,d-p.arteryDepth)<p.radius+.01)continue;
   const a=deformSection(x+e,d,0,p,state,gain),b=deformSection(x-e,d,0,p,state,gain),c=deformSection(x,d+e,0,p,state,gain),f=deformSection(x,d-e,0,p,state,gain);
   const determinant=-((a[0]-b[0])*(c[1]-f[1])-(a[1]-b[1])*(c[0]-f[0]))/(4*e*e);
   assert.ok(determinant>.98&&determinant<1.02,`${region.id}: ${determinant}`);
  }
 }
});

test('viscoelastic response relaxes without overshoot, freezes on pause, and is frame-rate independent',()=>{
 const target={distension:.03,respiratory:3,cardiac:.2},a=new SectionRelaxation(),b=new SectionRelaxation(),slow=new SectionRelaxation();
 for(let i=0;i<120;i++)a.update(1/120,target,45);for(let i=0;i<30;i++)b.update(1/30,target,45);
 for(const key of Object.keys(target)){assert.ok(Math.abs(a.state[key]-b.state[key])<1e-12);assert.ok(a.state[key]<=target[key]);}
 slow.update(.016,target,100);const fast=new SectionRelaxation();fast.update(.016,target,0);assert.ok(fast.state.distension>slow.state.distension);
 const saved={...a.state};a.update(0,{distension:0,respiratory:0,cardiac:0},45);assert.deepEqual(a.state,saved);
 for(let i=0;i<360;i++)a.update(1/120,{distension:0,respiratory:0,cardiac:0},45);assert.ok(a.state.respiratory<1e-8);
});

test('pulse transfers to the surface and respiration raises the full section continuously',()=>{
 const wrist=skinRegions[0],p=sectionProfile(wrist),state=sectionState(wrist,defaults,0,.3);
 assert.ok(deformSection(0,0,0,p,state,8)[1]>0);
 assert.ok(deformSection(p.arteryDepth*.9,0,0,p,state,1)[1]<0,'adjacent tissue should settle as the centre rises');
 const abdomen=skinRegions.find(r=>r.id==='abdomen'),q=sectionProfile(abdomen),high={distension:0,respiratory:5.2,cardiac:0};
 for(const d of[0,q.dermis,q.total])assert.ok(deformSection(0,d,0,q,high)[1]>-d);
});
