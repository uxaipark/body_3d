import * as THREE from 'three';
export type Tissue='muscle'|'tendon'|'fascia';
export function muscleTissue(name:string):Tissue {
 if(/fascia|bursa|bursae|sheath|septum/i.test(name))return 'fascia';
 if(/tendon|tendinous|aponeurosis|ligament|retinacul|iliotibial|tarsus|trochlea|arch/i.test(name))return 'tendon';
 return 'muscle';
}
export const tissueColors={muscle:'#a64238',tendon:'#e8ddc9',fascia:'#dbcabb'};

/** A local fibre frame survives batching and follows the mesh through skinning. */
export function muscleFrame(geometry:THREE.BufferGeometry,name:string){
 const p=geometry.getAttribute('position'),center=new THREE.Vector3();
 for(let i=0;i<p.count;i++)center.add(new THREE.Vector3(p.getX(i),p.getY(i),p.getZ(i)));center.multiplyScalar(1/p.count);
 const c=new Float64Array(9),v=new THREE.Vector3();
 for(let i=0;i<p.count;i++){v.set(p.getX(i),p.getY(i),p.getZ(i)).sub(center);const a=v.toArray();for(let j=0;j<3;j++)for(let k=0;k<3;k++)c[j*3+k]+=a[j]*a[k];}
 const largest=c[0]>=c[4]&&c[0]>=c[8]?0:c[4]>=c[8]?1:2;
 const axis=new THREE.Vector3(largest===0?1:0,largest===1?1:0,largest===2?1:0);
 for(let i=0;i<16;i++){v.set(c[0]*axis.x+c[1]*axis.y+c[2]*axis.z,c[3]*axis.x+c[4]*axis.y+c[5]*axis.z,c[6]*axis.x+c[7]*axis.y+c[8]*axis.z);if(v.lengthSq()>1e-20)axis.copy(v).normalize();}
 if(axis.y<0)axis.negate();
 // Broad trunk muscles use fan/oblique fibre directions instead of a vertical stripe.
 const side=center.x<0?-1:1;
 if(/pectoralis major/i.test(name))axis.set(side,.20,0).normalize();
 if(/external abdominal oblique/i.test(name))axis.set(side,.9,.05).normalize();
 if(/internal abdominal oblique/i.test(name))axis.set(-side,.9,.05).normalize();
 if(/transversus abdominis/i.test(name))axis.set(1,0,0);
 const u=new THREE.Vector3(0,0,1).cross(axis);if(u.lengthSq()<.01)u.set(1,0,0).cross(axis);u.normalize();
 const w=axis.clone().cross(u).normalize();
 const coords=new Float32Array(p.count*3);
 for(let i=0;i<p.count;i++){v.set(p.getX(i),p.getY(i),p.getZ(i)).sub(center);coords[i*3]=v.dot(u);coords[i*3+1]=v.dot(w);coords[i*3+2]=v.dot(axis);}
 geometry.setAttribute('fiberCoord',new THREE.BufferAttribute(coords,3));
 return {center,axis,u,w};
}

// Directional bundles (millimetres) plus fine fibres. Screen-space filtering
// suppresses distant shimmer; relief is shading only, so triangle count is unchanged.
export function applyMuscleSurface(mat:THREE.MeshStandardMaterial,tissue:Tissue){
 const previous=mat.onBeforeCompile,cache=mat.customProgramCacheKey();
 mat.onBeforeCompile=(shader,renderer)=>{
  previous.call(mat,shader,renderer);
  shader.vertexShader='attribute vec3 fiberCoord; varying vec3 vFiberCoord;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvFiberCoord=fiberCoord;');
  shader.fragmentShader=`varying vec3 vFiberCoord;
float fibreWave(float p){float aa=1.0-smoothstep(0.45,3.0,fwidth(p));return sin(p)*aa;}
vec3 fibreNormal(vec3 n,float h,vec3 viewPos){
 vec3 sx=dFdx(viewPos),sy=dFdy(viewPos);
 vec3 r1=cross(sy,n),r2=cross(n,sx);float det=dot(sx,r1);
 vec3 gradient=sign(det)*(dFdx(h)*r1+dFdy(h)*r2);
 return normalize(n-gradient/max(abs(det),0.000000000001));
}
`+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
 vec3 f=vFiberCoord;
 vec3 fn=abs(normalize(cross(dFdx(f),dFdy(f))));
 vec2 weights=pow(fn.yx,vec2(4.0))+vec2(0.001);weights/=weights.x+weights.y;
 float drift=sin(f.z*95.0)*0.23+sin(f.z*31.0)*0.34;
 // Slight feathering of bundles approximates pennation without moving fibres in world space.
 float px=f.x*2100.0+drift+sin(f.y*55.0)*1.3;
 float py=f.y*2100.0+drift+sin(f.x*55.0)*1.3;
 float bundles=dot(vec2(fibreWave(px),fibreWave(py)),weights);
 float fine=dot(vec2(fibreWave(px*5.3+sin(f.z*220.0)*.2),fibreWave(py*5.3)),weights);
 float broad=dot(vec2(fibreWave(px*.21),fibreWave(py*.21)),weights);
 float fibreShade=${tissue==='muscle'?'0.80+bundles*.15+fine*.05+broad*.06':'0.94+bundles*.035+fine*.02'};
 diffuseColor.rgb*=fibreShade;
 float fibreHeight=(bundles+fine*.12)*${tissue==='muscle'?'0.000085':'0.000025'};
 `);
  shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\nnormal=fibreNormal(normal,fibreHeight,-vViewPosition);');
 };
 mat.customProgramCacheKey=()=>`${cache}-fibres-v1-${tissue}`;
}
