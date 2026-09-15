import {defaultPatchGeometry,patchCoupling,patchExcursions,cardiacLead,accelerometer,heartCenter} from './sensing.js';
import {updateEcgDerived,measuredHeartRate} from './ecg-derived.js';
/** SI geometry, litres / cmH2O lung mechanics; synthetic research model.
 * C is a calibrated effective fringe capacitance, NOT direct spirometry. */
export const sleepDefaults={rr:14,hr:62,tidal:.5,compliance:.2,resistance:2,area:180,gap:2,permittivity:6,noise:.015,fat:8,conductivity:.2,scenario:'normal'};
export const sleepChannels={cap:{width:3,unit:'pF'},ecg:{width:1,unit:'mV'},acc:{width:3,unit:'m/s2'},breathAudio:{width:1,unit:'rms'},snore:{width:1,unit:'probability'},camera:{width:1,unit:'motion'},radar:{width:4,unit:'mm'},airflow:{width:1,unit:'L/s'}};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),tau=2*Math.PI;
export function sleepPose(t,mode='supine'){
 const ease=x=>{x=clamp(x,0,1);return x*x*x*(10+x*(-15+6*x));};
 if(mode==='left')return {roll:1.20,motion:0};if(mode==='right')return {roll:-1.20,motion:0};
 if(mode==='turn'){const p=t%64,phase=p<32?ease((p-3)/5):ease((p-35)/5),roll=p<32?-1.2+2.4*phase:1.2-2.4*phase;const u=p<32?(p-3)/5:(p-35)/5;return {roll,motion:u>0&&u<1?30*u*u*(1-u)*(1-u)/5:0};}
 return {roll:0,motion:0};
}
export class SleepPosture{
 constructor(){this.roll=0;this.velocity=0;}
 step(dt,t,mode){const target=sleepPose(t,mode).roll;this.velocity+=(20*(target-this.roll)-9*this.velocity)*dt;this.roll+=this.velocity*dt;return {roll:this.roll,motion:Math.min(1,Math.abs(this.velocity)/1.2)};}
}
export class SleepGenerator{
 constructor(seed=37){this.time=0;this.volume=.25;this.phase=0;this.cardiac=0;this.seed=seed;this.lastDisplacement=0;this.velocity=0;this.lastRoll=0;}
 random(){this.seed=(1664525*this.seed+1013904223)>>>0;return (this.seed/4294967296-.5)*Math.sqrt(12);}
 step(dt,settings=sleepDefaults,pose={roll:0,motion:0},geometry=defaultPatchGeometry){
  const p={...sleepDefaults,...settings},t=this.time+=dt,omega=tau*p.rr/60;this.phase+=omega*dt;
  const event=p.scenario!=='normal'&&t%60>=25&&t%60<43;
  const drive=event&&p.scenario==='central'?0:1;
  const obstruction=event&&p.scenario==='obstructive';
  const amplitude=p.tidal/2,pressure=drive*(amplitude/p.compliance+amplitude*Math.hypot(1/p.compliance,p.resistance*omega)*Math.sin(this.phase));
  const resistance=obstruction?120:p.resistance,flow=(pressure-this.volume/p.compliance)/resistance;
  this.volume=clamp(this.volume+flow*dt,0,1.8);
  const effort=drive*(1+Math.sin(this.phase-Math.atan(p.resistance*p.compliance*omega)))/2;
  if(this.geometry!==geometry||this.fat!==p.fat){this.geometry=geometry;this.fat=p.fat;this.coupling=patchCoupling(geometry,p.fat);}
  const excursions=patchExcursions(this.coupling,this.volume,effort,p.tidal,obstruction),excursion=excursions[1];
  const normal=(excursion-this.lastDisplacement)/dt,acceleration=clamp((normal-this.velocity)/dt,-1,1);this.lastDisplacement=excursion;this.velocity=normal;
  const speed=(pose.roll-this.lastRoll)/dt,angularAcceleration=clamp((speed-(this.lastSpeed??speed))/dt,-8,8);this.lastRoll=pose.roll;this.lastSpeed=speed;
  const motion=Math.max(pose.motion,Math.min(1,Math.abs(speed)/2));
  const motionNoise=motion*(.7*Math.sin(t*8.7)+.3*Math.sin(t*23));
  // Each pad sees a different field footprint. Skin stretch and dielectric/gap
  // change enter C = Cparasitic + epsilon0*epsilonEffective*Aeffective/deffective.
  const cap=[0,1,2].map(i=>{const strain=excursions[i]*(24+i*.5),area=p.area*1e-6*(1+strain),gap=p.gap*1e-3*(1-.045*excursions[i]/.008)+motionNoise*.00012,epsilon=p.permittivity/(1+p.fat*.012);return 9+i*.8+8.8541878128e-12*epsilon*area/Math.max(.0004,gap)*1e12-.5*this.coupling[i].direct*this.volume/.5+this.random()*p.noise+motionNoise*(i+1)*.2;});
  this.cardiac+=dt*p.hr/60*(1+.035*Math.sin(this.phase));const phase=this.cardiac%1;
  // Respiration changes cardiac orientation, source/electrode separation and
  // the local electrode interface offset. The lead is C3 minus C1, C2 reference.
  const baseline=.10*excursion/.008+.035*(excursions[2]-excursions[0])/.001+.8*motionNoise;
  const ecg=cardiacLead(phase,effort,excursions,geometry,p.conductivity)+baseline+this.random()*.006;
  const acc=accelerometer(geometry,pose.roll,effort,acceleration,speed,angularAcceleration,motionNoise,()=>this.random()*.005);
  const breathAudio=Math.max(0,flow)*.22+Math.max(0,-flow)*.055+Math.abs(this.random())*.002;
  const snore=obstruction?clamp(.65+.25*Math.sin(t*1.3),0,1):.02;
  return {t,pose,cardiac:this.cardiac,cap,ecg,acc,breathAudio,snore,camera:motion,radar:[excursion*1000+motionNoise*8,pose.roll*100,0,0],airflow:flow,truth:{volume:this.volume,effort,pressure,flow,event,obstruction,motion,excursion,excursions,coupling:this.coupling,heartDistance:Math.hypot(...geometry.electrodes[1].map((v,i)=>v-heartCenter[i])),rr:p.rr}};
 }
}
/** Socket v1 uses seconds on one session clock; buffers reject time reversal.
 * Independent channels may arrive in any order, with per-channel ordering. */
