import * as T from 'three';
/** GPU skinning does not update Three's CPU bounds. Use one conservative posed
 * envelope for anatomy batches so close views never cull the resting-pose box. */
export function updateDeformedBounds(bones:readonly T.Bone[],sphere:T.Sphere){
 let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
 for(const bone of bones){const e=bone.matrixWorld.elements;minX=Math.min(minX,e[12]);maxX=Math.max(maxX,e[12]);minY=Math.min(minY,e[13]);maxY=Math.max(maxY,e[13]);minZ=Math.min(minZ,e[14]);maxZ=Math.max(maxZ,e[14]);}
 sphere.center.set((minX+maxX)/2,(minY+maxY)/2,(minZ+maxZ)/2);
 // Includes scalp, soles, muscle envelopes and the physiological displacement.
 sphere.radius=Math.hypot(maxX-minX,maxY-minY,maxZ-minZ)/2+.30;
 return sphere;
}

/** Keep bed zoom centred on the moving trunk; preserve any deliberate pan offset. */
export function bedViewPoint(pelvis:T.Bone,chest:T.Bone,out:T.Vector3){
 const a=pelvis.matrixWorld.elements,b=chest.matrixWorld.elements;return out.set((a[12]+b[12])/2,(a[13]+b[13])/2+.04,(a[14]+b[14])/2);
}
export function followBedView(camera:T.Camera,orbitTarget:T.Vector3,previous:T.Vector3,current:T.Vector3){
 const dx=current.x-previous.x,dy=current.y-previous.y,dz=current.z-previous.z;camera.position.x+=dx;camera.position.y+=dy;camera.position.z+=dz;orbitTarget.x+=dx;orbitTarget.y+=dy;orbitTarget.z+=dz;previous.copy(current);
}
