/** Shared geometry/pose rules for the liver and attached gallbladder.
 * A bounded diaphragm translation replaces the expanding abdominal tissue field.
 * Illustrative respiratory excursion, not a patient-calibrated mechanics model.
 */
export const hepaticMotion={center:[-.01,1.18,.01],scale:[.90,1,.78],posterior:.012,descent:.006};
export function isHepatic(name){return /liver|gallbladder/i.test(name);}
export function hepaticPoint(point,inflation=0){
 const c=hepaticMotion.center,s=hepaticMotion.scale;
 return point.clone().set(c[0]+(point.x-c[0])*s[0],point.y-hepaticMotion.descent*Math.max(0,Math.min(1,inflation)),c[2]+(point.z-c[2])*s[2]-hepaticMotion.posterior);
}
export function fitHepaticGeometry(geometry){
 const p=geometry.getAttribute('position');
 for(let i=0;i<p.count;i++)p.setXYZ(i,hepaticMotion.center[0]+(p.getX(i)-hepaticMotion.center[0])*hepaticMotion.scale[0],p.getY(i),hepaticMotion.center[2]+(p.getZ(i)-hepaticMotion.center[2])*hepaticMotion.scale[2]-hepaticMotion.posterior);
 geometry.computeVertexNormals();
}
