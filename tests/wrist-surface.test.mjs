import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import * as T from '../public/simulators/radial/js/vendor/three.module.js';
import {GLTFLoader} from '../public/simulators/radial/js/vendor/GLTFLoader.js';
import {buildModel0} from '../public/simulators/radial/js/wrist3d/nativeAtlas.js';
import {buildSkinWrap,rotatePatchPoint,patchAlongHalf,clipPatchPath} from '../public/simulators/radial/js/patchGeometry.js';
import {wristSurface} from '../public/simulators/radial/js/wristSurface.js';
import {WristView} from '../public/simulators/radial/js/wristView.js';
import {CapacitiveArrayModel} from '../public/simulators/radial/js/capacitiveArray.js';
import {isCenterDrag,dragWristOrbit} from '../public/simulators/radial/js/viewInteraction.js';

test('skin arc continues over the wrist side to the dorsal surface without protruding or stretching',()=>{
 const geo=new T.CylinderGeometry(.02,.02,.13,192,1).rotateZ(Math.PI/2),wrap=buildSkinWrap(geo.attributes.position.array,geo.index.array);
 let previous=null;
 for(let arc=-90;arc<=90;arc+=.5){const p=wrap.sample(0,-30,arc);
  assert.ok(Math.abs(Math.hypot(p.y,p.z)-20)<.01);
  assert.ok(Math.abs(Math.hypot(p.nx,p.ny,p.nz)-1)<1e-8);
  if(previous)assert.ok(Math.hypot(p.y-previous.y,p.z-previous.z)>.49&&Math.hypot(p.y-previous.y,p.z-previous.z)<.51);
  previous=p;
 }
 assert.ok(wrap.sample(0,-30,45).ny<0);geo.dispose();
});

test('rotated patch preserves channel spacing and updates both longitudinal placement limits and geometry',()=>{
 const ca=new CapacitiveArrayModel();ca.configure({rows:2,cols:5,spacingMm:4});
 const before=ca.electrodePositions_mm();ca.setSheetAngle(90);const after=ca.electrodePositions_mm();
 assert.ok(Math.abs(after[1].along_mm-after[0].along_mm-4)<1e-8);
 for(let i=0;i<after.length;i++){const q=rotatePatchPoint((i%5-2)*4,(Math.floor(i/5)-.5)*4,90),p=wristSurface.sample(ca.sheetLateral_mm,ca.sheetAlong_mm+q.along,q.lateral);assert.ok(Math.abs(after[i].lateral_mm-p.z)<1e-8);assert.equal(after[i].surfaceY_mm,p.y);}
 assert.equal(after.length,before.length);assert.ok(patchAlongHalf(24,12,90)>patchAlongHalf(24,12,0));
 const a=ca.arteryAt(-20,{lateral_mm:0,depth_mm:1});ca.arteryLateralAdjust_mm=3;ca.arteryDepthAdjust_mm=-2;
 const b=ca.arteryAt(-20,{lateral_mm:0,depth_mm:1});assert.equal(b.lateral-a.lateral,3);assert.equal(b.depth-a.depth,-2);
});

test('snapshot artery path crosses the same patch centre at 0/90/180 degrees and follows artery relocation',()=>{
 const ca=new CapacitiveArrayModel(),offset={lateral_mm:0,depth_mm:1};ca.setSheetOffset(ca.arteryAt(-30,offset).lateral,-30);
 for(const angle of [0,90,180,-45]){ca.setSheetAngle(angle);const p=ca.arteryPathOnPatch(offset).find((_,i)=>i===80);assert.ok(Math.hypot(p.lateral_mm,p.along_mm)<1e-8);}
 ca.setSheetAngle(90);ca.arteryLateralAdjust_mm=3;const p=ca.arteryPathOnPatch(offset)[80];assert.ok(Math.abs(p.along_mm)>2);assert.ok(Math.abs(p.lateral_mm)<1e-8);
 const clipped=clipPatchPath([{lateral_mm:-30,along_mm:0},{lateral_mm:30,along_mm:0}],5,10);assert.deepEqual(clipped,[{lateral_mm:-5,along_mm:0},{lateral_mm:5,along_mm:0}]);
});

test('comma and period rotate the patch in 2.5 degree steps; central drag selects Y yaw',()=>{
 const listeners={},el={style:{},addEventListener(k,fn){(listeners[k]??=[]).push(fn);},getBoundingClientRect(){return {left:0,top:0,width:800,height:800};},setPointerCapture(){},focus(){}};
 const view=Object.create(WristView.prototype);Object.assign(view,{renderer:{domElement:el},sheet:{angle:0},orbit:{},_layoutSheet(){},_hitSheet(){return false;}});view._bindPointer();
 const key=k=>listeners.keydown[0]({key:k,preventDefault(){}});key('.');assert.equal(view.sheet.angle,2.5);key(',');assert.equal(view.sheet.angle,0);key(',');assert.equal(view.sheet.angle,-2.5);
 assert.equal(isCenterDrag(400,400,el.getBoundingClientRect()),true);assert.equal(isCenterDrag(50,400,el.getBoundingClientRect()),false);
 listeners.pointerdown[0]({button:0,clientX:400,clientY:400,pointerId:1});assert.equal(view.orbit.mode,'yaw');
 view.orbit.theta=0;view.orbit.phi=1;listeners.pointermove[1]({clientX:430,clientY:420});assert.ok(view.orbit.theta>0);assert.equal(view.orbit.phi,1);
 listeners.pointerup[0]();listeners.pointerdown[0]({button:0,clientX:400,clientY:50,pointerId:1});assert.equal(view.orbit.mode,'orbit');const previous=view.orbit.theta;listeners.pointermove[1]({clientX:430,clientY:50});assert.ok(view.orbit.theta>previous);
 const orbit={theta:.5,phi:1};dragWristOrbit(orbit,10,0,'yaw');dragWristOrbit(orbit,-10,0,'yaw');assert.ok(Math.abs(orbit.theta-.5)<1e-12);assert.equal(orbit.phi,1);
 view._hitSheet=()=>true;listeners.pointerdown[0]({button:0,clientX:400,clientY:400,pointerId:1});assert.equal(view.orbit.mode,'sheet');
});

