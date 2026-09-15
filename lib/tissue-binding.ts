import * as T from 'three';
import {BONE_NAMES,bindGeometry,weightsAt,pelvicOrgan,type Weights} from './rig.ts';
const id=(name:string)=>BONE_NAMES.indexOf(name);
const smooth=(a:number,b:number,v:number)=>T.MathUtils.smoothstep(v,a,b);
/** Mesh names disambiguate tissue beside the torso from tissue inside it.
 * Use a common longitudinal field across a limb cross-section: medial vessels
 * and deep muscle must not be pinned to spine/pelvis by an X-only envelope. */
export function tissueWeights(name:string,x:number,y:number,z:number):Weights{
 const n=name.toLowerCase(),side=/\.r(?:\.|$)|\bright\b/.test(n)?'r':/\.l(?:\.|$)|\bleft\b/.test(n)?'l':x<0?'r':'l';
 const single=(bone:string):Weights=>({indices:[id(bone),0,0,0],weights:[1,0,0,0]});
 if(pelvicOrgan(n)||/dorsal.*penis|pudendal|testicular/.test(n))return single('pelvis');
 if(/inguinal|iliopectineal|gluteal|gluteus|obturator|gemellus|piriformis|pectineus|adductor minimus|psoas/.test(n))return single('pelvis');
 if(/clavipectoral/.test(n))return single('chest');
 if(/brachiocephalic/.test(n))return weightsAt(0,y,z);
 // The brachial plexus originates beside the cervical spine, not on the humerus.
 // All its named pieces and terminal nerves share this spatial field so roots,
 // trunks, divisions and cords cannot separate merely at a GLB mesh boundary.
 const plexus=/brachial plexus/.test(n);
 const armNerve=/nerve/.test(n)&&/brachial|antebrachial|median|radial|ulnar|musculocutaneous|\baxillary/.test(n);
 const chestBranch=/nerve/.test(n)&&/subscapular|thoracodorsal|pectoral/.test(n);
 if(plexus||armNerve||chestBranch){
  const proximal=smooth(1.30,1.40,y),lateral=smooth(.085,.175,Math.abs(x));
  let arm=1-proximal*(1-lateral);
  // Branches entering the pectoral/back muscles return to the torso distally.
  if(chestBranch)arm*=smooth(1.33,1.39,y);
  const torso=weightsAt(0,y,z),elbow=1-smooth(1.015,1.165,y),wrist=1-smooth(.825,.905,y),merged=new Map<number,number>();
  for(let j=0;j<4;j++)merged.set(torso.indices[j],(merged.get(torso.indices[j])||0)+torso.weights[j]*(1-arm));
  for(const [bone,w] of [[`upperArm.${side}`,1-elbow],[`forearm.${side}`,elbow*(1-wrist)],[`hand.${side}`,elbow*wrist]] as [string,number][])merged.set(id(bone),w*arm);
  const entries=[...merged].filter(([,w])=>w>1e-8).sort((a,b)=>b[1]-a[1]).slice(0,4),sum=entries.reduce((s,[,w])=>s+w,0);
  return {indices:Array.from({length:4},(_,i)=>entries[i]?.[0]??0),weights:Array.from({length:4},(_,i)=>(entries[i]?.[1]??0)/sum)};
 }
 const footDigits=/digitorum (longus|brevis)/.test(n);
 const arm=!footDigits&&/brachi|biceps brachii|triceps|coracobrachialis|deltoid|carpi|palmar|pollicis|digitorum|digiti|indicis|pronator|supinator|anconeus|cephalic vein|basilic vein|cubital|antebrachial|median nerve|musculocutaneous|radial (arter|vein|collateral|nerve)|ulnar (arter|vein|collateral|recurrent|nerve)|interosseous|\baxillary|circumflex humeral|of (the )?arm|of hand/.test(n)&&!/(foot|plantar|tibial|femor|leg|pedis)/.test(n);
 const leg=footDigits||/femor|saphenous|poplite|tibial|fibular|plantar|pedis|tarsal|genicular|patellar|quadriceps|vastus|rectus femoris|biceps femoris|semitendinos|semimembranos|sartorius|gracilis|gastrocnemius|soleus|hallucis|of foot|adductor (longus|brevis|magnus)|gluteus|fascia lata|crural fascia|iliotibial|calcaneal|sural|sciatic|of thigh|of leg/.test(n);
 if(arm){
  // Muscle bellies stay on their owning segment; tendons/distal attachments
  // share the same continuous joint field as the vascular tree.
  const elbow=1-smooth(1.015,1.165,y),wrist=1-smooth(.825,.905,y);
  const shoulder=/arter|vein/.test(n)?smooth(1.30,1.40,y)*(1-smooth(.085,.175,Math.abs(x))):smooth(/deltoid/.test(n)?1.20:1.34,1.43,y)*(/\baxillary|cephalic|basilic|deltoid|brachial fascia/.test(n)?1:0);
  return {indices:[id('chest'),id(`upperArm.${side}`),id(`forearm.${side}`),id(`hand.${side}`)],weights:[shoulder,(1-shoulder)*(1-elbow),(1-shoulder)*elbow*(1-wrist),(1-shoulder)*elbow*wrist]};
 }
 if(leg){const hip=smooth(.83,.96,y),knee=1-smooth(.385,.495,y),ankle=1-smooth(.05,.13,y);return {indices:[0,id(`thigh.${side}`),id(`shin.${side}`),id(`foot.${side}`)],weights:[hip,(1-hip)*(1-knee),(1-hip)*knee*(1-ankle),(1-hip)*knee*ankle]};}
 if(/pectoralis major|latissimus dorsi|teres major/.test(n)){
  const attach=smooth(.10,.20,Math.abs(x))*smooth(1.20,1.34,y);
  return {indices:[id('chest'),id(`upperArm.${side}`),0,0],weights:[1-attach,attach,0,0]};
 }
 // Rib muscles, back/abdominal fascia and intrathoracic vessels never follow arms.
 if(/intercostal|thorac|costarum|serratus|diaphragm|abdom|epigastr|aorta|vena cava|pulmon|cardiac|coronar|trapezius|rhomboid|scapul|subclav|supraspin|infraspin|teres minor|cervical|lumborum|spinalis/.test(n))return weightsAt(0,y,z);
 return weightsAt(x,y,z);
}
export function bindTissueGeometry(geometry:T.BufferGeometry,name:string){
 bindGeometry(geometry);const p=geometry.getAttribute('position'),ix=geometry.getAttribute('rigIndex'),weight=geometry.getAttribute('rigWeight');
 for(let i=0;i<p.count;i++){const w=tissueWeights(name,p.getX(i),p.getY(i),p.getZ(i));const entries=w.indices.map((id,j)=>({id,w:w.weights[j]})).sort((a,b)=>b.w-a.w);for(let j=0;j<4;j++){ix.setComponent(i,j,entries[j].id);weight.setComponent(i,j,entries[j].w);}}
}
