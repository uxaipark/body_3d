import {sleepAnatomy} from './anatomy-data.js';
export const defaultPatchGeometry=sleepAnatomy.defaultGeometry;
export const heartCenter=[.028,1.29,.03];
const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),unit=a=>{const n=Math.hypot(...a)||1;return a.map(v=>v/n);},cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
/** Homogeneous quasi-static volume conductor, V = p·r/(4πσ|r|³).
 * Coordinates m, dipole A·m, conductivity S/m, returned potential mV.
 * This finite-size source is illustrative, not a personalized ECG forward FEM. */
export function dipolePotential(electrode,source,moment,conductivity=.2){const r=sub(electrode,source),distance=Math.max(.025,Math.hypot(...r));return 1000*dot(moment,r)/(4*Math.PI*conductivity*distance**3);}
export function bipolarPotential(electrodes,source,moment,conductivity=.2){return dipolePotential(electrodes[2],source,moment,conductivity)-dipolePotential(electrodes[0],source,moment,conductivity);}
export function patchFrame(geometry=defaultPatchGeometry){const x=unit(sub(geometry.electrodes[2],geometry.electrodes[0])),up=sub(geometry.up,geometry.electrodes[1]),z=unit(cross(x,up)),y=unit(cross(z,x));return [x,y,z];}
/** Regional mechanical footprint integrates the actual anterior lung mesh map.
 * The small direct dielectric term decays with coplanar-electrode field depth.
 * Fat thickness and spatial kernels are explicit effective model assumptions. */
export function patchCoupling(geometry=defaultPatchGeometry,fatMm=8){
 const sigma=.030,normalizer=2*Math.PI*sigma*sigma,area=sleepAnatomy.step**2;
 return geometry.electrodes.map(p=>{let lung=0,direct=0,depthSum=0,coverage=0;
  for(const q of sleepAnatomy.front){const lateral=(p[0]-q[0])**2+(p[1]-q[1])**2,w=Math.exp(-lateral/(2*sigma*sigma))*area/normalizer,depth=Math.max(.006,p[2]-q[2]);lung+=w*Math.exp(-depth/.065);direct+=w*Math.exp(-2*Math.PI*depth/.028);depthSum+=w*depth;coverage+=w;}
  const fat=Math.exp(-Math.max(0,fatMm)/35),abdomen=.20*Math.exp(-((p[0]/.09)**2+((p[1]-1.095)/.065)**2));
  return {lung:lung*fat,abdomen:abdomen*fat,gain:Math.min(1,(lung+abdomen)*fat),direct:direct*Math.exp(-fatMm/15),depth:coverage>.01?depthSum/coverage:null};
 });
}
export function patchExcursions(coupling,volume,effort,tidal,obstructed=false){return coupling.map(c=>.008*(c.lung*(obstructed?effort*tidal/.5:volume/.5)+c.abdomen*effort*tidal/.5));}
export function cardiacLead(phase,effort,excursions,geometry=defaultPatchGeometry,conductivity=.2){
 const electrodes=geometry.electrodes.map((p,i)=>add(p,[0,0,excursions[i]])),source=add(heartCenter,[0,-.002*effort,0]),g=(c,w,a)=>a*Math.exp(-.5*((phase-c)/w)**2);
 const waves=[[g(.16,.035,.12),[.80,-.52,.12]],[g(.36,.012,-.15),[.20,-.92,-.32]],[g(.4,.009,1.1),[.55,-.82,.16]],[g(.435,.014,-.23),[.75,-.32,.57]],[g(.68,.065,.29),[.40,-.68,.61]]];
 // Different activation/repolarization axes allow P/QRS/T ratios and polarity
 // to change with lead position, not just a scalar distance multiplier.
 const angle=.06*(effort-.5),c=Math.cos(angle),s=Math.sin(angle),moment=[0,0,0];
 for(const [amplitude,direction] of waves){const d=unit(direction),rotated=[c*d[0]-s*d[1],s*d[0]+c*d[1],d[2]];for(let i=0;i<3;i++)moment[i]+=amplitude*rotated[i]*.00008;}
 return bipolarPotential(electrodes,source,moment,conductivity);
}
export function accelerometer(geometry,roll,effort,normalAcceleration,speed,angularAcceleration,motionNoise,noise){
 const angle=roll+.035*effort,p=geometry.electrodes[1],r=[p[0],0,p[2]+.02],body=[9.80665*Math.sin(angle)+angularAcceleration*r[2]-speed*speed*r[0]+motionNoise*.6,0,9.80665*Math.cos(angle)+normalAcceleration-angularAcceleration*r[0]-speed*speed*r[2]+motionNoise*.3];
 return patchFrame(geometry).map(axis=>dot(body,axis)+noise());
}
