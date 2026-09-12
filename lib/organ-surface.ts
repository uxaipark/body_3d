import *as T from'three';
/** A restrained silhouette cue separates adjacent semi-transparent organs. */
export function applyOrganSurface(material:T.MeshStandardMaterial,part:'heart'|'lung'){
 const previous=material.onBeforeCompile,key=material.customProgramCacheKey();
 material.onBeforeCompile=(shader,renderer)=>{
  previous.call(material,shader,renderer);
  shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
  float organRim=pow(1.0-abs(dot(normal,normalize(vViewPosition))),2.0);
  outgoingLight*=1.0-organRim*${part==='heart'?'.32':'.22'};
  #include <opaque_fragment>`);
 };
 material.customProgramCacheKey=()=>`${key}-organ-edge-v1-${part}`;
}
