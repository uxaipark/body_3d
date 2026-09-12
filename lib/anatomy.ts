import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {DRACOLoader} from 'three/addons/loaders/DRACOLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {sites, type Parameters, type Site} from './physiology';
export type Layer='skin'|'cardiovascular'|'visceral'|'nervous'|'skeleton'|'muscular';
export type Layers=Record<Layer,number>;
export const initialLayers:Layers={skin:100,cardiovascular:100,visceral:80,nervous:65,skeleton:13,muscular:9};
interface PickRange{end:number;name:string}
export class AnatomyScene{
 renderer:THREE.WebGLRenderer;scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(31,1,.01,30);controls:OrbitControls;
 groups=new Map<Layer,THREE.Group>(); meshes:THREE.Mesh[]=[]; markers=new Map<Site,THREE.Mesh>();
 root=new THREE.Group();draco=new DRACOLoader();params:Parameters;layers:Layers;time=0;running=true;rotate=false;disposed=false;
 frame=0;last=0;lastStats=0;frameCount=0;slowFrames=0;resizeObserver:ResizeObserver;raycaster=new THREE.Raycaster();pointerDown=[0,0];
 uniforms={uTime:{value:0},uMotion:{value:0},uResp:{value:0},uBeat:{value:0}};
 onStats:(fps:number,triangles:number)=>void;onPick:(name:string)=>void;onTime:(time:number)=>void;onSite:(site:Site)=>void;
 constructor(public container:HTMLDivElement,p:Parameters,l:Layers,callbacks:{stats:AnatomyScene['onStats'];pick:AnatomyScene['onPick'];time:AnatomyScene['onTime'];site:AnatomyScene['onSite']}){
 this.params=p;this.layers=l;this.onStats=callbacks.stats;this.onPick=callbacks.pick;this.onTime=callbacks.time;this.onSite=callbacks.site;
 this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
 this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.5));this.renderer.setClearColor(0x0c1013,0);this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.4;
 container.appendChild(this.renderer.domElement);this.camera.position.set(.7,1.04,3.7);this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.target.set(0,.91,0);this.controls.enableDamping=true;this.controls.dampingFactor=.075;this.controls.minDistance=.22;this.controls.maxDistance=6;this.controls.maxPolarAngle=Math.PI*.95;
 this.scene.add(this.root);this.scene.add(new THREE.HemisphereLight(0xcce6f4,0x423b32,2));
 for(const [pos,color,intensity] of [[[2,3,3],0xffffff,3],[[-2,1,1],0x76bdce,2],[[0,2,-2],0xb4e5d0,3]] as const){const light=new THREE.DirectionalLight(color,intensity);light.position.set(pos[0],pos[1],pos[2]);this.scene.add(light);}
 const grid=new THREE.GridHelper(8,80,0x354743,0x202a2e);grid.position.y=-.015;(grid.material as THREE.Material).transparent=true;(grid.material as THREE.Material).opacity=.5;this.scene.add(grid);
 const ring=new THREE.Mesh(new THREE.RingGeometry(.38,.383,96),new THREE.MeshBasicMaterial({color:0x92cbbb,side:THREE.DoubleSide,transparent:true,opacity:.32}));ring.rotation.x=-Math.PI/2;ring.position.y=-.01;this.scene.add(ring);
 for(const [key,site]of Object.entries(sites)){const marker=new THREE.Mesh(new THREE.SphereGeometry(.012,16,12),new THREE.MeshBasicMaterial({color:0xa4e4d0,transparent:true,opacity:.75,depthTest:false}));marker.position.set(...site.position);marker.renderOrder=10;marker.userData.site=key;this.markers.set(key as Site,marker);this.root.add(marker);const halo=new THREE.Mesh(new THREE.TorusGeometry(.021,.0015,6,32),new THREE.MeshBasicMaterial({color:0xa4e4d0,transparent:true,opacity:.6,depthTest:false}));halo.name='halo';marker.add(halo);}
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
 const gltf=await loader.loadAsync(`/models/${layer}-web.glb`);if(this.disposed){gltf.scene.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.dispose()});return;}
 gltf.scene.updateMatrixWorld(true);
 if(layer==='skin'){
 const group=new THREE.Group();
 gltf.scene.traverse(obj=>{if(!(obj instanceof THREE.Mesh))return;
 const geometry=obj.geometry.clone().applyMatrix4(obj.matrixWorld);
 const source=Array.isArray(obj.material)?obj.material[0]:obj.material;
 const mat=source.clone() as THREE.MeshStandardMaterial;
 mat.transparent=true;mat.opacity=this.layers.skin/100;mat.depthWrite=this.layers.skin>=95;
 mat.metalness=0;mat.side=THREE.FrontSide;mat.roughness=/eye|high.poly/i.test(obj.name)?.3:.62;
 if(mat.map)mat.map.anisotropy=Math.min(4,this.renderer.capabilities.getMaxAnisotropy());
 // Alpha-tested hair cards keep their strand silhouettes even when the skin layer fades.
 if(/short|eyebrow/i.test(obj.name)){mat.alphaTest=.3;mat.side=THREE.DoubleSide;}
 this.applyDeformation(mat,'skin');
 const mesh=new THREE.Mesh(geometry,mat);mesh.renderOrder=8;mesh.userData={layer:'skin',ranges:[{end:Infinity,name:/short/i.test(obj.name)?'헤어':/eyebrow/i.test(obj.name)?'눈썹':/high.poly/i.test(obj.name)?'눈':'피부 · 성인 남성 외피'}]};group.add(mesh);this.meshes.push(mesh);
 obj.geometry.dispose();source.dispose();
 });
 this.groups.set('skin',group);this.root.add(group);this.setLayers(this.layers);onProgress(Math.round(++done/6*100));continue;
 }

 const batches=new Map<string,{geometries:THREE.BufferGeometry[];ranges:PickRange[];count:number}>();
 gltf.scene.traverse(obj=>{if(!(obj instanceof THREE.Mesh))return;
 const name=obj.name.replace(/_/g,' ');if(/systemg\d|organsg\d/i.test(name))return;
 const source=Array.isArray(obj.material)?obj.material[0]:obj.material;
 const color=source.color?.clone()||new THREE.Color(0xddb2a4);
 const part=layer==='visceral'&&/lung|bronch/i.test(name)?'lung':layer==='cardiovascular'&&/atrium|ventricle|myocard|epicard/i.test(name)?'heart':'body';
 const key=part;let batch=batches.get(key);if(!batch){batch={geometries:[],ranges:[],count:0};batches.set(key,batch);}
 const geometry=obj.geometry.clone().applyMatrix4(obj.matrixWorld);
 for(const key of Object.keys(geometry.attributes))if(key!=='position'&&key!=='normal')geometry.deleteAttribute(key);
 if(!geometry.getAttribute('normal'))geometry.computeVertexNormals();
 const count=geometry.getAttribute('position').count;const colors=new Float32Array(count*3);
 if(layer==='cardiovascular'){if(color.b>color.r)color.set('#4988c9');else color.set('#d55559');}
 if(layer==='nervous')color.set('#d2b278');
 if(layer==='muscular')color.set('#bf8b80');
 for(let i=0;i<count;i++)color.toArray(colors,i*3);geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
 batch.count+=(geometry.index?.count||count)/3;batch.ranges.push({end:batch.count,name:name.replace(/\d{3}$/,'').replace(/([a-z])([lr])$/,'$1 ($2)')});batch.geometries.push(geometry);
 });
 const group=new THREE.Group();
 for(const [part,batch]of batches){const geometry=mergeGeometries(batch.geometries);batch.geometries.forEach(g=>g.dispose());if(!geometry)continue;
 const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.52,metalness:.07,transparent:true,opacity:this.layers[layer]/100,depthWrite:this.layers[layer]>=95,side:THREE.FrontSide});
 this.applyDeformation(mat,part);
 const mesh=new THREE.Mesh(geometry,mat);mesh.userData={layer,ranges:batch.ranges};mesh.renderOrder=layer==='muscular'?4:layer==='skeleton'?3:0;this.meshes.push(mesh);group.add(mesh);}
 this.groups.set(layer,group);this.root.add(group);this.setLayers(this.layers);gltf.scene.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();const mats=Array.isArray(o.material)?o.material:[o.material];mats.forEach(m=>m.dispose());}});onProgress(Math.round(++done/6*100));
 }
 }
 applyDeformation(mat:THREE.MeshStandardMaterial,part:string){
 mat.onBeforeCompile=shader=>{Object.assign(shader.uniforms,this.uniforms);shader.vertexShader='uniform float uTime; uniform float uMotion; uniform float uResp; uniform float uBeat;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
 float side=sign(transformed.x); float gait=sin(uTime*${'6.28318'}*mix(1.6,2.6,step(0.7,uMotion))+side*1.5708)*uMotion;
 float leg=1.0-smoothstep(0.75,0.98,transformed.y); float arm=smoothstep(0.17,0.25,abs(transformed.x))*(1.0-smoothstep(1.35,1.48,transformed.y));
 transformed.z+=gait*(leg*(0.95-transformed.y)*0.28-arm*(1.45-transformed.y)*0.3);
 transformed.y+=abs(gait)*leg*0.014;
 ${part==='lung'?'transformed.x*=1.0+uResp*0.028; transformed.z+=uResp*0.012;':''}
 ${part==='skin'?'float chest = smoothstep(1.05,1.2,transformed.y)*(1.0-smoothstep(1.38,1.48,transformed.y))*(1.0-smoothstep(0.13,0.19,abs(transformed.x))); transformed.z += chest*uResp*0.005;':''}
 ${part==='heart'?'transformed += (transformed-vec3(0.035,1.28,0.035))*uBeat*0.035;':''}
 `);};mat.customProgramCacheKey=()=>part;
 }
 setLayers(l:Layers){this.layers=l;for(const m of this.meshes){const v=l[m.userData.layer as Layer];m.visible=v>0&&(m.userData.layer==='skin'||l.skin<100);const mat=m.material as THREE.MeshStandardMaterial;mat.opacity=v/100;mat.depthWrite=v>=95;}}
 setParameters(p:Parameters){this.params=p;for(const [key,m]of this.markers){m.scale.setScalar(key===p.site?1.4:.65);(m.material as THREE.MeshBasicMaterial).color.set(key===p.site?0xc2ffe4:0x649b8c);}}
 focus(target:'body'|'chest'|'head'|'sensor'|'front'|'back'){if(target==='body'||target==='front'){this.controls.target.set(0,.91,0);this.camera.position.set(target==='front'?0:.7,1.04,3.7);}else if(target==='back'){this.controls.target.set(0,.91,0);this.camera.position.set(0,1.04,-3.7);}else{const p=target==='sensor'?sites[this.params.site].position:target==='head'?[0,1.62,0]:[0,1.28,0];this.controls.target.set(p[0],p[1],p[2]);this.camera.position.set(p[0]+.12,p[1]+.02,p[2]+(target==='sensor'?.5:.85));}this.controls.update();}
 zoom(factor:number){this.camera.position.sub(this.controls.target).multiplyScalar(factor).add(this.controls.target);this.controls.update();}
 pointerStart=(e:PointerEvent)=>{this.pointerDown=[e.clientX,e.clientY]};
 pick=(e:PointerEvent)=>{if(Math.hypot(e.clientX-this.pointerDown[0],e.clientY-this.pointerDown[1])>5)return;const r=this.renderer.domElement.getBoundingClientRect();this.raycaster.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),this.camera);
 const marker=this.raycaster.intersectObjects([...this.markers.values()],false)[0];if(marker){this.onSite(marker.object.userData.site);return;}
 if(this.params.motion!=='rest'){this.onPick('해부학 구조 선택은 정지 자세에서 가능합니다.');return;}
 const hit=this.raycaster.intersectObjects(this.meshes.filter(m=>m.visible&&this.layers[m.userData.layer as Layer]>20),false)[0];if(hit){const ranges=hit.object.userData.ranges as PickRange[];this.onPick(ranges.find(r=>(hit.faceIndex||0)<r.end)?.name||'Anatomical structure');}
 };
 animate=(now:number)=>{if(this.disposed)return;const delta=this.last?Math.min((now-this.last)/1000,.05):0;this.last=now;if(this.running&&!document.hidden)this.time+=delta;
 this.uniforms.uTime.value=this.time;this.uniforms.uMotion.value=this.params.motion==='rest'?0:this.params.motion==='walk'?.48:.9;this.uniforms.uResp.value=Math.sin(this.time*Math.PI*2*this.params.rr/60)*this.params.tidal/500;this.uniforms.uBeat.value=Math.max(0,Math.sin(this.time*Math.PI*2*this.params.hr/60));
 this.controls.autoRotate=this.rotate;this.controls.autoRotateSpeed=.5;this.controls.update();for(const [key,m] of this.markers){const p=sites[key].position;const motion=this.uniforms.uMotion.value;const side=Math.sign(p[0]);const gait=Math.sin(this.time*6.28318*(motion>=.7?2.6:1.6)+side*1.5708)*motion;const smooth=(a:number,b:number,x:number)=>{const v=THREE.MathUtils.clamp((x-a)/(b-a),0,1);return v*v*(3-2*v)};const leg=1-smooth(.75,.98,p[1]);const arm=smooth(.17,.25,Math.abs(p[0]))*(1-smooth(1.35,1.48,p[1]));m.position.set(p[0],p[1]+Math.abs(gait)*leg*.014,p[2]+gait*(leg*(.95-p[1])*.28-arm*(1.45-p[1])*.3));const halo=m.getObjectByName('halo');if(halo)halo.quaternion.copy(this.camera.quaternion);}
 if(!document.hidden){this.renderer.render(this.scene,this.camera);this.frameCount++;}if(now-this.lastStats>1000){const fps=Math.round(this.frameCount*1000/(now-this.lastStats));this.slowFrames=fps<38?this.slowFrames+1:0;if(this.slowFrames>=3&&this.renderer.getPixelRatio()>1){this.renderer.setPixelRatio(1);this.resize();this.slowFrames=0;}this.onStats(fps,this.renderer.info.render.triangles);this.onTime(this.time);this.lastStats=now;this.frameCount=0;}
 this.frame=requestAnimationFrame(this.animate);
 };
 dispose(){this.disposed=true;cancelAnimationFrame(this.frame);this.resizeObserver.disconnect();this.controls.dispose();this.draco.dispose();this.renderer.domElement.removeEventListener('pointerdown',this.pointerStart);this.renderer.domElement.removeEventListener('pointerup',this.pick);this.renderer.domElement.removeEventListener('webglcontextlost',this.contextLost);this.scene.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{for(const v of Object.values(m)){if(v instanceof THREE.Texture)v.dispose();}m.dispose();})}});this.renderer.dispose();this.renderer.domElement.remove();}
}
