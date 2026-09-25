import * as T from 'three';
import {HumanRig,BONE_NAMES,surfaceTissueWeight,type Weights} from './rig.ts';

interface Branch {box:T.Box3;left?:Branch;right?:Branch;faces?:number[]}
/** A load-time triangle index of the actual exterior, independent of visibility.
 * No per-frame nearest-neighbour search or additional draw pass. */
export class SkinBoundary {
 points:T.Vector3[];normals:T.Vector3[];weights:Weights[];faces:number[][];tree:Branch;faceArm:number[];
 constructor(g:T.BufferGeometry){
  if(!g.getAttribute('normal'))g.computeVertexNormals();
  const normals=g.getAttribute('normal');
  const p=g.getAttribute('position'),ix=g.getAttribute('rigIndex'),w=g.getAttribute('rigWeight');
  this.points=Array.from({length:p.count},(_,i)=>new T.Vector3().fromBufferAttribute(p,i));
  this.normals=this.points.map((_,i)=>new T.Vector3().fromBufferAttribute(normals,i));
  this.weights=this.points.map((_,i)=>({indices:[0,1,2,3].map(j=>ix.getComponent(i,j)),weights:[0,1,2,3].map(j=>w.getComponent(i,j))}));
  const index=g.index;this.faces=Array.from({length:(index?.count??p.count)/3},(_,f)=>[0,1,2].map(j=>index?index.getX(f*3+j):f*3+j));
  this.faces=this.faces.filter(ids=>new T.Triangle(...ids.map(i=>this.points[i]) as [T.Vector3,T.Vector3,T.Vector3]).getArea()>1e-10);
  this.faceArm=this.faces.map(ids=>ids.reduce((sum,i)=>sum+this.weights[i].weights.reduce((s,w,j)=>s+(/^(upperArm|forearm|hand)\./.test(BONE_NAMES[this.weights[i].indices[j]])?w:0),0),0)/3);
  const boxes=this.faces.map(ids=>new T.Box3().setFromPoints(ids.map(i=>this.points[i]))),centers=boxes.map(b=>b.getCenter(new T.Vector3()));
  const build=(ids:number[]):Branch=>{const box=new T.Box3();for(const i of ids)box.union(boxes[i]);if(ids.length<=12)return {box,faces:ids};const size=box.getSize(new T.Vector3()),axis=size.x>size.y?(size.x>size.z?0:2):(size.y>size.z?1:2);ids.sort((a,b)=>centers[a].getComponent(axis)-centers[b].getComponent(axis));const mid=ids.length>>1;return {box,left:build(ids.slice(0,mid)),right:build(ids.slice(mid))};};
  this.tree=build(this.faces.map((_,i)=>i));
 }
 nearest(p:T.Vector3,armWeight?:number){
  let distance=Infinity,face=-1;const point=new T.Vector3(),candidate=new T.Vector3(),triangle=new T.Triangle();
  const visit=(node:Branch)=>{if(node.box.distanceToPoint(p)**2>distance)return;if(node.faces){for(const f of node.faces){if(armWeight!==undefined&&Math.abs(this.faceArm[f]-armWeight)>.35)continue;const ids=this.faces[f];triangle.set(...ids.map(i=>this.points[i]) as [T.Vector3,T.Vector3,T.Vector3]);triangle.closestPointToPoint(p,candidate);const d=candidate.distanceToSquared(p);if(d<distance){distance=d;face=f;point.copy(candidate);}}}else{const a=node.left!,b=node.right!;if(a.box.distanceToPoint(p)<b.box.distanceToPoint(p)){visit(a);visit(b);}else{visit(b);visit(a);}}};
  visit(this.tree);const ids=this.faces[face];triangle.set(...ids.map(i=>this.points[i]) as [T.Vector3,T.Vector3,T.Vector3]);return {ids,point,normal:triangle.getNormal(new T.Vector3()),distance:Math.sqrt(distance)};
 }
 contains(p:T.Vector3){
  const ray=new T.Ray(p,new T.Vector3(1,.371,.123).normalize()),hit=new T.Vector3(),distances:{d:number;sign:number}[]=[];
  const visit=(node:Branch)=>{if(!ray.intersectBox(node.box,hit))return;if(node.faces){for(const f of node.faces){const [a,b,c]=this.faces[f].map(i=>this.points[i]);if(ray.intersectTriangle(a,b,c,false,hit))distances.push({d:hit.distanceTo(p),sign:new T.Triangle(a,b,c).getNormal(new T.Vector3()).dot(ray.direction)>0?1:-1});}}else{visit(node.left!);visit(node.right!);}};visit(this.tree);
  distances.sort((a,b)=>a.d-b.d);return distances.filter((v,i)=>i===0||v.d-distances[i-1].d>1e-7).reduce((sum,v)=>sum+v.sign,0)!==0;
 }
 posed(rig:HumanRig,displacement?:(p:T.Vector3)=>T.Vector3){return this.points.map((p,i)=>rig.transform(displacement?p.clone().addScaledVector(displacement(p),surfaceTissueWeight(this.weights[i])):p,this.weights[i]));}
}

