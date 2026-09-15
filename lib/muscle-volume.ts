import * as T from 'three';
import {muscleVolumeData} from './muscle-volume-data.js';
import {tissueWeights} from './tissue-binding.ts';
const canonical=(name:string)=>name.toLowerCase().replace(/[\s_.\[\]:/]+/g,'');
const lookup=new Map(muscleVolumeData.names.map((name,i)=>[canonical(name),i]));
export function bindMuscleVolume(g:T.BufferGeometry,name:string){
 g.computeBoundingBox();const center=g.boundingBox!.getCenter(new T.Vector3()),weights=tissueWeights(name,center.x,center.y,center.z),n=g.getAttribute('position').count;
 const anchor=new Float32Array(n*4),indices=new Float32Array(n*4),values=new Float32Array(n*4);
 for(let i=0;i<n;i++){anchor.set([center.x,center.y,center.z,lookup.get(canonical(name))??-1],i*4);indices.set(weights.indices,i*4);values.set(weights.weights,i*4);}
 g.setAttribute('muscleAnchor',new T.BufferAttribute(anchor,4));g.setAttribute('muscleIndex',new T.BufferAttribute(indices,4));g.setAttribute('muscleWeight',new T.BufferAttribute(values,4));
}
export class MuscleVolumeGuard{
 texture:T.DataTexture;active=false;
 uniforms:{uMuscleVolume:{value:T.DataTexture};uMuscleVolumeSize:{value:T.Vector2};uMuscleVolumeRow:{value:T.Vector4}};
 constructor(){const clips=muscleVolumeData.clips,width=muscleVolumeData.names.length,height=clips.wave.frames.length+clips.dance.frames.length,data=new Float32Array(width*height*4);let row=0;
  for(const clip of [clips.wave,clips.dance])for(const frame of clip.frames){for(let i=0;i<width;i++)data[(row*width+i)*4]=frame[i];row++;}
  this.texture=new T.DataTexture(data,width,height,T.RGBAFormat,T.FloatType);this.texture.needsUpdate=true;this.texture.minFilter=this.texture.magFilter=T.NearestFilter;
  this.uniforms={uMuscleVolume:{value:this.texture},uMuscleVolumeSize:{value:new T.Vector2(width,height)},uMuscleVolumeRow:{value:new T.Vector4(0,0,0,0)}};
 }
 update(mode:string,time:number,transition:number){
  const row=this.uniforms.uMuscleVolumeRow.value;
  if(mode!=='wave'&&mode!=='dance'){row.w=this.active?1-transition:0;return;}
  this.active=true;const clip=muscleVolumeData.clips[mode],n=clip.frames.length,frame=((time%clip.duration)+clip.duration)%clip.duration/clip.duration*n,i=Math.floor(frame),offset=mode==='dance'?muscleVolumeData.clips.wave.frames.length:0;
  row.set(offset+i,offset+(i+1)%n,frame-i,transition);
 }
 dispose(){this.texture.dispose();}
}
export const muscleVolumeShader=`
attribute vec4 muscleAnchor;attribute vec4 muscleIndex;attribute vec4 muscleWeight;
uniform sampler2D uMuscleVolume;uniform vec2 uMuscleVolumeSize;uniform vec4 uMuscleVolumeRow;
vec3 muscleVolumePosition(vec3 p){
 if(muscleAnchor.w<0.0||uMuscleVolumeRow.w<.0001)return p;
 float a=texture2D(uMuscleVolume,vec2(muscleAnchor.w+.5,uMuscleVolumeRow.x+.5)/uMuscleVolumeSize).r;
 float b=texture2D(uMuscleVolume,vec2(muscleAnchor.w+.5,uMuscleVolumeRow.y+.5)/uMuscleVolumeSize).r;
 float scale=mix(1.0,mix(a,b,uMuscleVolumeRow.z),uMuscleVolumeRow.w);
 int reference=0;for(int j=1;j<4;j++){if(muscleWeight[j]>muscleWeight[reference])reference=j;}
 vec4 ref=uRigReal[int(muscleIndex[reference])],r=vec4(0.0),d=vec4(0.0);
 for(int j=0;j<4;j++){int id=int(muscleIndex[j]);float w=muscleWeight[j]*(dot(ref,uRigReal[id])<0.0?-1.0:1.0);r+=w*uRigReal[id];d+=w*uRigDual[id];}
 float norm=max(length(r),.00001);r/=norm;d/=norm;d-=r*dot(r,d);
 vec3 center=rigPosition(r,d,muscleAnchor.xyz);return center+(p-center)*scale;
}
`;