export function validateSleepPacket(data){
 if(!data||data.version!==1||typeof data.channel!=='string'||data.channel.length>64||!Object.hasOwn(sleepChannels,data.kind))throw Error('Invalid v1 channel/kind');
 const spec=sleepChannels[data.kind];if(data.unit!==spec.unit)throw Error(`Expected ${spec.unit}`);
 if(!Number.isFinite(data.t0)||data.t0<0||!Number.isFinite(data.fs)||data.fs<1||data.fs>2000||!Array.isArray(data.samples)||!data.samples.length||data.samples.length>2000)throw Error('Invalid time / sample rate / block size');
 for(const sample of data.samples){const a=spec.width===1?[sample]:sample;if(!Array.isArray(a)||a.length!==spec.width||!a.every(v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<1e6))throw Error('Invalid sample dimensions/value');if(['snore','camera'].includes(data.kind)&&(sample<0||sample>1)||data.kind==='breathAudio'&&sample<0)throw Error('Invalid feature range');}
 return {...(data.origin==='synthetic'||data.origin==='device'?{origin:data.origin}:{}),version:1,channel:data.channel,kind:data.kind,unit:data.unit,t0:data.t0,fs:data.fs,samples:data.samples};
}
export function simulationPackets(frame){return Object.entries(sleepChannels).map(([kind,spec])=>({version:1,origin:'synthetic',channel:kind,kind,unit:spec.unit,t0:frame.t,fs:250,samples:[frame[kind]]}));}

