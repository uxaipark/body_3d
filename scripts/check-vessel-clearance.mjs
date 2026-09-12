import fs from 'node:fs';import * as T from 'three';
import {NodeIO} from '@gltf-transform/core';import {ALL_EXTENSIONS} from '@gltf-transform/extensions';import draco from 'draco3dgltf';
import {HumanRig,bindGeometry} from '../lib/rig.ts';
import {SoftBody} from '../lib/soft-body.ts';
import {bindCardiacMotion,cardiacDisplacement} from '../lib/cardiac.ts';
import {isArtery,arteryRadius} from '../lib/arterial.ts';
import {bindVesselClearance,constrainVessel} from '../lib/vessel-clearance.ts';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco.createDecoderModule()});
const doc=await io.read('public/models/cardiovascular-web.glb'),rig=new HumanRig();
const bodies=[0,.5,1].map(breath=>{const b=new SoftBody();for(let i=0;i<180;i++)b.update(1/60,breath,1000);return b;});
const cases=[];for(const run of [-1,0,.5,1])for(let phase=0;phase<(run<0?1:8);phase++)for(let breath=0;breath<3;breath++)cases.push({run,phase:phase/8,breath});
const output={ribs:JSON.parse(fs.readFileSync('/tmp/soma-vessel-contact.json')).ribs,vessels:[],cases};
for(const node of doc.getRoot().listNodes()){
 if(!node.getMesh())continue;
 for(const p of node.getMesh().listPrimitives()){
  if(!p.getAttribute('_RIB_GUARD'))continue;
  const g=new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(p.getAttribute('POSITION').getArray(),3)).setAttribute('normal',new T.BufferAttribute(p.getAttribute('NORMAL').getArray(),3)).setAttribute('_rib_guard',new T.BufferAttribute(p.getAttribute('_RIB_GUARD').getArray(),4)).setAttribute('_rib_chest',new T.BufferAttribute(p.getAttribute('_RIB_CHEST').getArray(),1));
  g.applyMatrix4(new T.Matrix4().fromArray(node.getWorldMatrix()));bindGeometry(g);bindCardiacMotion(g,node.getName());bindVesselClearance(g);
  const pos=g.getAttribute('position'),norm=g.getAttribute('normal'),guard=g.getAttribute('ribGuard'),cardiac=g.getAttribute('cardiacData'),ix=g.getAttribute('rigIndex'),weight=g.getAttribute('rigWeight'),pulse=isArtery(node.getName())?arteryRadius(node.getName(),g)*.025:0;
  const phases=[];
  for(const c of cases){
   rig.pose(c.phase,c.run<0?0:1,Math.max(0,c.run));const inverseChest=new T.Matrix4().fromArray(rig.skeleton.boneMatrices,32).invert(),points=[];
   for(let i=0;i<pos.count;i++){
    const rest=new T.Vector3().fromBufferAttribute(pos,i),influence=cardiac.getY(i),offset=bodies[c.breath].sample(rest).multiplyScalar(1-influence).add(new T.Vector3(0,-.002*c.breath/2*influence,0));
    const point=rest.clone().add(offset).add(cardiacDisplacement(rest,cardiac.getX(i),influence,c.phase)).addScaledVector(new T.Vector3().fromBufferAttribute(norm,i),pulse);
    const bounded=constrainVessel(point,new T.Vector4().fromBufferAttribute(guard,i));
    const w={indices:[0,1,2,3].map(j=>ix.getComponent(i,j)),weights:[0,1,2,3].map(j=>weight.getComponent(i,j))};
    points.push(rig.transform(bounded,w).applyMatrix4(inverseChest).toArray());
   }
   phases.push(points);
  }
  output.vessels.push({name:node.getName(),indices:Array.from(p.getIndices().getArray()),phases});
 }
}
fs.writeFileSync('/tmp/soma-vessel-poses.json',JSON.stringify(output));console.log('Exported',output.vessels.length,'vessels ×',cases.length,'motion/breath states, maximum pulse distension');
