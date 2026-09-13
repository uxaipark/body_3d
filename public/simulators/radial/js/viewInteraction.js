// Central drag rolls around the longitudinal vessel axis; outer drag orbits.
// Patch dragging has priority over camera gestures.
export function isCenterDrag(x,y,rect){return Math.abs(x-rect.left-rect.width/2)<rect.width*.18&&Math.abs(y-rect.top-rect.height/2)<rect.height*.18;}
export function dragWristOrbit(orbit,dx,dy,mode){
 if(mode==='axial'){orbit.roll=(orbit.roll||0)+dx*.008;return;}
 orbit.theta+=dx*.006;
 if(mode==='orbit'&&dy!==0)orbit.phi=Math.max(.15,Math.min(Math.PI-.15,orbit.phi-dy*.006));
}

// Rotate the eye AND its up vector to retain the vessel direction on screen.
// Native atlas longitudinal axis is X; the local section's axis is Z.
export function rotateCameraAroundAxis(camera,target,axis,angle){
 camera.position.sub(target).applyAxisAngle(axis,angle).add(target);
 camera.up.applyAxisAngle(axis,angle).normalize();
 camera.lookAt(target);
}
