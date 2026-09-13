import {bedViewPoint,followBedView} from '../rig-view';
import * as T from 'three';
import {AnatomyScene} from '../anatomy';
import {defaults} from '../physiology';
import {SkinSectionScene} from '../skin-section-scene';
import {sectionProfile} from '../skin-section-model';
import {skinRegions} from '../skin-section';
/** Adapter to the original CBP simulator interface. Reuses SOMA meshes and rig. */
export class Avatar {
 view:AnatomyScene;posture='standing';orbit={theta:.3,phi:1.4};lastOrbit='';lastTime=0;
 constructor(public container:HTMLDivElement){
  this.view=new AnatomyScene(container,{...defaults},{skin:14,dermis:0,adipose:0,skeleton:90,muscular:60,cardiovascular:100,nervous:55,visceral:70},{stats:()=>{},pick:()=>{},time:()=>{},site:()=>{},skin:()=>{}});
  cancelAnimationFrame(this.view.frame);this.view.controls.minDistance=.15;this.view.setComfortMode(true);
  const label=document.createElement('div');label.className='soma-load';label.textContent='SOMA 해부학 메시 불러오는 중…';container.appendChild(label);
  this.view.load(n=>{label.textContent=`전신 해부학 ${n}%`;}).then(()=>label.remove()).catch(()=>{label.textContent='해부학 모델을 불러오지 못했습니다. 새로고침해 주세요.';});
 }
 setBodyPosture(name:string){this.posture=name;this.view.focus(name==='lying'?'bed':'body');}
 setElectrodeLayout(){/* Sensor markers are anatomical surface sites, independent of grid tessellation. */}
 update(angles:{shoulderAbd:number;elbowFlex:number;wristPron:number;wristFlex:number},pulse:{heart:number},_grid:unknown,torso?:{walking:boolean;gaitPhase:number;pos:number[];tiltPitch_deg:number;tiltRoll_deg:number},state?:{t:number;instantHR:number;hemo?:{resp_bpm:number;respDepth:number}}){
  const v=this.view,r=v.rig,t=state?.t||0,dt=Math.max(0,Math.min(.1,t-this.lastTime));this.lastTime=t;
  const breath=(1+Math.sin(t*Math.PI*2*(state?.hemo?.resp_bpm||15)/60))/2,tidal=500*(state?.hemo?.respDepth??1);
  v.uniforms.uLungInflation.value=breath*Math.min(1,tidal/1000);v.uniforms.uResp.value=(breath*2-1)*tidal/500;v.softBody.update(dt,breath,tidal);
  // The chair task starts standing and finishes sitting at 2 s. Hold its
  // seated plateau (2–3 s), rather than replaying its standing first frame.
  if(this.posture==='sitting')r.poseTask('stand',2.5);
  else if(this.posture==='lying')r.poseTask('lie',14);
  else r.pose(torso?.gaitPhase||0,torso?.walking?1:0,0);
  // Arm-position controls apply to stationary sensing poses only. Walking
  // already supplies coordinated shoulders, elbows and inward-facing palms
  // from the shared capture; an Euler override erases the right forearm roll.
  if(this.posture!=='lying'&&this.posture!=='walking'&&!torso?.walking){
   r.bone('upperArm.r').rotation.set(-angles.shoulderAbd*Math.PI/180,0,0);
   r.bone('forearm.r').rotation.set(-angles.elbowFlex*Math.PI/180,0,0);
   r.bone('hand.r').rotation.set(-angles.wristFlex*Math.PI/180,angles.wristPron*Math.PI/180,0);
  }
  r.bones[0].updateMatrixWorld(true);r.updatePalette();v.skinRig.copyPose(r);
  if(v.followBed&&this.posture==='lying'){bedViewPoint(r.bone('pelvis'),r.bone('chest'),v.bedViewCurrent);followBedView(v.camera,v.controls.target,v.bedViewAnchor,v.bedViewCurrent);}
  v.chair.visible=this.posture==='sitting';v.bedGroup.visible=this.posture==='lying';
  v.uniforms.uBeat.value=pulse?.heart||0;v.uniforms.uCardiacCycles.value=(state?.t||0)*(state?.instantHR||72)/60;v.uniforms.uPulseGain.value=1;
  const orbit=JSON.stringify(this.orbit);if(orbit!==this.lastOrbit){const target=v.controls.target,dist=v.camera.position.distanceTo(target);v.camera.position.set(target.x+dist*Math.sin(this.orbit.phi)*Math.sin(this.orbit.theta),target.y+dist*Math.cos(this.orbit.phi),target.z+dist*Math.sin(this.orbit.phi)*Math.cos(this.orbit.theta));this.lastOrbit=orbit;}
  v.controls.update();v.renderer.render(v.scene,v.camera);
 }
 measureWristHeartDelta_cm(){const r=this.view.rig,w=r.bone('hand.r').getWorldPosition(new T.Vector3()),h=r.transform(new T.Vector3(0,1.27,.02));return (h.y-w.y)*100;}
 resize(){this.view.resize();}
 dispose(){this.view.dispose();}
}
export function makeWristSection(host:HTMLDivElement,fat=2.2,depth=3.3,lateral=0){const region={...skinRegions.find(r=>r.id==='wrist')!,arteryDepth:depth};const p=sectionProfile(region,fat);p.arteryDepth=depth;p.arteryX=lateral;p.total=Math.max(p.total,depth+9);p.coupledWrist=true;const bone=p.structures.find(s=>s.kind==='bone');if(bone)bone.depth=Math.max(bone.depth,depth+4.5);return new SkinSectionScene(host,p);}
