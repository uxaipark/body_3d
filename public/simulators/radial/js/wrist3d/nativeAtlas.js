import * as T from '../vendor/three.module.js';
import {GLTFLoader} from '../vendor/GLTFLoader.js';
import {atlasArteryAt} from '../atlasProfile.js';
import {surroundingDisplacement} from '../wristMechanics.js';
import {arteryTether} from '../arteryDeformation.js';
import {wristSurface} from '../wristSurface.js';
const colors={skin:0xc7a18b,adipose:0xd8b15b,muscular:0x9d4250,skeleton:0xe5d9b7,nervous:0xe9d68d,cardiovascular:0xb73246};
// Add bend resolution without smoothing/shrinking atlas junctions or changing
// their rest shape. Interpolated unit normals retain smooth vascular shading.
function refineVessel(geometry){
 const p=geometry.attributes.position,n=geometry.attributes.normal,index=geometry.index,positions=[],normals=[];
 const vertex=i=>[p.getX(i),p.getY(i),p.getZ(i),n.getX(i),n.getY(i),n.getZ(i)];
 const distance=(a,b)=>{
  const lo=Math.min(a[0],b[0]),hi=Math.max(a[0],b[0]);
  return (lo<-.050&&hi>-.070)||(lo<.075&&hi>.055)?(a[0]-b[0])**2:0;
 };
 const emit=(a,b,c,level=0)=>{
  const edges=[distance(a,b),distance(b,c),distance(c,a)],longest=Math.max(...edges);
  if(longest>9e-6&&level<18){
   if(edges[1]===longest)[a,b,c]=[b,c,a];else if(edges[2]===longest)[a,b,c]=[c,a,b];
   const mid=a.map((v,i)=>(v+b[i])*.5),length=Math.hypot(...mid.slice(3))||1;for(let i=3;i<6;i++)mid[i]/=length;
   emit(a,mid,c,level+1);emit(mid,b,c,level+1);return;
  }
  for(const v of [a,b,c]){positions.push(...v.slice(0,3));normals.push(...v.slice(3));}
 };
 for(let i=0;i<(index?.count??p.count);i+=3)emit(...[0,1,2].map(k=>vertex(index?index.getX(i+k):i+k)));
 geometry.setIndex(null);geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new T.Float32BufferAttribute(normals,3));
}
export function buildModel0(ctx){
 const group=new T.Group(),moving=[],all=[],ray=new T.Raycaster();let skin=null,wrap=null,mode='A',fat=2.2,lastFat=-1,lastPosition='',drive=0,lateralShift=0,depthShift=0;
 const model={group,ready:null,setGeometry(){/* Same native atlas scale is intentionally retained. */},setMode(key){mode=key;for(const m of all){const l=m.userData.layer;m.visible=key==='0'?l==='skin':true;m.material.opacity=l==='skin'?(key==='0'?.94:.14):l==='adipose'?.12:l==='muscular'?.8:1;m.material.depthWrite=m.material.opacity>.94;}},
 surfaceY(lat,along){if(!skin)return null;ray.set(new T.Vector3((55+along)*.001,.16,lat*.001),new T.Vector3(0,-1,0));return ray.intersectObject(skin)[0]?.point.y??null;},
 surfacePoint(lat,along,arc){if(!wrap)return null;const p=wrap.sample(lat,along,arc),a=atlasArteryAt(along),w=arteryTether(along).weight,u=surroundingDisplacement(p.z,Math.max(0,a.surfaceY_mm-p.y),a.lateral_mm+lateralShift*w,Math.max(1.3,a.depth_mm+depthShift*w),1,fat);return {...p,dy:u.vertical_mm*w,dz:u.lateral_mm*w};},
 update(tissue,gain=1){const dr=tissue?.radiusDelta_mm||0;fat=tissue?.fat_mm??2.2;drive=dr*gain;lateralShift=tissue?.arteryLateralShift_mm||0;depthShift=tissue?.arteryDepthShift_mm||0;const positionKey=`${Math.round(lateralShift*4)}:${Math.round(depthShift*4)}`;
  for(const item of moving){const {mesh,rest,field,base,arterial,normals}=item,a=mesh.geometry.attributes.position.array;
   if(lastFat!==fat||lastPosition!==positionKey){for(let i=0;i<rest.length;i+=3){
    const along=rest[i]*1000-55,{weight:w,derivative:dw}=arteryTether(along),atlas=atlasArteryAt(along);
    base[i]=rest[i];base[i+1]=rest[i+1]-(arterial?depthShift*w*.001:0);base[i+2]=rest[i+2]+(arterial?lateralShift*w*.001:0);
    const u=surroundingDisplacement(base[i+2]*1000,Math.max(0,atlas.surfaceY_mm-base[i+1]*1000),atlas.lateral_mm+lateralShift*w,Math.max(1.3,atlas.depth_mm+depthShift*w),1,fat);
    field[i]=0;field[i+1]=u.vertical_mm*.001*w;field[i+2]=u.lateral_mm*.001*w;
    if(arterial){const nx=normals[i]+dw*(depthShift*normals[i+1]-lateralShift*normals[i+2]),ny=normals[i+1],nz=normals[i+2],length=Math.hypot(nx,ny,nz)||1;mesh.geometry.attributes.normal.setXYZ(i/3,nx/length,ny/length,nz/length);}
   }if(arterial)mesh.geometry.attributes.normal.needsUpdate=true;}
   for(let i=0;i<a.length;i++)a[i]=base[i]+field[i]*drive;
   mesh.geometry.attributes.position.needsUpdate=true;
  }lastFat=fat;lastPosition=positionKey;
 },
 dispose(){group.traverse(m=>{if(m.isMesh){m.geometry.dispose();m.material.dispose();}});}};
 model.ready=new GLTFLoader().loadAsync('/models/wrist/atlas.glb').then(g=>{
  g.scene.traverse(n=>{if(!n.isMesh)return;const layer=n.userData.layer||'muscular',name=(n.userData.sourceName||n.name).toLowerCase();
   // GLTFLoader uses interleaved position/normal buffers. Deformation must not
   // treat that shared array as packed XYZ and accidentally overwrite normals.
   for(const key of ['position','normal']){const a=n.geometry.getAttribute(key);if(!a)continue;const packed=new Float32Array(a.count*3);for(let i=0;i<a.count;i++){packed[i*3]=a.getX(i);packed[i*3+1]=a.getY(i);packed[i*3+2]=a.getZ(i);}n.geometry.setAttribute(key,new T.BufferAttribute(packed,3));}
   const tendon=/tendon|sheath|fascia|retinaculum|ligament|aponeurosis/.test(name),vein=/vein|venous/.test(name);
   n.material=new T.MeshStandardMaterial({color:tendon?0xd8cdbb:vein?0x486a99:colors[layer],roughness:layer==='skeleton'?.88:.65,transparent:true,side:T.DoubleSide});n.userData.layer=layer;n.frustumCulled=false;all.push(n);
   if(layer==='cardiovascular'){
    n.geometry.computeVertexNormals();const p=n.geometry.attributes.position,a=n.geometry.attributes.normal,sums=new Map(),keys=[];
    for(let i=0;i<p.count;i++){const key=[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e6)).join(':');keys.push(key);const sum=sums.get(key)||new T.Vector3();sum.add(new T.Vector3(a.getX(i),a.getY(i),a.getZ(i)));sums.set(key,sum);}
    for(const sum of sums.values())sum.normalize();for(let i=0;i<a.count;i++){const q=sums.get(keys[i]);a.setXYZ(i,q.x,q.y,q.z);}a.needsUpdate=true;
   }
   if(layer==='cardiovascular'&&!vein)refineVessel(n.geometry);
   if(/^radial[_ ]artery[._]/.test(name)){n.material.color.setHex(0xff0000);n.material.emissive.setHex(0xb00000);n.material.emissiveIntensity=.6;n.material.roughness=1;n.material.metalness=0;n.material.toneMapped=false;}
   if(layer==='skin')skin=n;
   if(layer!=='skeleton'&&layer!=='nervous'&&!tendon){const rest=n.geometry.attributes.position.array.slice();moving.push({mesh:n,rest,base:rest.slice(),arterial:layer==='cardiovascular'&&!vein,normals:n.geometry.attributes.normal.array.slice(),field:new Float32Array(rest.length)});}
  });
  group.add(g.scene);group.updateMatrixWorld(true);
  // The original radial course reaches the deep palmar arch. Retain those
  // endpoints and apply one continuous field to the connected arterial tree.
  if(skin)wrap=wristSurface;
  // Native-surface-derived local subcutis envelope: representative, NOT segmented fat.
  if(skin){const fatMesh=skin.clone();fatMesh.geometry=skin.geometry.clone();fatMesh.userData={layer:'adipose'};fatMesh.name='피하지방 경계 · 피부에서 유도한 대표층';const a=fatMesh.geometry.attributes.position,b=fatMesh.geometry.attributes.normal;
   for(let i=0;i<a.count;i++){a.setXYZ(i,a.getX(i)-b.getX(i)*.0016,a.getY(i)-b.getY(i)*.0016,a.getZ(i)-b.getZ(i)*.0016);}
   fatMesh.material=new T.MeshStandardMaterial({color:colors.adipose,transparent:true,opacity:.12,depthWrite:false,side:T.DoubleSide});
   // Fat view is local to distal forearm, never a shrunken whole hand inside fingers.
   fatMesh.material.onBeforeCompile=s=>{s.vertexShader='varying float wristAlong;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nwristAlong=position.x;');s.fragmentShader='varying float wristAlong;\n'+s.fragmentShader;s.fragmentShader=s.fragmentShader.replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nif(wristAlong>.065)discard;');};
   group.add(fatMesh);all.push(fatMesh);moving.push({mesh:fatMesh,rest:a.array.slice(),base:a.array.slice(),field:new Float32Array(a.array.length)});
  }model.setMode(mode);model.update(null);
  return model;
 });return model;
}
export const buildModelA=buildModel0;
export const buildModelE=buildModel0;
