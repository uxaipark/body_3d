import * as T from 'three';
import {MeshoptEncoder,MeshoptSimplifier} from 'meshoptimizer';
import {AnatomyScene,initialLayers} from '../../lib/anatomy';
import {defaults} from '../../lib/physiology';
const host=document.createElement('div');host.style.cssText='width:32px;height:32px';document.body.appendChild(host);
const noop=()=>{},scene=new AnatomyScene(host,{...defaults},{...initialLayers},{stats:noop,pick:noop,time:noop,site:noop,skin:noop});scene.running=false;
await scene.loadSource(noop);cancelAnimationFrame(scene.frame);await Promise.all([MeshoptEncoder.ready,MeshoptSimplifier.ready]);
async function pack(g:T.BufferGeometry){
 const streams:Uint8Array[]=[],header:any[]=[];
 for(const [name,a]of Object.entries({...g.attributes,index:g.index!})){
  const source=new Uint8Array(a.array.buffer,a.array.byteOffset,a.array.byteLength),stride=a.itemSize*a.array.BYTES_PER_ELEMENT;
  const bytes=name==='index'?MeshoptEncoder.encodeIndexBuffer(source,a.count,stride):MeshoptEncoder.encodeVertexBuffer(source,a.count,stride);
  header.push({name,type:a.array.constructor.name,count:a.count,stride,itemSize:a.itemSize,normalized:a.normalized,bytes:bytes.length});streams.push(bytes);
 }
 const metadata=new TextEncoder().encode(JSON.stringify(header)),buffer=new Uint8Array(4+metadata.length+streams.reduce((s,b)=>s+b.length,0));new DataView(buffer.buffer).setUint32(0,metadata.length,true);buffer.set(metadata,4);let offset=4+metadata.length;for(const bytes of streams){buffer.set(bytes,offset);offset+=bytes.length}
 return new Response(new Blob([buffer]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
}
function compact(g:T.BufferGeometry,selected:number[]){
 const map=new Map<number,number>(),vertices:number[]=[],indices=selected.map(i=>{if(!map.has(i)){map.set(i,map.size);vertices.push(i)}return map.get(i)!}),out=new T.BufferGeometry().setIndex(indices);
 for(const [name,a]of Object.entries(g.attributes)){const C=a.array.constructor as Float32ArrayConstructor,data=new C(vertices.length*a.itemSize);for(let i=0;i<vertices.length;i++)for(let c=0;c<a.itemSize;c++)data[i*a.itemSize+c]=a.getComponent(vertices[i],c);out.setAttribute(name,new T.BufferAttribute(data,a.itemSize,a.normalized))}return out;
}
function regions(g:T.BufferGeometry,ranges:any[]){
 const groups=new Map<string,{indices:number[];ranges:any[]}>(),p=g.getAttribute('position'),ix=g.index!;let start=0;
 for(const range of ranges){const end=Math.min(ix.count,(range.end??Infinity)*3),box=new T.Box3(),point=new T.Vector3();for(let i=start;i<end;i++)box.expandByPoint(point.fromBufferAttribute(p,ix.getX(i)));const c=box.getCenter(new T.Vector3());
  const region=c.y>1.47?'head':Math.abs(c.x)>.16&&c.y>.70?(c.x<0?'rightArm':'leftArm'):c.y<.88?'legs':'torso';
  let group=groups.get(region);if(!group){group={indices:[],ranges:[]};groups.set(region,group)}for(let i=start;i<end;i++)group.indices.push(ix.getX(i));group.ranges.push({...range,end:group.indices.length/3});start=end;
 }return [...groups].map(([region,group])=>({region,geometry:compact(g,group.indices),ranges:group.ranges}));
}
function simplify(g:T.BufferGeometry,ranges:any[]){
 const positions=g.getAttribute('position').array as Float32Array,source=new Uint32Array(g.index!.array),selected:number[]=[],nextRanges:any[]=[];let start=0;
 // Protect open vessel junctions; never prune components or change positions,
 // skin weights, organ boundaries, or discrete nerve attachment attributes.
 for(const range of ranges){const end=Math.min(source.length,(range.end??Infinity)*3),indices=source.slice(start,end),target=Math.max(24,Math.floor(indices.length*.23/3)*3);start=end;
  const [reduced]=MeshoptSimplifier.simplify(indices,positions,3,Math.min(indices.length,target),.0015,['LockBorder','ErrorAbsolute','Sparse','RegularizeLight']);
  for(const i of reduced)selected.push(i);nextRanges.push({...range,end:selected.length/3});
 }
 return {geometry:compact(g,selected),ranges:nextRanges};
}
const parts:any[]=[];
for(const mesh of scene.meshes){
 const layer=mesh.userData.layer,part=mesh.userData.part||layer,mat=mesh.material as T.MeshStandardMaterial,keep=layer==='skin'||part==='heart'||part==='lung'||part==='hepatic';
 for(const chunk of keep?[{region:'torso',geometry:mesh.geometry,ranges:mesh.userData.ranges}]:regions(mesh.geometry,mesh.userData.ranges)){
 const g=chunk.geometry;chunk.ranges=chunk.ranges.map((r:any)=>({...r,end:Number.isFinite(r.end)?r.end:g.index!.count/3}));
 const base={layer,part,region:chunk.region,userData:{...mesh.userData,ranges:chunk.ranges},renderOrder:mesh.renderOrder,color:mat.color.toArray(),triangles:g.index!.count/3};
 const upload=async(geometry:T.BufferGeometry)=>{const r=await fetch('/bake',{method:'POST',body:await pack(geometry)});if(!r.ok)throw Error('Cannot save precomputed body');return ((await r.json()) as {file:string}).file};
 const high=await upload(g);
 if(keep){parts.push({...base,file:high});continue}
 const low=simplify(g,chunk.ranges),file=await upload(low.geometry);parts.push({...base,file,detail:high,detailTriangles:base.triangles,triangles:low.geometry.index!.count/3,userData:{...base.userData,ranges:low.ranges},detailRanges:chunk.ranges});low.geometry.dispose();g.dispose();
 }
}
const r=await fetch('/bake-manifest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:1,parts})});if(!r.ok)throw Error('Cannot finalize precomputed body');
(window as any).profileResults={baked:parts.map(p=>({layer:p.layer,part:p.part,triangles:p.triangles,detailTriangles:p.detailTriangles}))};(window as any).profileBody=()=>{};scene.dispose();
