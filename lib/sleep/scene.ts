import * as T from 'three';
import {AnatomyScene} from '../anatomy';
import {defaults} from '../physiology';
import {bedPlacement,bedSurface,worldToBed,aboveBed} from '../bed.js';
import {updateDeformedBounds} from '../rig-view';
import {PatchSurface,patchOrigin,boundPatch,type PatchPosition,type SurfaceAnchor} from './patch-surface';
/** Shared anatomical meshes, bed and rigid-joint rig. Sleep turns are authored,
 * eased poses (not a mocap claim); contact uses the fitted exterior samples. */
export class SleepScene{
 view:AnatomyScene;patch=new T.Group();roll=0;velocity=0;disposed=false;
 surface:PatchSurface|null=null;position:PatchPosition={...patchOrigin};editing=false;
 patchBase=new T.PlaneGeometry(.094,.040,16,8);anchors:SurfaceAnchor[]=[];attachments:{mesh:T.Object3D;x:number;y:number;height:number;anchors:SurfaceAnchor[]}[]=[];
 dragging:number|null=null;dragOffset={x:0,y:0};controlsEnabled=true;ray=new T.Raycaster();
 constructor(host:HTMLDivElement,progress:(n:number)=>void,private onPosition:(p:PatchPosition)=>void=()=>{}){
  this.view=new AnatomyScene(host,{...defaults,motion:'lie'},{skin:10,dermis:0,adipose:0,skeleton:50,muscular:24,cardiovascular:90,nervous:0,visceral:85},{stats:()=>{},pick:()=>{},time:()=>{},site:()=>{},skin:()=>{}});
  const v=this.view;cancelAnimationFrame(v.frame);v.setComfortMode(true);v.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));v.chair.visible=false;v.bedGroup.visible=true;
  for(const marker of v.markers.values())marker.visible=false;
  const base=new T.Mesh(this.patchBase,new T.MeshStandardMaterial({color:'#cbebe1',transparent:true,opacity:.8,roughness:.65,side:T.DoubleSide}));this.patch.add(base);
  for(let i=0;i<3;i++){const pad=new T.Mesh(new T.CylinderGeometry(.011,.011,.0015,32),new T.MeshStandardMaterial({color:['#f8c86a','#50e6c4','#7baeff'][i],metalness:.45,roughness:.38}));pad.rotation.x=Math.PI/2;pad.position.set((i-1)*.028,0,.0025);this.patch.add(pad);this.attachments.push({mesh:pad,x:(i-1)*.028,y:0,height:.0025,anchors:[]});}
  const chip=new T.Mesh(new T.BoxGeometry(.012,.009,.003),new T.MeshStandardMaterial({color:'#122c38'}));chip.position.set(0,.013,.003);this.patch.add(chip);v.root.add(this.patch);this.attachments.push({mesh:chip,x:0,y:.013,height:.003,anchors:[]});this.patch.visible=false;
  const canvas=v.renderer.domElement;canvas.addEventListener('pointerdown',this.pointerDown,true);canvas.addEventListener('pointermove',this.pointerMove,true);canvas.addEventListener('pointerup',this.pointerUp,true);canvas.addEventListener('pointercancel',this.pointerUp,true);canvas.addEventListener('lostpointercapture',this.pointerUp,true);
  v.rig.poseBed(14);v.skinRig.copyPose(v.rig);v.focus('bed');v.controls.target.set(-.15,.6,-.805);v.camera.position.set(1.2,1.8,1.0);v.controls.update();
  v.load(progress).then(()=>{if(this.disposed)return;const skin=v.meshes.find(m=>m.userData.layer==='skin'&&m.geometry.getAttribute('position').count>10000);if(skin){this.surface=new PatchSurface(skin.geometry);this.setPatchPosition(this.position);}}).catch(()=>progress(-1));
 }
 setLayers(skin:boolean){this.view.setLayers({skin:skin?92:10,dermis:0,adipose:0,skeleton:skin?20:50,muscular:skin?12:24,cardiovascular:90,nervous:0,visceral:85});}
 focus(chest:boolean){const v=this.view;if(chest){const p=this.anchors.length?this.deform(this.attachments[1].anchors[0]):v.rig.transform(new T.Vector3(0,1.24,.07));v.controls.target.copy(p);v.camera.position.copy(p).add(new T.Vector3(.25,.62,.55));}else{v.controls.target.set(-.15,.6,-.805);v.camera.position.set(1.2,1.8,1.0);}v.controls.update();}
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
  this.updatePatch();
  v.controls.update();v.renderer.render(v.scene,v.camera);
 }
 setPatchEditing(editing:boolean){this.editing=editing;if(!editing)this.endDrag();this.view.renderer.domElement.style.cursor=editing?'crosshair':'';}
 setPatchPosition(position:PatchPosition){
  const p=boundPatch(position);if(!this.surface){this.position=p;return;}
  const anchors:SurfaceAnchor[]=[];
  // Sample a curved grid from the fitted skin; no rigid box cuts through the chest.
  for(let i=0;i<this.patchBase.getAttribute('uv').count;i++){const uv=this.patchBase.getAttribute('uv'),a=this.surface.anchor(p.x+(uv.getX(i)-.5)*.094,p.y+(uv.getY(i)-.5)*.040);if(!a)return;anchors.push(a);}
  const attachments=this.attachments.map(a=>[this.surface!.anchor(p.x+a.x,p.y+a.y),this.surface!.anchor(p.x+a.x+.002,p.y+a.y),this.surface!.anchor(p.x+a.x,p.y+a.y+.002)]);
  if(attachments.some(a=>a.some(v=>!v)))return;
  this.anchors=anchors;this.attachments.forEach((a,i)=>a.anchors=attachments[i] as SurfaceAnchor[]);this.position=p;this.patch.visible=true;this.updatePatch();this.onPosition({...p});
 }
 deform=(anchor:SurfaceAnchor)=>this.surface!.deform(anchor,(p,w)=>this.view.skinRig.transform(p,w),p=>this.view.softBody.sample(p));
 updatePatch(){
  if(!this.anchors.length)return;const p=this.patchBase.getAttribute('position');this.anchors.forEach((a,i)=>{const v=this.deform(a);p.setXYZ(i,v.x,v.y,v.z);});
  this.patchBase.computeVertexNormals();const normals=this.patchBase.getAttribute('normal');for(let i=0;i<p.count;i++)p.setXYZ(i,p.getX(i)+normals.getX(i)*.0015,p.getY(i)+normals.getY(i)*.0015,p.getZ(i)+normals.getZ(i)*.0015);
  p.needsUpdate=true;this.patchBase.computeBoundingSphere();
  for(const a of this.attachments){const center=this.deform(a.anchors[0]),x=this.deform(a.anchors[1]).sub(center).normalize(),up=this.deform(a.anchors[2]).sub(center),z=x.clone().cross(up).normalize(),y=z.clone().cross(x).normalize();a.mesh.position.copy(center).addScaledVector(z,a.height);a.mesh.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(x,y,z));if(a.mesh instanceof T.Mesh&&a.mesh.geometry.type==='CylinderGeometry')a.mesh.rotateX(Math.PI/2);}
  this.patch.updateMatrixWorld(true);
 }
 pointerRay(e:PointerEvent){const box=this.view.renderer.domElement.getBoundingClientRect();this.ray.setFromCamera(new T.Vector2((e.clientX-box.left)/box.width*2-1,1-(e.clientY-box.top)/box.height*2),this.view.camera);}
 surfaceHit(){return this.surface?.pick(this.ray,(p,w)=>this.view.skinRig.transform(p,w),p=>this.view.softBody.sample(p))??null;}
 pointerDown=(e:PointerEvent)=>{
  if(e.button!==0||!this.surface||this.dragging!==null)return;this.pointerRay(e);
  const onPatch=this.patch.visible&&this.ray.intersectObject(this.patch,true).length>0;if(!this.editing&&!onPatch)return;
  const hit=this.surfaceHit();if(!hit)return;e.preventDefault();e.stopImmediatePropagation();this.dragging=e.pointerId;
  this.dragOffset=onPatch?{x:this.position.x-hit.x,y:this.position.y-hit.y}:{x:0,y:0};this.controlsEnabled=this.view.controls.enabled;this.view.controls.enabled=false;
  this.view.renderer.domElement.setPointerCapture(e.pointerId);this.view.renderer.domElement.style.cursor='grabbing';this.setPatchPosition({x:hit.x+this.dragOffset.x,y:hit.y+this.dragOffset.y});
 };
 pointerMove=(e:PointerEvent)=>{if(e.pointerId!==this.dragging)return;e.preventDefault();e.stopImmediatePropagation();this.pointerRay(e);const hit=this.surfaceHit();if(hit)this.setPatchPosition({x:hit.x+this.dragOffset.x,y:hit.y+this.dragOffset.y});};
 pointerUp=(e:PointerEvent)=>{if(e.pointerId!==this.dragging)return;e.preventDefault();e.stopImmediatePropagation();this.endDrag();};
 endDrag(){if(this.dragging===null)return;const id=this.dragging;this.dragging=null;const canvas=this.view.renderer.domElement;if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);this.view.controls.enabled=this.controlsEnabled;canvas.style.cursor=this.editing?'crosshair':'';}
 dispose(){this.disposed=true;this.endDrag();const canvas=this.view.renderer.domElement;canvas.removeEventListener('pointerdown',this.pointerDown,true);canvas.removeEventListener('pointermove',this.pointerMove,true);canvas.removeEventListener('pointerup',this.pointerUp,true);canvas.removeEventListener('pointercancel',this.pointerUp,true);canvas.removeEventListener('lostpointercapture',this.pointerUp,true);this.surface?.dispose();this.view.dispose();}
}
