import * as THREE from 'three';

/** Baked contact planes are in atlas space; protected vertices share the ribs'
 * chest transform. Lower abdominal branches retain their existing binding. */
export function bindVesselClearance(geometry:THREE.BufferGeometry){
 const count=geometry.getAttribute('position').count;
 const guard=geometry.getAttribute('_rib_guard');
 geometry.setAttribute('ribGuard',guard||new THREE.Float32BufferAttribute(new Float32Array(count*4),4));
 const chest=geometry.getAttribute('_rib_chest');
 if(chest){
  // A local contact-mask island must not bind one edge of a vein to the chest
  // while its neighbours follow the spine. Use a common longitudinal tether,
  // reaching full chest attachment before the first protected cross-section.
  const position=geometry.getAttribute('position');let first=Infinity;
  for(let i=0;i<count;i++)if(chest.getX(i)>0)first=Math.min(first,position.getY(i));
  const indices=geometry.getAttribute('rigIndex'),weights=geometry.getAttribute('rigWeight');
  for(let i=0;i<count;i++){
   const influence=Number.isFinite(first)?THREE.MathUtils.smoothstep(position.getY(i),first-.14,first):0,merged=new Map<number,number>();
   for(let j=0;j<4;j++){const id=indices.getComponent(i,j);merged.set(id,(merged.get(id)||0)+weights.getComponent(i,j)*(1-influence));}
   merged.set(2,(merged.get(2)||0)+influence);
   const entries=[...merged].sort((a,b)=>b[1]-a[1]).slice(0,4),sum=entries.reduce((s,e)=>s+e[1],0);
   for(let j=0;j<4;j++){indices.setComponent(i,j,entries[j]?.[0]||0);weights.setComponent(i,j,(entries[j]?.[1]||0)/sum);}
  }
 }
 geometry.deleteAttribute('_rib_guard');geometry.deleteAttribute('_rib_chest');
}

export function constrainVessel(point:THREE.Vector3,guard:THREE.Vector4){
 const normal=new THREE.Vector3(guard.x,guard.y,guard.z);
 return point.clone().addScaledVector(normal,Math.max(0,guard.w-normal.dot(point)));
}

export const vesselClearanceShader=`
attribute vec4 ribGuard;
vec3 constrainVessel(vec3 p){
 return p+ribGuard.xyz*max(0.0,ribGuard.w-dot(ribGuard.xyz,p));
}
`;
