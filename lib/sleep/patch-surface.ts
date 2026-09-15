import * as T from 'three';
import {surfaceTissueWeight,type Weights} from '../rig.ts';
export const patchOrigin={x:0,y:1.135};
export const patchLimits={x:[-.08,.08],y:[1.075,1.335]};
export type PatchPosition={x:number;y:number};
export const boundPatch=(p:PatchPosition):PatchPosition=>({x:T.MathUtils.clamp(Number.isFinite(p.x)?p.x:patchOrigin.x,...patchLimits.x as [number,number]),y:T.MathUtils.clamp(Number.isFinite(p.y)?p.y:patchOrigin.y,...patchLimits.y as [number,number])});
type Vertex={point:T.Vector3;weights:Weights};
export type SurfaceAnchor={vertices:Vertex[];bary:T.Vector3};
/** Restrict picking to the actual anterior torso triangles, independent of layer opacity.
 * Skin vertex weights are retained: interpolation occurs AFTER the same deformation
 * as the displayed skin, so placement follows turns and breathing without detaching. */
export class PatchSurface{
 geometry=new T.BufferGeometry();material=new T.MeshBasicMaterial({side:T.DoubleSide});mesh:T.Mesh;
 vertices:Vertex[]=[];rest:T.Vector3[]=[];triangles:{vertices:Vertex[];minX:number;maxX:number;minY:number;maxY:number;det:number}[]=[];
 constructor(source:T.BufferGeometry){
  const p=source.getAttribute('position'),ix=source.getAttribute('rigIndex'),w=source.getAttribute('rigWeight'),tri=source.index;
  const shared=new Map<number,Vertex>();
  const get=(i:number)=>new T.Vector3().fromBufferAttribute(p,i);
  const eligible=(v:T.Vector3)=>Math.abs(v.x)<.17&&v.y>1.03&&v.y<1.39&&v.z>.005;
  for(let i=0;i<(tri?.count??p.count);i+=3){const ids=[0,1,2].map(j=>tri?tri.getX(i+j):i+j),points=ids.map(get);if(!points.every(eligible))continue;
   for(let j=0;j<3;j++){const k=ids[j];let vertex=shared.get(k);if(!vertex){vertex={point:points[j],weights:{indices:[0,1,2,3].map(c=>ix.getComponent(k,c)),weights:[0,1,2,3].map(c=>w.getComponent(k,c))}};shared.set(k,vertex);}this.vertices.push(vertex);this.rest.push(vertex.point);}
  }
  for(let i=0;i<this.rest.length;i+=3){const [a,b,c]=this.rest.slice(i,i+3),det=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);if(Math.abs(det)<1e-12)continue;this.triangles.push({vertices:this.vertices.slice(i,i+3),minX:Math.min(a.x,b.x,c.x),maxX:Math.max(a.x,b.x,c.x),minY:Math.min(a.y,b.y,c.y),maxY:Math.max(a.y,b.y,c.y),det});}
  this.geometry.setAttribute('position',new T.Float32BufferAttribute(this.rest.flatMap(v=>v.toArray()),3));this.mesh=new T.Mesh(this.geometry,this.material);
 }
 anchor(x:number,y:number):SurfaceAnchor|null{
  let best=-Infinity,result:SurfaceAnchor|null=null;
  for(const t of this.triangles){if(x<t.minX||x>t.maxX||y<t.minY||y>t.maxY)continue;const [a,b,c]=t.vertices.map(v=>v.point),u=((b.y-c.y)*(x-c.x)+(c.x-b.x)*(y-c.y))/t.det,v=((c.y-a.y)*(x-c.x)+(a.x-c.x)*(y-c.y))/t.det,w=1-u-v;if(u< -1e-7||v< -1e-7||w< -1e-7)continue;const z=u*a.z+v*b.z+w*c.z;if(z>best){best=z;result={vertices:t.vertices,bary:new T.Vector3(u,v,w)};}}
  return result;
 }
 deform(anchor:SurfaceAnchor,transform:(p:T.Vector3,w:Weights)=>T.Vector3,offset:(p:T.Vector3)=>T.Vector3){
  const points=anchor.vertices.map(v=>transform(v.point.clone().addScaledVector(offset(v.point),surfaceTissueWeight(v.weights)),v.weights));
  return points[0].multiplyScalar(anchor.bary.x).addScaledVector(points[1],anchor.bary.y).addScaledVector(points[2],anchor.bary.z);
 }
 pick(ray:T.Raycaster,transform:(p:T.Vector3,w:Weights)=>T.Vector3,offset:(p:T.Vector3)=>T.Vector3):PatchPosition|null{
  const p=this.geometry.getAttribute('position'),cache=new Map<Vertex,T.Vector3>();this.vertices.forEach((v,i)=>{let moved=cache.get(v);if(!moved){moved=transform(v.point.clone().addScaledVector(offset(v.point),surfaceTissueWeight(v.weights)),v.weights);cache.set(v,moved);}p.setXYZ(i,moved.x,moved.y,moved.z);});
  this.geometry.computeBoundingSphere();this.geometry.computeBoundingBox();const hit=ray.intersectObject(this.mesh,false)[0];if(!hit?.face)return null;
  const {a,b,c}=hit.face,bary=T.Triangle.getBarycoord(hit.point,new T.Vector3().fromBufferAttribute(p,a),new T.Vector3().fromBufferAttribute(p,b),new T.Vector3().fromBufferAttribute(p,c),new T.Vector3());if(!bary)return null;
  const rest=this.rest[a].clone().multiplyScalar(bary.x).addScaledVector(this.rest[b],bary.y).addScaledVector(this.rest[c],bary.z);return {x:rest.x,y:rest.y};
 }
 dispose(){this.geometry.dispose();this.material.dispose();}
}
