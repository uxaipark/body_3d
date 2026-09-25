import * as T from 'three';
import {BONE_NAMES,weightsAt} from './rig.ts';
/** Matches the repaired atlas gap, in metres. No broad X-only torso box: the
 * upper arm on the other side of the crease retains its own bone influence. */
export function axillarySeam(y:number){
 const rows=[[.96,.180],[1.10,.170],[1.18,.163],[1.24,.167],[1.285,.164],[1.305,.161],[1.32,.160]];
 for(let i=1;i<rows.length;i++)if(y<=rows[i][0])return T.MathUtils.lerp(rows[i-1][1],rows[i][1],T.MathUtils.clamp((y-rows[i-1][0])/(rows[i][0]-rows[i-1][0]),0,1));
 return .160;
}
export function bindAxillarySkin(g:T.BufferGeometry){
 const p=g.getAttribute('position'),ix=g.getAttribute('rigIndex'),w=g.getAttribute('rigWeight');
 const parent=Array.from({length:p.count},(_,i)=>i),find=(i:number):number=>parent[i]===i?i:(parent[i]=find(parent[i]));
 const eligible=(i:number)=>p.getY(i)>.90&&p.getY(i)<1.31;
 const index=g.index!;
 for(let f=0;f<index.count;f+=3)for(let j=0;j<3;j++){const a=index.getX(f+j),b=index.getX(f+(j+1)%3);if(eligible(a)&&eligible(b))parent[find(a)]=find(b)}
 const spans=new Map<number,{min:number;max:number}>();
 for(let i=0;i<p.count;i++)if(eligible(i)){const root=find(i),s=spans.get(root)||{min:Infinity,max:-Infinity};s.min=Math.min(s.min,p.getX(i));s.max=Math.max(s.max,p.getX(i));spans.set(root,s)}
 for(let i=0;i<p.count;i++){
  const x=p.getX(i),y=p.getY(i),z=p.getZ(i),ax=Math.abs(x);
  if(y<.98||y>1.38||ax<.10)continue;
  const span=eligible(i)?spans.get(find(i)):undefined;
  const arm=span?(span.min>0||span.max<0):ax>axillarySeam(y),blend=(1-T.MathUtils.smoothstep(y,1.315,1.38))*T.MathUtils.smoothstep(y,.98,1.10);
  if(blend===0)continue;
  const elbow=1-T.MathUtils.smoothstep(y,1.055,1.125),side=x<0?'r':'l';
  const armFraction=T.MathUtils.lerp(arm?1:0,T.MathUtils.smoothstep(ax,axillarySeam(y)-.045,axillarySeam(y)+.045),T.MathUtils.smoothstep(y,1.28,1.32));
  const limb=[0,1,2,3].map(j=>[ix.getComponent(i,j),w.getComponent(i,j)]).filter(([id])=>/^(upperArm|forearm|hand)\./.test(BONE_NAMES[id])),total=limb.reduce((s,e)=>s+e[1],0);
  const armBinding=total>.1?limb.map(([id,v])=>[id,v/total]):[[BONE_NAMES.indexOf(`upperArm.${side}`),1-elbow],[BONE_NAMES.indexOf(`forearm.${side}`),elbow]];
  const torso=weightsAt(0,y,z),target={indices:[...torso.indices,...armBinding.map(e=>e[0])],weights:[...torso.weights.map(v=>v*(1-armFraction)),...armBinding.map(e=>e[1]*armFraction)]};
  const combined=new Map<number,number>();
  for(let j=0;j<4;j++){
   combined.set(ix.getComponent(i,j),(combined.get(ix.getComponent(i,j))||0)+w.getComponent(i,j)*(1-blend));
  }
  for(let j=0;j<target.indices.length;j++)combined.set(target.indices[j],(combined.get(target.indices[j])||0)+target.weights[j]*blend);
  const entries=[...combined].sort((a,b)=>b[1]-a[1]).slice(0,4),sum=entries.reduce((s,e)=>s+e[1],0);
  for(let j=0;j<4;j++){ix.setComponent(i,j,entries[j]?.[0]??0);w.setComponent(i,j,(entries[j]?.[1]??0)/sum)}
 }
}
