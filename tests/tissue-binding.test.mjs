import test from 'node:test';import assert from 'node:assert/strict';import *as T from 'three';import{BONE_NAMES,HumanRig}from'../lib/rig.ts';import{bindTissueGeometry,tissueWeights}from'../lib/tissue-binding.ts';
test('deep medial arm muscle and vessels follow their own limb, never trunk or legs',()=>{
 for(const side of ['l','r'])for(const name of ['Brachial artery','Basilic vein','Long head of triceps brachii','Humeral head of flexor carpi ulnaris'])for(const y of [.95,1.07,1.18,1.30]){
  const w=tissueWeights(`${name}.${side}.001`,side==='l'?.14:-.14,y,.015);
  w.indices.forEach((id,i)=>{if(w.weights[i]>0)assert.ok(['upperArm','forearm','hand'].some(part=>BONE_NAMES[id]===`${part}.${side}`));});
 }
});
test('cross-sectional binding is coherent and gives a unit-volume local DQ frame through the whole gesture and dance',()=>{
 const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute([-.19,1.18,.01,-.17,1.18,.01,-.19,1.18,.03],3));bindTissueGeometry(g,'Brachial artery.r.001');const w=g.getAttribute('rigWeight'),ix=g.getAttribute('rigIndex');
 for(let i=0;i<3;i++){assert.equal(w.getX(i),1);assert.equal(ix.getX(i),BONE_NAMES.indexOf('upperArm.r'));}
 const rig=new HumanRig(),weights={indices:[0,1,2,3].map(j=>ix.getComponent(0,j)),weights:[0,1,2,3].map(j=>w.getComponent(0,j))},origin=new T.Vector3(-.19,1.18,.01);
 for(const mode of ['wave','dance'])for(let t=0;t<4;t+=.1){rig.poseExpression(mode,t);const center=rig.transform(origin,weights),axes=[new T.Vector3(.01,0,0),new T.Vector3(0,.01,0),new T.Vector3(0,0,.01)].map(v=>rig.transform(origin.clone().add(v),weights).sub(center));assert.ok(Math.abs(Math.abs(axes[0].dot(axes[1].cross(axes[2])))-1e-6)<1e-10);}
});
test('thoracic and pelvic structures cannot be mistaken for an adjacent limb',()=>{
 for(const name of ['Brachiocephalic trunk','External intercostal muscle.l.001','Rectus abdominis muscle.r.001']){const w=tissueWeights(name,.19,1.20,0);w.indices.forEach((i,j)=>{if(w.weights[j]>0)assert.ok(i<=2);});}
 for(const name of ['Superficial dorsal veins of penis','Gluteus maximus muscle.l.001'])assert.equal(tissueWeights(name,.08,.85,0).indices[0],0);
});

test('captured tissue volume guard matches its exact capture and binding sources and never inflates tissue',async()=>{
 const fs=await import('node:fs'),crypto=await import('node:crypto'),{muscleVolumeData:d}=await import('../lib/muscle-volume-data.js');
 assert.equal(d.source,crypto.createHash('sha256').update(fs.readFileSync('lib/expression-mocap-data.js')).update(fs.readFileSync('lib/tissue-binding.ts')).digest('hex'));
 assert.ok(d.names.length>600);for(const clip of Object.values(d.clips))for(const frame of clip.frames){assert.equal(frame.length,d.names.length);assert.ok(frame.every(v=>Number.isFinite(v)&&v>0&&v<=1));}
});

test('volume guard resolves original GLB names and Three sanitized node names identically',async()=>{
 const {bindMuscleVolume}=await import('../lib/muscle-volume.ts');
 const name='Long head of biceps brachii.r.001',a=new T.BoxGeometry(.02,.1,.02),b=a.clone();a.translate(-.19,1.18,0);b.translate(-.19,1.18,0);bindMuscleVolume(a,name);bindMuscleVolume(b,T.PropertyBinding.sanitizeNodeName(name));
 assert.ok(a.getAttribute('muscleAnchor').getW(0)>=0);assert.equal(a.getAttribute('muscleAnchor').getW(0),b.getAttribute('muscleAnchor').getW(0));
});

test('foot digital muscles never inherit hand bones despite sharing digitorum names',async()=>{
 const {NodeIO}=await import('@gltf-transform/core'),{ALL_EXTENSIONS}=await import('@gltf-transform/extensions'),draco=(await import('draco3dgltf')).default;
 const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco.createDecoderModule()}),doc=await io.read('public/models/muscular-web.glb');let meshes=0,vertices=0;
 for(const node of doc.getRoot().listNodes()){if(!node.getMesh()||!/digitorum (longus|brevis)/i.test(node.getName()))continue;for(const p of node.getMesh().listPrimitives()){const g=new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(new Float32Array(p.getAttribute('POSITION').getArray()),3)).applyMatrix4(new T.Matrix4().fromArray(node.getWorldMatrix()));bindTissueGeometry(g,node.getName());const ix=g.getAttribute('rigIndex'),w=g.getAttribute('rigWeight');for(let i=0;i<ix.count;i++){for(let j=0;j<4;j++)if(w.getComponent(i,j)>0)assert.match(BONE_NAMES[ix.getComponent(i,j)],/^(pelvis|thigh\.|shin\.|foot\.)/);vertices++;}meshes++;}}
 assert.equal(meshes,14);assert.ok(vertices>5000);
});
test('named arm nerves stay on the arm and maxillary vessels stay on the head',()=>{
 for(const name of ['Ulnar nerve.r.001','Median nerve.r.001','Radial nerve.r.001','Musculocutaneous nerve.r.001'])for(const y of [.86,.94,1.10,1.21])for(const x of [-.16,-.21]){const w=tissueWeights(name,x,y,.01);w.indices.forEach((id,j)=>{if(w.weights[j]>0)assert.match(BONE_NAMES[id],/^(upperArm|forearm|hand)\.r$/);});}
 const w=tissueWeights('Maxillary artery.r.001',-.07,1.56,.035);assert.equal(BONE_NAMES[w.indices[0]],'head');assert.equal(w.weights[0],1);
});
