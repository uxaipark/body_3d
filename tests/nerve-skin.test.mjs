import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import draco from 'draco3dgltf';
import {HumanRig} from '../lib/rig.ts';
import {refineFlexibleTissue} from '../lib/flexible-tissue.ts';
import {bindTissueGeometry} from '../lib/tissue-binding.ts';
import {bakeAnatomyTransform} from '../lib/vessel-junctions.ts';
import {SkinBoundary,NerveSkinGuard,constrainNerveToFace,NERVE_SKIN_CLEARANCE} from '../lib/skin-boundary.ts';
import {expressionMocapData} from '../lib/expression-mocap-data.js';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco.createDecoderModule()});
const skin=await io.read('public/models/skin-atlas-web.glb'),node=skin.getRoot().listNodes().find(n=>n.getMesh()),primitive=node.getMesh().listPrimitives()[0],g=new T.BufferGeometry();
for(const [src,dst,size]of [['POSITION','position',3],['NORMAL','normal',3],['_RIG_INDEX','rigIndex',4],['_RIG_WEIGHT','rigWeight',4]])g.setAttribute(dst,new T.BufferAttribute(primitive.getAttribute(src).getArray().slice(),size));
g.setIndex(new T.BufferAttribute(primitive.getIndices().getArray().slice(),1));bakeAnatomyTransform(g,new T.Matrix4().fromArray(node.getWorldMatrix()));
const guard=new NerveSkinGuard(g),doc=await io.read('public/models/nervous-web.glb'),samples=[];
for(const node of doc.getRoot().listNodes())if(node.getMesh())for(const primitive of node.getMesh().listPrimitives()){
 const nerve=new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(primitive.getAttribute('POSITION').getArray().slice(),3));nerve.setAttribute('normal',new T.BufferAttribute(primitive.getAttribute('NORMAL').getArray().slice(),3));nerve.setIndex(new T.BufferAttribute(primitive.getIndices().getArray().slice(),1));bakeAnatomyTransform(nerve,new T.Matrix4().fromArray(node.getWorldMatrix()));refineFlexibleTissue(nerve,node.getName());bindTissueGeometry(nerve,node.getName());const original=nerve.getAttribute('position').clone();guard.bind(nerve);
 const p=nerve.getAttribute('position'),ix=nerve.getAttribute('rigIndex'),w=nerve.getAttribute('rigWeight');
 for(let i=0;i<p.count;i+=Math.max(1,Math.floor(p.count/20))){const point=new T.Vector3().fromBufferAttribute(p,i),face=nerve.getAttribute('nerveSkinFace'),anchor=nerve.getAttribute('nerveSkinAnchor');samples.push({name:node.getName(),original:new T.Vector3().fromBufferAttribute(original,i),point,face:[face.getX(i),face.getY(i),face.getZ(i)],anchor:new T.Vector4().fromBufferAttribute(anchor,i),w:{indices:[0,1,2,3].map(j=>ix.getComponent(i,j)),weights:[0,1,2,3].map(j=>w.getComponent(i,j))}});}
 nerve.dispose();
}
test('nerve contact follows actual skin triangles through greeting, jazz, gait and bed poses without removing geometry',()=>{
 const rig=new HumanRig();let before=0,after=0,maxBefore=0,maxAfter=0,rootShift=0;const issues=new Map();
 for(const mode of ['wave','dance','walk','run','lie','rest'])for(let frame=0;frame<(mode==='wave'||mode==='dance'?12:mode==='rest'?1:4);frame++){
  if(mode==='wave'||mode==='dance')rig.poseExpression(mode,frame/12*expressionMocapData[mode].duration);else if(mode==='lie')rig.poseBed(frame*3);else rig.pose(frame/4,mode==='rest'?0:1,mode==='run'?1:0);const posed=guard.boundary.posed(rig),posedGeometry=g.clone();posedGeometry.setAttribute('position',new T.Float32BufferAttribute(posed.flatMap(p=>p.toArray()),3));const exterior=new SkinBoundary(posedGeometry);
  for(const s of samples){const p=rig.transform(s.point,s.w),[a,b,c]=s.face.map(i=>posed[i]),embedded=s.face.reduce((v,id,j)=>v.addScaledVector(rig.transform(s.point,guard.boundary.weights[id]),s.anchor.getComponent(j)),new T.Vector3()),normal=s.face.reduce((v,id,j)=>v.addScaledVector(rig.transform(guard.boundary.points[id].clone().add(guard.boundary.normals[id]),guard.boundary.weights[id]).sub(posed[id]),s.anchor.getComponent(j)),new T.Vector3()).normalize(),initial=constrainNerveToFace(p,a,b,c,s.anchor,embedded,normal);const moved=initial;

   if(/Roots of brachial plexus/.test(s.name)&&Math.abs(s.point.x)<.027)rootShift=Math.max(rootShift,p.distanceTo(moved));assert.ok(moved.toArray().every(Number.isFinite));if(s.anchor.w>=0)assert.ok(moved.clone().sub(a.clone().multiplyScalar(s.anchor.x).addScaledVector(b,s.anchor.y).addScaledVector(c,s.anchor.z)).dot(normal)<=-NERVE_SKIN_CLEARANCE+1e-6);
   const was=exterior.nearest(p),now=exterior.nearest(moved),d0=p.clone().sub(was.point).dot(was.normal),d1=moved.clone().sub(now.point).dot(now.normal);
   if(d0>.002&&!exterior.contains(p)){before++;maxBefore=Math.max(maxBefore,d0);}if(d1>.0005&&!exterior.contains(moved)){after++;issues.set(s.name,Math.max(issues.get(s.name)||0,d1));maxAfter=Math.max(maxAfter,d1);}
  }posedGeometry.dispose();
 }
 if(issues.size)console.log([...issues].sort((a,b)=>b[1]-a[1]).slice(0,20));console.log({samples:samples.length,before,after,maxBefore,maxAfter,rootShift});
 assert.equal(rootShift,0,'spinal insertions must retain their fixed pose');assert.ok(before>0,'fixture must reproduce protrusions');assert.equal(after,0,'nerve samples remain outside the posed exterior');rig.dispose();
});
test('interior attachments are unchanged by unilateral contact',()=>{
 const a=new T.Vector3(0,0,0),b=new T.Vector3(1,0,0),c=new T.Vector3(0,1,0),inside=new T.Vector3(.1,.1,-.03);
 assert.deepEqual(constrainNerveToFace(inside,a,b,c).toArray(),inside.toArray());
});
