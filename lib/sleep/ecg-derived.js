const median=a=>{const v=[...a].sort((a,b)=>a-b),m=v.length>>1;return v.length%2?v[m]:(v[m-1]+v[m])/2;};
/** Causal ECG-only extraction. No respiratory/heart-rate truth enters here.
 * Cascaded 200/600 ms medians reject QRS/T morphology before baseline EDR.
 * A polarity-independent high-pass detector adapts to the measured QRS level. */
export function updateEcgDerived(c,s,t,dt){
 if(c.lastEcg!==undefined&&t-c.lastEcg>.3){delete c.ecgFast;delete c.edrA;delete c.edrB;delete c.edrSlow;delete c.edrValue;delete c.edrSample;delete c.beat;c.intervals=[];c.envelope=0;}
 c.lastEcg=t;c.ecgFast??=s;c.ecgFast+=dt/(.035+dt)*(s-c.ecgFast);const qrs=Math.abs(s-c.ecgFast);c.envelope=Math.max(qrs,(c.envelope||0)*Math.exp(-dt/2));
 if(qrs>Math.max(.018,c.envelope*.45)&&t-(c.beat??-Infinity)>.4){if(c.beat!==undefined){const interval=t-c.beat;if(interval>.4&&interval<2){c.intervals??=[];c.intervals.push(interval);if(c.intervals.length>8)c.intervals.shift();}}c.beat=t;}
 if(c.edrSample===undefined||t-c.edrSample>=.019){const h=c.edrSample===undefined?.02:Math.min(.1,t-c.edrSample);c.edrSample=t;c.edrA??=[];c.edrB??=[];c.edrA.push({t,v:s});while(c.edrA[0].t<t-.2)c.edrA.shift();c.edrB.push({t,v:median(c.edrA.map(p=>p.v))});while(c.edrB[0].t<t-.6)c.edrB.shift();const baseline=median(c.edrB.map(p=>p.v));c.edrSlow??=baseline;c.edrSlow+=h/(3.2+h)*(baseline-c.edrSlow);c.edrValue??=0;c.edrValue+=h/(.12+h)*(baseline-c.edrSlow-c.edrValue);}
 return c.edrValue??0;
}
export function measuredHeartRate(channels,now){
 const candidates=[...channels].filter(c=>c.kind==='ecg'&&now-(c.beat??-Infinity)<3&&(c.intervals?.length??0)>=2);
 for(const c of candidates.sort((a,b)=>b.envelope-a.envelope)){const center=median(c.intervals),valid=c.intervals.filter(v=>Math.abs(v-center)<center*.2);if(valid.length>=Math.ceil(c.intervals.length*.65))return 60/(valid.reduce((a,b)=>a+b,0)/valid.length);}
 return null;
}
