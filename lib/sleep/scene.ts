import * as T from 'three';
import {AnatomyScene} from '../anatomy';
import {defaults} from '../physiology';
import {bedPlacement,bedSurface,worldToBed,aboveBed} from '../bed.js';
import {updateDeformedBounds} from '../rig-view';
/** Shared anatomical meshes, bed and rigid-joint rig. Sleep turns are authored,
 * eased poses (not a mocap claim); contact uses the fitted exterior samples. */
export class SleepScene{
 view:AnatomyScene;patch=new T.Group();roll=0;velocity=0;disposed=false;
 constructor(host:HTMLDivElement,progress:(n:number)=>void){
  this.view=new AnatomyScene(host,{...defaults,motion:'lie'},{skin:10,dermis:0,adipose:0,skeleton:50,muscular:24,cardiovascular:90,nervous:0,visceral:85},{stats:()=>{},pick:()=>{},time:()=>{},site:()=>{},skin:()=>{}});
  const v=this.view;cancelAnimationFrame(v.frame);v.setComfortMode(true);v.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));v.chair.visible=false;v.bedGroup.visible=true;
  for(const marker of v.markers.values())marker.visible=false;
  const base=new T.Mesh(new T.BoxGeometry(.094,.040,.002),new T.MeshStandardMaterial({color:'#cbebe1',transparent:true,opacity:.8,roughness:.65}));this.patch.add(base);
  for(let i=0;i<3;i++){const pad=new T.Mesh(new T.CylinderGeometry(.011,.011,.0015,32),new T.MeshStandardMaterial({color:['#f8c86a','#50e6c4','#7baeff'][i],metalness:.45,roughness:.38}));pad.rotation.x=Math.PI/2;pad.position.set((i-1)*.028,0,.0025);this.patch.add(pad);}
  const chip=new T.Mesh(new T.BoxGeometry(.012,.009,.003),new T.MeshStandardMaterial({color:'#122c38'}));chip.position.set(0,.013,.003);this.patch.add(chip);v.root.add(this.patch);
  v.rig.poseBed(14);v.skinRig.copyPose(v.rig);v.focus('bed');v.controls.target.set(-.15,.6,-.805);v.camera.position.set(1.2,1.8,1.0);v.controls.update();
  v.load(progress).catch(()=>progress(-1));
 }
 setLayers(skin:boolean){this.view.setLayers({skin:skin?92:10,dermis:0,adipose:0,skeleton:skin?20:50,muscular:skin?12:24,cardiovascular:90,nervous:0,visceral:85});}
 focus(chest:boolean){const v=this.view;if(chest){const p=v.rig.transform(new T.Vector3(0,1.24,.07));v.controls.target.copy(p);v.camera.position.copy(p).add(new T.Vector3(.25,.62,.55));}else{v.controls.target.set(-.15,.6,-.805);v.camera.position.set(1.2,1.8,1.0);}v.controls.update();}
 update(dt:number,target:number,volume:number,effort:number,heart:number){
  if(this.disposed)return;const v=this.view,r=v.rig;dt=Math.min(dt,.05);
  this.velocity=dt>0?(target-this.roll)/dt:0;this.roll=target;
  r.poseBed(14);const root=r.bones[0];root.quaternion.multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),this.roll));
  r.bone('spine').rotation.y=.035*this.velocity;r.bone('chest').rotation.y=.045*this.velocity;
  const side=Math.abs(this.roll)/1.2;
  for(const [name,sign] of [['l',1],['r',-1]]as const){r.bone(`thigh.${name}`).rotation.x-=side*.22;r.bone(`shin.${name}`).rotation.x+=side*.38;r.bone(`upperArm.${name}`).rotation.x-=side*.36;r.bone(`forearm.${name}`).rotation.x-=side*.18;}
  root.updateMatrixWorld(true);r.updatePalette();
  // A common pelvis correction keeps all anatomy together; do not stretch bones
  // or clamp individual vertices against the bed.
  let lowest=Infinity;for(const s of r.bedSamples){const p=r.transform(s.point,s.w),[x,z]=worldToBed(p.x,p.z,r.bedAnchor);if(aboveBed(x,z))lowest=Math.min(lowest,p.y-bedSurface(x,z,1));}
  if(Number.isFinite(lowest)){root.position.y+=.004-lowest;root.updateMatrixWorld(true);r.updatePalette();}
  v.skinRig.copyPose(r);updateDeformedBounds(r.bones,v.bodyBounds);v.bedGroup.position.set(bedPlacement.x,0,bedPlacement.z);v.bedLoad.value=1;
  v.uniforms.uLungInflation.value=Math.min(.85,volume);v.uniforms.uResp.value=effort*2-1;v.softBody.update(dt,effort,500);v.uniforms.uCardiacCycles.value=heart;v.uniforms.uBeat.value=Math.exp(-(((heart%1-.12)/.09)**2));
  const center=new T.Vector3(0,1.135,.123);center.add(v.softBody.sample(center));this.patch.position.copy(r.transform(center));this.patch.quaternion.copy(r.bone('spine').getWorldQuaternion(new T.Quaternion()));
  v.controls.update();v.renderer.render(v.scene,v.camera);
 }
 dispose(){this.disposed=true;this.view.dispose();}
}
