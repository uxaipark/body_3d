import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {DRACOLoader} from 'three/addons/loaders/DRACOLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {skinRegions,closestSkinRegion,type SkinRegion} from './skin-section';
import {applySkinTissue} from './skin-tissue';
import {SoftBody,tissueShader} from './soft-body';
import {isArtery,bindArterialPulse,arterialShader,systolicPulse,distensionFraction} from './arterial';
import {muscleTissue,muscleFrame,applyMuscleSurface,tissueColors,type Tissue} from './muscle';
import {HumanRig,bindGeometry,rigidBone,pelvicOrgan,rigShader} from './rig';
import {respiratoryPart,isRespiratoryPart} from './respiratory.js';
import {registerSkinGeometry} from './skin-registration.js';
import {sites,sensorColors, type Parameters, type Site} from './physiology';
export type Layer='skin'|'dermis'|'adipose'|'cardiovascular'|'visceral'|'nervous'|'skeleton'|'muscular';
export type Layers=Record<Layer,number>;
export const initialLayers:Layers={skin:0,dermis:0,adipose:0,cardiovascular:100,visceral:80,nervous:65,skeleton:13,muscular:9};
interface PickRange{end:number;name:string}
export class AnatomyScene{
 renderer:THREE.WebGLRenderer;scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(31,1,.01,30);controls:OrbitControls;
 groups=new Map<Layer,THREE.Group>(); meshes:THREE.Mesh[]=[]; markers=new Map<Site,THREE.Mesh>();
 root=new THREE.Group();draco=new DRACOLoader();params:Parameters;layers:Layers;time=0;running=true;rotate=false;disposed=false;
 frame=0;last=0;lastStats=0;frameCount=0;slowFrames=0;resizeObserver:ResizeObserver;raycaster=new THREE.Raycaster();pointerDown=[0,0];
 rig=new HumanRig();skinRig=new HumanRig();softBody=new SoftBody();
 skinInspection=false;skinMarkers=new Map<string,THREE.Mesh>();
 cardiacCycles=0;selectedSites=new Set<Site>();
 uniforms={uResp:{value:0},uLungInflation:{value:0},uBeat:{value:0},uCardiacCycles:{value:0},uHeartRate:{value:72},uPWV:{value:6.8},uDistension:{value:.019},uPulseGain:{value:1}};
 onStats:(fps:number,triangles:number)=>void;onPick:(name:string)=>void;onTime:(time:number)=>void;onSite:(site:Site)=>void;onSkin:(region:SkinRegion)=>void;
 constructor(public container:HTMLDivElement,p:Parameters,l:Layers,callbacks:{stats:AnatomyScene['onStats'];pick:AnatomyScene['onPick'];time:AnatomyScene['onTime'];site:AnatomyScene['onSite'];skin:AnatomyScene['onSkin']}){
 this.skinRig.forearmRoll=0;
 this.params=p;this.layers=l;this.onStats=callbacks.stats;this.onPick=callbacks.pick;this.onTime=callbacks.time;this.onSite=callbacks.site;this.onSkin=callbacks.skin;
 this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
 this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.5));this.renderer.setClearColor(0x0c1013,0);this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.4;
 container.appendChild(this.renderer.domElement);this.camera.position.set(.7,1.04,3.7);this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.target.set(0,.91,0);this.controls.enableDamping=true;this.controls.dampingFactor=.075;this.controls.minDistance=.22;this.controls.maxDistance=6;this.controls.maxPolarAngle=Math.PI*.95;
 this.scene.add(this.root);this.scene.add(new THREE.HemisphereLight(0xcce6f4,0x423b32,2));
 for(const [pos,color,intensity] of [[[2,3,3],0xffffff,3],[[-2,1,1],0x76bdce,2],[[0,2,-2],0xb4e5d0,3]] as const){const light=new THREE.DirectionalLight(color,intensity);light.position.set(pos[0],pos[1],pos[2]);this.scene.add(light);}
 const grid=new THREE.GridHelper(8,80,0x354743,0x202a2e);grid.position.y=-.015;(grid.material as THREE.Material).transparent=true;(grid.material as THREE.Material).opacity=.5;this.scene.add(grid);
 const ring=new THREE.Mesh(new THREE.RingGeometry(.38,.383,96),new THREE.MeshBasicMaterial({color:0x92cbbb,side:THREE.DoubleSide,transparent:true,opacity:.32}));ring.rotation.x=-Math.PI/2;ring.position.y=-.01;this.scene.add(ring);
 for(const [key,site]of Object.entries(sites)){const marker=new THREE.Mesh(new THREE.SphereGeometry(.012,16,12),new THREE.MeshBasicMaterial({color:0xa4e4d0,transparent:true,opacity:.75,depthTest:false}));marker.position.set(...site.position);marker.visible=false;marker.renderOrder=10;marker.userData.site=key;this.markers.set(key as Site,marker);this.root.add(marker);const halo=new THREE.Mesh(new THREE.TorusGeometry(.021,.0015,6,32),new THREE.MeshBasicMaterial({color:0xa4e4d0,transparent:true,opacity:.6,depthTest:false}));halo.name='halo';marker.add(halo);}
 for(const region of skinRegions){const marker=new THREE.Mesh(new THREE.SphereGeometry(.014,12,10),new THREE.MeshBasicMaterial({color:0x82e4d4,depthTest:false,transparent:true,opacity:.85}));marker.userData.region=region;marker.visible=false;marker.renderOrder=15;marker.position.set(...region.position);this.skinMarkers.set(region.id,marker);this.root.add(marker);}
 this.draco.setDecoderPath('/draco/');this.draco.setWorkerLimit(2);
 this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);this.resize();
 this.renderer.domElement.addEventListener('pointerdown',this.pointerStart);this.renderer.domElement.addEventListener('pointerup',this.pick);
 this.renderer.domElement.addEventListener('webglcontextlost',this.contextLost);
 this.frame=requestAnimationFrame(this.animate);
 }
 contextLost=(e:Event)=>{e.preventDefault();this.onPick('WebGL 연결이 끊겼습니다. 페이지를 새로고침해 주세요.');};
 resize(){const w=this.container.clientWidth,h=this.container.clientHeight;if(!w||!h)return;this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();}
 async load(onProgress:(n:number)=>void){let done=0;const loader=new GLTFLoader().setDRACOLoader(this.draco);
 // Limit concurrent decodes to keep interaction responsive on integrated GPUs.
 for(const layer of ['skin','visceral','cardiovascular','skeleton','nervous','muscular'] as Layer[]){
 const gltf=await loader.loadAsync(layer==='skin'?'/models/skin-web.glb?portrait=original-3141ddb':`/models/${layer}-web.glb${layer==='adipose'||layer==='dermis'?'?tissue=3':layer==='visceral'?'?lungs=4':''}`);if(this.disposed){gltf.scene.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.dispose()});return;}
 gltf.scene.updateMatrixWorld(true);
 if(layer==='skin'||layer==='dermis'||layer==='adipose'){
 const group=new THREE.Group();
 gltf.scene.traverse(obj=>{if(!(obj instanceof THREE.Mesh))return;
 const geometry=obj.geometry.clone().applyMatrix4(obj.matrixWorld);
 const pelvicAnchors=registerSkinGeometry(geometry);
 const source=Array.isArray(obj.material)?obj.material[0]:obj.material;
 const mat=source.clone() as THREE.MeshStandardMaterial;
 mat.transparent=true;mat.opacity=this.layers[layer]/100;mat.depthWrite=this.layers[layer]>=95;
 mat.metalness=0;mat.side=THREE.FrontSide;mat.roughness=/high.poly/i.test(obj.name)?.3:mat.roughness;
 if(mat.map)mat.map.anisotropy=Math.min(4,this.renderer.capabilities.getMaxAnisotropy());
 // Alpha-tested hair cards keep their strand silhouettes even when the skin layer fades.
 if(/short|eyebrow/i.test(obj.name)){mat.alphaTest=.3;mat.side=THREE.DoubleSide;}
 bindGeometry(geometry,undefined,true);for(const i of pelvicAnchors){geometry.getAttribute('rigIndex').setXYZW(i,0,0,0,0);geometry.getAttribute('rigWeight').setXYZW(i,1,0,0,0);}this.applyDeformation(mat,layer);if(layer!=='skin')applySkinTissue(mat,layer);
 const mesh=new THREE.Mesh(geometry,mat);mesh.renderOrder=layer==='skin'?8:layer==='dermis'?7:6;mesh.userData={layer,ranges:[{end:Infinity,name:layer==='adipose'?'피하지방':layer==='dermis'?'진피':/short|hair/i.test(obj.name)?'헤어':/eyebrow/i.test(obj.name)?'눈썹':/high.poly/i.test(obj.name)?'눈':'피부 · 성인 남성 외피'}]};group.add(mesh);this.meshes.push(mesh);
 obj.geometry.dispose();source.dispose();
 });
 this.groups.set(layer,group);this.root.add(group);this.setLayers(this.layers);onProgress(Math.round(++done/6*100));continue;
 }

 const batches=new Map<string,{geometries:THREE.BufferGeometry[];ranges:PickRange[];count:number}>();
 gltf.scene.traverse(obj=>{if(!(obj instanceof THREE.Mesh))return;
 const name=obj.name.replace(/_/g,' ');if(/systemg\d|organsg\d/i.test(name))return;
 const source=Array.isArray(obj.material)?obj.material[0]:obj.material;
 const color=source.color?.clone()||new THREE.Color(0xddb2a4);
 const part=layer==='visceral'&&pelvicOrgan(name)?'pelvic':layer==='muscular'?muscleTissue(name):layer==='visceral'&&respiratoryPart(name)?respiratoryPart(name)!:layer==='cardiovascular'&&/atrium|ventricle|myocard|epicard/i.test(name)?'heart':layer==='cardiovascular'&&isArtery(name)?'artery':'body';
 const key=part;let batch=batches.get(key);if(!batch){batch={geometries:[],ranges:[],count:0};batches.set(key,batch);}
 const geometry=obj.geometry.clone().applyMatrix4(obj.matrixWorld);
 for(const key of Object.keys(geometry.attributes))if(key!=='position'&&key!=='normal'&&key!=='_lung_inhale')geometry.deleteAttribute(key);
 if(isRespiratoryPart(part)){const inhale=geometry.getAttribute('_lung_inhale') as THREE.BufferAttribute;if(!inhale)throw new Error(`Missing bounded respiratory pose: ${name}`);const v=new THREE.Vector3();for(let i=0;i<inhale.count;i++){v.fromBufferAttribute(inhale,i).applyMatrix4(obj.matrixWorld);inhale.setXYZ(i,v.x,v.y,v.z);}geometry.setAttribute('lungInhale',inhale);geometry.deleteAttribute('_lung_inhale');}
 if(!geometry.getAttribute('normal'))geometry.computeVertexNormals();
 geometry.computeBoundingBox();bindGeometry(geometry,layer==='skeleton'?rigidBone(name,geometry.boundingBox!.getCenter(new THREE.Vector3())):isRespiratoryPart(part)?2:pelvicOrgan(name)?0:undefined);
 const count=geometry.getAttribute('position').count;const colors=new Float32Array(count*3);
 if(layer==='cardiovascular'){if(color.b>color.r)color.set('#4988c9');else color.set('#d55559');}
 if(layer==='nervous')color.set('#d2b278');
 if(part==='artery')bindArterialPulse(geometry,name);
 if(layer==='muscular'){color.set(tissueColors[part as Tissue]);muscleFrame(geometry,name);}
 for(let i=0;i<count;i++)color.toArray(colors,i*3);geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
 batch.count+=(geometry.index?.count||count)/3;batch.ranges.push({end:batch.count,name:name.replace(/\d{3}$/,'').replace(/([a-z])([lr])$/,'$1 ($2)')});batch.geometries.push(geometry);
 });
 const group=new THREE.Group();
 for(const [part,batch]of batches){const geometry=mergeGeometries(batch.geometries);batch.geometries.forEach(g=>g.dispose());if(!geometry)continue;
 const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.52,metalness:.07,transparent:true,opacity:this.layers[layer]/100,depthWrite:this.layers[layer]>=95,side:THREE.FrontSide});
 this.applyDeformation(mat,part,layer==='skeleton'||part==='pelvic'||isRespiratoryPart(part));
 if(layer==='muscular'){mat.metalness=0;mat.roughness=part==='tendon'?.4:.57;applyMuscleSurface(mat,part as Tissue);}
 const mesh=new THREE.Mesh(geometry,mat);mesh.userData={layer,ranges:batch.ranges,opacityScale:part==='fascia'?.13:part==='pleura'?.18:1};mesh.renderOrder=part==='fascia'?6:layer==='muscular'?4:layer==='skeleton'?3:part==='pleura'?1:0;this.meshes.push(mesh);group.add(mesh);}
 this.groups.set(layer,group);this.root.add(group);this.setLayers(this.layers);gltf.scene.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();const mats=Array.isArray(o.material)?o.material:[o.material];mats.forEach(m=>m.dispose());}});onProgress(Math.round(++done/6*100));
 }
 }
 applyDeformation(mat:THREE.MeshStandardMaterial,part:string,rigid=false){
 mat.onBeforeCompile=shader=>{
 Object.assign(shader.uniforms,this.uniforms,this.softBody.uniforms,['skin','dermis','adipose'].includes(part)?this.skinRig.uniforms:this.rig.uniforms);
 shader.vertexShader='uniform float uResp; uniform float uBeat;\n'+(isRespiratoryPart(part)?'attribute vec3 lungInhale; uniform float uLungInflation;\n':'')+rigShader+(rigid?'':tissueShader)+(part==='artery'?arterialShader:'')+shader.vertexShader;
 shader.vertexShader=shader.vertexShader.replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
 vec4 rigR;vec4 rigD;rigBlend(rigR,rigD);
 ${rigid?'':'vec3 tissueOffset;mat3 tissueJacobian;tissueField(position,tissueOffset,tissueJacobian);objectNormal=transpose(inverse(tissueJacobian))*objectNormal;'}
 objectNormal=rigRotate(rigR,objectNormal);
 #ifdef USE_TANGENT
 objectTangent=rigRotate(rigR,objectTangent);
 #endif
 `);
 shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
 ${rigid?'':'transformed+=tissueOffset;'}

 ${isRespiratoryPart(part)?'transformed=mix(position,lungInhale,uLungInflation);':''}
 ${part==='heart'?'transformed -= (transformed-vec3(0.035,1.28,0.035))*uBeat*0.035;':''}
 ${part==='artery'?'transformed += normal*pulseData.x*uDistension*uPulseGain*arterialWallPulse();':''}
 transformed=rigPosition(rigR,rigD,transformed);
 `);
 };mat.customProgramCacheKey=()=>`joint-dq-tissue-v2-${part}-${rigid}`;
 }

 setLayers(l:Layers){this.layers=l;for(const m of this.meshes){const v=l[m.userData.layer as Layer];const layer=m.userData.layer as Layer;const cover=l.skin>=100?'skin':l.dermis>=100?'dermis':l.adipose>=100?'adipose':null;const exterior=['skin','dermis','adipose'];m.visible=v>0&&(!cover||(exterior.includes(layer)&&exterior.indexOf(layer)<=exterior.indexOf(cover)));const mat=m.material as THREE.MeshStandardMaterial;mat.opacity=v/100*(m.userData.opacityScale??1);mat.depthWrite=mat.opacity>=.95;}}
 setSkinInspection(enabled:boolean){this.skinInspection=enabled;for(const marker of this.skinMarkers.values())marker.visible=enabled;}
 setSensors(selected:Site[]){this.selectedSites=new Set(selected);for(const [key,m]of this.markers)m.visible=this.selectedSites.has(key);}
 setParameters(p:Parameters){this.params=p;for(const [key,m]of this.markers){m.scale.setScalar(key===p.site?1.4:.65);(m.material as THREE.MeshBasicMaterial).color.set(sensorColors[key]);}}
 focus(target:'body'|'chest'|'head'|'sensor'|'front'|'back'){if(target==='body'||target==='front'){this.controls.target.set(0,.91,0);this.camera.position.set(target==='front'?0:.7,1.04,3.7);}else if(target==='back'){this.controls.target.set(0,.91,0);this.camera.position.set(0,1.04,-3.7);}else{const p=target==='sensor'?sites[this.params.site].position:target==='head'?[0,1.62,0]:[0,1.28,0];this.controls.target.set(p[0],p[1],p[2]);this.camera.position.set(p[0]+.12,p[1]+.02,p[2]+(target==='sensor'?.5:.85));}this.controls.update();}
 zoom(factor:number){this.camera.position.sub(this.controls.target).multiplyScalar(factor).add(this.controls.target);this.controls.update();}
 pointerStart=(e:PointerEvent)=>{this.pointerDown=[e.clientX,e.clientY]};
 pick=(e:PointerEvent)=>{if(Math.hypot(e.clientX-this.pointerDown[0],e.clientY-this.pointerDown[1])>5)return;const r=this.renderer.domElement.getBoundingClientRect();this.raycaster.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),this.camera);
 if(this.skinInspection){
  const spot=this.raycaster.intersectObjects([...this.skinMarkers.values()],false)[0];if(spot){this.onSkin(spot.object.userData.region);return;}
  const point=this.pickSkinSurface();if(point){this.onSkin(closestSkinRegion(point));return;}
 }
 const marker=this.raycaster.intersectObjects([...this.markers.values()].filter(m=>m.visible),false)[0];if(marker){this.onSite(marker.object.userData.site);return;}
 if(this.params.motion!=='rest'){this.onPick('해부학 구조 선택은 정지 자세에서 가능합니다.');return;}
 const hit=this.raycaster.intersectObjects(this.meshes.filter(m=>m.visible&&this.layers[m.userData.layer as Layer]>20),false)[0];if(hit){const ranges=hit.object.userData.ranges as PickRange[];this.onPick(ranges.find(r=>(hit.faceIndex||0)<r.end)?.name||'Anatomical structure');}
 };
 /** CPU skin picking only on clicks, so a moving surface opens its bind-space region. */
 pickSkinSurface():[number,number,number]|null{
  const source=this.meshes.find(m=>m.userData.layer==='skin'&&m.geometry.getAttribute('position').count>10000);if(!source)return null;
  const geometry=source.geometry.clone(),position=geometry.getAttribute('position') as THREE.BufferAttribute,original=source.geometry.getAttribute('position'),indices=source.geometry.getAttribute('rigIndex'),weights=source.geometry.getAttribute('rigWeight');
  for(let i=0;i<position.count;i++){
   const point=new THREE.Vector3().fromBufferAttribute(original,i);point.add(this.softBody.sample(point));
   const moved=this.skinRig.transform(point,{indices:[indices.getX(i),indices.getY(i),indices.getZ(i),indices.getW(i)],weights:[weights.getX(i),weights.getY(i),weights.getZ(i),weights.getW(i)]});position.setXYZ(i,moved.x,moved.y,moved.z);
  }
  geometry.computeBoundingSphere();geometry.computeBoundingBox();
  const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),mesh=new THREE.Mesh(geometry,material);mesh.matrixWorld.copy(source.matrixWorld);
  const hit=this.raycaster.intersectObject(mesh,false)[0];let result:[number,number,number]|null=null;
  if(hit?.face){const {a,b,c}=hit.face,local=mesh.worldToLocal(hit.point.clone()),bary=THREE.Triangle.getBarycoord(local,new THREE.Vector3().fromBufferAttribute(position,a),new THREE.Vector3().fromBufferAttribute(position,b),new THREE.Vector3().fromBufferAttribute(position,c),new THREE.Vector3());if(bary){const point=new THREE.Vector3().fromBufferAttribute(original,a).multiplyScalar(bary.x).addScaledVector(new THREE.Vector3().fromBufferAttribute(original,b),bary.y).addScaledVector(new THREE.Vector3().fromBufferAttribute(original,c),bary.z);result=point.toArray() as [number,number,number];}}
  geometry.dispose();material.dispose();return result;
 }
 animate=(now:number)=>{if(this.disposed)return;const delta=this.last?Math.min((now-this.last)/1000,.05):0;this.last=now;if(this.running&&!document.hidden)this.time+=delta;
 this.uniforms.uLungInflation.value=(1+Math.sin(this.time*Math.PI*2*this.params.rr/60))/2*Math.min(1,this.params.tidal/1000);
 this.uniforms.uResp.value=Math.sin(this.time*Math.PI*2*this.params.rr/60)*this.params.tidal/500;if(this.running&&!document.hidden)this.cardiacCycles+=delta*this.params.hr/60;
 this.uniforms.uCardiacCycles.value=this.cardiacCycles;this.uniforms.uHeartRate.value=this.params.hr;this.uniforms.uPWV.value=4+8*this.params.stiffness/100;this.uniforms.uDistension.value=distensionFraction(this.params.stiffness);this.uniforms.uBeat.value=systolicPulse(this.cardiacCycles);
 this.softBody.update(this.running&&!document.hidden?delta:0,(1+Math.sin(this.time*Math.PI*2*this.params.rr/60))/2,this.params.tidal);
 this.rig.update(this.running&&!document.hidden?delta:0,this.params.motion);
 this.skinRig.pose(this.rig.phase,this.rig.amount,this.rig.runMix);
 this.controls.autoRotate=this.rotate;this.controls.autoRotateSpeed=.5;this.controls.update();
 for(const [key,m] of this.markers){
 const point=new THREE.Vector3(...sites[key].position);
 point.add(this.softBody.sample(point));
 m.position.copy((this.layers.skin>0||this.layers.dermis>0||this.layers.adipose>0?this.skinRig:this.rig).transform(point));
 const halo=m.getObjectByName('halo');if(halo)halo.quaternion.copy(this.camera.quaternion);
 }
 if(this.skinInspection)for(const [key,marker]of this.skinMarkers){const region=skinRegions.find(r=>r.id===key)!,point=new THREE.Vector3(...region.position);point.add(this.softBody.sample(point));marker.position.copy(this.skinRig.transform(point));marker.scale.setScalar(1+.10*Math.sin(this.time*3));}
 if(!document.hidden){this.renderer.render(this.scene,this.camera);this.frameCount++;}if(now-this.lastStats>1000){const fps=Math.round(this.frameCount*1000/(now-this.lastStats));this.slowFrames=fps<38?this.slowFrames+1:0;if(this.slowFrames>=3&&this.renderer.getPixelRatio()>1){this.renderer.setPixelRatio(1);this.resize();this.slowFrames=0;}this.onStats(fps,this.renderer.info.render.triangles);this.onTime(this.time);this.lastStats=now;this.frameCount=0;}
 this.frame=requestAnimationFrame(this.animate);
 };
 dispose(){this.disposed=true;cancelAnimationFrame(this.frame);this.resizeObserver.disconnect();this.controls.dispose();this.draco.dispose();this.rig.dispose();this.skinRig.dispose();this.renderer.domElement.removeEventListener('pointerdown',this.pointerStart);this.renderer.domElement.removeEventListener('pointerup',this.pick);this.renderer.domElement.removeEventListener('webglcontextlost',this.contextLost);this.scene.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{for(const v of Object.values(m)){if(v instanceof THREE.Texture)v.dispose();}m.dispose();})}});this.renderer.dispose();this.renderer.domElement.remove();}
}
