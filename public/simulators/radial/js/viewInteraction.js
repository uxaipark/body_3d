// Select the gesture at pointer-down; crossing another zone cannot flip it.
export function isCenterDrag(x,y,rect){return Math.abs(x-rect.left-rect.width/2)<rect.width*.18&&Math.abs(y-rect.top-rect.height/2)<rect.height*.18;}
export function wristDragMode(x,y,rect){
 if(isCenterDrag(x,y,rect))return 'axial';
 const yFraction=(y-rect.top)/rect.height;
 return yFraction<.32?'twistTop':yFraction>.68?'twistBottom':'orbit';
}
export function rotateCameraAroundAxis(camera,target,axis,angle){
 camera.position.sub(target).applyAxisAngle(axis,angle).add(target);
 camera.up.applyAxisAngle(axis,angle).normalize();
 camera.lookAt(target);camera.updateMatrixWorld();
}
export function axialRotationSign(camera,axis){
 camera.updateMatrixWorld();const m=camera.matrixWorld.elements;
 const up=axis.x*m[4]+axis.y*m[5]+axis.z*m[6];
 const right=axis.x*m[0]+axis.y*m[1]+axis.z*m[2];
 return -Math.sign(Math.abs(up)>.05?up:(right||1));
}
export function dragWristCamera(camera,target,axis,dx,dy,mode,axialSign=axialRotationSign(camera,axis)){
 if(mode==='axial'){rotateCameraAroundAxis(camera,target,axis,dx*.008*axialSign);return;}
 if(mode==='twistTop'||mode==='twistBottom'){
  const eye=camera.position.clone().sub(target).normalize();
  rotateCameraAroundAxis(camera,target,eye,dx*.008*(mode==='twistTop'?1:-1));return;
 }
 // Camera motion is inverse to the visible object's motion.
 camera.updateMatrixWorld();const up=camera.up.clone().setFromMatrixColumn(camera.matrixWorld,1);
 rotateCameraAroundAxis(camera,target,up,-dx*.006);
 const right=camera.up.clone().setFromMatrixColumn(camera.matrixWorld,0);
 rotateCameraAroundAxis(camera,target,right,-dy*.006);
}
