import *as T from'three';
import{cardiacSpacePlanes}from'./cardiac-space-data.js';
export function cardiacSpaceDistance(p:T.Vector3){return Math.max(...cardiacSpacePlanes.map(n=>n[0]*p.x+n[1]*p.y+n[2]*p.z-n[3]));}
/** Render-space separation of the atlas's intersecting pulmonary/cardiac meshes.
 * The maximum cardiac envelope is reserved throughout breathing and contraction.
 * This is an anatomical display correction, not a tissue-contact solver.
 */
export function applyCardiacClearance(material:T.MeshStandardMaterial){
 const previous=material.onBeforeCompile,key=material.customProgramCacheKey();
 material.onBeforeCompile=(shader,renderer)=>{
  previous.call(material,shader,renderer);
  shader.uniforms.uCardiacSpace={value:cardiacSpacePlanes.map(v=>new T.Vector4(...v))};
  shader.vertexShader='varying vec3 vThoracicPoint;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('transformed=rigPosition(rigR,rigD,transformed);','vThoracicPoint=transformed;\ntransformed=rigPosition(rigR,rigD,transformed);');
  shader.fragmentShader=`varying vec3 vThoracicPoint;uniform vec4 uCardiacSpace[${cardiacSpacePlanes.length}];\n`+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
  float cardiacClearance=-100.0;
  for(int plane=0;plane<${cardiacSpacePlanes.length};plane++){cardiacClearance=max(cardiacClearance,dot(uCardiacSpace[plane].xyz,vThoracicPoint)-uCardiacSpace[plane].w);if(cardiacClearance>=0.0)break;}
  if(cardiacClearance<0.0)discard;`);
 };
 material.customProgramCacheKey=()=>`${key}-cardiac-clearance-v1`;
}
