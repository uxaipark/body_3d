/** Extract a right hand / distal forearm from the SAME atlas as SOMA.
 * No independent hand registration, artificial bone primitives, or NC assets.
 * Plane clipping creates exact section edges; section caps are supplied by the regional inset.
 */
import fs from 'node:fs';
import {NodeIO,Document} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import draco from 'draco3dgltf';
import * as T from 'three';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco.createDecoderModule()});
const out=new Document(),buffer=out.createBuffer(),scene=out.createScene();
const manifest={source:'SOMA native atlas, same coordinate frame; right hand',units:'metres',transform:'[.920-y,z-.019,-x-.276]',clip:{maxBodyY:.99,maxBodyX:-.17},layers:{}};
function clip(poly,axis,bound){const result=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],ia=a[axis]<=bound,ib=b[axis]<=bound;if(ia)result.push(a);if(ia!==ib){const t=(bound-a[axis])/(b[axis]-a[axis]);result.push(a.map((v,k)=>v+(b[k]-v)*t));}}return result;}
for(const layer of ['skin','skeleton','muscular','cardiovascular','nervous']){
 const input=await io.read(`public/models/${layer==='skin'?'skin-atlas':layer}-web.glb`);let triangles=0,names=[];
 for(const n of input.getRoot().listNodes()){
  if(!n.getMesh())continue;const matrix=new T.Matrix4().fromArray(n.getWorldMatrix());
  for(const p of n.getMesh().listPrimitives()){
   const pos=p.getAttribute('POSITION'),idx=p.getIndices(),pts=[];
   for(let i=0;i<pos.getCount();i++)pts.push(new T.Vector3().fromArray(pos.getElement(i,[])).applyMatrix4(matrix).toArray());
   const xyz=[];for(let i=0;i<(idx?.getCount()??pos.getCount());i+=3){const vi=[0,1,2].map(k=>idx?idx.getScalar(i+k):i+k);if(layer==='skin'){const ri=p.getAttribute('_RIG_INDEX'),rw=p.getAttribute('_RIG_WEIGHT');if(!vi.every(v=>{const ids=ri.getElement(v,[]),w=rw.getElement(v,[]);return ids.reduce((sum,id,j)=>sum+([19,20].includes(id)?w[j]:0),0)>.5;}))continue;}let poly=vi.map(k=>pts[k]);poly=clip(poly,0,-.17);if(poly.length)poly=clip(poly,1,.99);for(let j=1;j<poly.length-1;j++)for(const v of [poly[0],poly[j],poly[j+1]])xyz.push(.920-v[1],v[2]-.019,-v[0]-.276);}
   if(!xyz.length)continue;
   const geo=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(xyz,3));geo.computeVertexNormals();
   const primitive=out.createPrimitive().setAttribute('POSITION',out.createAccessor().setType('VEC3').setArray(new Float32Array(xyz)).setBuffer(buffer)).setAttribute('NORMAL',out.createAccessor().setType('VEC3').setArray(geo.getAttribute('normal').array).setBuffer(buffer));
   const name=n.getName()||n.getMesh().getName();scene.addChild(out.createNode(name).setExtras({layer,sourceName:name}).setMesh(out.createMesh(name).addPrimitive(primitive)));triangles+=xyz.length/9;names.push(name);
  }
 }
 manifest.layers[layer]={triangles,structures:names};
}
fs.mkdirSync('public/models/wrist',{recursive:true});await new NodeIO().write('public/models/wrist/atlas.glb',out);fs.writeFileSync('public/models/wrist/manifest.json',JSON.stringify(manifest,null,2));console.log(Object.fromEntries(Object.entries(manifest.layers).map(([k,v])=>[k,{triangles:v.triangles,structures:v.structures.length}])));
// Derive a shared centreline and skin depth from the atlas itself, in mm.
const ns=out.getRoot().listNodes(),skin=ns.find(n=>n.getExtras().layer==='skin'),radial=ns.find(n=>/^Radial artery\./.test(n.getName()));
function geo(n){const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(n.getMesh().listPrimitives()[0].getAttribute('POSITION').getArray(),3));g.computeVertexNormals();return g;}
const skinMesh=new T.Mesh(geo(skin),new T.MeshBasicMaterial({side:T.DoubleSide})),artery=geo(radial).getAttribute('position'),ray=new T.Raycaster(),profile=[];
for(let along=-110;along<=5;along+=5){const x=(55+along)/1000;let sumY=0,sumZ=0,count=0;for(let i=0;i<artery.count;i++)if(Math.abs(artery.getX(i)-x)<.004){sumY+=artery.getY(i);sumZ+=artery.getZ(i);count++;}if(!count)continue;const y=sumY/count,z=sumZ/count;ray.set(new T.Vector3(x,.15,z),new T.Vector3(0,-1,0));const hit=ray.intersectObject(skinMesh)[0];if(!hit)continue;profile.push({along_mm:along,lateral_mm:z*1000,centerY_mm:y*1000,surfaceY_mm:hit.point.y*1000,depth_mm:Math.max(1.3,(hit.point.y-y)*1000)});}
fs.writeFileSync('public/simulators/radial/js/atlasProfile.js',`// Generated from SAME atlas vessel and native skin. One specimen, not a population norm.\nexport const atlasProfile=${JSON.stringify(profile)};\nexport function atlasArteryAt(along){const a=atlasProfile;let i=0;while(i<a.length-2&&a[i+1].along_mm<along)i++;const p=a[i],q=a[i+1],t=Math.max(0,Math.min(1,(along-p.along_mm)/(q.along_mm-p.along_mm)));return Object.fromEntries(Object.keys(p).map(k=>[k,p[k]+(q[k]-p[k])*t]));}\n`);console.log('Atlas centreline samples',profile.length,profile.find(p=>p.along_mm===0));
