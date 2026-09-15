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
 const arm=/brachi|biceps brachii|triceps|coracobrachialis|deltoid|carpi|palmar|pollicis|digitorum|digiti|indicis|pronator|supinator|anconeus|cephalic vein|basilic vein|cubital|antebrachial|radial (arter|vein|collateral)|ulnar (arter|vein|collateral|recurrent)|interosseous|axillary|circumflex humeral|of (the )?arm|of hand/.test(n)&&!/(foot|plantar|tibial|femor|leg|pedis)/.test(n);
 const leg=/femor|saphenous|poplite|tibial|fibular|plantar|pedis|tarsal|genicular|patellar|quadriceps|vastus|rectus femoris|biceps femoris|semitendinos|semimembranos|sartorius|gracilis|gastrocnemius|soleus|hallucis|of foot|adductor (longus|brevis|magnus)|gluteus|fascia lata|of thigh|of leg/.test(n);
 if(arm){
  // Muscle bellies stay on their owning segment; tendons/distal attachments
  // share the same continuous joint field as the vascular tree.
  const elbow=1-smooth(1.035,1.145,y),wrist=1-smooth(.825,.905,y);
  const shoulder=smooth(/deltoid/.test(n)?1.20:1.34,1.43,y)*(/axillary|cephalic|basilic|deltoid|brachial fascia/.test(n)?1:0);
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
