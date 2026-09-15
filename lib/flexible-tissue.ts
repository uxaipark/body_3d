import * as T from 'three';
/** Add bending resolution once at load time, only along joint-spanning tube
 * edges. Shared edge midpoints keep the indexed tube watertight. All baked
 * contact attributes survive subdivision; no per-frame CPU mesh solver. */
export function refineFlexibleTissue(g:T.BufferGeometry,name:string){
 if(!/nerve|brachial plexus|arter|vein|aort/i.test(name))return;
 const zone=(x:number,y:number)=>{const ax=Math.abs(x);return (y>1.29&&y<1.49&&ax>.025&&ax<.24)||(y>1.01&&y<1.18&&ax>.135)||(y>.81&&y<.92&&ax>.19)||(y>.37&&y<.51&&ax<.17)||(y>.03&&y<.15&&ax<.16);};
 const attributes=Object.entries(g.attributes).filter(([key])=>!/^rig|^muscle/.test(key));
 const data=new Map(attributes.map(([key,a])=>[key,Array.from(a.array)]));
 let triangles=g.index?Array.from(g.index.array):Array.from({length:g.getAttribute('position').count},(_,i)=>i),changed=false;
 const p=data.get('position')!,point=(i:number)=>new T.Vector3(p[i*3],p[i*3+1],p[i*3+2]);
 const vertex=(ids:number[])=>{const index=p.length/3;for(const [key,a] of attributes){const values=data.get(key)!;for(let c=0;c<a.itemSize;c++)values.push(ids.reduce((s,i)=>s+values[i*a.itemSize+c],0)/ids.length);
  if(key==='normal'||key==='_rib_guard'){const k=index*a.itemSize,len=Math.hypot(values[k],values[k+1],values[k+2]);if(len>1e-8)for(let c=0;c<a.itemSize;c++)values[k+c]/=len;}
 }return index;};
 // Four passes cap work and avoid subdividing the head or long straight shafts.
 for(let pass=0;pass<4;pass++){
  const edges=new Map<string,number>(),key=(a:number,b:number)=>a<b?`${a}/${b}`:`${b}/${a}`;
  for(let i=0;i<triangles.length;i+=3)for(let j=0;j<3;j++){const a=triangles[i+j],b=triangles[i+(j+1)%3],k=key(a,b);if(edges.has(k))continue;const av=point(a),bv=point(b),mid=av.clone().add(bv).multiplyScalar(.5);if(av.distanceToSquared(bv)>.008**2&&zone(mid.x,mid.y))edges.set(k,vertex([a,b]));}
  if(!edges.size)break;changed=true;const next:number[]=[];
  for(let i=0;i<triangles.length;i+=3){const ids=triangles.slice(i,i+3),m=ids.map((a,j)=>edges.get(key(a,ids[(j+1)%3]))),count=m.filter(v=>v!==undefined).length;
   if(count===0){next.push(...ids);continue;}
   if(count===1){const k=m.findIndex(v=>v!==undefined),a=ids[k],b=ids[(k+1)%3],c=ids[(k+2)%3],mid=m[k]!;next.push(a,mid,c,mid,b,c);}
   else if(count===2){const k=(m.findIndex(v=>v===undefined)+1)%3,a=ids[k],b=ids[(k+1)%3],c=ids[(k+2)%3],ab=m[k]!,bc=m[(k+1)%3]!;next.push(a,ab,c,ab,bc,c,ab,b,bc);}
   else{const [a,b,c]=ids,[ab,bc,ca]=m as number[];next.push(a,ab,ca,ab,b,bc,ca,bc,c,ab,bc,ca);}
  }triangles=next;
 }
 if(changed){for(const [key,a] of attributes)g.setAttribute(key,new T.Float32BufferAttribute(data.get(key)!,a.itemSize));g.setIndex(triangles);g.computeBoundingBox();g.computeBoundingSphere();}
}
