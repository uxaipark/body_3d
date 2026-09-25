import * as T from 'three';
import {rigShader,type HumanRig} from './rig';
import {tissueShader,type SoftBody} from './soft-body';
import type {NerveSkinGuard} from './skin-boundary';
/** One GPU pass per skin vertex, shared by every attached nerve vertex. The
 * fallback retains the original containment shader on unsupported hardware. */
export class NervePoseCache {
 target:T.WebGLRenderTarget;material:T.RawShaderMaterial;scene=new T.Scene();camera=new T.Camera();mesh:T.Mesh;
 uniforms:Record<string,{value:any}>;ready=false;
 constructor(guard:NerveSkinGuard,rig:HumanRig,soft:SoftBody){
  const count=guard.texture.image.width*guard.texture.image.height/4,width=512,height=Math.ceil(count/width);
  this.target=new T.WebGLRenderTarget(width,height,{count:4,type:T.FloatType,minFilter:T.NearestFilter,magFilter:T.NearestFilter,depthBuffer:false,stencilBuffer:false});
  this.uniforms={uNerveCachedPosition:{value:this.target.textures[0]},uNerveCachedNormal:{value:this.target.textures[1]},uNerveCachedRotation:{value:this.target.textures[2]},uNerveCachedTranslation:{value:this.target.textures[3]},uNerveCacheSize:{value:new T.Vector2(width,height)}};
  this.material=new T.RawShaderMaterial({glslVersion:T.GLSL3,depthTest:false,depthWrite:false,uniforms:{...guard.uniforms,...rig.uniforms,...soft.uniforms,uCacheWidth:{value:width}},vertexShader:`precision highp float;in vec3 position;void main(){gl_Position=vec4(position,1.0);}`,fragmentShader:`precision highp float;
  #define texture2D texture
  ${rigShader.replace('attribute vec4 rigIndex;','vec4 rigIndex;').replace('attribute vec4 rigWeight;','vec4 rigWeight;')}
  ${tissueShader}
  uniform sampler2D uNerveSkin;uniform vec2 uNerveSkinSize;uniform float uCacheWidth;
  layout(location=0) out vec4 outPosition;layout(location=1) out vec4 outNormal;layout(location=2) out vec4 outRotation;layout(location=3) out vec4 outTranslation;
  vec4 readSkin(float i){return texture(uNerveSkin,(vec2(mod(i,uNerveSkinSize.x),floor(i/uNerveSkinSize.x))+.5)/uNerveSkinSize);}
  void main(){float i=floor(gl_FragCoord.y)*uCacheWidth+floor(gl_FragCoord.x);vec3 p=readSkin(i*4.0).xyz;vec4 indices=readSkin(i*4.0+1.0),weights=readSkin(i*4.0+2.0);
   vec4 reference=uRigReal[int(indices.x)],r=vec4(0.0),d=vec4(0.0);float torso=0.0;
   for(int j=0;j<4;j++){int id=int(indices[j]);float w=weights[j]*(dot(reference,uRigReal[id])<0.0?-1.0:1.0);r+=w*uRigReal[id];d+=w*uRigDual[id];if(id<=2)torso+=weights[j];}
   float norm=max(length(r),.00001);r/=norm;d/=norm;d-=r*dot(r,d);vec3 offset;mat3 jacobian;tissueField(p,offset,jacobian);
   vec3 normal=rigRotate(r,transpose(inverse(mat3(1.0)+(jacobian-mat3(1.0))*torso))*readSkin(i*4.0+3.0).xyz);
   outPosition=vec4(rigPosition(r,d,p+offset*torso),1.0);outNormal=vec4(normal,0.0);outRotation=r;outTranslation=vec4(rigPosition(r,d,offset*torso),0.0);
  }`});
  this.mesh=new T.Mesh(new T.PlaneGeometry(2,2),this.material);this.mesh.frustumCulled=false;this.scene.add(this.mesh);
 }
 update(renderer:T.WebGLRenderer){const target=renderer.getRenderTarget();renderer.setRenderTarget(this.target);renderer.render(this.scene,this.camera);renderer.setRenderTarget(target);this.ready=true}
 dispose(){this.target.dispose();this.material.dispose();this.mesh.geometry.dispose()}
}
export const cachedNerveVertex=`
uniform sampler2D uNerveCachedPosition,uNerveCachedNormal,uNerveCachedRotation,uNerveCachedTranslation;uniform vec2 uNerveCacheSize;
vec3 nerveSkinVertex(float i,out vec3 embedded,out vec3 surfaceNormal){
 vec2 uv=(vec2(mod(i,uNerveCacheSize.x),floor(i/uNerveCacheSize.x))+.5)/uNerveCacheSize;
 vec4 r=texture2D(uNerveCachedRotation,uv);embedded=rigRotate(r,position)+texture2D(uNerveCachedTranslation,uv).xyz;surfaceNormal=texture2D(uNerveCachedNormal,uv).xyz;
 return texture2D(uNerveCachedPosition,uv).xyz;
}
`;
export function cachedNerveShader(original:string){const start=original.indexOf('vec3 nerveSkinVertex('),end=original.indexOf('vec3 nerveSkinPosition(');return original.slice(0,start)+cachedNerveVertex+original.slice(end)}
