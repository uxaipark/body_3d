// Central drag turns the wrist sideways (Y yaw); surrounding drag also tilts.
// Patch dragging has priority over camera gestures.
export function isCenterDrag(x,y,rect){return Math.abs(x-rect.left-rect.width/2)<rect.width*.18&&Math.abs(y-rect.top-rect.height/2)<rect.height*.18;}
export function dragWristOrbit(orbit,dx,dy,mode){
 orbit.theta+=dx*.006;
 if(mode==='orbit'&&dy!==0)orbit.phi=Math.max(.15,Math.min(Math.PI-.15,orbit.phi-dy*.006));
}
