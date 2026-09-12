import * as T from 'three';
/** A local rest-space privacy mask; torso, legs and other organs stay visible. */
export function comfortRegion(x:number,y:number,z:number){return Math.abs(x)<.044&&y>.695&&y<.835&&z>.005;}
export function applyComfortMask(material:T.MeshStandardMaterial,uniform:{value:number}){
 const previous=material.onBeforeCompile.bind(material),key=material.customProgramCacheKey.bind(material);
 material.onBeforeCompile=(shader,renderer)=>{
  previous(shader,renderer);shader.uniforms.uComfort=uniform;
  shader.vertexShader='varying vec3 vComfortRest;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n vComfortRest=position;');
  shader.fragmentShader='uniform float uComfort; varying vec3 vComfortRest;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
   if(uComfort>.5&&abs(vComfortRest.x)<.044&&vComfortRest.y>.695&&vComfortRest.y<.835&&vComfortRest.z>.005)discard;
  `);
 };const sourceKey=key();material.customProgramCacheKey=()=>sourceKey+'-comfort-v1';
}