// Include a 2 mm allowance for the curved surface between triangle anchors.
export const NERVE_SKIN_CLEARANCE=.005;
/** CPU reference: bounded sliding around a skin-driven interior anchor, then
 * unilateral surface contact. Cervical insertions retain their spinal binding. */
export function constrainNerveToFace(p:T.Vector3,a:T.Vector3,b:T.Vector3,c:T.Vector3,anchor?:T.Vector4,embedded?:T.Vector3,surfaceNormal?:T.Vector3){
 if(anchor&&anchor.w<0)return p.clone();
 const normal=surfaceNormal?.clone()??new T.Vector3().subVectors(b,a).cross(new T.Vector3().subVectors(c,a));
 if(normal.lengthSq()<1e-24)return p.clone();normal.normalize();
 const result=p.clone();
 if(anchor){const center=embedded?embedded.clone().addScaledVector(normal,-NERVE_SKIN_CLEARANCE):a.clone().multiplyScalar(anchor.x).addScaledVector(b,anchor.y).addScaledVector(c,anchor.z).addScaledVector(normal,-anchor.w),offset=result.clone().sub(center),radius=Math.max(.001,anchor.w*.15);if(offset.length()>radius)result.copy(center).add(offset.setLength(radius));}
 const penetration=result.clone().sub(anchor?a.clone().multiplyScalar(anchor.x).addScaledVector(b,anchor.y).addScaledVector(c,anchor.z):a).dot(normal)+NERVE_SKIN_CLEARANCE;
 return result.addScaledVector(normal,-Math.max(0,penetration));
}

export class NerveSkinGuard {
 private indexedBoundary?:SkinBoundary;
 get boundary(){return this.indexedBoundary??=new SkinBoundary(this.geometry)}
 texture:T.DataTexture;uniforms:{uNerveSkin:{value:T.DataTexture};uNerveSkinSize:{value:T.Vector2}};
 private geometry:T.BufferGeometry;
 constructor(geometry:T.BufferGeometry){
  this.geometry=geometry;
  const p=geometry.getAttribute('position'),ix=geometry.getAttribute('rigIndex'),w=geometry.getAttribute('rigWeight'),normal=geometry.getAttribute('normal');
  const width=768,height=Math.ceil(p.count*4/width),data=new Float32Array(width*height*4);
  for(let i=0;i<p.count;i++){for(let j=0;j<3;j++){data[i*16+j]=p.getComponent(i,j);data[i*16+12+j]=normal.getComponent(i,j)}for(let j=0;j<4;j++){data[i*16+4+j]=ix.getComponent(i,j);data[i*16+8+j]=w.getComponent(i,j)}}
  this.texture=new T.DataTexture(data,width,height,T.RGBAFormat,T.FloatType);this.texture.needsUpdate=true;this.texture.minFilter=this.texture.magFilter=T.NearestFilter;
  this.uniforms={uNerveSkin:{value:this.texture},uNerveSkinSize:{value:new T.Vector2(width,height)}};
 }
 anchor(point:T.Vector3,ids:number[]){const triangle=new T.Triangle(...ids.map(i=>this.boundary.points[i]) as [T.Vector3,T.Vector3,T.Vector3]),closest=triangle.closestPointToPoint(point,new T.Vector3()),bary=triangle.getBarycoord(closest,new T.Vector3())!;return new T.Vector4(bary.x,bary.y,bary.z,(Math.abs(point.x)<.027&&point.y>1.34&&point.y<1.50)?-1:Math.max(.004,point.distanceTo(closest)));}

