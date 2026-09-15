import * as THREE from 'three';
export function isArtery(name:string){return /artery|arteries|aorta|aortic arch|arterial|pulmonary trunk|brachiocephalic trunk|coeliac trunk|thyrocervical trunk|costocervical trunk/i.test(name)&&!/vein|venous|valve|atrium|ventricle/i.test(name);}
export function systolicPulse(cycles:number){const phase=((cycles%1)+1)%1;return phase<.38?Math.sin(Math.PI*phase/.38)**2:0;}
export function distensionFraction(stiffness:number){return .025*(1-.7*THREE.MathUtils.clamp(stiffness/100,0,1));}
export function arterialPulse(cycles:number,hr:number,pwv:number,distance:number){return systolicPulse(cycles-(.025+distance/Math.max(pwv,.1))*hr/60);}
/** Approximate route lengths and resting radii for a visual wall-motion model. */
export function arterialDistance(x:number,y:number,z:number){
 if(Math.abs(x)>.16&&y>.65&&y<1.43)return .17+Math.hypot(Math.abs(x)-.16,y-1.38,z);
 return .07+Math.abs(y-1.28)+Math.abs(x)*.5;
}
export function arteryRadius(name:string,geometry:THREE.BufferGeometry){
 if(/aorta|aortic arch/i.test(name))return .011;
 if(/common carotid|subclavian|common iliac|femoral artery/i.test(name))return .0035;
 if(/^radial artery|^ulnar artery/i.test(name))return .0014;
 if(/^brachial artery/i.test(name))return .002;
 geometry.computeBoundingBox();const d=geometry.boundingBox!.getSize(new THREE.Vector3());
 return THREE.MathUtils.clamp(Math.min(d.x,d.y,d.z)*.23,.0002,.002);
}
export function bindArterialPulse(geometry:THREE.BufferGeometry,name:string){
 const p=geometry.getAttribute('position'),data=new Float32Array(p.count*2),radius=arteryRadius(name,geometry);
 for(let i=0;i<p.count;i++){data[i*2]=radius;data[i*2+1]=arterialDistance(p.getX(i),p.getY(i),p.getZ(i));}
 geometry.setAttribute('pulseData',new THREE.BufferAttribute(data,2));
}
export const arterialShader=`
attribute vec2 pulseData;
uniform float uCardiacCycles;
uniform float uHeartRate;
uniform float uPWV;
uniform float uDistension;
uniform float uPulseGain;
float arterialWallPulse(){
 float phase=fract(uCardiacCycles-(.025+pulseData.y/max(uPWV,.1))*uHeartRate/60.0);
 if(phase>=.38)return 0.0;
 float s=sin(3.14159265359*phase/.38);return s*s;
}
`;
