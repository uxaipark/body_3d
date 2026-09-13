/** Compile the actual Three material hooks offline; no browser or WebGL screenshot. */
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';import {createServer} from 'vite';import * as T from 'three';
const server=await createServer({configFile:false,root:process.cwd(),server:{middlewareMode:true},appType:'custom'}),dir=fs.mkdtempSync(path.join(os.tmpdir(),'soma-section-glsl-'));
try{
 const {SkinSectionScene}=await server.ssrLoadModule('/lib/skin-section-scene.ts'),{sectionProfile}=await server.ssrLoadModule('/lib/skin-section-model.ts'),{skinRegions}=await server.ssrLoadModule('/lib/skin-section.ts');
 const include=source=>source.replace(/#include <([\w_]+)>/g,(_,name)=>include(T.ShaderChunk[name]));
 let count=0;
 for(const region of [...skinRegions,{...skinRegions.find(r=>r.id==='wrist'),id:'wrist-coupled'}]){
  const scene=Object.create(SkinSectionScene.prototype);Object.assign(scene,{profile:sectionProfile(region),uniforms:{},scene:new T.Scene(),geometries:[],materials:[]});
  if(region.id==='wrist-coupled')scene.profile.coupledWrist=true;
  for(const [cut,top]of [[true,false],[true,true],[false,false]]){const mat=new T.MeshStandardMaterial();scene.deformMaterial(mat,cut,top);scene.materials.push(mat);}
  scene.regionalStructures();
  for(const [i,material]of scene.materials.entries()){
   const shader={uniforms:{},vertexShader:T.ShaderLib.standard.vertexShader,fragmentShader:T.ShaderLib.standard.fragmentShader};material.onBeforeCompile(shader,{});
   for(const [stage,source]of [['vert',shader.vertexShader],['frag',shader.fragmentShader]]){
    let body=include(source);const counts=[...new Set(body.match(/\bNUM_[A-Z_]+\b/g)||[])].map(n=>`#define ${n} 0`).join('\n');
    // glslang reserves average in newer language tables; Three's common helper is alpha-renamed for validation only.
    const common='#version 300 es\nprecision highp float;precision highp int;\n#define average soma_three_average\n'+counts+'\n#define texture2D texture\n#define textureCube texture\n#define texture2DLodEXT textureLod\n#define textureCubeLodEXT textureLod\n#define texture2DGradEXT textureGrad\n#define texture2DProj textureProj\nuniform mat4 viewMatrix;uniform vec3 cameraPosition;uniform bool isOrthographic;\n';
    const prefix=stage==='vert'?'#define attribute in\n#define varying out\nuniform mat4 modelMatrix;uniform mat4 modelViewMatrix;uniform mat4 projectionMatrix;uniform mat3 normalMatrix;in vec3 position;in vec3 normal;in vec2 uv;\n':'#define varying in\nout vec4 pc_fragColor;\n#define gl_FragColor pc_fragColor\nvec4 linearToOutputTexel(vec4 value){return value;}\n';
    const file=path.join(dir,`${region.id}-${i}.${stage}`);fs.writeFileSync(file,common+prefix+body);try{execFileSync('glslangValidator',[file],{stdio:'pipe'});}catch(e){process.stderr.write(e.stdout?.toString()||e.message);throw new Error(`Shader compilation failed: ${region.id}/${i}/${stage}`);}count++;
   }
  }
  scene.geometries.forEach(g=>g.dispose());scene.materials.forEach(m=>m.dispose());
 }
 console.log(`Validated ${count} regional section vertex/fragment shaders.`);
}finally{await server.close();fs.rmSync(dir,{recursive:true,force:true});}
