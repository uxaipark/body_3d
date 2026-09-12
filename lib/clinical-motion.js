/** Authored joint tasks, not motion-capture or a validated clinical protocol.
 * The same clock drives the pose, task HUD and illustrative signal envelope. */
export const motionOptions=[['rest','정지'],['walk','걷기'],['run','달리기'],['stand','일어서기'],['sitStand','앉았다 일어서기'],['grip','손 쥐기'],['lie','침대에 눕기']];
export const ease=(a,b,t)=>{const u=Math.max(0,Math.min(1,(t-a)/(b-a)));return u*u*u*(u*(u*6-15)+10)};
export const isClinicalMotion=motion=>['stand','sitStand','grip','lie'].includes(motion);
export function taskState(motion,elapsed){
 const t=Math.max(0,elapsed),base={seat:0,lean:0,grip:0,arm:0,effort:0,activity:0,stage:'',repetitions:0,complete:false,recline:0,legLift:0};
 if(!isClinicalMotion(motion))return base;
 if(motion==='lie'){
  const prep=ease(0,2,t),recline=ease(3.5,7,t)*(1-ease(17,20.5,t)),legLift=ease(3,6.5,t)*(1-ease(17.5,21,t));
  const effort=t<2?.2*Math.sin(Math.PI*prep):.3*Math.sin(Math.PI*recline);
  return {...base,seat:prep,lean:.12*prep,arm:prep,recline,legLift,effort,activity:effort*.7,repetitions:t>=21?1:0,complete:t>=21,stage:t<2?'침대에 앉기':t<3?'앉은 자세':t<7?'다리 올리며 눕기':t<17?'누워서 안정 호흡':t<21?'상체 일으키고 다리 내리기':'앉은 자세 · 완료'};
 }
 if(motion==='grip'){
  const arm=ease(0,1.5,t),cycle=Math.max(0,t-1.5),p=cycle%6;
  const grip=t<1.5?0:ease(.5,1.5,p)*(1-ease(3.5,4.5,p));
  return {...base,arm,grip,effort:grip,activity:t<1.5?.15*Math.sin(Math.PI*t/1.5):Math.abs(grip*(1-grip)),repetitions:Math.floor(cycle/6)+(p>=4.5?1:0),stage:t<1.5?'팔 준비':p<.5?'이완':p<1.5?'쥐기':p<3.5?'유지':p<4.5?'펴기':'회복'};
 }
 if(t<2){const seat=ease(0,2,t);return {...base,seat,lean:.12*seat+.22*Math.sin(Math.PI*seat),arm:seat,effort:.25*Math.sin(Math.PI*seat),activity:.3*Math.sin(Math.PI*seat),stage:'앉은 자세 준비'};}
 const cycle=t-2,p=motion==='stand'?cycle:cycle%7;
 if(p<1)return {...base,seat:1,lean:.12,arm:1,stage:'앉은 자세',repetitions:Math.floor(cycle/7)};
 if(p<3.5){const rise=ease(1.7,3.5,p),lean=.12+.38*ease(1,1.7,p);return {...base,seat:1-rise,lean:lean*(1-ease(1.9,3.5,p)),arm:1-rise*.65,effort:.8*Math.sin(Math.PI*rise)+.12*(1-rise),activity:.6*Math.sin(Math.PI*rise),stage:p<1.7?'체중 전방 이동':'일어서기',repetitions:motion==='stand'?0:Math.floor(cycle/7)};}
 if(motion==='stand')return {...base,arm:.35*(1-ease(3.5,4.5,p)),stage:'기립 완료',repetitions:1,complete:true};
 const repetitions=Math.floor(cycle/7)+1;
 if(p<4.5)return {...base,arm:.35,stage:'선 자세',repetitions};
 const seat=ease(4.5,6.5,p);return {...base,seat,lean:.12*seat+.28*Math.sin(Math.PI*seat),arm:.35+.65*seat,effort:.35*Math.sin(Math.PI*seat),activity:.35*Math.sin(Math.PI*seat),stage:p<6.5?'앉기':'앉은 자세',repetitions};
}
