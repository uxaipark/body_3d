import * as T from 'three';
/** Baking a mirrored GLB transform must also reverse triangle winding. */
export function bakeAnatomyTransform(g:T.BufferGeometry,m:T.Matrix4){
 g.applyMatrix4(m);if(m.determinant()<0){if(!g.index)g.setIndex(Array.from({length:g.getAttribute('position').count},(_,i)=>i));const ix=g.index!;for(let i=0;i<ix.count;i+=3){const b=ix.getX(i+1);ix.setX(i+1,ix.getX(i+2));ix.setX(i+2,b);}}return g;
}
export interface VesselPart {name:string;geometry:T.BufferGeometry;kind:string}
interface Rim {part:VesselPart;ids:number[];center:T.Vector3;normal:T.Vector3;radius:number}
/** Only manifold open rims are eligible: side-wall crossings are never joined. */
export function vesselRims(part:VesselPart):Rim[]{
 const g=part.geometry,p=g.getAttribute('position'),index=g.index;if(!index)return [];
 const edges=new Map<string,{a:number;b:number;n:number}>();
 for(let i=0;i<index.count;i+=3)for(let k=0;k<3;k++){const a=index.getX(i+k),b=index.getX(i+(k+1)%3),key=a<b?`${a}/${b}`:`${b}/${a}`,e=edges.get(key);if(e)e.n++;else edges.set(key,{a,b,n:1});}
 const next=new Map<number,number>(),invalid=new Set<number>();for(const e of edges.values())if(e.n===1){if(next.has(e.a))invalid.add(e.a);next.set(e.a,e.b);}
 const visited=new Set<number>(),result:Rim[]=[];
 for(const start of next.keys()){if(visited.has(start))continue;const ids:number[]=[];let v=start;
  while(!visited.has(v)&&next.has(v)&&!invalid.has(v)){visited.add(v);ids.push(v);v=next.get(v)!;}
  if(v!==start||ids.length<5||ids.length>64)continue;
  const points=ids.map(i=>new T.Vector3().fromBufferAttribute(p,i)),center=points.reduce((c,v)=>c.add(v),new T.Vector3()).divideScalar(ids.length),normal=new T.Vector3();
  points.forEach((v,i)=>normal.add(v.clone().sub(center).cross(points[(i+1)%points.length].clone().sub(center))));normal.normalize();
  const radius=points.reduce((s,v)=>s+v.distanceTo(center),0)/points.length;
  if(radius<.0001||radius>.03)continue;
  result.push({part,ids,center,normal,radius});
 }return result;
}
/** Seal paired, opposed vessel rims. Separate arterial and venous trees; no
 * nearest-side-wall links, no connection of capillary beds absent in the atlas.
 * A shared joint frame across each collar prevents mesh-name boundaries from
 * separating in motion. Bridge ends copy ALL shader attributes exactly. */
