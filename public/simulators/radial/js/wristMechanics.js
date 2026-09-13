/** SOMA wrist reduced-order mechanics. All distances mm, time s, pressure mmHg.
 * Assumptions to calibrate: tissue relaxation 18 ms, Gaussian support length,
 * fixed deep support and effective electrode sensitivity. NOT a FEM solver.
 * The negative surrounding lobe is a specified boundary-condition hypothesis,
 * not a universal consequence of tissue incompressibility.
 */
export const WRIST_MECHANICS = Object.freeze({radius_mm:1.1,wall_mm:.18,fat_mm:2.2,tau_s:.018,rho_kgm3:1060,pwv_ms:6,capSensitivity_pFmm:11.15});
export function radiusPerPressure(pwv=WRIST_MECHANICS.pwv_ms,radius=WRIST_MECHANICS.radius_mm){return radius*133.322/(2*WRIST_MECHANICS.rho_kgm3*Math.max(2,pwv)**2);}
export function surfaceTransfer(lateralDistance_mm,depth_mm,fat_mm=2.2){
 const width=Math.max(2.5,depth_mm*1.2+fat_mm*.25),u=lateralDistance_mm/width;
 const kernel=(Math.exp(-u*u/2)-Math.exp(-u*u/8)/4)/.75;
 return kernel*Math.exp(-Math.max(0,depth_mm-1.1)/(3+fat_mm));
}
export function surroundingDisplacement(lateral_mm,depthBelowSurface_mm,arteryLateral_mm,arteryDepth_mm,radiusDelta_mm,fat_mm=2.2){
 const x=lateral_mm-arteryLateral_mm,y=arteryDepth_mm-depthBelowSurface_mm,r=Math.hypot(x,y),R=1.1;
 const radial=radiusDelta_mm*R/Math.max(R,r),support=Math.exp(-Math.max(0,depthBelowSurface_mm-arteryDepth_mm)/4);
 const skinWeight=Math.exp(-Math.max(0,depthBelowSurface_mm)/1.8);
 return {lateral_mm:radial*x/Math.max(R,r)*support,
  vertical_mm:((1-skinWeight)*radial*y/Math.max(R,r)+skinWeight*surfaceTransfer(x,arteryDepth_mm,fat_mm)*radiusDelta_mm)*support};
}
export class WristRelaxation {
 constructor(){this.states=new Map();}
 step(key,index,target,fs,tau=WRIST_MECHANICS.tau_s){let s=this.states.get(key);if(!s||index<s.index){s={index:index-1,value:0};this.states.set(key,s);}if(index>s.index){const dt=Math.min(.1,(index-s.index)/fs);s.value+=(target-s.value)*(-Math.expm1(-dt/Math.max(.0001,tau)));s.index=index;}return s.value;}
}
