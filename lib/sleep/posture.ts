import * as T from 'three';
import type {HumanRig} from '../rig';
import {bedSurface,worldToBed,aboveBed} from '../bed.js';
/** Authored sleep pose: shoulder adduction brings the upper arm onto the body,
 * while the lower arm reaches forward along the mattress. */
export function poseSupportedSleep(r:HumanRig,roll:number,velocity=0){
 r.poseBed(14);const root=r.bones[0];root.quaternion.multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),roll));
 r.bone('spine').rotation.y=.035*velocity;r.bone('chest').rotation.y=.045*velocity;
 const side=T.MathUtils.smoothstep(Math.abs(roll),0,1.2);
 for(const [name,sign]of [['l',1],['r',-1]]as const){
  r.bone(`thigh.${name}`).rotation.x-=side*.22;r.bone(`shin.${name}`).rotation.x+=side*.38;
  const upper=T.MathUtils.smoothstep(-sign*Math.sin(roll),0,.93);
  r.bone(`upperArm.${name}`).rotation.x=T.MathUtils.lerp(.30,-.32+.17*upper,side);
  r.bone(`upperArm.${name}`).rotation.z=T.MathUtils.lerp(-sign*.13,-sign*(.12+.58*upper),side);
  const elbow=r.bone(`forearm.${name}`);elbow.rotation.set(-.08-side*.05,0,0);elbow.quaternion.multiply(new T.Quaternion().setFromAxisAngle(r.bone(`hand.${name}`).position.clone().normalize(),sign*.65));
 }
 root.updateMatrixWorld(true);r.updatePalette();let lowest=Infinity;
 for(const s of r.bedSamples){const p=r.transform(s.point,s.w),[x,z]=worldToBed(p.x,p.z,r.bedAnchor);if(aboveBed(x,z))lowest=Math.min(lowest,p.y-bedSurface(x,z,1));}
 if(Number.isFinite(lowest)){root.position.y+=.004-lowest;root.updateMatrixWorld(true);r.updatePalette();}
}