export function connectVesselJunctions(parts:VesselPart[]){
 const rims=parts.flatMap(vesselRims),candidates:{a:Rim;b:Rim;score:number}[]=[];
 for(let i=0;i<rims.length;i++)for(let j=i+1;j<rims.length;j++){
  const a=rims[i],b=rims[j];if(a.part===b.part||a.part.kind!==b.part.kind)continue;
  const d=a.center.distanceTo(b.center),ratio=a.radius/b.radius;
  const side=(n:string)=>/\.r(?:\.|$)|\bright\b/i.test(n)?'r':/\.l(?:\.|$)|\bleft\b/i.test(n)?'l':'';
  if(d>.0001){const sa=side(a.part.name),sb=side(b.part.name);if(sa&&sb&&sa!==sb)continue;
   // Non-coincident atlas ends require a named continuation, never proximity alone.
   const names=[a.part.name,b.part.name].join(' / ');
   if(!(/brachiocephalic vein/i.test(names)&&/subclavian vein/i.test(names))&&!(/insular branches/i.test(names)&&/middle cerebral artery \(M3/i.test(names))&&!(/coronary artery/i.test(a.part.name)&&/coronary artery/i.test(b.part.name)))continue;
  }
  if(d>Math.min(.012,(a.radius+b.radius)*1.5)||ratio<.5||ratio>2||a.normal.dot(b.normal)>-.65)continue;
  // Coaxial ends only. Reject parallel vessels offset sideways.
  if(d>.001){const axis=b.center.clone().sub(a.center).divideScalar(d);if(Math.abs(axis.dot(a.normal))<.65||Math.abs(axis.dot(b.normal))<.65)continue;}
  candidates.push({a,b,score:d+Math.abs(Math.log(ratio))*.003});
 }
 candidates.sort((a,b)=>a.score-b.score);const used=new Set<Rim>(),joins:{from:string;to:string;gap:number;geometry:T.BufferGeometry;kind:string}[]=[];
 for(const {a,b}of candidates){if(used.has(a)||used.has(b))continue;used.add(a);used.add(b);
  const weights=new Map<number,number>();
  for(const rim of [a,b]){const ix=rim.part.geometry.getAttribute('rigIndex'),w=rim.part.geometry.getAttribute('rigWeight');for(const i of rim.ids)for(let k=0;k<4;k++)weights.set(ix.getComponent(i,k),(weights.get(ix.getComponent(i,k))||0)+w.getComponent(i,k)/(2*rim.ids.length));}
  const common=[...weights].sort((a,b)=>b[1]-a[1]).slice(0,4),sum=common.reduce((s,v)=>s+v[1],0);common.forEach(v=>v[1]/=sum);
  for(const rim of [a,b]){const g=rim.part.geometry,p=g.getAttribute('position'),ix=g.getAttribute('rigIndex'),w=g.getAttribute('rigWeight'),ends=new Set(rim.ids);
   for(let i=0;i<p.count;i++){const v=new T.Vector3().fromBufferAttribute(p,i),distance=v.distanceTo(rim.center),blend=ends.has(i)?1:1-T.MathUtils.smoothstep(distance,rim.radius*1.15,rim.radius+.035);if(blend<=0)continue;
    const mixed=new Map<number,number>();for(let k=0;k<4;k++)mixed.set(ix.getComponent(i,k),(mixed.get(ix.getComponent(i,k))||0)+w.getComponent(i,k)*(1-blend));for(const [bone,weight]of common)mixed.set(bone,(mixed.get(bone)||0)+weight*blend);
    const top=[...mixed].sort((a,b)=>b[1]-a[1]).slice(0,4),total=top.reduce((s,v)=>s+v[1],0);for(let k=0;k<4;k++){ix.setComponent(i,k,top[k]?.[0]??0);w.setComponent(i,k,(top[k]?.[1]??0)/total);}
   }
  }
  // Orient the second rim opposite its surface winding, then align angular phase.
  const pa=a.part.geometry.getAttribute('position'),pb=b.part.geometry.getAttribute('position'),aa=a.ids,bb=[...b.ids].reverse();let shift=0,best=Infinity;
  for(let i=0;i<bb.length;i++){const d=new T.Vector3().fromBufferAttribute(pa,aa[0]).sub(a.center).normalize().distanceToSquared(new T.Vector3().fromBufferAttribute(pb,bb[i]).sub(b.center).normalize());if(d<best){best=d;shift=i;}}
  const bi=bb.map((_,i)=>bb[(i+shift)%bb.length]),geometry=new T.BufferGeometry();
  for(const [key,attr]of Object.entries(a.part.geometry.attributes)){const other=b.part.geometry.getAttribute(key);if(!other||other.itemSize!==attr.itemSize)throw new Error(`Incompatible vessel junction attribute: ${key}`);const values:number[]=[];for(const i of aa)for(let k=0;k<attr.itemSize;k++)values.push(attr.getComponent(i,k));for(const i of bi)for(let k=0;k<attr.itemSize;k++)values.push(other.getComponent(i,k));const joined=new T.BufferAttribute(new (attr.array.constructor as typeof Float32Array)(values.length),attr.itemSize,attr.normalized);if('gpuType'in attr)joined.gpuType=attr.gpuType;for(let i=0;i<joined.count;i++)for(let k=0;k<attr.itemSize;k++)joined.setComponent(i,k,values[i*attr.itemSize+k]);geometry.setAttribute(key,joined);}
  const triangles:number[]=[];let i=0,j=0;while(i<aa.length||j<bi.length){const ai=i%aa.length,bj=aa.length+j%bi.length;if((i+1)/aa.length<=(j+1)/bi.length){triangles.push(ai,bj,(i+1)%aa.length);i++;}else{triangles.push(ai,bj,aa.length+(j+1)%bi.length);j++;}}
  geometry.setIndex(triangles);geometry.computeBoundingSphere();geometry.userData.sourceRims=[{part:a.part,ids:aa},{part:b.part,ids:bi}];joins.push({from:a.part.name,to:b.part.name,gap:a.center.distanceTo(b.center),geometry,kind:a.part.kind});
 }
 for(const join of joins){let offset=0;for(const rim of join.geometry.userData.sourceRims){for(const [key,attr]of Object.entries(join.geometry.attributes)){const source=rim.part.geometry.getAttribute(key);for(let i=0;i<rim.ids.length;i++)for(let k=0;k<attr.itemSize;k++)attr.setComponent(offset+i,k,source.getComponent(rim.ids[i],k));}offset+=rim.ids.length;}delete join.geometry.userData.sourceRims;}
 return joins;
}
