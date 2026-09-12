import test from'node:test';import assert from'node:assert/strict';
import {smoothCapture}from'../scripts/mocap-filter.mjs';
test('cyclic smoothing removes fast jitter without delaying the stride',()=>{
 const n=120,frames=Array.from({length:n},(_,i)=>{
  const phase=2*Math.PI*i/n,angle=.4*Math.sin(phase)+.05*Math.sin(phase*18);
  const sign=i%2?-1:1;
  return [0,.92+.04*Math.sin(phase)+.005*Math.sin(phase*18),0,0,0,sign*Math.sin(angle/2),sign*Math.cos(angle/2)];
 });
 const result=smoothCapture(frames,1,.05);
 const harmonic=(values,k)=>{
  let sin=0,cos=0;values.forEach((v,i)=>{sin+=v*Math.sin(2*Math.PI*i/n*k)*2/n;cos+=v*Math.cos(2*Math.PI*i/n*k)*2/n;});return {amplitude:Math.hypot(sin,cos),phase:Math.atan2(cos,sin)};
 };
 const heights=result.map(f=>f[1]),angles=result.map(f=>2*Math.atan2(f[5]*Math.sign(f[6]),Math.abs(f[6])));
 for(const [values,stride,jitter]of [[heights,.04,.005],[angles,.4,.05]]){
  assert.ok(harmonic(values,1).amplitude>stride*.94);
  assert.ok(harmonic(values,18).amplitude<jitter*.02);
  assert.ok(Math.abs(harmonic(values,1).phase)<1e-6);
 }
 for(const f of result)assert.ok(Math.abs(Math.hypot(...f.slice(3))-1)<1e-9);
 // The boundary has the same small velocity change as the rest of the cycle.
 assert.ok(Math.abs(heights[1]-2*heights[0]+heights.at(-1))<1e-6);
});
