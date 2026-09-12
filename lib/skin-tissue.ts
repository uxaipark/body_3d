import * as THREE from 'three';
/** Procedural connective/fat texture, anchored in the original tissue coordinates. */
export function applySkinTissue(mat:THREE.MeshStandardMaterial,layer:'skin'|'dermis'|'adipose'){
 const previous=mat.onBeforeCompile,cache=mat.customProgramCacheKey();
 mat.onBeforeCompile=(shader,renderer)=>{
  previous.call(mat,shader,renderer);
  shader.vertexShader='varying vec3 vSkinTissue;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvSkinTissue=position;');
  shader.fragmentShader='varying vec3 vSkinTissue;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
 vec3 tissuePhase=vSkinTissue*${layer==='adipose'?'620.0':layer==='skin'?'8000.0':'3500.0'};
 vec3 lobule=sin(tissuePhase+sin(tissuePhase.yzx*.29)*.45);
 float detail=1.0-dot(lobule,lobule)/3.0;
 float filterDetail=1.0-smoothstep(.4,2.8,length(fwidth(tissuePhase)));
 detail=mix(.5,detail,filterDetail);
 diffuseColor.rgb*= ${layer==='adipose'?'(.78+.30*detail)':layer==='skin'?'(.985+.03*detail)':'(.93+.10*detail)'};
 float tissueHeight=detail*${layer==='adipose'?'0.00023':layer==='skin'?'0.000006':'0.00002'};
 `);
  shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
 vec3 sx=dFdx(-vViewPosition),sy=dFdy(-vViewPosition),r1=cross(sy,normal),r2=cross(normal,sx);
 float det=dot(sx,r1);
 normal=normalize(normal-sign(det)*(dFdx(tissueHeight)*r1+dFdy(tissueHeight)*r2)/max(abs(det),1e-12));
 `);
 };
 mat.customProgramCacheKey=()=>`${cache}-${layer}-surface-v2`;
}
