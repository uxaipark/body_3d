import * as T from 'three';
import {MeshoptDecoder} from 'meshoptimizer';
export interface PackedPart {layer:string;part:string;region?:string;file:string;detail?:string;detailRanges?:any[];userData:Record<string,any>;renderOrder:number;color:number[];triangles:number;detailTriangles?:number}
export interface BodyManifest {version:1;source:string;parts:PackedPart[]}
const arrays={Float32Array,Uint32Array,Uint16Array,Uint8Array,Int16Array,Int32Array};
/** Lossless attributes: nerve attachment indices and rigid-bone IDs must never
 * be quantized or interpolated by a deployment codec. */
export async function decodeBodyGeometry(bytes:ArrayBuffer){
 await MeshoptDecoder.ready;
 // Static servers may advertise Content-Encoding: gzip for .gz assets;
 // fetch then returns already-decoded bytes. Decode only the gzip envelope.
 const magic=new Uint8Array(bytes,0,Math.min(2,bytes.byteLength));
 const raw=magic[0]===0x1f&&magic[1]===0x8b?await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer():bytes;
 const size=new DataView(raw).getUint32(0,true),header=JSON.parse(new TextDecoder().decode(new Uint8Array(raw,4,size))),geometry=new T.BufferGeometry();let offset=4+size;
 for(const a of header){
  if(!(a.type in arrays)||a.count<0||a.count>10000000)throw Error('Invalid body geometry');
  const output=new Uint8Array(a.count*a.stride),source=new Uint8Array(raw,offset,a.bytes);offset+=a.bytes;
  if(a.name==='index')MeshoptDecoder.decodeIndexBuffer(output,a.count,a.stride,source);else MeshoptDecoder.decodeVertexBuffer(output,a.count,a.stride,source);
  const ArrayType=arrays[a.type as keyof typeof arrays],attribute=new T.BufferAttribute(new ArrayType(output.buffer),a.itemSize,a.normalized);
  if(a.name==='index')geometry.setIndex(attribute);else geometry.setAttribute(a.name,attribute);
 }
 if(offset!==raw.byteLength||!geometry.getAttribute('position')||!geometry.index)throw Error('Incomplete body geometry');
 geometry.computeBoundingBox();return geometry;
}
export async function fetchBodyGeometry(file:string,signal?:AbortSignal){
 const response=await fetch(`/models/body/${file}`,{signal,cache:/^[a-f0-9]{24}\.bin\.gz$/.test(file)?'force-cache':'default'});if(!response.ok)throw Error('Body geometry unavailable');
 return response.arrayBuffer();
}

export async function loadBodyGeometry(file:string,signal?:AbortSignal){return decodeBodyGeometry(await fetchBodyGeometry(file,signal));}
