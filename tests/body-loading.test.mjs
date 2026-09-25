import {test} from 'node:test';
import assert from 'node:assert/strict';
import {orderedBatches,bodyLoadParts} from '../lib/body-loading.js';
test('bounded downloads retain manifest order despite out-of-order completion',async()=>{
 let active=0,max=0;const signal=new AbortController().signal,seen=[];
 const load=async i=>{max=Math.max(max,++active);await new Promise(r=>setTimeout(r,(8-i)*2));active--;return i*10;};
 for await(const result of orderedBatches([0,1,2,3,4,5,6,7],load,signal,4))seen.push(result);
 assert.equal(max,4);assert.deepEqual(seen.map(x=>x.value),[0,10,20,30,40,50,60,70]);
});
test('abort prevents later batches and aborts pending requests',async()=>{
 const controller=new AbortController();let started=0,aborted=0;
 const load=(_,signal)=>new Promise((resolve,reject)=>{started++;signal.addEventListener('abort',()=>{aborted++;reject(signal.reason)},{once:true});});
 const run=(async()=>{for await(const ignored of orderedBatches([0,1,2,3,4,5],load,controller.signal,4))void ignored})();
 controller.abort();await assert.rejects(run);assert.equal(started,4);assert.equal(aborted,4);
});
test('download failure cancels its peers without starting the next batch',async()=>{
 let peer;const run=(async()=>{for await(const ignored of orderedBatches([0,1,2],async(i,signal)=>{peer=signal;if(i===0)throw Error('network');return i},new AbortController().signal,2))void ignored})();
 await assert.rejects(run,/network/);assert.equal(peer.aborted,true);
});
test('sleep omits nerves but preserves skin, organs, vessels, bones and muscles in order',()=>{
 const parts=['skin','visceral','nervous','cardiovascular','skeleton','muscular'].map(layer=>({layer}));
 assert.deepEqual(bodyLoadParts(parts),parts);
 assert.deepEqual(bodyLoadParts(parts,'sleep').map(p=>p.layer),['skin','visceral','cardiovascular','skeleton','muscular']);
});