 bind(g:T.BufferGeometry){
  const rigIndex=g.getAttribute('rigIndex'),rigWeight=g.getAttribute('rigWeight');
  const p=g.getAttribute('position'),data=new Float32Array(p.count*3),anchors=new Float32Array(p.count*4),cache=new Map<string,{ids:number[];point:T.Vector3}>();let changed=false;
  for(let i=0;i<p.count;i++){const point=new T.Vector3().fromBufferAttribute(p,i),key=point.toArray().join('/');let entry=cache.get(key);if(!entry){
   // Fit the narrow elbow corridor before skinning; use a smooth radial inset
   // around the atlas arm axis instead of snapping individual tube vertices.
   const armWeight=[0,1,2,3].reduce((sum,j)=>sum+(/^(upperArm|forearm|hand)\./.test(BONE_NAMES[rigIndex.getComponent(i,j)])?rigWeight.getComponent(i,j):0),0);
   if(armWeight>.8&&Math.abs(point.x)>.14&&point.y>1.0&&point.y<1.22){const side=Math.sign(point.x),t=point.y>=1.098?(point.y-1.098)/(1.375-1.098):(1.098-point.y)/(1.098-.863),x=point.y>=1.098?T.MathUtils.lerp(.222,.167,t):T.MathUtils.lerp(.222,.283,t),z=point.y>=1.098?T.MathUtils.lerp(-.035,-.019,t):T.MathUtils.lerp(-.035,.012,t),inset=.25*Math.exp(-(((point.y-1.12)/.055)**2))*T.MathUtils.smoothstep(point.y,1.0,1.025)*(1-T.MathUtils.smoothstep(point.y,1.195,1.22));point.x=T.MathUtils.lerp(point.x,x*side,inset);point.z=T.MathUtils.lerp(point.z,z,inset);changed=true;}
   // Opposing arm and chest surfaces can be millimetres apart at rest. A
   // nearest-only attachment makes chest nerves follow the raised arm.
   const nearest=this.boundary.nearest(point,point.y>1&&point.y<1.40?armWeight:undefined);const ids=nearest.ids;if(point.clone().sub(nearest.point).dot(nearest.normal)>0&&!this.boundary.contains(point)){point.copy(nearest.point).addScaledVector(nearest.normal,-NERVE_SKIN_CLEARANCE*2);changed=true;}entry={ids,point};cache.set(key,entry);}p.setXYZ(i,entry.point.x,entry.point.y,entry.point.z);data.set(entry.ids,i*3);this.anchor(entry.point,entry.ids).toArray(anchors,i*4);}
  if(changed&&g.index)g.computeVertexNormals();
  g.setAttribute('nerveSkinFace',new T.BufferAttribute(data,3));g.setAttribute('nerveSkinAnchor',new T.BufferAttribute(anchors,4));
 }
 dispose(){this.texture.dispose();}
}

export const nerveSkinShader=`
attribute vec3 nerveSkinFace;attribute vec4 nerveSkinAnchor;
uniform sampler2D uNerveSkin;uniform vec2 uNerveSkinSize;
vec4 nerveSkinTexel(float i){return texture2D(uNerveSkin,(vec2(mod(i,uNerveSkinSize.x),floor(i/uNerveSkinSize.x))+.5)/uNerveSkinSize);}
vec3 nerveSkinVertex(float i,out vec3 embedded,out vec3 surfaceNormal){
 vec3 p=nerveSkinTexel(i*4.0).xyz;vec4 indices=nerveSkinTexel(i*4.0+1.0),weights=nerveSkinTexel(i*4.0+2.0);
 vec4 reference=uRigReal[int(indices.x)],r=vec4(0.0),d=vec4(0.0);float torso=0.0;
 for(int j=0;j<4;j++){int id=int(indices[j]);float w=weights[j]*(dot(reference,uRigReal[id])<0.0?-1.0:1.0);r+=w*uRigReal[id];d+=w*uRigDual[id];if(id<=2)torso+=weights[j];}
 float norm=max(length(r),.00001);r/=norm;d/=norm;d-=r*dot(r,d);
 vec3 offset;mat3 jacobian;tissueField(p,offset,jacobian);surfaceNormal=rigRotate(r,transpose(inverse(mat3(1.0)+(jacobian-mat3(1.0))*torso))*nerveSkinTexel(i*4.0+3.0).xyz);embedded=rigPosition(r,d,position+offset*torso);return rigPosition(r,d,p+offset*torso);
}
vec3 nerveSkinPosition(vec3 p){
 if(nerveSkinAnchor.w<0.0)return p;
 vec3 ea,eb,ec,na,nb,nc;vec3 a=nerveSkinVertex(nerveSkinFace.x,ea,na),b=nerveSkinVertex(nerveSkinFace.y,eb,nb),c=nerveSkinVertex(nerveSkinFace.z,ec,nc),n=na*nerveSkinAnchor.x+nb*nerveSkinAnchor.y+nc*nerveSkinAnchor.z;
 float norm=length(n);if(norm<.000000000001)return p;n/=norm;
 vec3 center=ea*nerveSkinAnchor.x+eb*nerveSkinAnchor.y+ec*nerveSkinAnchor.z-n*${NERVE_SKIN_CLEARANCE.toFixed(6)},offset=p-center;
 float radius=max(.001,nerveSkinAnchor.w*.15);p=center+offset*min(1.0,radius/max(length(offset),.000001));
 p-=n*max(0.0,dot(p-(a*nerveSkinAnchor.x+b*nerveSkinAnchor.y+c*nerveSkinAnchor.z),n)+${NERVE_SKIN_CLEARANCE.toFixed(6)});
 return p;
}
`;
