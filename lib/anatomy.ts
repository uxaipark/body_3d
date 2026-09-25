import {orderedBatches,bodyLoadParts} from './body-loading.js';
import {NerveSkinGuard,nerveSkinShader} from './skin-boundary';
import {loadBodyGeometry,fetchBodyGeometry,decodeBodyGeometry,type BodyManifest,type PackedPart} from './body-packed';
import {NervePoseCache,cachedNerveShader} from './nerve-pose-cache';
import {qualitySettings,readQualityPreference,resolveQuality,type QualityChoice,type QualityTier} from './render-quality';
import {connectVesselJunctions,bakeAnatomyTransform,type VesselPart} from './vessel-junctions';
import {refineFlexibleTissue} from './flexible-tissue';
import {updateDeformedBounds,bedViewPoint,followBedView} from './rig-view';
import * as THREE from 'three';
import {RenderBudget} from '../public/ui/render-budget.js';
import {chair} from './chair.js';
import {applyComfortMask,comfortRegion} from './comfort';
import {bed,bedShader,bedPlacement} from './bed.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {DRACOLoader} from 'three/addons/loaders/DRACOLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {skinRegions,closestSkinRegion,type SkinRegion} from './skin-section';
import {applySkinTissue} from './skin-tissue';
import {SoftBody,tissueShader} from './soft-body';
import {isArtery,bindArterialPulse,arterialShader,systolicPulse,distensionFraction} from './arterial';
import {muscleTissue,muscleFrame,applyMuscleSurface,tissueColors,type Tissue} from './muscle';
import {MuscleVolumeGuard,bindMuscleVolume,muscleVolumeShader} from './muscle-volume';
import {bindTissueGeometry} from './tissue-binding';
import {HumanRig,bindGeometry,bindFingerGeometry,rigidBone,pelvicOrgan,rigShader,weightsAt,surfaceTissueWeight,surfaceFootSupport} from './rig';
import {respiratoryPart,isRespiratoryPart} from './respiratory.js';
import {registerSkinGeometry} from './skin-registration.js';
import {bindCardiacMotion,cardiacShader,isCardiacChamber} from './cardiac';
import {applyCardiacClearance} from './cardiac-space';
import {applyOrganSurface} from './organ-surface';
import {bindVesselClearance,vesselClearanceShader} from './vessel-clearance';
import {isHepatic,fitHepaticGeometry,hepaticMotion} from './hepatic.js';
import {sites,sensorColors, type Parameters, type Site} from './physiology';
import type {Layer,Layers} from './anatomy-layers';
export {initialLayers} from './anatomy-layers';
export type {Layer,Layers} from './anatomy-layers';
interface PickRange{end:number;name:string}
export class AnatomyScene{
 renderer:THREE.WebGLRenderer;scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(31,1,.003,30);controls:OrbitControls;
 groups=new Map<Layer,THREE.Group>(); meshes:THREE.Mesh[]=[]; markers=new Map<Site,THREE.Mesh>();
 root=new THREE.Group();chair=new THREE.Group();bedGroup=new THREE.Group();bedLoad={value:0};draco=new DRACOLoader();params:Parameters;layers:Layers;time=0;running=true;rotate=false;disposed=false;
 frame=0;last=0;lastStats=0;frameCount=0;slowFrames=0;resizeObserver:ResizeObserver;raycaster=new THREE.Raycaster();pointerDown=[0,0];
 followBed=false;bedViewAnchor=new THREE.Vector3();bedViewCurrent=new THREE.Vector3();bodyBounds=new THREE.Sphere(new THREE.Vector3(0,.9,0),1.3);rig=new HumanRig();skinRig=this.rig;softBody=new SoftBody();
 bloodVesselsVisible=true;comfortMode=true;comfortUniform={value:1};
 nerveSkin?:NerveSkinGuard;
 nerveCache?:NervePoseCache;useNerveCache=true;qualityChoice:QualityChoice='auto';qualityTier:QualityTier='balanced';dirty=true;idleFrames=0;lastRendered=0;lastLod=0;qualitySamples=0;qualitySlow=0;ready=false;lodError='';
 muscleVolume=new MuscleVolumeGuard();skinInspection=false;skinMarkers=new Map<string,THREE.Mesh>();
 cardiacCycles=0;selectedSites=new Set<Site>();
 uniforms={uResp:{value:0},uLungInflation:{value:0},uBeat:{value:0},uCardiacCycles:{value:0},uHeartRate:{value:72},uPWV:{value:6.8},uDistension:{value:.019},uPulseGain:{value:1}};
 onStats:(fps:number,triangles:number)=>void;onPick:(name:string)=>void;onTime:(time:number)=>void;onSite:(site:Site)=>void;onSkin:(region:SkinRegion)=>void;
 constructor(public container:HTMLDivElement,p:Parameters,l:Layers,callbacks:{stats:AnatomyScene['onStats'];pick:AnatomyScene['onPick'];time:AnatomyScene['onTime'];site:AnatomyScene['onSite'];skin:AnatomyScene['onSkin']}){
 this.skinRig.forearmRoll=this.rig.forearmRoll;
 this.params=p;this.layers=l;this.onStats=callbacks.stats;this.onPick=callbacks.pick;this.onTime=callbacks.time;this.onSite=callbacks.site;this.onSkin=callbacks.skin;
 this.qualityChoice=readQualityPreference();this.qualityTier=resolveQuality(this.qualityChoice);
 this.renderer=new THREE.WebGLRenderer({antialias:this.qualityTier!=='low',alpha:true,powerPreference:'high-performance'});
 this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,qualitySettings[this.qualityTier].dpr));this.renderer.setClearColor(0x0c1013,0);this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.4;
 container.appendChild(this.renderer.domElement);this.camera.position.set(.7,1.04,3.7);this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.target.set(0,.91,0);this.controls.enableDamping=true;this.controls.dampingFactor=.075;this.controls.minDistance=.22;this.controls.maxDistance=6;this.controls.maxPolarAngle=Math.PI*.95;
 this.scene.add(this.root);this.scene.add(new THREE.HemisphereLight(0xcce6f4,0x423b32,2));
 for(const [pos,color,intensity] of [[[2,3,3],0xffffff,3],[[-2,1,1],0x76bdce,2],[[0,2,-2],0xb4e5d0,3]] as const){const light=new THREE.DirectionalLight(color,intensity);light.position.set(pos[0],pos[1],pos[2]);this.scene.add(light);}
 const grid=new THREE.GridHelper(8,80,0x354743,0x202a2e);grid.position.y=-.015;(grid.material as THREE.Material).transparent=true;(grid.material as THREE.Material).opacity=.5;this.scene.add(grid);
 const ring=new THREE.Mesh(new THREE.RingGeometry(.38,.383,96),new THREE.MeshBasicMaterial({color:0x92cbbb,side:THREE.DoubleSide,transparent:true,opacity:.32}));ring.rotation.x=-Math.PI/2;ring.position.y=-.01;this.scene.add(ring);
 // A stationary seat makes the sit-to-stand support phase legible.
 const chairMaterial=new THREE.MeshStandardMaterial({color:0x506d69,roughness:.8,metalness:.15});
 const chairPart=(size:number[],position:number[])=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),chairMaterial);mesh.position.set(position[0],position[1],position[2]);this.chair.add(mesh)};
 chairPart([chair.width,chair.seatThickness,chair.depth],[0,chair.seatTop-chair.seatThickness/2,chair.centerZ]);chairPart([chair.width,.25,.022],[0,.64,-.56]);
 for(const x of [-.18,.18])for(const z of [-.51,-.23])chairPart([.022,.404,.022],[x,.202,z]);
 this.chair.visible=false;this.scene.add(this.chair);
 const bedFrameMaterial=new THREE.MeshStandardMaterial({color:0x40544f,roughness:.65,metalness:.25});
 const bedPart=(size:number[],position:number[])=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),bedFrameMaterial);mesh.position.set(position[0],position[1],position[2]);this.bedGroup.add(mesh)};
 bedPart([bed.width+.03,.06,bed.depth+.03],[0,bed.top-bed.thickness-.03,bed.centerZ]);
 for(const x of [-.43,.43])for(const z of [-2.12,-.28])bedPart([.04,.25,.04],[x,.125,z]);
 const mattressGeometry=new THREE.BoxGeometry(bed.width,bed.thickness,bed.depth,24,1,52).translate(0,bed.top-bed.thickness/2,bed.centerZ);
 const mattressMaterial=new THREE.MeshStandardMaterial({color:0xb5c8bf,roughness:.94,metalness:0});
 mattressMaterial.onBeforeCompile=shader=>{
  shader.uniforms.uBedLoad=this.bedLoad;shader.vertexShader=bedShader+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
   transformed.y+=(bedTop(position.xz)-.43)*clamp((position.y-.31)/.12,0.,1.);
  `).replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
   if(objectNormal.y>.5){float dx=(bedTop(position.xz+vec2(.001,0.))-bedTop(position.xz-vec2(.001,0.)))/.002;float dz=(bedTop(position.xz+vec2(0.,.001))-bedTop(position.xz-vec2(0.,.001)))/.002;objectNormal=normalize(vec3(-dx,1.,-dz));}
  `);
 };mattressMaterial.customProgramCacheKey=()=> 'support-mattress-v1';
 this.bedGroup.add(new THREE.Mesh(mattressGeometry,mattressMaterial));this.bedGroup.rotation.y=bedPlacement.angle;this.bedGroup.position.set(bedPlacement.x,0,bedPlacement.z);this.bedGroup.visible=false;this.scene.add(this.bedGroup);
 for(const [key,site]of Object.entries(sites)){const marker=new THREE.Mesh(new THREE.SphereGeometry(.012,16,12),new THREE.MeshBasicMaterial({color:0xa4e4d0,transparent:true,opacity:.75,depthTest:false}));marker.position.set(...site.position);marker.visible=false;marker.renderOrder=10;marker.userData.site=key;this.markers.set(key as Site,marker);this.root.add(marker);const halo=new THREE.Mesh(new THREE.TorusGeometry(.021,.0015,6,32),new THREE.MeshBasicMaterial({color:0xa4e4d0,transparent:true,opacity:.6,depthTest:false}));halo.name='halo';marker.add(halo);}
 for(const region of skinRegions){const marker=new THREE.Mesh(new THREE.SphereGeometry(.014,12,10),new THREE.MeshBasicMaterial({color:0x82e4d4,depthTest:false,transparent:true,opacity:.85}));marker.userData.region=region;marker.visible=false;marker.renderOrder=15;marker.position.set(...region.position);this.skinMarkers.set(region.id,marker);this.root.add(marker);}
 this.draco.setDecoderPath('/draco/');this.draco.setWorkerLimit(2);
 this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);this.resize();
 this.renderer.domElement.addEventListener('pointerdown',this.pointerStart);this.renderer.domElement.addEventListener('pointerup',this.pick);
 this.renderer.domElement.addEventListener('webglcontextlost',this.contextLost);
 this.controls.addEventListener('change',this.invalidate);document.addEventListener('visibilitychange',this.visibilityChanged);
 this.frame=requestAnimationFrame(this.animate);
 }
 contextLost=(e:Event)=>{e.preventDefault();this.onPick('WebGL 연결이 끊겼습니다. 페이지를 새로고침해 주세요.');};
 invalidate=()=>{this.dirty=true;this.idleFrames=0};
 setNerveCacheEnabled(enabled:boolean){if(this.useNerveCache===enabled)return;this.useNerveCache=enabled;for(const m of this.meshes)if(m.userData.layer==='nervous')(m.material as THREE.Material).needsUpdate=true;this.invalidate()}
 visibilityChanged=()=>{this.last=0;this.lastRendered=0;this.lastStats=performance.now();this.frameCount=0;this.qualitySlow=0;this.invalidate()};
 resize(){const w=this.container.clientWidth,h=this.container.clientHeight;if(!w||!h)return;this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.invalidate();}
 setQuality(choice:QualityChoice){this.qualityChoice=choice;this.qualityTier=resolveQuality(choice);if(this.lodError){this.lodError="";for(const state of this.packedParts.values())state.pending=undefined;}this.qualitySlow=0;this.qualitySamples=0;this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,qualitySettings[this.qualityTier].dpr));this.resize();this.updateLod();}
 updateLod(){
  if(this.disposed)return;
  const close=this.camera.position.distanceTo(this.controls.target)<1.35,wantDetail=this.qualityTier==='high'||(this.qualityTier==='balanced'&&close);
  const anchors:[string,string][]=[['head','head'],['torso','chest'],['legs','thigh.r'],['rightArm','forearm.r'],['leftArm','forearm.l']];let region='torso',distance=Infinity;
  for(const [name,bone]of anchors){const d=this.rig.bone(bone).getWorldPosition(new THREE.Vector3()).distanceToSquared(this.controls.target);if(d<distance){distance=d;region=name}}
  for(const [mesh,state]of this.packedParts){const detail=wantDetail&&mesh.visible&&(this.qualityTier==='high'||state.part.region===region||!state.part.region);
   if(detail&&state.part.detail&&!state.high&&!state.pending){state.pending=loadBodyGeometry(state.part.detail,this.abortLoad.signal).then(g=>{if(this.disposed){g.dispose();return}state.high=g;g.boundingSphere=this.bodyBounds;state.pending=undefined;this.invalidate();this.updateLod()}).catch(e=>{if(!this.disposed)this.lodError=String(e)});}
   const g=detail&&state.high?state.high:state.low;if(mesh.geometry!==g){mesh.geometry=g;mesh.userData.ranges=g===state.high?state.part.detailRanges:state.part.userData.ranges;this.invalidate()}
   if(!detail&&state.high){state.high.dispose();state.high=undefined}
  }
 }
 abortLoad=new AbortController();packedParts=new Map<THREE.Mesh,{part:PackedPart;low:THREE.BufferGeometry;high?:THREE.BufferGeometry;pending?:Promise<void>}>();
 async load(onProgress:(n:number)=>void,profile:'full'|'sleep'='full'){
  const response=await fetch('/models/body/manifest.json',{signal:this.abortLoad.signal});if(!response.ok)throw Error('Precomputed anatomy is unavailable');
  const manifest=await response.json() as BodyManifest;if(manifest.version!==1)throw Error('Incompatible anatomy version');let done=0;
  const parts=bodyLoadParts(manifest.parts,profile);
  for await(const {item:part,value:bytes} of orderedBatches(parts,(part:PackedPart,signal:AbortSignal)=>fetchBodyGeometry(part.file,signal),this.abortLoad.signal,4)){
   const geometry=await decodeBodyGeometry(bytes);if(this.disposed){geometry.dispose();return}
   const layer=part.layer as Layer,skin=layer==='skin';
   if(skin){if(profile==='full')this.nerveSkin=new NerveSkinGuard(geometry);this.rig.floorSamples=surfaceFootSupport(geometry);this.skinRig.floorSamples=this.rig.floorSamples;if(this.nerveSkin&&this.renderer.extensions.has('EXT_color_buffer_float'))this.nerveCache=new NervePoseCache(this.nerveSkin,this.rig,this.softBody);}
   const mat=new THREE.MeshStandardMaterial({color:new THREE.Color().fromArray(part.color),vertexColors:!skin,roughness:.52,metalness:skin?0:.07,transparent:true,side:THREE.FrontSide});
   this.applyDeformation(mat,part.part,layer==='skeleton'||part.part==='pelvic'||part.part==='hepatic'||isRespiratoryPart(part.part),layer==='cardiovascular',layer==='muscular',layer==='nervous');
   if(skin)applySkinTissue(mat,'skin');if(part.part==='lung')applyCardiacClearance(mat);
   if(part.part==='heart'||part.part==='lung'){mat.metalness=0;mat.roughness=part.part==='heart'?.42:.7;applyOrganSurface(mat,part.part)}
   if(layer==='muscular'){mat.metalness=0;mat.roughness=part.part==='tendon'?.4:.57;applyMuscleSurface(mat,part.part as Tissue)}
   applyComfortMask(mat,this.comfortUniform);
   const mesh=new THREE.Mesh(geometry,mat);geometry.boundingSphere=this.bodyBounds;mesh.userData={...part.userData};mesh.renderOrder=part.renderOrder;
   if(skin)mesh.userData.ranges=[{end:Infinity,name:'피부 · BodyParts3D 성인 남성'}];
   let group=this.groups.get(layer);if(!group){group=new THREE.Group();this.groups.set(layer,group);this.root.add(group)}group.add(mesh);this.meshes.push(mesh);this.packedParts.set(mesh,{part,low:geometry});this.setLayers(this.layers);onProgress(Math.round(++done/parts.length*100));
  }this.ready=true;this.lastStats=performance.now();this.frameCount=0;this.updateLod();this.invalidate();
 }
 /** Offline asset baker only. Production uses the lossless precomputed meshes. */
 async loadSource(onProgress:(n:number)=>void){let done=0;const loader=new GLTFLoader().setDRACOLoader(this.draco);
 // Limit concurrent decodes to keep interaction responsive on integrated GPUs.
 for(const layer of ['skin','visceral','cardiovascular','skeleton','nervous','muscular'] as Layer[]){
 const gltf=await loader.loadAsync(layer==='skin'?'/models/skin-atlas-web.glb?native=3':`/models/${layer}-web.glb${layer==='adipose'||layer==='dermis'?'?tissue=3':layer==='visceral'?'?lungs=4':layer==='cardiovascular'?'?costal=1':''}`);if(this.disposed){gltf.scene.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.dispose()});return;}
 gltf.scene.updateMatrixWorld(true);
 if(layer==='skin'||layer==='dermis'||layer==='adipose'){
 const group=new THREE.Group();
 gltf.scene.traverse(obj=>{if(!(obj instanceof THREE.Mesh))return;
 const geometry=bakeAnatomyTransform(obj.geometry.clone(),obj.matrixWorld);
 const pelvicAnchors=layer==='skin'?[]:registerSkinGeometry(geometry);
 const source=Array.isArray(obj.material)?obj.material[0]:obj.material;
 const mat=source.clone() as THREE.MeshStandardMaterial;
 mat.transparent=true;mat.opacity=this.layers[layer]/100;mat.depthWrite=this.layers[layer]>=95;
 mat.metalness=0;mat.side=THREE.FrontSide;mat.roughness=/high.poly/i.test(obj.name)?.3:mat.roughness;
 if(mat.map)mat.map.anisotropy=Math.min(4,this.renderer.capabilities.getMaxAnisotropy());
 // Alpha-tested hair cards keep their strand silhouettes even when the skin layer fades.
 if(/short|eyebrow/i.test(obj.name)){mat.alphaTest=.3;mat.side=THREE.DoubleSide;}
 if(layer==='skin'){
  for(const [source,target]of [['_rig_index','rigIndex'],['_rig_weight','rigWeight']]){const attribute=geometry.getAttribute(source);if(!attribute)throw new Error('Missing fitted skin binding');geometry.setAttribute(target,attribute);geometry.deleteAttribute(source);}
  bindFingerGeometry(geometry);
  if(/Atlas[_ ]Skin/i.test(obj.name))this.nerveSkin=new NerveSkinGuard(geometry);
  const support=surfaceFootSupport(geometry);this.rig.floorSamples=support;this.skinRig.floorSamples=support;
  geometry.computeBoundingSphere();if(geometry.boundingSphere)geometry.boundingSphere.radius+=.6;
 }else{bindGeometry(geometry,undefined,true);for(const i of pelvicAnchors){geometry.getAttribute('rigIndex').setXYZW(i,0,0,0,0);geometry.getAttribute('rigWeight').setXYZW(i,1,0,0,0);}}
 this.applyDeformation(mat,layer);if(layer!=='skin'||/Atlas[_ ]Skin/i.test(obj.name))applySkinTissue(mat,layer);applyComfortMask(mat,this.comfortUniform);
 const mesh=new THREE.Mesh(geometry,mat);geometry.boundingSphere=this.bodyBounds;mesh.renderOrder=layer==='skin'?8:layer==='dermis'?7:6;mesh.userData={layer,ranges:[{end:Infinity,name:layer==='adipose'?'피하지방':layer==='dermis'?'진피':/short|hair/i.test(obj.name)?'헤어':/eyebrow/i.test(obj.name)?'눈썹':/high.poly/i.test(obj.name)?'눈':'피부 · BodyParts3D 성인 남성'}]};group.add(mesh);this.meshes.push(mesh);
 obj.geometry.dispose();source.dispose();
 });
 this.groups.set(layer,group);this.root.add(group);this.setLayers(this.layers);onProgress(Math.round(++done/6*100));continue;
 }

 const vesselParts:VesselPart[]=[];
 const batches=new Map<string,{geometries:THREE.BufferGeometry[];ranges:PickRange[];count:number}>();
 gltf.scene.traverse(obj=>{if(!(obj instanceof THREE.Mesh))return;
 const name=(obj.userData.name||obj.name).replace(/_/g,' ');if(layer==='visceral'&&respiratoryPart(name)==='pleura')return;if(/systemg\d|organsg\d/i.test(name))return;
 const source=Array.isArray(obj.material)?obj.material[0]:obj.material;
 const color=source.color?.clone()||new THREE.Color(0xddb2a4);
 const part=layer==='visceral'&&isHepatic(name)?'hepatic':layer==='visceral'&&pelvicOrgan(name)?'pelvic':layer==='muscular'?muscleTissue(name):layer==='visceral'&&respiratoryPart(name)?respiratoryPart(name)!:layer==='cardiovascular'&&isCardiacChamber(name)?'heart':layer==='cardiovascular'&&isArtery(name)?'artery':'body';
 const key=part;let batch=batches.get(key);if(!batch){batch={geometries:[],ranges:[],count:0};batches.set(key,batch);}
 const geometry=bakeAnatomyTransform(obj.geometry.clone(),obj.matrixWorld);
 if(part==='hepatic')fitHepaticGeometry(geometry);
 for(const key of Object.keys(geometry.attributes))if(!['position','normal','_lung_inhale','_rib_guard','_rib_chest'].includes(key))geometry.deleteAttribute(key);
 if(isRespiratoryPart(part)){const inhale=geometry.getAttribute('_lung_inhale') as THREE.BufferAttribute;if(!inhale)throw new Error(`Missing bounded respiratory pose: ${name}`);const v=new THREE.Vector3();for(let i=0;i<inhale.count;i++){v.fromBufferAttribute(inhale,i).applyMatrix4(obj.matrixWorld);inhale.setXYZ(i,v.x,v.y,v.z);}geometry.setAttribute('lungInhale',inhale);geometry.deleteAttribute('_lung_inhale');}
 if(!geometry.getAttribute('normal'))geometry.computeVertexNormals();
 if(layer==='nervous'||layer==='cardiovascular')refineFlexibleTissue(geometry,name);
 geometry.computeBoundingBox();bindGeometry(geometry,layer==='skeleton'?rigidBone(name,geometry.boundingBox!.getCenter(new THREE.Vector3())):isRespiratoryPart(part)||part==='hepatic'?2:pelvicOrgan(name)?0:undefined);
 if(layer==='muscular'||layer==='cardiovascular'||layer==='nervous')bindTissueGeometry(geometry,name);
 if(layer==='nervous'){if(!this.nerveSkin)throw new Error('Missing skin boundary for nerves');this.nerveSkin.bind(geometry);}
 const count=geometry.getAttribute('position').count;const colors=new Float32Array(count*3);
 if(layer==='cardiovascular'){if(color.b>color.r)color.set('#4988c9');else color.set('#d55559');}
 if(part==='heart')color.set('#a92e46');
 if(part==='lung')color.set('#d6a2b1');
 if(layer==='nervous')color.set('#d2b278');
 if(part==='artery')bindArterialPulse(geometry,name);
 if(layer==='cardiovascular')bindCardiacMotion(geometry,name);
 if(layer==='cardiovascular')bindVesselClearance(geometry);
 if(layer==='muscular'){color.set(tissueColors[part as Tissue]);muscleFrame(geometry,name);bindMuscleVolume(geometry,name);}
 for(let i=0;i<count;i++)color.toArray(colors,i*3);geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
 if(layer==='cardiovascular'&&part!=='heart')vesselParts.push({name,geometry,kind:part});
 batch.count+=(geometry.index?.count||count)/3;batch.ranges.push({end:batch.count,name:name.replace(/\d{3}$/,'').replace(/([a-z])([lr])$/,'$1 ($2)')});batch.geometries.push(geometry);
 });
 for(const join of connectVesselJunctions(vesselParts)){const batch=batches.get(join.kind)!;batch.count+=join.geometry.index!.count/3;batch.ranges.push({end:batch.count,name:`${join.from} ↔ ${join.to}`});batch.geometries.push(join.geometry);}
 const group=new THREE.Group();
 for(const [part,batch]of batches){const geometry=mergeGeometries(batch.geometries);batch.geometries.forEach(g=>g.dispose());if(!geometry)throw new Error(`Cannot merge anatomical layer ${layer}/${part}`);
 const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.52,metalness:.07,transparent:true,opacity:this.layers[layer]/100,depthWrite:this.layers[layer]>=95,side:THREE.FrontSide});
 this.applyDeformation(mat,part,layer==='skeleton'||part==='pelvic'||part==='hepatic'||isRespiratoryPart(part),layer==='cardiovascular',layer==='muscular',layer==='nervous');
 if(part==='lung')applyCardiacClearance(mat);
 if(part==='heart'||part==='lung'){mat.metalness=0;mat.roughness=part==='heart'?.42:.7;applyOrganSurface(mat,part);}
 if(layer==='muscular'){mat.metalness=0;mat.roughness=part==='tendon'?.4:.57;applyMuscleSurface(mat,part as Tissue);}
 applyComfortMask(mat,this.comfortUniform);
 const mesh=new THREE.Mesh(geometry,mat);geometry.boundingSphere=this.bodyBounds;mesh.userData={layer,part,vessel:layer==='cardiovascular'&&part!=='heart',genital:part==='pelvic',organSurface:part==='heart'||part==='lung',ranges:batch.ranges,opacityScale:part==='fascia'?.13:part==='pleura'?.18:1};mesh.renderOrder=part==='fascia'?6:layer==='muscular'?4:layer==='skeleton'?3:part==='pleura'?1:0;this.meshes.push(mesh);group.add(mesh);}
 this.groups.set(layer,group);this.root.add(group);this.setLayers(this.layers);gltf.scene.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();const mats=Array.isArray(o.material)?o.material:[o.material];mats.forEach(m=>m.dispose());}});onProgress(Math.round(++done/6*100));
 }
 }
 applyDeformation(mat:THREE.MeshStandardMaterial,part:string,rigid=false,cardiac=false,muscular=false,nervous=false){
 mat.onBeforeCompile=shader=>{
 Object.assign(shader.uniforms,this.uniforms,this.softBody.uniforms,nervous?this.nerveSkin!.uniforms:{},nervous&&this.nerveCache&&this.useNerveCache?this.nerveCache.uniforms:{},muscular?this.muscleVolume.uniforms:{},this.rig.uniforms);
 shader.vertexShader='uniform float uResp; uniform float uBeat;\n'+(cardiac&&part!=='artery'?'uniform float uCardiacCycles;\n':'')+(isRespiratoryPart(part)?'attribute vec3 lungInhale; uniform float uLungInflation;\n':part==='hepatic'||cardiac?'uniform float uLungInflation;\n':'')+rigShader+(muscular?muscleVolumeShader:'')+(rigid?'':tissueShader)+(part==='artery'?arterialShader:'')+(cardiac?cardiacShader+vesselClearanceShader:'')+(nervous?(this.nerveCache&&this.useNerveCache?cachedNerveShader(nerveSkinShader):nerveSkinShader):'')+shader.vertexShader;
 shader.vertexShader=shader.vertexShader.replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
 vec4 rigR;vec4 rigD;rigBlend(rigR,rigD);
 ${rigid?'':'vec3 tissueOffset;mat3 tissueJacobian;tissueField(position,tissueOffset,tissueJacobian);'}
 ${['skin','dermis','adipose'].includes(part)?'tissueOffset*=rigTorsoInfluence();tissueJacobian=mat3(1.0)+(tissueJacobian-mat3(1.0))*rigTorsoInfluence();':''}
 ${cardiac?'tissueOffset=mix(tissueOffset,vec3(0.0,-.002*uLungInflation,0.0),cardiacData.y);tissueJacobian=mat3(1.0)+(tissueJacobian-mat3(1.0))*(1.0-cardiacData.y);':''}
 ${rigid?'':'objectNormal=transpose(inverse(tissueJacobian))*objectNormal;'}
 ${cardiac?'objectNormal=cardiacNormal(position,objectNormal,uCardiacCycles);':''}
 objectNormal=rigRotate(rigR,objectNormal);
 #ifdef USE_TANGENT
 objectTangent=rigRotate(rigR,objectTangent);
 #endif
 `);
 shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
 ${rigid?'':'transformed+=tissueOffset;'}

 ${isRespiratoryPart(part)?'transformed=mix(position,lungInhale,uLungInflation);':''}
 ${part==='hepatic'?`transformed.y-=uLungInflation*${hepaticMotion.descent.toFixed(6)};`:''}
 ${cardiac?'if(cardiacData.y>.0001)transformed+=cardiacOffset(position,cardiacData,uCardiacCycles);':''}
 ${part==='artery'?'transformed += normal*pulseData.x*uDistension*uPulseGain*arterialWallPulse();':''}
 ${cardiac?'transformed=constrainVessel(transformed);':''}
 transformed=rigPosition(rigR,rigD,transformed);
 ${muscular?'transformed=muscleVolumePosition(transformed);':''}
 ${nervous?'transformed=nerveSkinPosition(transformed);':''}
 `);
 };mat.customProgramCacheKey=()=>`joint-dq-tissue-volume-v6-${part}-${rigid}-${cardiac}-${muscular}-${nervous}-${!!this.nerveCache&&this.useNerveCache}`;
 }

 setLayers(l:Layers){this.invalidate();this.layers=l;for(const m of this.meshes){const v=l[m.userData.layer as Layer];const layer=m.userData.layer as Layer;const cover=l.skin>=100?'skin':l.dermis>=100?'dermis':l.adipose>=100?'adipose':null;const exterior=['skin','dermis','adipose'];m.visible=v>0&&(!m.userData.vessel||this.bloodVesselsVisible)&&!(this.comfortMode&&m.userData.genital)&&(!cover||(exterior.includes(layer)&&exterior.indexOf(layer)<=exterior.indexOf(cover)));const mat=m.material as THREE.MeshStandardMaterial;mat.opacity=v/100*(m.userData.opacityScale??1);mat.depthWrite=mat.opacity>=(m.userData.organSurface?.5:.95);}}
 setBloodVesselsVisible(enabled:boolean){this.bloodVesselsVisible=enabled;this.setLayers(this.layers);}
 setComfortMode(enabled:boolean){this.comfortMode=enabled;this.comfortUniform.value=enabled?1:0;this.setLayers(this.layers);}
 setSkinInspection(enabled:boolean){this.invalidate();this.skinInspection=enabled;for(const marker of this.skinMarkers.values())marker.visible=enabled;}
 setSensors(selected:Site[]){this.invalidate();this.selectedSites=new Set(selected);for(const [key,m]of this.markers)m.visible=this.selectedSites.has(key);}
 setParameters(p:Parameters){this.invalidate();const previous=this.params.motion;this.params=p;if(previous!==p.motion){if(p.motion==='lie'){this.rig.bedAnchor.set(this.rig.bones[0].position.x,0,this.rig.bones[0].position.z-this.rig.bind[0].z);this.focus('bed');}else if(previous==='lie')this.focus('body');}for(const [key,m]of this.markers){m.scale.setScalar(key===p.site?1.4:.65);(m.material as THREE.MeshBasicMaterial).color.set(sensorColors[key]);}}
 focus(target:'body'|'chest'|'head'|'sensor'|'front'|'back'|'hands'|'bed'){this.followBed=target==='bed';if(target==='body'||target==='front'){this.controls.target.set(0,.91,0);this.camera.position.set(target==='front'?0:.7,1.04,3.7);}else if(target==='back'){this.controls.target.set(0,.91,0);this.camera.position.set(0,1.04,-3.7);}else if(target==='bed'){bedViewPoint(this.rig.bone('pelvis'),this.rig.bone('chest'),this.bedViewAnchor);this.controls.target.copy(this.bedViewAnchor);this.camera.position.copy(this.bedViewAnchor).add(new THREE.Vector3(1.5,1.17,3.5));}else if(target==='hands'){const p=this.rig.bone('hand.r').getWorldPosition(new THREE.Vector3()).add(this.rig.bone('hand.l').getWorldPosition(new THREE.Vector3())).multiplyScalar(.5);this.controls.target.copy(p);this.camera.position.copy(p).add(new THREE.Vector3(.15,.12,1.45));}else{const p=target==='sensor'?this.rig.transform(new THREE.Vector3(...sites[this.params.site].position)).toArray():target==='head'?[0,1.62,0]:[0,1.28,0];this.controls.target.set(p[0],p[1],p[2]);this.camera.position.set(p[0]+.12,p[1]+.02,p[2]+(target==='sensor'?.5:.85));}this.controls.update();}
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
   const point=new THREE.Vector3().fromBufferAttribute(original,i),w={indices:[indices.getX(i),indices.getY(i),indices.getZ(i),indices.getW(i)],weights:[weights.getX(i),weights.getY(i),weights.getZ(i),weights.getW(i)]};point.addScaledVector(this.softBody.sample(point),surfaceTissueWeight(w));
   const moved=this.skinRig.transform(point,w);position.setXYZ(i,moved.x,moved.y,moved.z);
  }
  geometry.computeBoundingSphere();geometry.computeBoundingBox();
  const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),mesh=new THREE.Mesh(geometry,material);mesh.matrixWorld.copy(source.matrixWorld);
  const hit=this.raycaster.intersectObject(mesh,false)[0];let result:[number,number,number]|null=null;
  if(hit?.face){const {a,b,c}=hit.face,local=mesh.worldToLocal(hit.point.clone()),bary=THREE.Triangle.getBarycoord(local,new THREE.Vector3().fromBufferAttribute(position,a),new THREE.Vector3().fromBufferAttribute(position,b),new THREE.Vector3().fromBufferAttribute(position,c),new THREE.Vector3());if(bary){const point=new THREE.Vector3().fromBufferAttribute(original,a).multiplyScalar(bary.x).addScaledVector(new THREE.Vector3().fromBufferAttribute(original,b),bary.y).addScaledVector(new THREE.Vector3().fromBufferAttribute(original,c),bary.z);result=point.toArray() as [number,number,number];}}
  geometry.dispose();material.dispose();return result&&this.comfortMode&&comfortRegion(...result)?null:result;
 }
 externalBudget=new RenderBudget();
 renderExternal(now=performance.now(),active=true){
  const budget=this.externalBudget.frame(now,this.qualityTier,this.qualityChoice,active&&this.ready,document.hidden);
  if(budget.lower){this.qualityTier='low';this.renderer.setPixelRatio(Math.min(devicePixelRatio,qualitySettings.low.dpr));this.resize();}
  if(!budget.draw)return;
  this.controls.update();
  if(now-this.lastLod>500){this.lastLod=now;this.updateLod()}
  if(this.nerveCache&&this.useNerveCache&&this.meshes.some(m=>m.visible&&m.userData.layer==='nervous'))this.nerveCache.update(this.renderer);
  this.renderer.render(this.scene,this.camera);this.dirty=false;
 }
 previousRunning=true;
 animate=(now:number)=>{if(this.disposed)return;this.frame=requestAnimationFrame(this.animate);
 if(document.hidden){this.last=0;this.lastRendered=0;return}
 if(this.running!==this.previousRunning){this.previousRunning=this.running;this.last=now;this.lastStats=now;this.frameCount=0;this.qualitySlow=0;this.invalidate()}
 if(now-this.lastRendered<1000/qualitySettings[this.qualityTier].fps-1)return;
 this.controls.autoRotate=this.rotate;const cameraChanged=this.controls.update();
 if(cameraChanged)this.invalidate();else this.idleFrames++;
 if(!this.running&&!this.rotate&&!this.dirty&&this.idleFrames>1){this.last=now;return}
 const delta=this.last?Math.min((now-this.last)/1000,.05):0;this.last=now;this.lastRendered=now;if(this.running)this.time+=delta;
 this.uniforms.uLungInflation.value=(1+Math.sin(this.time*Math.PI*2*this.params.rr/60))/2*Math.min(1,this.params.tidal/1000);
 this.uniforms.uResp.value=Math.sin(this.time*Math.PI*2*this.params.rr/60)*this.params.tidal/500;if(this.running&&!document.hidden)this.cardiacCycles+=delta*this.params.hr/60;
 this.uniforms.uCardiacCycles.value=this.cardiacCycles;this.uniforms.uHeartRate.value=this.params.hr;this.uniforms.uPWV.value=4+8*this.params.stiffness/100;this.uniforms.uDistension.value=distensionFraction(this.params.stiffness);this.uniforms.uBeat.value=systolicPulse(this.cardiacCycles);
 this.softBody.update(this.running&&!document.hidden?delta:0,(1+Math.sin(this.time*Math.PI*2*this.params.rr/60))/2,this.params.tidal);
 this.rig.update(this.running&&!document.hidden?delta:0,this.params.motion,this.params.motionRevision||0);
 if(this.layers.muscular>0)this.muscleVolume.update(this.params.motion,this.rig.taskTime,this.rig.transition);updateDeformedBounds(this.rig.bones,this.bodyBounds);
 this.chair.visible=this.params.motion==='stand'||this.params.motion==='sitStand';
 this.bedGroup.position.set(bedPlacement.x+this.rig.bedAnchor.x,0,bedPlacement.z+this.rig.bedAnchor.z);this.bedGroup.visible=this.params.motion==='lie';this.bedLoad.value=this.params.motion==='lie'?this.rig.bedLoad:0;
 if(this.followBed&&this.params.motion==='lie'){bedViewPoint(this.rig.bone('pelvis'),this.rig.bone('chest'),this.bedViewCurrent);followBedView(this.camera,this.controls.target,this.bedViewAnchor,this.bedViewCurrent);}
 this.controls.autoRotateSpeed=.5;
 for(const [key,m] of this.markers){
 if(!m.visible)continue;
 const point=new THREE.Vector3(...sites[key].position);
 point.addScaledVector(this.softBody.sample(point),this.layers.skin>0?surfaceTissueWeight(weightsAt(point.x,point.y,point.z)):1);
 m.position.copy((this.layers.skin>0||this.layers.dermis>0||this.layers.adipose>0?this.skinRig:this.rig).transform(point));
 const halo=m.getObjectByName('halo');if(halo)halo.quaternion.copy(this.camera.quaternion);
 }
 if(this.skinInspection)for(const [key,marker]of this.skinMarkers){const region=skinRegions.find(r=>r.id===key)!,point=new THREE.Vector3(...region.position);point.addScaledVector(this.softBody.sample(point),surfaceTissueWeight(weightsAt(point.x,point.y,point.z)));marker.position.copy(this.skinRig.transform(point));marker.scale.setScalar(1+.10*Math.sin(this.time*3));}
 if(this.nerveCache&&this.useNerveCache&&this.meshes.some(m=>m.userData.layer==='nervous'&&m.visible)&&(this.running||!this.nerveCache.ready||this.dirty))this.nerveCache.update(this.renderer);
 this.renderer.render(this.scene,this.camera);this.frameCount++;this.dirty=false;
 if(now-this.lastLod>500){this.lastLod=now;this.updateLod()}
 if(now-this.lastStats>1000){const fps=Math.round(this.frameCount*1000/(now-this.lastStats));
  if(this.ready&&this.running&&this.qualityChoice==='auto'){this.qualitySamples++;this.qualitySlow=fps<42?this.qualitySlow+1:0;if(this.qualitySamples>3&&this.qualitySlow>=3&&this.qualityTier!=='low'){this.qualityTier='low';this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,qualitySettings.low.dpr));this.resize();this.updateLod()}}
  this.onStats(fps,this.renderer.info.render.triangles);this.onTime(this.time);this.lastStats=now;this.frameCount=0;
 }
 };
 dispose(){this.disposed=true;this.abortLoad.abort();document.removeEventListener('visibilitychange',this.visibilityChanged);this.nerveCache?.dispose();for(const state of this.packedParts.values()){state.low.dispose();state.high?.dispose()}cancelAnimationFrame(this.frame);this.resizeObserver.disconnect();this.controls.dispose();this.draco.dispose();this.nerveSkin?.dispose();this.muscleVolume.dispose();this.rig.dispose();this.renderer.domElement.removeEventListener('pointerdown',this.pointerStart);this.renderer.domElement.removeEventListener('pointerup',this.pick);this.renderer.domElement.removeEventListener('webglcontextlost',this.contextLost);this.scene.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{for(const v of Object.values(m)){if(v instanceof THREE.Texture)v.dispose();}m.dispose();})}});this.renderer.dispose();this.renderer.domElement.remove();}
}