test('native atlas preserves radial–palmar connection, bends between anchors and pulses without drift',async()=>{
 const bytes=fs.readFileSync('public/models/wrist/atlas.glb'),load=GLTFLoader.prototype.loadAsync;
 GLTFLoader.prototype.loadAsync=function(){return this.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');};
 let m;try{m=buildModel0({});await m.ready;}finally{GLTFLoader.prototype.loadAsync=load;}
 let skin,tube,arch;m.group.traverse(n=>{if(n.userData?.layer==='skin')skin=n;if(n.userData?.sourceName==='Radial artery.r.001')tube=n;if(n.userData?.sourceName==='Deep palmar arch.r.001')arch=n;});
 assert.equal(tube.visible,true);assert.equal(tube.material.color.getHex(),0xff0000);assert.equal(tube.material.metalness,0);assert.equal(tube.material.toneMapped,false);
 assert.equal(skin.geometry.attributes.position.array.length,skin.geometry.attributes.position.count*3);
 const normals=skin.geometry.attributes.normal.array.slice(),rest=tube.geometry.attributes.position.array.slice(),expanded=tube.geometry.attributes.position.array,archRest=arch.geometry.attributes.position.array.slice();
 const nearest=(array,target)=>{let best=Infinity,offset=0;for(let i=0;i<array.length;i+=3){const d=Math.hypot(...target.map((v,k)=>array[i+k]-v));if(d<best){best=d;offset=i;}}return offset;};
 const end=nearest(rest,[.07550361752510071,-.004710394423455,.010858566500246525]);
 const joined=nearest(archRest,[.07564688473939896,-.004792043473571539,.010940630920231342]);
 assert.ok(Math.max(...Array.from({length:rest.length/3},(_,i)=>rest[i*3]*1000-55))>20);
 const core=nearest(rest,[.025,.002,.01]);
 for(const lateral of [-6,0,6])for(const depth of [-6,0,6])for(const pulse of [0,.06]){
  m.update({radiusDelta_mm:pulse,fat_mm:2.2,arteryLateralShift_mm:lateral,arteryDepthShift_mm:depth});
  const ap=arch.geometry.attributes.position.array;
  assert.ok(Math.hypot(...[0,1,2].map(k=>expanded[end+k]-ap[joined+k]))<.00025,'hand connection remains within the original junction');
  assert.ok([...expanded].every(Number.isFinite));
  for(let i=0;i<rest.length;i+=3)if(rest[i]*1000-55>=20)for(let k=0;k<3;k++)assert.equal(expanded[i+k],rest[i+k],'distal anchor stays fixed');
  if(pulse===0){assert.ok(Math.abs(expanded[core+1]-rest[core+1]+depth*.001)<1e-8);assert.ok(Math.abs(expanded[core+2]-rest[core+2]-lateral*.001)<1e-8);}
 }
 m.update({radiusDelta_mm:.06,fat_mm:2.2});
 assert.ok(expanded.some((v,i)=>Math.abs(v-rest[i])>.00001),'pulse moves the vascular wall');
 assert.deepEqual(skin.geometry.attributes.normal.array,normals);
 m.update({radiusDelta_mm:0,fat_mm:2.2});assert.deepEqual(expanded,rest);
 const view=Object.create(WristView.prototype);Object.assign(view,{_models:new Map([['0',m]]),sheet:{lateral:12,along:-30,angle:37.5},layout:{},sheetGroup:new T.Group(),_makeLabelSprite(){return new T.Sprite(new T.SpriteMaterial());}});
 view.setLayout(3,3,4);for(const mesh of [view.sheetMesh,...view.pads])assert.ok([...mesh.geometry.attributes.position.array].every(Number.isFinite));
 const q=rotatePatchPoint(0,0,37.5),p=m.surfacePoint(12,-30+q.along,q.lateral),mapped=view._patchPoint(0,0,.25);
 assert.ok(Math.abs(Math.hypot(mapped.base[0]*1000,mapped.base[1]*1000-p.y,mapped.base[2]*1000-p.z)-.25)<1e-8);
 view.setSheetAngle(90);view._pulsePatch(.05);for(const pad of view.pads)assert.ok([...pad.geometry.attributes.position.array].every(Number.isFinite));
 m.dispose();
});
