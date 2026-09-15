import test from 'node:test';import assert from 'node:assert/strict';
import{SleepGenerator,SleepAnalysis,sleepDefaults,simulationPackets,sleepPose,validateSleepPacket}from'../lib/sleep/model.js';
function simulate(seconds,settings={},mode='supine'){const g=new SleepGenerator(),a=new SleepAnalysis();let f;for(let i=0;i<seconds*250;i++){f=g.step(.004,{...sleepDefaults,...settings},sleepPose(g.time,mode));for(const p of simulationPackets(f))a.ingest(p);}return {g,a,f};}
test('CAP-only respiration follows measured periods at 8, 14 and 24/min; optional fusion and ECG heart rate use acquired samples',()=>{
 for(const rr of [8,14,24]){const {g,a}=simulate(45,{rr});let result=a.analyze(g.time);assert.equal(result.artifact,false);assert.ok(Math.abs(result.rr-rr)<.3);assert.ok(Math.abs(result.hr-62)<2);result=a.analyze(g.time,{cap:true,ecg:true,acc:true,breathAudio:true,radar:true});assert.ok(Math.abs(result.rr-rr)<.5);assert.ok(result.candidates.length>=3);assert.equal(a.analyze(g.time,{cap:false,ecg:false,acc:false,breathAudio:false,radar:false}).rr,null);}
});
test('lung mechanics distinguishes persistent obstructed effort from absent central drive',()=>{
 for(const scenario of ['obstructive','central']){const {f}=simulate(36,{scenario});assert.equal(f.truth.event,true);assert.ok(Math.abs(f.airflow)<.04);if(scenario==='obstructive')assert.ok(f.truth.effort>.05);else{assert.equal(f.truth.effort,0);assert.ok(f.truth.volume<.001);}}
 const {f}=simulate(45);assert.ok(f.cap.every(c=>c>8&&c<40));assert.ok(f.truth.excursion>=0&&f.truth.excursion<.012);
});
test('turns are artifacts, stationary data is usable, disconnected streams cannot preserve a stale rate',()=>{
 const {a,g}=simulate(45);assert.ok(a.analyze(g.time).rr);assert.equal(a.analyze(g.time+2).rr,null);
 const turned=simulate(6,{},'turn');assert.equal(turned.a.analyze(turned.g.time).artifact,true);assert.equal(turned.a.analyze(turned.g.time).rr,null);
 let maxSpeed=0;for(let t=0;t<64;t+=.01)maxSpeed=Math.max(maxSpeed,Math.abs((sleepPose(t+.01,'turn').roll-sleepPose(t,'turn').roll)/.01));assert.ok(maxSpeed<1);assert.ok(Math.abs(sleepPose(0,'turn').roll-sleepPose(64,'turn').roll)<1e-6);
});
test('socket contract rejects units, nonfinite values, malformed dimensions and nonmonotonic channel times',()=>{
 const valid={version:1,channel:'patch-1',kind:'cap',unit:'pF',t0:1,fs:25,samples:[[12,13,14]]};assert.deepEqual(validateSleepPacket(valid),valid);
 for(const override of [{unit:'F'},{samples:[[1,2]]},{samples:[[1,2,NaN]]},{t0:-1},{fs:0},{kind:'__proto__'},{version:2}])assert.throws(()=>validateSleepPacket({...valid,...override}));
 const a=new SleepAnalysis();assert.ok(a.ingest(valid));assert.equal(a.ingest(valid),false);assert.equal(a.rejected,1);assert.ok(a.ingest({...valid,channel:'patch-2'}));assert.equal(a.channels.size,2);
});
