import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {makeSectionTexture} from './skin-section-texture';
import {deformSection,tissueBoundary,sectionDeformationGLSL,type SectionProfile,type TissueDrive} from './skin-section-model';
import {photonPaths,opticalAbsorption} from './skin-section';

export type SectionView='full'|'top'|'dermis'|'vessel';
const layerColors=['#e6c3a7','#ba827d','#d59b9a','#b9767b','#c7a361','#856c73'];
export class SkinSectionScene{
 renderer:T.WebGLRenderer;scene=new T.Scene();camera=new T.OrthographicCamera();controls:OrbitControls;
 overlay=document.createElement('canvas');texture:T.CanvasTexture;geometries:T.BufferGeometry[]=[];materials:T.Material[]=[];
 view:SectionView='full';drive:TissueDrive={distension:0,respiratory:0,cardiac:0};gain=1;
 uniforms:{[key:string]:{value:number}};led:T.Mesh;detector:T.Mesh;lightLines:T.LineSegments;heads:T.Points;paths:ReturnType<typeof photonPaths>;
 private lastOptics='';private energy:{reflection:number;transmission:number}={reflection:0,transmission:0};
 constructor(public host:HTMLDivElement,public profile:SectionProfile){
  const p=profile;this.uniforms={uSectionDepth:{value:p.arteryDepth},uSectionRadius:{value:p.radius},uSectionExpansion:{value:0},uSectionLift:{value:0},uSectionContours:{value:0}};
  this.renderer=new T.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});this.renderer.setClearColor('#101b23');this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));this.renderer.outputColorSpace=T.SRGBColorSpace;this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=.95;this.renderer.setSize(host.clientWidth,host.clientHeight);
  this.renderer.domElement.setAttribute('aria-label','회전과 확대가 가능한 3D 피부 절단면');this.renderer.domElement.style.touchAction='none';host.appendChild(this.renderer.domElement);host.appendChild(this.overlay);this.overlay.className='section-label-overlay';
  this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;this.controls.dampingFactor=.12;this.controls.minZoom=.5;this.controls.maxZoom=5;this.controls.maxPolarAngle=Math.PI*.86;
  this.scene.add(new T.HemisphereLight(0xfff3e4,0x71616c,2.2));const light=new T.DirectionalLight(0xfff4eb,2.1);light.position.set(-6,10,18);this.scene.add(light);const rim=new T.DirectionalLight(0xa6cede,1.3);rim.position.set(12,-2,-9);this.scene.add(rim);
  const source=makeSectionTexture(p);this.texture=new T.CanvasTexture(source.canvas);this.texture.colorSpace=T.SRGBColorSpace;this.texture.anisotropy=Math.min(4,this.renderer.capabilities.getMaxAnisotropy());
  for(let layer=0;layer<6;layer++){
   const geometry=this.band(layer,source.height),cut=new T.MeshStandardMaterial({map:this.texture,roughness:.78}),surface=new T.MeshStandardMaterial({color:layerColors[layer],roughness:.72});
   this.deformMaterial(cut,true);this.deformMaterial(surface,true,layer===0);this.materials.push(cut,surface);this.scene.add(new T.Mesh(geometry,[cut,surface]));
  }
  // True extruded vessel lumen and concentric wall layers across the block.
  const wallRadii=[p.radius,p.radius+p.wall*.16,p.radius+p.wall*.77,p.radius+p.wall];
  for(let i=0;i<3;i++)this.vesselShell(p.arteryX,p.arteryDepth,wallRadii[i],wallRadii[i+1],['#e4b1a4','#b66b70','#ddc8b6'][i]);
  this.vesselShell(p.veinX,p.arteryDepth+.3,.46,.56,'#9aacb1',.65);
  const blood=this.cylinder(p.radius,p.arteryX,p.arteryDepth,'#6c162b');blood.material.roughness=.38;
  this.cylinder(.46,p.veinX,p.arteryDepth+.3,'#36596e',.65);
  this.regionalStructures();
  const pad=new T.BoxGeometry(.7,.17,.85);this.geometries.push(pad);const emitter=new T.MeshStandardMaterial({color:'#8fdbb1',emissive:'#284535',roughness:.35}),detector=new T.MeshStandardMaterial({color:'#86b6d6',roughness:.45});this.materials.push(emitter,detector);this.led=new T.Mesh(pad,emitter);this.detector=new T.Mesh(pad,detector);this.scene.add(this.led,this.detector);
  this.paths=photonPaths(p.total);const capacity=this.paths.reduce((n,path)=>n+(path.points.length-1)*6,0),geometry=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(new Float32Array(capacity),3)).setAttribute('color',new T.Float32BufferAttribute(new Float32Array(capacity),3)),material=new T.LineBasicMaterial({vertexColors:true,transparent:true,opacity:.34,depthTest:false});this.deformMaterial(material);this.materials.push(material);this.geometries.push(geometry);this.lightLines=new T.LineSegments(geometry,material);this.lightLines.renderOrder=9;this.scene.add(this.lightLines);
  const headGeometry=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(new Float32Array(this.paths.length*3),3)),headMaterial=new T.PointsMaterial({color:'#a5ffd1',size:2.6,sizeAttenuation:false,transparent:true,opacity:.9,depthTest:false});this.deformMaterial(headMaterial);this.materials.push(headMaterial);this.geometries.push(headGeometry);this.heads=new T.Points(headGeometry,headMaterial);this.heads.renderOrder=10;this.scene.add(this.heads);
  this.focus('full');
 }
 private deformMaterial(material:T.Material,cut=false,topography=false,structures=true){
  material.onBeforeCompile=shader=>{
   Object.assign(shader.uniforms,this.uniforms);
   shader.vertexShader=sectionDeformationGLSL(this.profile)+'\nvarying vec3 vSectionRest;varying vec3 vSectionWarped;\n'+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
    float e=.002;vec3 dx=(sectionWarp(position+vec3(e,0,0))-sectionWarp(position-vec3(e,0,0)))/(2.0*e),dy=(sectionWarp(position+vec3(0,e,0))-sectionWarp(position-vec3(0,e,0)))/(2.0*e);
    vec3 dz=(sectionWarp(position+vec3(0,0,e))-sectionWarp(position-vec3(0,0,e)))/(2.0*e);objectNormal=transpose(inverse(mat3(dx,dy,dz)))*objectNormal;`);
   shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvSectionRest=position;transformed=sectionWarp(position);vSectionWarped=transformed;');
   if(cut){const p=this.profile;shader.fragmentShader='varying vec3 vSectionRest;\n'+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
    if(length(vec2(vSectionRest.x-(${p.arteryX.toFixed(8)}),-vSectionRest.y-${p.arteryDepth.toFixed(8)}))<${(p.radius+p.wall).toFixed(8)})discard;
    if(length(vec2((vSectionRest.x-(${p.veinX.toFixed(8)}))/.56,(-vSectionRest.y-${(p.arteryDepth+.3).toFixed(8)})/.364))<1.0)discard;
    ${(structures?p.structures:[]).map(s=>`if(length((vec2(vSectionRest.x,-vSectionRest.y)-vec2(${s.x.toFixed(8)},${s.depth.toFixed(8)}))/vec2(${s.rx.toFixed(8)},${s.ry.toFixed(8)}))<1.0)discard;`).join('\n')}`);}
   if(topography){shader.fragmentShader='uniform float uSectionContours;varying vec3 vSectionWarped;\n'+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
    if(uSectionContours>.5&&abs(vSectionRest.y)<.06){
     float h=vSectionWarped.y;vec2 grid=abs(fract(vSectionRest.xz/2.0-.5)-.5)/max(fwidth(vSectionRest.xz/2.0),vec2(.0001));
     float gridLine=1.0-min(min(grid.x,grid.y),1.0);
     float contour=1.0-smoothstep(.6,1.3,abs(fract(h/.25-.5)-.5)/max(fwidth(h/.25),.0001));
     float major=1.0-smoothstep(.7,1.5,abs(fract(h-.5)-.5)/max(fwidth(h),.0001));
     vec3 tint=mix(vec3(.16,.40,.43),vec3(.93,.74,.36),smoothstep(-3.0,.35,h));
     diffuseColor.rgb=mix(diffuseColor.rgb,tint,.72);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.08,.22,.25),gridLine*.55);
     diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.91,.98,.82),max(contour*.74,major));
    }`);}
  };
  material.customProgramCacheKey=()=>`section-regional-v2-${cut}-${topography}-${structures}-${JSON.stringify(this.profile)}`;
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
  surface(192,rows,(u,v)=>{const x=-p.width/2+p.width*u;return[x,depth(x,v),0];},true,0);
  surface(192,rows,(u,v)=>{const x=-p.width/2+p.width*u;return[x,depth(x,v),-p.thickness];},false,0);
  for(const bottom of[false,true])surface(192,40,(u,v)=>{const x=-p.width/2+p.width*u;return[x,depth(x,bottom?1:0),-p.thickness+p.thickness*v];},!bottom,1);
  for(const right of[false,true])surface(40,rows,(u,v)=>{const x=right?p.width/2:-p.width/2;return[x,depth(x,v),-p.thickness+p.thickness*u];},!right,0);
  geometry.setAttribute('position',new T.Float32BufferAttribute(vertices,3));geometry.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();if(geometry.boundingSphere)geometry.boundingSphere.radius+=7;this.geometries.push(geometry);return geometry;
 }
 private vesselShell(x:number,depth:number,inner:number,outer:number,color:string,flatten=1){
  const material=new T.MeshStandardMaterial({color,roughness:.53,side:T.DoubleSide});this.deformMaterial(material);this.materials.push(material);
  for(const radius of[inner,outer]){const g=new T.CylinderGeometry(radius,radius,this.profile.thickness,72,32,true);g.rotateX(Math.PI/2);g.scale(1,flatten,1);g.translate(x,-depth,-this.profile.thickness/2);this.geometries.push(g);this.scene.add(new T.Mesh(g,material));}
  for(const z of[.018,-this.profile.thickness-.018]){const g=new T.RingGeometry(inner,outer,72,2);g.scale(1,flatten,1);g.translate(x,-depth,z);this.geometries.push(g);this.scene.add(new T.Mesh(g,material));}
 }
 private cylinder(radius:number,x:number,depth:number,color:string,flatten=1){
  const g=new T.CylinderGeometry(radius,radius,this.profile.thickness,72,32);g.rotateX(Math.PI/2);g.scale(1,flatten,1);g.translate(x,-depth,-this.profile.thickness/2);const material=new T.MeshStandardMaterial({color,roughness:.6});this.deformMaterial(material);this.geometries.push(g);this.materials.push(material);const mesh=new T.Mesh(g,material);this.scene.add(mesh);return mesh;
 }
 private regionalStructures(){
  const p=this.profile;
  for(const part of p.structures){
   const colors={bone:'#e4d6ad',tendon:'#e5decc',muscle:'#9f4653',fascia:'#d8ced0',nerve:'#dbce89'};
   const g=new T.CylinderGeometry(1,1,p.thickness,64,32);g.rotateX(Math.PI/2);g.scale(part.rx,part.ry,1);g.translate(part.x,-part.depth,-p.thickness/2);
   const material=new T.MeshStandardMaterial({color:colors[part.kind],roughness:part.kind==='bone'?.83:.66});this.deformMaterial(material,true,false,false);
   const previous=material.onBeforeCompile.bind(material),key=material.customProgramCacheKey();
   material.onBeforeCompile=(shader,renderer)=>{previous(shader,renderer);
    const x=part.x.toFixed(8),depth=part.depth.toFixed(8),rx=part.rx.toFixed(8),ry=part.ry.toFixed(8);
    const pattern=part.kind==='bone'?`float cortex=length(vec2((vSectionRest.x-(${x}))/${rx},(-vSectionRest.y-${depth})/${ry}));float lattice=abs(sin(vSectionRest.x*8.0+sin(vSectionRest.y*5.0))*sin(vSectionRest.y*8.5));diffuseColor.rgb=mix(mix(vec3(.45,.28,.20),vec3(.85,.75,.51),smoothstep(.12,.3,lattice)),diffuseColor.rgb,smoothstep(.76,.82,cortex));`:
     part.kind==='muscle'?`vec2 cell=fract(vec2(vSectionRest.x*2.7+sin(vSectionRest.y*3.0)*.14,vSectionRest.y*2.8))-.5;float septum=smoothstep(.36,.45,length(cell));float fibre=.88+.12*sin(vSectionRest.z*9.0+vSectionRest.x*16.0);diffuseColor.rgb=mix(diffuseColor.rgb*fibre,vec3(.79,.56,.53),septum*.65);`:
     `float fibre=.88+.12*sin(vSectionRest.x*34.0+sin(vSectionRest.z*1.3)*.5);diffuseColor.rgb*=fibre;`;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\n'+pattern);
   };material.customProgramCacheKey=()=>key+'-'+JSON.stringify(part);this.materials.push(material);this.geometries.push(g);this.scene.add(new T.Mesh(g,material));
  }
  if(p.regionId==='finger'){
   const material=new T.MeshStandardMaterial({color:'#e7d3b1',roughness:.83});this.deformMaterial(material);this.materials.push(material);
   for(const x of [-3,-1.5,1.5,3])for(const z of [.025,-p.thickness/2,-p.thickness-.025]){
    const path=new T.CatmullRomCurve3([new T.Vector3(x,-p.dermis,z),new T.Vector3(x*.85,-(p.dermis+p.fat*.6),z),new T.Vector3(x*.70,-(p.dermis+p.fat+1.3),z)]),g=new T.TubeGeometry(path,14,.04,5,false);this.geometries.push(g);this.scene.add(new T.Mesh(g,material));
   }
  }
 }
 focus(view:SectionView){
  this.view=view;this.uniforms.uSectionContours.value=view==='top'?1:0;const p=this.profile,targetY=view==='dermis'?-p.dermis*.53:view==='vessel'?-p.arteryDepth:-p.total*.48;
  const top=view==='top';this.camera.up.set(0,1,0);this.controls.target.set(view==='vessel'?p.arteryX:0,top?0:targetY,top?-p.thickness/2:-p.thickness*.22);
  this.camera.position.set(top?0:view==='full'?12:2,top?45:targetY+(view==='full'?13:3),top?-p.thickness/2+.001:32);this.camera.zoom=1;this.resize();this.controls.update();
 }
 resize(){const w=this.host.clientWidth,h=this.host.clientHeight;if(!w||!h)return;this.renderer.setSize(w,h,false);const p=this.profile,extent=this.view==='top'?Math.max(p.thickness+5,(p.width+5)*h/w):this.view==='dermis'?4.3:this.view==='vessel'?Math.max(8,p.radius*7):Math.max(p.total+10,(p.width+14)*h/w);this.camera.left=-extent*w/h/2;this.camera.right=extent*w/h/2;this.camera.top=extent/2;this.camera.bottom=-extent/2;this.camera.near=.01;this.camera.far=180;this.camera.updateProjectionMatrix();}
 update(state:TissueDrive,gain:number,time:number,wavelength:number,spo2:number,light:boolean,mode:string){
  this.drive=state;this.gain=gain;this.uniforms.uSectionExpansion.value=state.distension*gain;this.uniforms.uSectionLift.value=state.respiratory+state.cardiac;
  const p=this.profile,point=(x:number,d:number,z:number)=>new T.Vector3(...deformSection(x,d,z,p,state,gain));
  this.led.position.copy(point(-3,tissueBoundary(-3,0,p)-.17,-p.thickness/2));this.detector.position.copy(point(mode==='reflection'?3:-3,mode==='reflection'?tissueBoundary(3,0,p)-.17:p.total+.17,-p.thickness/2));this.led.visible=this.detector.visible=this.lightLines.visible=this.heads.visible=light;
  const optics=`${wavelength}-${spo2}-${state.distension.toFixed(3)}`;
  if(light&&optics!==this.lastOptics){this.lastOptics=optics;const positions:number[]=[],colors:number[]=[],color=new T.Color(wavelength===530?'#81edac':wavelength===660?'#ff8991':'#bca8fa');let reflected=0,transmitted=0;
   for(let k=0;k<this.paths.length;k++){const path=this.paths[k];let energy=1;for(let j=1;j<path.points.length;j++){const a=path.points[j-1],b=path.points[j],inBlood=Math.hypot(b[0]-p.arteryX,b[1]-p.arteryDepth)<p.radius+state.distension;energy*=Math.exp(-opticalAbsorption(b[1],inBlood,wavelength,spo2)*Math.hypot(b[0]-a[0],b[1]-a[1]));if(energy<.025)continue;positions.push(a[0],-a[1],-p.thickness/2+Math.sin(k+j*.17)*.9,b[0],-b[1],-p.thickness/2+Math.sin(k+(j+1)*.17)*.9);for(let v=0;v<2;v++)colors.push(color.r*energy,color.g*energy,color.b*energy);}
    if(path.exit==='reflection')reflected+=energy;if(path.exit==='transmission')transmitted+=energy;
   }
   const positionAttribute=this.lightLines.geometry.getAttribute('position'),colorAttribute=this.lightLines.geometry.getAttribute('color');(positionAttribute.array as Float32Array).set(positions);(colorAttribute.array as Float32Array).set(colors);positionAttribute.needsUpdate=true;colorAttribute.needsUpdate=true;this.lightLines.geometry.setDrawRange(0,positions.length/3);this.lightLines.frustumCulled=false;(this.heads.material as T.PointsMaterial).color.copy(color);this.energy={reflection:reflected/this.paths.length,transmission:transmitted/this.paths.length};
  }
  if(light){const position=this.heads.geometry.getAttribute('position');for(let k=0;k<this.paths.length;k++){const path=this.paths[k],j=Math.floor(((time*.45+k/this.paths.length)%1)*path.points.length),q=path.points[j];position.setXYZ(k,q[0],-q[1],-p.thickness/2+Math.sin(k+(j+1)*.17)*.9);}position.needsUpdate=true;this.heads.frustumCulled=false;}
  this.controls.update();this.renderer.render(this.scene,this.camera);this.labels();return this.energy;
 }
 private labels(){
  const c=this.overlay.getContext('2d')!,w=this.host.clientWidth,h=this.host.clientHeight,dpr=Math.min(devicePixelRatio,2);if(this.overlay.width!==Math.round(w*dpr)||this.overlay.height!==Math.round(h*dpr)){this.overlay.width=Math.round(w*dpr);this.overlay.height=Math.round(h*dpr);}c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);c.font='12px sans-serif';
  const project=(x:number,d:number,z=.06)=>{const q=new T.Vector3(...deformSection(x,d,z,this.profile,this.drive,this.gain)).project(this.camera);return [(q.x+1)*w/2,(1-q.y)*h/2];};
  const p=this.profile;const labels=this.view==='top'?[]:this.view==='vessel'?[[p.arteryLabel,p.arteryDepth,p.arteryX],['정맥',p.arteryDepth+.3,p.veinX],...p.structures.filter(s=>s.kind==='tendon'||s.kind==='bone').map(s=>[s.label,s.depth,s.x])]:this.view==='dermis'?[['표피 · 기저층',p.epidermis,3.4],['유두 진피',p.papillary,3.4],['망상 진피',p.dermis*.7,3.4]]:[['표피',p.epidermis,p.width/2-.2],['진피',p.dermis*.65,p.width/2-.2],['피하 지방',p.dermis+p.fat*.5,p.width/2-.2],...p.structures.map(s=>[s.label,s.depth,s.x])];
  let lastY=-30;for(const [text,depth,x] of labels){const a=project(Number(x),Number(depth)),y=Math.max(a[1],lastY+23);if(a[0]<20||a[0]>w-10||y<22||y>h-45)continue;lastY=y;const tx=Math.min(a[0]+15,w-174);c.strokeStyle='#c2cbbb88';c.beginPath();c.moveTo(a[0],a[1]);c.lineTo(tx,y);c.stroke();c.fillStyle='#101b23dd';c.fillRect(tx-3,y-13,172,19);c.fillStyle='#e0d9c9';c.fillText(String(text),tx,y);}
  if(this.led.visible)for(const [mesh,label] of [[this.led,'LED'],[this.detector,'PD']] as const){const q=mesh.position.clone().project(this.camera),x=(q.x+1)*w/2,y=(1-q.y)*h/2;c.fillStyle='#daede1';c.fillText(label,x-10,y-12);}
  if(this.view==='top'){c.fillStyle='#cce8d4';c.fillText('TOP · 2 mm 격자 / 0.25 mm 등고선 / 1 mm 굵은 선',18,25);c.fillStyle='#b9cfc8';c.fillText('높이 기준: 정지 상태의 패치 중앙 · 맥동 강조 배율 적용',18,45);}
  const a=project(-3,p.total+.7),b=project(0,p.total+.7),length=Math.hypot(b[0]-a[0],b[1]-a[1]);c.strokeStyle='#c5d9cf';c.lineWidth=2;c.beginPath();c.moveTo(22,h-25);c.lineTo(22+Math.min(length,w*.4),h-25);c.stroke();c.fillStyle='#b2c7c2';c.fillText(length<w*.4?'3 mm':'배율 확대',22,h-34);c.textAlign='right';c.fillText('드래그 회전 · 휠 확대 · 우클릭 이동',w-16,h-15);c.textAlign='left';
 }
 dispose(){this.controls.dispose();this.geometries.forEach(g=>g.dispose());this.materials.forEach(m=>m.dispose());this.texture.dispose();this.renderer.dispose();this.renderer.forceContextLoss();this.renderer.domElement.remove();this.overlay.remove();}
}
