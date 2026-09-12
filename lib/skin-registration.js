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
const upperArm=segment('shoulder','elbow'),forearm=segment('elbow','wrist'),thigh=segment('hip','knee'),shin=segment('knee','ankle');
const handOffset=V(target.wrist).sub(V(skinLandmarks.wrist)),footOffset=V(target.ankle).sub(V(skinLandmarks.ankle));
const forearmAxis=V(target.wrist).sub(V(target.elbow)).normalize();
export function registerSkinPoint(point,armSide=0){
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
 const foot=p.clone().add(footOffset);
 legPoint.lerp(foot,1-smooth(.055,.095,y));
 const arm=Math.max(smooth(.15+Math.max(0,1.12-y)*.30-.01,.15+Math.max(0,1.12-y)*.30+.01,ax)*smooth(.60,.67,y)*(1-smooth(1.36,1.44,y)),smooth(.18,.195,ax)*smooth(.63,.67,y)*(1-smooth(.82,.85,y)));
 const armPoint=upperArm(p).lerp(forearm(p),1-smooth(1.055,1.125,y));
 const hand=p.clone().add(handOffset);
 armPoint.lerp(hand,1-smooth(.843,.888,y));
 // Normalize MakeHuman's inward-facing neutral hands to the atlas's forward
 // palms. The shared runtime forearm rotation then moves skin and bones together.
 const untwist=-(Math.PI/2)*(1-smooth(.865,1.08,y));
 armPoint.sub(V(target.elbow)).applyAxisAngle(forearmAxis,untwist).add(V(target.elbow));
 if(armSide){armPoint.x*=sign;return armPoint;}
 // Arm envelopes take precedence beside the groin; the central pelvis stays one piece.
 const mapped=torso.lerp(legPoint,leg*(1-arm)).lerp(armPoint,arm);
 mapped.x*=sign;return mapped;
}
/** Find the distal arms in the ORIGINAL mesh, before registration changes their
 * coordinates. Cutting below the shoulder separates arms from the trunk;
 * welded position duplicates preserve connectivity across UV seams. */
export function skinArmMembership(geometry){
 const p=geometry.getAttribute('position'),parent=Int32Array.from({length:p.count},(_,i)=>i),eligible=new Uint8Array(p.count),weld=new Map();
 const root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
 const join=(a,b)=>{if(eligible[a]&&eligible[b])parent[root(a)]=root(b);};
 for(let i=0;i<p.count;i++){
  if(p.getY(i)>=1.24)continue;eligible[i]=1;
  const key=[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e6)).join(',');
  const previous=weld.get(key);if(previous!==undefined)join(i,previous);else weld.set(key,i);
 }
 const ix=geometry.index,count=ix?ix.count:p.count;
 for(let i=0;i+2<count;i+=3){const a=ix?ix.getX(i):i,b=ix?ix.getX(i+1):i+1,c=ix?ix.getX(i+2):i+2;join(a,b);join(b,c);join(c,a);}
 const labels=new Int8Array(p.count);
 for(const side of [-1,1]){
  const wrist=V(skinLandmarks.wrist);wrist.x*=side;let best=-1,distance=.065**2;
  for(let i=0;i<p.count;i++)if(eligible[i]){
   const d=(p.getX(i)-wrist.x)**2+(p.getY(i)-wrist.y)**2+(p.getZ(i)-wrist.z)**2;
   if(d<distance){distance=d;best=i;}
  }
  if(best<0)continue;const armRoot=root(best);
  for(let i=0;i<p.count;i++)if(eligible[i]&&root(i)===armRoot)labels[i]=side;
 }
 return labels;
}
export function registerSkinGeometry(geometry){
 const position=geometry.getAttribute('position'),pelvic=[],arms=skinArmMembership(geometry);
 for(let i=0;i<position.count;i++){
  const source=new T.Vector3().fromBufferAttribute(position,i);
  if(Math.abs(source.x)<.038&&source.y>.78&&source.y<.99)pelvic.push(i);
  const p=registerSkinPoint(source,arms[i]);position.setXYZ(i,p.x,p.y,p.z);
 }
 geometry.setAttribute('skinArmSide',new T.BufferAttribute(arms,1));
 geometry.computeVertexNormals();return pelvic;
}
