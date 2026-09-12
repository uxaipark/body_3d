import test from 'node:test';import assert from 'node:assert/strict';
import {skinRegions,sectionState} from '../lib/skin-section.ts';
import {sectionProfile,tissueBoundary,deformSection,SectionRelaxation,sectionCurvature,sectionMobility} from '../lib/skin-section-model.ts';
import {defaults} from '../lib/physiology.ts';

test('regional tissue boundaries remain ordered, including the thinnest adipose preset',()=>{
 for(const region of skinRegions)for(const fat of[.5,region.fat,16]){
  const p=sectionProfile(region,fat);
  for(let x=-12;x<=12;x+=.1)for(let layer=0;layer<6;layer++)assert.ok(tissueBoundary(x,layer+1,p)>tissueBoundary(x,layer,p));
  assert.ok(p.arteryDepth-p.radius-p.wall>0);assert.ok(p.arteryDepth+p.radius+p.wall<p.total);
 }
 assert.equal(sectionProfile(skinRegions.find(r=>r.id==='finger')).hair,false);
});

test('tissue stays non-inverted near supports and preserves area away from them',()=>{
 const e=.0001;
 for(const region of skinRegions)for(const fat of[.5,16]){
  const p=sectionProfile(region,fat),state={distension:region.radius*.025,respiratory:region.driver==='breath'?5.2:region.driver==='heart'?2.4:0,cardiac:.22};
  for(const gain of[1,12])for(let x=-10;x<=10;x+=.73)for(let d=.02;d<p.total;d+=.39){
   if(Math.hypot(x-p.arteryX,d-p.arteryDepth)<p.radius+.01)continue;
   const a=deformSection(x+e,d,0,p,state,gain),b=deformSection(x-e,d,0,p,state,gain),c=deformSection(x,d+e,0,p,state,gain),f=deformSection(x,d-e,0,p,state,gain);
   const determinant=-((a[0]-b[0])*(c[1]-f[1])-(a[1]-b[1])*(c[0]-f[0]))/(4*e*e);
   const unrestricted=[sectionMobility(x+e,d,p),sectionMobility(x-e,d,p),sectionMobility(x,d+e,p),sectionMobility(x,d-e,p)].every(v=>v===1);
   assert.ok(determinant>(unrestricted?.98:.65)&&determinant<(unrestricted?1.02:1.35),`${region.id}: ${determinant}`);
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
 assert.ok(deformSection(0,0,-p.thickness/2,p,state,8)[1]>0);
 assert.ok(deformSection(p.arteryDepth*.9,0,0,p,state,1)[1]<sectionCurvature(p.arteryDepth*.9,0,p),'adjacent tissue should settle as the centre rises');
 const abdomen=skinRegions.find(r=>r.id==='abdomen'),q=sectionProfile(abdomen),high={distension:0,respiratory:5.2,cardiac:0};
 for(const d of[0,q.dermis,q.total])assert.ok(deformSection(0,d,0,q,high)[1]>-d+sectionCurvature(0,0,q));
});

test('all twelve regions have curved depth windows and differentiated deep anatomy',()=>{
 const signatures=new Set();for(const region of skinRegions){const p=sectionProfile(region);assert.ok(p.thickness>=16&&p.thickness>=p.width*.65);assert.ok(sectionCurvature(0,-p.thickness/2,p)>sectionCurvature(p.width/2,-p.thickness/2,p));assert.ok(sectionCurvature(0,-p.thickness/2,p)>sectionCurvature(0,0,p));signatures.add([p.curveX,p.curveZ,p.structures.map(s=>s.label).join(',')].join('|'));for(const s of p.structures){assert.ok(s.depth-s.ry>p.epidermis);assert.ok(s.depth+s.ry<p.total);}}
 assert.equal(signatures.size,12);
 const wrist=sectionProfile(skinRegions.find(r=>r.id==='wrist')),tendons=wrist.structures.filter(s=>s.kind==='tendon'),bone=wrist.structures.find(s=>s.kind==='bone');assert.equal(tendons.length,2);assert.ok(tendons.some(s=>s.x<wrist.arteryX)&&tendons.some(s=>s.x>wrist.arteryX));assert.ok(bone.depth-bone.ry>wrist.arteryDepth+wrist.radius+wrist.wall);
 assert.equal(sectionProfile(skinRegions.find(r=>r.id==='ear')).structures.length,0,'the earlobe window has no invented cartilage or bone');
 assert.ok(sectionProfile(skinRegions.find(r=>r.id==='finger')).arteryX<0,'digital artery sits toward the lateral pulp');
});

test('bone cross-sections do not expand with the pulse while overlying skin moves',()=>{
 for(const region of skinRegions){const p=sectionProfile(region),rest={distension:0,respiratory:0,cardiac:0},pulse={...rest,distension:p.radius*.025};for(const bone of p.structures.filter(s=>s.kind==='bone'))for(const dx of[-.5,0,.5]){const x=bone.x+dx*bone.rx,d=bone.depth,z=-p.thickness/2;assert.equal(sectionMobility(x,d,p),0);assert.deepEqual(deformSection(x,d,z,p,pulse,12),deformSection(x,d,z,p,rest,12));}}
});
