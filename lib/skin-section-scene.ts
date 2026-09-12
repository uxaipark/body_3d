import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {makeSectionTexture} from './skin-section-texture';
import {deformSection,tissueBoundary,sectionDeformationGLSL,type SectionProfile,type TissueDrive} from './skin-section-model';
import {photonPaths,opticalAbsorption} from './skin-section';

export type SectionView='full'|'dermis'|'vessel';
const layerColors=['#e6c3a7','#ba827d','#d59b9a','#b9767b','#c7a361','#856c73'];
export class SkinSectionScene{
 renderer:T.WebGLRenderer;scene=new T.Scene();camera=new T.OrthographicCamera();controls:OrbitControls;
 overlay=document.createElement('canvas');texture:T.CanvasTexture;geometries:T.BufferGeometry[]=[];materials:T.Material[]=[];
 view:SectionView='full';drive:TissueDrive={distension:0,respiratory:0,cardiac:0};gain=1;
 uniforms:{[key:string]:{value:number}};led:T.Mesh;detector:T.Mesh;lightLines:T.LineSegments;heads:T.Points;paths:ReturnType<typeof photonPaths>;
 private lastOptics='';private energy:{reflection:number;transmission:number}={reflection:0,transmission:0};
 constructor(public host:HTMLDivElement,public profile:SectionProfile){
  const p=profile;this.uniforms={uSectionDepth:{value:p.arteryDepth},uSectionRadius:{value:p.radius},uSectionExpansion:{value:0},uSectionLift:{value:0}};
  this.renderer=new T.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});this.renderer.setClearColor('#101b23');this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));this.renderer.outputColorSpace=T.SRGBColorSpace;this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=.95;this.renderer.setSize(host.clientWidth,host.clientHeight);
  this.renderer.domElement.setAttribute('aria-label','회전과 확대가 가능한 3D 피부 절단면');this.renderer.domElement.style.touchAction='none';host.appendChild(this.renderer.domElement);host.appendChild(this.overlay);this.overlay.className='section-label-overlay';
  this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;this.controls.dampingFactor=.12;this.controls.minZoom=.5;this.controls.maxZoom=5;this.controls.maxPolarAngle=Math.PI*.86;
  this.scene.add(new T.HemisphereLight(0xfff3e4,0x71616c,2.2));const light=new T.DirectionalLight(0xfff4eb,2.1);light.position.set(-6,10,18);this.scene.add(light);const rim=new T.DirectionalLight(0xa6cede,1.3);rim.position.set(12,-2,-9);this.scene.add(rim);
  const source=makeSectionTexture(p);this.texture=new T.CanvasTexture(source.canvas);this.texture.colorSpace=T.SRGBColorSpace;this.texture.anisotropy=Math.min(4,this.renderer.capabilities.getMaxAnisotropy());
  for(let layer=0;layer<6;layer++){
   const geometry=this.band(layer,source.height),cut=new T.MeshStandardMaterial({map:this.texture,roughness:.78}),surface=new T.MeshStandardMaterial({color:layerColors[layer],roughness:.72});
   this.deformMaterial(cut,true);this.deformMaterial(surface,true);this.materials.push(cut,surface);this.scene.add(new T.Mesh(geometry,[cut,surface]));
  }
  // True extruded vessel lumen and concentric wall layers across the block.
  const wallRadii=[p.radius,p.radius+p.wall*.16,p.radius+p.wall*.77,p.radius+p.wall];
  for(let i=0;i<3;i++)this.vesselShell(0,p.arteryDepth,wallRadii[i],wallRadii[i+1],['#e4b1a4','#b66b70','#ddc8b6'][i]);
  this.vesselShell(3.2,p.arteryDepth+.3,.46,.56,'#9aacb1',.65);
  const blood=this.cylinder(p.radius,0,p.arteryDepth,'#6c162b');blood.material.roughness=.38;
  this.cylinder(.46,3.2,p.arteryDepth+.3,'#36596e',.65);
  const pad=new T.BoxGeometry(.7,.17,.85);this.geometries.push(pad);const emitter=new T.MeshStandardMaterial({color:'#8fdbb1',emissive:'#284535',roughness:.35}),detector=new T.MeshStandardMaterial({color:'#86b6d6',roughness:.45});this.materials.push(emitter,detector);this.led=new T.Mesh(pad,emitter);this.detector=new T.Mesh(pad,detector);this.scene.add(this.led,this.detector);
  this.paths=photonPaths(p.total);const capacity=this.paths.reduce((n,path)=>n+(path.points.length-1)*6,0),geometry=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(new Float32Array(capacity),3)).setAttribute('color',new T.Float32BufferAttribute(new Float32Array(capacity),3)),material=new T.LineBasicMaterial({vertexColors:true,transparent:true,opacity:.34,depthTest:false});this.deformMaterial(material);this.materials.push(material);this.geometries.push(geometry);this.lightLines=new T.LineSegments(geometry,material);this.lightLines.renderOrder=9;this.scene.add(this.lightLines);
  const headGeometry=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(new Float32Array(this.paths.length*3),3)),headMaterial=new T.PointsMaterial({color:'#a5ffd1',size:2.6,sizeAttenuation:false,transparent:true,opacity:.9,depthTest:false});this.deformMaterial(headMaterial);this.materials.push(headMaterial);this.geometries.push(headGeometry);this.heads=new T.Points(headGeometry,headMaterial);this.heads.renderOrder=10;this.scene.add(this.heads);
  this.focus('full');
 }
 private deformMaterial(material:T.Material,cut=false){
  material.onBeforeCompile=shader=>{
   Object.assign(shader.uniforms,this.uniforms);
   shader.vertexShader=sectionDeformationGLSL+'\nvarying vec3 vSectionRest;\n'+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
    float e=.002;vec3 dx=(sectionWarp(position+vec3(e,0,0))-sectionWarp(position-vec3(e,0,0)))/(2.0*e),dy=(sectionWarp(position+vec3(0,e,0))-sectionWarp(position-vec3(0,e,0)))/(2.0*e);
    objectNormal=transpose(inverse(mat3(dx,dy,vec3(0,0,1))))*objectNormal;`);
   shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvSectionRest=position;transformed=sectionWarp(position);');
   if(cut){const p=this.profile;shader.fragmentShader='varying vec3 vSectionRest;\n'+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
    if(length(vec2(vSectionRest.x,-vSectionRest.y-${p.arteryDepth.toFixed(8)}))<${(p.radius+p.wall).toFixed(8)})discard;
    if(length(vec2((vSectionRest.x-3.2)/.56,(-vSectionRest.y-${(p.arteryDepth+.3).toFixed(8)})/.364))<1.0)discard;`);}
  };
  material.customProgramCacheKey=()=>`section-continuum-v1-${cut}-${this.profile.arteryDepth}-${this.profile.radius}`;
 }
 private band(layer:number,textureHeight:number){
  const p=this.profile,vertices:number[]=[],uv:number[]=[],indices:number[]=[],geometry=new T.BufferGeometry();
  const surface=(nx:number,ny:number,point:(u:number,v:number)=>[number,number,number],reverse:boolean,material:number)=>{
   const start=vertices.length/3,indexStart=indices.length;
   for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){const q=point(i/nx,j/ny);vertices.push(q[0],-q[1],q[2]);uv.push((q[0]+12)/24,1-(q[1]+.08)/textureHeight);}
   for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const a=start+j*(nx+1)+i,b=a+1,c=a+nx+1,d=c+1;indices.push(...(reverse?[a,c,b,b,c,d]:[a,b,c,b,d,c]));}
   geometry.addGroup(indexStart,indices.length-indexStart,material);
  };
  const depth=(x:number,v:number)=>{const a=tissueBoundary(x,layer,p),b=tissueBoundary(x,layer+1,p);return a+(b-a)*v;};
  const rows=layer===4?Math.max(8,Math.ceil(p.fat*5)):layer===3?10:3;
  surface(192,rows,(u,v)=>{const x=-12+24*u;return[x,depth(x,v),0];},true,0);
  surface(192,rows,(u,v)=>{const x=-12+24*u;return[x,depth(x,v),-p.thickness];},false,0);
  for(const bottom of[false,true])surface(192,8,(u,v)=>{const x=-12+24*u;return[x,depth(x,bottom?1:0),-p.thickness+p.thickness*v];},!bottom,1);
  for(const right of[false,true])surface(10,rows,(u,v)=>{const x=right?12:-12;return[x,depth(x,v),-p.thickness+p.thickness*u];},!right,0);
  geometry.setAttribute('position',new T.Float32BufferAttribute(vertices,3));geometry.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();if(geometry.boundingSphere)geometry.boundingSphere.radius+=7;this.geometries.push(geometry);return geometry;
 }
 private vesselShell(x:number,depth:number,inner:number,outer:number,color:string,flatten=1){
  const material=new T.MeshStandardMaterial({color,roughness:.53,side:T.DoubleSide});this.deformMaterial(material);this.materials.push(material);
  for(const radius of[inner,outer]){const g=new T.CylinderGeometry(radius,radius,this.profile.thickness,72,12,true);g.rotateX(Math.PI/2);g.scale(1,flatten,1);g.translate(x,-depth,-this.profile.thickness/2);this.geometries.push(g);this.scene.add(new T.Mesh(g,material));}
  for(const z of[.018,-this.profile.thickness-.018]){const g=new T.RingGeometry(inner,outer,72,2);g.scale(1,flatten,1);g.translate(x,-depth,z);this.geometries.push(g);this.scene.add(new T.Mesh(g,material));}
 }
 private cylinder(radius:number,x:number,depth:number,color:string,flatten=1){
  const g=new T.CylinderGeometry(radius,radius,this.profile.thickness,72,12);g.rotateX(Math.PI/2);g.scale(1,flatten,1);g.translate(x,-depth,-this.profile.thickness/2);const material=new T.MeshStandardMaterial({color,roughness:.6});this.deformMaterial(material);this.geometries.push(g);this.materials.push(material);const mesh=new T.Mesh(g,material);this.scene.add(mesh);return mesh;
 }
 focus(view:SectionView){
  this.view=view;const p=this.profile,targetY=view==='dermis'?-p.dermis*.53:view==='vessel'?-p.arteryDepth:-p.total*.48;
  this.controls.target.set(0,targetY,-.7);this.camera.position.set(view==='full'?9:2,targetY+(view==='full'?7:2),32);this.camera.zoom=1;this.resize();this.controls.update();
 }
 resize(){const w=this.host.clientWidth,h=this.host.clientHeight;if(!w||!h)return;this.renderer.setSize(w,h,false);const extent=this.view==='dermis'?4.3:this.view==='vessel'?Math.max(3.5,this.profile.radius*5):Math.max(this.profile.total+7,31*h/w);this.camera.left=-extent*w/h/2;this.camera.right=extent*w/h/2;this.camera.top=extent/2;this.camera.bottom=-extent/2;this.camera.near=.01;this.camera.far=150;this.camera.updateProjectionMatrix();}
 update(state:TissueDrive,gain:number,time:number,wavelength:number,spo2:number,light:boolean,mode:string){
  this.drive=state;this.gain=gain;this.uniforms.uSectionExpansion.value=state.distension*gain;this.uniforms.uSectionLift.value=state.respiratory+state.cardiac;
  const p=this.profile,point=(x:number,d:number,z:number)=>new T.Vector3(...deformSection(x,d,z,p,state,gain));
  this.led.position.copy(point(-3,tissueBoundary(-3,0,p)-.17,-2.5));this.detector.position.copy(point(mode==='reflection'?3:-3,mode==='reflection'?tissueBoundary(3,0,p)-.17:p.total+.17,-2.5));this.led.visible=this.detector.visible=this.lightLines.visible=this.heads.visible=light;
  const optics=`${wavelength}-${spo2}-${state.distension.toFixed(3)}`;
  if(light&&optics!==this.lastOptics){this.lastOptics=optics;const positions:number[]=[],colors:number[]=[],color=new T.Color(wavelength===530?'#81edac':wavelength===660?'#ff8991':'#bca8fa');let reflected=0,transmitted=0;
   for(let k=0;k<this.paths.length;k++){const path=this.paths[k];let energy=1;for(let j=1;j<path.points.length;j++){const a=path.points[j-1],b=path.points[j],inBlood=Math.hypot(b[0],b[1]-p.arteryDepth)<p.radius+state.distension;energy*=Math.exp(-opticalAbsorption(b[1],inBlood,wavelength,spo2)*Math.hypot(b[0]-a[0],b[1]-a[1]));if(energy<.025)continue;positions.push(a[0],-a[1],-2.5+Math.sin(k+j*.17)*.9,b[0],-b[1],-2.5+Math.sin(k+(j+1)*.17)*.9);for(let v=0;v<2;v++)colors.push(color.r*energy,color.g*energy,color.b*energy);}
    if(path.exit==='reflection')reflected+=energy;if(path.exit==='transmission')transmitted+=energy;
   }
   const positionAttribute=this.lightLines.geometry.getAttribute('position'),colorAttribute=this.lightLines.geometry.getAttribute('color');(positionAttribute.array as Float32Array).set(positions);(colorAttribute.array as Float32Array).set(colors);positionAttribute.needsUpdate=true;colorAttribute.needsUpdate=true;this.lightLines.geometry.setDrawRange(0,positions.length/3);this.lightLines.frustumCulled=false;(this.heads.material as T.PointsMaterial).color.copy(color);this.energy={reflection:reflected/this.paths.length,transmission:transmitted/this.paths.length};
  }
  if(light){const position=this.heads.geometry.getAttribute('position');for(let k=0;k<this.paths.length;k++){const path=this.paths[k],j=Math.floor(((time*.45+k/this.paths.length)%1)*path.points.length),q=path.points[j];position.setXYZ(k,q[0],-q[1],-2.5+Math.sin(k+(j+1)*.17)*.9);}position.needsUpdate=true;this.heads.frustumCulled=false;}
  this.controls.update();this.renderer.render(this.scene,this.camera);this.labels();return this.energy;
 }
 private labels(){
  const c=this.overlay.getContext('2d')!,w=this.host.clientWidth,h=this.host.clientHeight,dpr=Math.min(devicePixelRatio,2);if(this.overlay.width!==Math.round(w*dpr)||this.overlay.height!==Math.round(h*dpr)){this.overlay.width=Math.round(w*dpr);this.overlay.height=Math.round(h*dpr);}c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);c.font='12px sans-serif';
  const project=(x:number,d:number,z=.06)=>{const q=new T.Vector3(...deformSection(x,d,z,this.profile,this.drive,this.gain)).project(this.camera);return [(q.x+1)*w/2,(1-q.y)*h/2];};
  const p=this.profile;const labels=this.view==='vessel'?[['동맥 · 3층 혈관벽',p.arteryDepth,0],['정맥',p.arteryDepth+.3,3.2]]:this.view==='dermis'?[['표피 · 기저층',p.epidermis,3.4],['유두 진피',p.papillary,3.4],['망상 진피',p.dermis*.7,3.4]]:[['표피',p.epidermis,11.8],['진피',p.dermis*.65,11.8],['피하 지방 소엽',p.dermis+p.fat*.5,11.8],['심부 근막',p.total-.4,11.8]];
  let lastY=-30;for(const [text,depth,x] of labels){const a=project(Number(x),Number(depth)),y=Math.max(a[1],lastY+23);if(a[0]<20||a[0]>w-10||y<22||y>h-45)continue;lastY=y;const tx=Math.min(a[0]+15,w-116);c.strokeStyle='#c2cbbb88';c.beginPath();c.moveTo(a[0],a[1]);c.lineTo(tx,y);c.stroke();c.fillStyle='#101b23dd';c.fillRect(tx-3,y-13,114,19);c.fillStyle='#e0d9c9';c.fillText(String(text),tx,y);}
  if(this.led.visible)for(const [mesh,label] of [[this.led,'LED'],[this.detector,'PD']] as const){const q=mesh.position.clone().project(this.camera),x=(q.x+1)*w/2,y=(1-q.y)*h/2;c.fillStyle='#daede1';c.fillText(label,x-10,y-12);}
  const a=project(-3,p.total+.7),b=project(0,p.total+.7),length=Math.hypot(b[0]-a[0],b[1]-a[1]);c.strokeStyle='#c5d9cf';c.lineWidth=2;c.beginPath();c.moveTo(22,h-25);c.lineTo(22+Math.min(length,w*.4),h-25);c.stroke();c.fillStyle='#b2c7c2';c.fillText(length<w*.4?'3 mm':'배율 확대',22,h-34);c.textAlign='right';c.fillText('드래그 회전 · 휠 확대 · 우클릭 이동',w-16,h-15);c.textAlign='left';
 }
 dispose(){this.controls.dispose();this.geometries.forEach(g=>g.dispose());this.materials.forEach(m=>m.dispose());this.texture.dispose();this.renderer.dispose();this.renderer.forceContextLoss();this.renderer.domElement.remove();this.overlay.remove();}
}
