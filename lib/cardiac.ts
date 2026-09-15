import * as T from 'three';
const smooth=(a:number,b:number,x:number)=>{const t=T.MathUtils.clamp((x-a)/(b-a),0,1);return T.MathUtils.clamp(t*t*t*(t*(t*6-15)+10),0,1);};
const cycle=(x:number)=>((x%1)+1)%1;
export function chamberContraction(cycles:number,atrial=false){const p=cycle(cycles+(atrial?.22:0));return smooth(0,atrial?.065:.13,p)*(1-smooth(atrial?.09:.24,atrial?.24:.55,p));}
const base=new T.Vector3(.009,1.329,.012),axis=new T.Vector3(.048,-.086,.039).normalize();
export function cardiacDisplacement(point:T.Vector3,role:number,weight:number,cycles:number){
 const local=point.clone().sub(base),length=local.dot(axis),radial=local.clone().addScaledVector(axis,-length);
 const vent=chamberContraction(cycles),atrial=chamberContraction(cycles,true),contraction=T.MathUtils.lerp(vent,atrial,role);
 const apex=smooth(-.015,.105,length),twist=(apex-.20)*vent*.13*(1-role);
 radial.multiplyScalar(1-contraction*T.MathUtils.lerp(.09,.045,role)).applyAxisAngle(axis,twist);
 const axial=length*(1-contraction*.045*(1-role));
 return base.clone().add(radial).addScaledVector(axis,axial).sub(point).multiplyScalar(weight);
}
export const isCardiacChamber=(name:string)=>!/vein|artery|vessel/i.test(name)&&/atrium|ventricle|papillary|leaflet|myocard|epicard|pericard/i.test(name);
/** Myocardium moves fully; great-vessel roots taper over a short tethered segment.
 * Descending/abdominal vessels retain their independent wall pulse and breathing. */
export function cardiacAttachmentWeight(name:string,v:T.Vector3){
 if(isCardiacChamber(name))return 1;
 if(/coronar|cardiac vein/i.test(name))return 1-smooth(.9,1.35,Math.sqrt(((v.x-.025)/.088)**2+((v.y-1.29)/.092)**2+((v.z-.025)/.082)**2));
 if(!/ascending aorta|aortic arch|pulmonary (arter|vein|trunk)|pulmonic|vena cava.*thoracic|superior vena cava/i.test(name))return 0;
 const inferior=1-smooth(0,.07,Math.max(0,1.30-v.y));
 return .25*(1-smooth(.025,.075,v.distanceTo(new T.Vector3(.009,1.329,.012))))*inferior;
}
export function bindCardiacMotion(geometry:T.BufferGeometry,name:string){
 const p=geometry.getAttribute('position'),data=new Float32Array(p.count*2),chamber=isCardiacChamber(name),atrial=/atrium/i.test(name);
 for(let i=0;i<p.count;i++){
  const v=new T.Vector3().fromBufferAttribute(p,i),distance=Math.sqrt(((v.x-.025)/.088)**2+((v.y-1.29)/.092)**2+((v.z-.025)/.082)**2);
  data[i*2]=atrial?1:chamber?0:smooth(1.29,1.34,v.y);
  data[i*2+1]=cardiacAttachmentWeight(name,v);
 }
 geometry.setAttribute('cardiacData',new T.BufferAttribute(data,2));
 // The heart and nearby vessel roots follow the same chest transform as lungs.
 const indices=geometry.getAttribute('rigIndex'),weights=geometry.getAttribute('rigWeight');
 if(indices&&weights)for(let i=0;i<p.count;i++){
  const influence=data[i*2+1];if(!influence)continue;
  const blended=new Map<number,number>([[2,influence]]);
  for(let j=0;j<4;j++){const id=indices.getComponent(i,j);blended.set(id,(blended.get(id)||0)+weights.getComponent(i,j)*(1-influence));}
  const active=[...blended].sort((a,b)=>b[1]-a[1]).slice(0,4),sum=active.reduce((v,p)=>v+p[1],0);
  for(let j=0;j<4;j++){indices.setComponent(i,j,active[j]?.[0]||0);weights.setComponent(i,j,(active[j]?.[1]||0)/sum);}
 }

}
export const cardiacShader=`
attribute vec2 cardiacData;
float cardiacSmooth(float a,float b,float x){float t=clamp((x-a)/(b-a),0.0,1.0);return clamp(t*t*t*(t*(t*6.0-15.0)+10.0),0.0,1.0);}
float cardiacContraction(float cycles,float atrial){float p=fract(cycles+atrial*.22);return cardiacSmooth(0.0,mix(.13,.065,atrial),p)*(1.0-cardiacSmooth(mix(.24,.09,atrial),mix(.55,.24,atrial),p));}
vec3 cardiacOffset(vec3 point,vec2 data,float cycles){
 vec3 base=vec3(.009,1.329,.012),axis=normalize(vec3(.048,-.086,.039)),local=point-base;
 float axial=dot(local,axis),apex=cardiacSmooth(-.015,.105,axial),vent=cardiacContraction(cycles,0.0);
 float contraction=mix(vent,cardiacContraction(cycles,1.0),data.x),twist=(apex-.20)*vent*.13*(1.0-data.x);
 vec3 radial=(local-axis*axial)*(1.0-contraction*mix(.09,.045,data.x));
 radial=radial*cos(twist)+cross(axis,radial)*sin(twist);
 return (base+radial+axis*axial*(1.0-contraction*.045*(1.0-data.x))-point)*data.y;
}
vec3 cardiacNormal(vec3 point,vec3 normal,float cycles){
 if(cardiacData.y<.0001)return normal;
 float e=.0002;vec3 x=vec3(e,0.0,0.0),y=vec3(0.0,e,0.0),z=vec3(0.0,0.0,e);
 mat3 j=mat3(1.0)+mat3(cardiacOffset(point+x,cardiacData,cycles)-cardiacOffset(point-x,cardiacData,cycles),cardiacOffset(point+y,cardiacData,cycles)-cardiacOffset(point-y,cardiacData,cycles),cardiacOffset(point+z,cardiacData,cycles)-cardiacOffset(point-z,cardiacData,cycles))/(2.0*e);
 return transpose(inverse(j))*normal;
}
`;
