import * as T from 'three';
const smooth=(a,b,x)=>{const t=T.MathUtils.clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const V=a=>new T.Vector3(...a);
// Landmarks measured from the restored MakeHuman asset, after its original
// A-pose conversion. Targets follow the visible atlas bone cross-sections;
// paired radius/ulna and tibia/fibula use their combined centre, not one bone.
export const skinLandmarks={
 shoulder:[.167,1.375,-.019],elbow:[.222,1.090,-.014],wrist:[.26356,.863,.012],
 hip:[.0997845,.9227754,-.0287684],knee:[.0854922,.5021254,.0052552],ankle:[.0881978,.0711637,-.0063894],
};
export const skinTargets={shoulder:[.170,1.375,-.025],elbow:[.225,1.098,-.035],wrist:[.259,.863,.0135],hip:[.1014,.867,-.009],knee:[.077,.438,-.028],ankle:[.086,.073,-.043]};
const target=skinTargets;
function segment(a,b,width=1){
 const from=V(skinLandmarks[a]),to=V(target[a]),axis=V(skinLandmarks[b]).sub(from),end=V(target[b]).sub(to);
 const ratio=end.length()/axis.length();axis.normalize();const rotation=new T.Quaternion().setFromUnitVectors(axis,end.normalize());
 return p=>{const r=p.clone().sub(from),along=r.dot(axis),w=typeof width==='function'?width(p.y):width;r.multiplyScalar(w).addScaledVector(axis,along*(ratio-w));return r.applyQuaternion(rotation).add(to);};
}
const upperArm=segment('shoulder','elbow'),forearm=segment('elbow','wrist',y=>1.1+.65*(1-smooth(.84,.98,y))),thigh=segment('hip','knee',1.1),shin=segment('knee','ankle',y=>1.25+.5*(1-smooth(.09,.20,y)));
const handOffset=V(target.wrist).sub(V(skinLandmarks.wrist)),footOffset=V(target.ankle).sub(V(skinLandmarks.ankle));
export function registerSkinPoint(point){
 const p=point.clone(),sign=p.x<0?-1:1,ax=Math.abs(p.x),y=p.y;p.x=ax;
 const torso=p.clone(),pelvis=1-smooth(.96,1.20,y);
 torso.y-=.0557754*pelvis;torso.z+=.0227684*pelvis;
 // Register the whole head, including eyes, hair and brows, to the skull.
 // Preserve facial relief while moving the cranial centre back into the atlas.
 const head=smooth(1.43,1.50,y);
 torso.z=T.MathUtils.lerp(torso.z,p.z*1.0833-.0373,head);
 torso.x*=1+.08*head;
 const jaw=1-smooth(1.52,1.58,y);
 torso.y-=head*(.014*(1-.8*jaw)*(1-smooth(1.63,1.72,y))+.004*smooth(1.63,1.72,y));
 const legGuard=1-smooth(.70,.78,y)*(1-smooth(.038,.085,ax));
 const leg=(1-smooth(.93,1.00,y))*legGuard;
 const legPoint=thigh(p).lerp(shin(p),1-smooth(.467,.537,y));
 const foot=p.clone().add(footOffset);foot.x=target.ankle[0]+(p.x-skinLandmarks.ankle[0])*(1.15+.6*smooth(.025,.065,y));
 legPoint.lerp(foot,1-smooth(.055,.095,y));
 const arm=Math.max(smooth(.15+Math.max(0,1.12-y)*.30-.01,.15+Math.max(0,1.12-y)*.30+.01,ax)*smooth(.60,.67,y)*(1-smooth(1.36,1.44,y)),smooth(.18,.195,ax)*smooth(.63,.67,y)*(1-smooth(.82,.85,y)));
 const armPoint=upperArm(p).lerp(forearm(p),1-smooth(1.055,1.125,y));
 const hand=p.clone().add(handOffset),wristWidth=1+.65*smooth(.79,.86,y);
 hand.x=target.wrist[0]+(p.x-skinLandmarks.wrist[0])*wristWidth;
 hand.z=target.wrist[2]+(p.z-skinLandmarks.wrist[2])*wristWidth;
 armPoint.lerp(hand,1-smooth(.843,.888,y));
 // Arm envelopes take precedence beside the groin; the central pelvis stays one piece.
 const mapped=torso.lerp(legPoint,leg*(1-arm)).lerp(armPoint,arm);
 mapped.x*=sign;return mapped;
}
export function registerSkinGeometry(geometry){
 const position=geometry.getAttribute('position'),pelvic=[];
 for(let i=0;i<position.count;i++){
  const source=new T.Vector3().fromBufferAttribute(position,i);
  if(Math.abs(source.x)<.038&&source.y>.78&&source.y<.99)pelvic.push(i);
  const p=registerSkinPoint(source);position.setXYZ(i,p.x,p.y,p.z);
 }
 geometry.computeVertexNormals();return pelvic;
}
