import * as T from '../vendor/three.module.js';
import {GLTFLoader} from '../vendor/GLTFLoader.js';
import {atlasArteryAt} from '../atlasProfile.js';
import {surroundingDisplacement} from '../wristMechanics.js';
const colors={skin:0xc7a18b,adipose:0xd8b15b,muscular:0x9d4250,skeleton:0xe5d9b7,nervous:0xe9d68d,cardiovascular:0xb73246};
export function buildModel0(ctx){
 const group=new T.Group(),moving=[],all=[],ray=new T.Raycaster();let skin=null,mode='A',fat=2.2,lastFat=-1;
 const model={group,ready:null,setGeometry(){/* Same native atlas scale is intentionally retained. */},setMode(key){mode=key;for(const m of all){const l=m.userData.layer;m.visible=key==='0'?l==='skin':true;m.material.opacity=l==='skin'?(key==='0'?.94:.14):l==='adipose'?.12:l==='muscular'?.8:1;m.material.depthWrite=m.material.opacity>.94;}},
 surfaceY(lat,along){if(!skin)return null;ray.set(new T.Vector3((55+along)*.001,.16,lat*.001),new T.Vector3(0,-1,0));return ray.intersectObject(skin)[0]?.point.y??null;},
 update(tissue,gain=1){const dr=tissue?.radiusDelta_mm||0;fat=tissue?.fat_mm??2.2;
  for(const item of moving){const {mesh,rest,field}=item,a=mesh.geometry.attributes.position.array;
   if(lastFat!==fat){for(let i=0;i<rest.length;i+=3){const x=rest[i]*1000,lat=rest[i+2]*1000,atlas=atlasArteryAt(x-55),d=atlas.surfaceY_mm-rest[i+1]*1000;
    const u=surroundingDisplacement(lat,Math.max(0,d),atlas.lateral_mm,atlas.depth_mm,1,fat),envelope=x<55?1:Math.exp(-(((x-55)/18)**2));
    field[i]=0;field[i+1]=u.vertical_mm*.001*envelope;field[i+2]=u.lateral_mm*.001*envelope;
   }}
   for(let i=0;i<a.length;i++)a[i]=rest[i]+field[i]*dr*gain;
   mesh.geometry.attributes.position.needsUpdate=true;
  }lastFat=fat;
 },
 dispose(){group.traverse(m=>{if(m.isMesh){m.geometry.dispose();m.material.dispose();}});}};
 model.ready=new GLTFLoader().loadAsync('/models/wrist/atlas.glb').then(g=>{
  g.scene.traverse(n=>{if(!n.isMesh)return;const layer=n.userData.layer||'muscular',name=n.name.toLowerCase();
   const tendon=/tendon|sheath|fascia|retinaculum|ligament|aponeurosis/.test(name),vein=/vein|venous/.test(name);
   n.material=new T.MeshStandardMaterial({color:tendon?0xd8cdbb:vein?0x486a99:colors[layer],roughness:layer==='skeleton'?.88:.65,transparent:true,side:T.DoubleSide});n.userData.layer=layer;n.frustumCulled=false;all.push(n);
   if(layer==='skin')skin=n;
   if(layer!=='skeleton'&&layer!=='nervous'&&!tendon){const rest=n.geometry.attributes.position.array.slice();moving.push({mesh:n,rest,field:new Float32Array(rest.length)});}
  });
  group.add(g.scene);
  // Native-surface-derived local subcutis envelope: representative, NOT segmented fat.
  if(skin){const fatMesh=skin.clone();fatMesh.geometry=skin.geometry.clone();fatMesh.userData={layer:'adipose'};fatMesh.name='피하지방 경계 · 피부에서 유도한 대표층';const a=fatMesh.geometry.attributes.position,b=fatMesh.geometry.attributes.normal;
   for(let i=0;i<a.count;i++){a.setXYZ(i,a.getX(i)-b.getX(i)*.0016,a.getY(i)-b.getY(i)*.0016,a.getZ(i)-b.getZ(i)*.0016);}
   fatMesh.material=new T.MeshStandardMaterial({color:colors.adipose,transparent:true,opacity:.12,depthWrite:false,side:T.DoubleSide});
   // Fat view is local to distal forearm, never a shrunken whole hand inside fingers.
   fatMesh.material.onBeforeCompile=s=>{s.vertexShader='varying float wristAlong;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nwristAlong=position.x;');s.fragmentShader='varying float wristAlong;\n'+s.fragmentShader;s.fragmentShader=s.fragmentShader.replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nif(wristAlong>.065)discard;');};
   group.add(fatMesh);all.push(fatMesh);moving.push({mesh:fatMesh,rest:a.array.slice(),field:new Float32Array(a.array.length)});
  }model.setMode(mode);model.update(null);
  return model;
 });return model;
}
export const buildModelA=buildModel0;
export const buildModelE=buildModel0;