function respirationEstimate(points){
 if(points.length<200)return null;const end=points.at(-1).t,start=Math.max(points[0].t,end-32),dt=.08,n=Math.floor((end-start)/dt);if(n<200)return null;
 // Resample only across short gaps; no interpolation across a disconnected sensor.
 let cursor=0;const values=[];
 for(let i=0;i<n;i++){const t=start+i*dt;while(cursor+1<points.length&&points[cursor+1].t<t)cursor++;const a=points[cursor],b=points[cursor+1];if(!b||b.t-a.t>.3)return null;values.push(a.v+(b.v-a.v)*(t-a.t)/(b.t-a.t));}
 const mean=values.reduce((a,b)=>a+b,0)/n;let slope=0,den=0;for(let i=0;i<n;i++){slope+=(i-(n-1)/2)*(values[i]-mean);den+=(i-(n-1)/2)**2;}slope/=den;
 const x=values.map((v,i)=>v-mean-slope*(i-(n-1)/2)),energy=x.reduce((a,v)=>a+v*v,0);if(energy/n<1e-8)return null;
 const minLag=Math.round(60/35/dt),maxLag=Math.min(Math.round(60/6/dt),Math.floor(n/2)),corr=[];
 for(let lag=minLag;lag<=maxLag;lag++){let ab=0,aa=0,bb=0;for(let i=0;i<n-lag;i++){ab+=x[i]*x[i+lag];aa+=x[i]*x[i];bb+=x[i+lag]*x[i+lag];}corr.push({lag,c:ab/Math.sqrt(aa*bb||1)});}
 const peaks=corr.filter((v,i)=>i>0&&i<corr.length-1&&v.c>corr[i-1].c&&v.c>=corr[i+1].c);if(!peaks.length)return null;
 const best=Math.max(...peaks.map(p=>p.c)),p=peaks.find(p=>p.c>=Math.max(.45,best*.93));if(!p)return null;
 const k=corr.indexOf(p),a=corr[k-1].c,b=p.c,c=corr[k+1].c,offset=clamp(.5*(a-c)/(a-2*b+c),-.5,.5);
 return {rr:60/((p.lag+offset)*dt),quality:clamp((p.c-.35)/.65,0,1),amplitude:Math.sqrt(energy/n),seconds:end-start};
}
export class SleepAnalysis{
 constructor(){this.channels=new Map();this.lastArtifact=-Infinity;this.lastAcc=null;this.lastCap=null;this.ecgBase=0;this.lastEcgTime=0;this.lastBeat=-Infinity;this.rrIntervals=[];this.events=[];this.rejected=0;}
 ingest(input){
  const p=validateSleepPacket(input);let channel=this.channels.get(p.channel);
  if(channel&&(channel.kind!==p.kind||p.t0<=channel.last)){this.rejected++;return false;}
  if(!channel){if(this.channels.size>=32)throw Error('Maximum 32 channels');channel={kind:p.kind,origin:p.origin||'unspecified',unit:p.unit,last:-Infinity,series:[],raw:[],received:0};this.channels.set(p.channel,channel);}
  for(let i=0;i<p.samples.length;i++){
   const t=p.t0+i/p.fs,s=p.samples[i],dt=1/p.fs;let v=Array.isArray(s)?s[0]:s;
   if(p.kind==='acc'){
    const magnitude=Math.hypot(...s);if(Math.abs(magnitude-9.80665)>.65)this.lastArtifact=t;
    channel.accFiltered??=[...s];const filtered=s.map((x,j)=>channel.accFiltered[j]+dt/(.10+dt)*(x-channel.accFiltered[j]));if(Math.hypot(...filtered.map((x,j)=>x-channel.accFiltered[j]))/dt>1.8)this.lastArtifact=t;channel.accFiltered=filtered;v=s[0];
   }
   if(p.kind==='cap'){
    v=(s[0]+s[1]+s[2])/3;
    channel.capFiltered??=v;const filtered=channel.capFiltered+dt/(.12+dt)*(v-channel.capFiltered);if(Math.abs(filtered-channel.capFiltered)/dt>2.5)this.lastArtifact=t;channel.capFiltered=filtered;
   }
   if(p.kind==='camera'&&s>.12)this.lastArtifact=t;
   if(p.kind==='radar')v=s[0];
   if(p.kind==='ecg')v=updateEcgDerived(channel,s,t,dt);
   channel.raw.push({t,value:s});
   if(!channel.series.length||t-channel.series.at(-1).t>=.035){channel.series.push({t,v});if(p.kind==='acc'){channel.axisSeries??=[[],[],[]];s.forEach((v,j)=>channel.axisSeries[j].push({t,v}));}}channel.last=t;
  }
  const cutoff=channel.last-65;while(channel.raw.length&&channel.raw[0].t<channel.last-12)channel.raw.shift();while(channel.series.length&&channel.series[0].t<cutoff)channel.series.shift();
  if(channel.axisSeries)for(const axis of channel.axisSeries)while(axis.length&&axis[0].t<cutoff)axis.shift();channel.received=Date.now();return true;
 }
 analyze(now,enabled={cap:true,ecg:false,acc:false,breathAudio:false,radar:false}){
  const artifact=now-this.lastArtifact<2.5,validAfter=this.lastArtifact+2.5,candidates=[];
  for(const [id,c]of this.channels){if(!enabled[c.kind]||now-c.last>.6)continue;let best=null;
   for(const [axis,series]of (c.kind==='acc'?c.axisSeries||[c.series]:[c.series]).entries()){const clean=series.filter(p=>p.t>validAfter),recent=clean.filter(p=>p.t>now-6);if(recent.length){const mean=recent.reduce((a,p)=>a+p.v,0)/recent.length,rms=Math.sqrt(recent.reduce((a,p)=>a+(p.v-mean)**2,0)/recent.length);if(c.kind==='cap'&&rms<.02||c.kind==='acc'&&rms<.01)continue;}const estimate=respirationEstimate(clean);if(estimate&&estimate.quality>.25&&(!best||estimate.quality>best.quality))best={id,kind:c.kind,...estimate,...(c.kind==='acc'?{axis:['X','Y','Z'][axis]}:{})};}if(best)candidates.push(best);
  }
  let rr=null,quality=0;const rates=candidates.map(c=>c.rr).sort((a,b)=>a-b),median=rates.length?rates[Math.floor(rates.length/2)]:0;
  const accepted=candidates.filter(c=>Math.abs(c.rr-median)<Math.max(2,median*.15));
  if(!artifact&&accepted.length){const sum=accepted.reduce((a,c)=>a+c.quality*c.quality,0);rr=accepted.reduce((a,c)=>a+c.rr*c.quality*c.quality,0)/sum;quality=accepted.reduce((a,c)=>a+c.quality,0)/accepted.length;}
  const hr=measuredHeartRate(this.channels.values(),now);
  // A rolling motion label gates all sensing modalities, including deselected ACC.
  return {rr,hr,quality,artifact,label:artifact?'artifact':rr===null?'warming':'respiration',candidates:candidates.map(c=>({...c,accepted:accepted.includes(c)})),validSeconds:Number.isFinite(validAfter)?Math.max(0,now-validAfter):now};
 }
}
