// Run with the local app on port 3000; isolated Chrome verifies real UI quality changes.
import {mkdtemp,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import WebSocket from 'ws';
const profile=await mkdtemp(join(tmpdir(),'soma-body-profile-'));
const executable=process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome=spawn(executable,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--window-size=1100,1000','about:blank'],{stdio:['ignore','ignore','pipe']});
let ws;
try{
 const endpoint=await new Promise((resolve,reject)=>{let text='';const timeout=setTimeout(()=>reject(Error('Chrome startup timeout')),20000);chrome.on('error',reject);chrome.stderr.on('data',b=>{text+=b;const m=text.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timeout);resolve(m[1])}})});
 const targets=await (await fetch(`http://${new URL(endpoint).host}/json/list`)).json();ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.on('open',r));let id=0;const pending=new Map();ws.on('message',raw=>{const data=JSON.parse(raw);if(data.id){const p=pending.get(data.id);pending.delete(data.id);data.error?p.reject(data.error):p.resolve(data.result)}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const request=++id;pending.set(request,{resolve,reject});ws.send(JSON.stringify({id:request,method,params}))});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1400,height:1000,deviceScaleFactor:2,mobile:false});const errors=[];ws.on('message',raw=>{const data=JSON.parse(raw);if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails.text+': '+data.params.exceptionDetails.exception?.description)});
 const delay=ms=>new Promise(r=>setTimeout(r,ms));
 for(const route of ['/simulators/sleep','/simulators/radial/index.html?theme=dark&wrist3d=A']){
  await send('Page.navigate',{url:(process.env.SOMA_TEST_URL||'http://localhost:3000')+route});
  for(let i=0;i<100;i++){if(await evaluate(`!!document.querySelector('select') && (!document.querySelector('#renderQuality') || !!document.querySelector('#renderQuality')._dd) && !!document.querySelector('canvas') && !document.querySelector('.sleep-loading,.soma-load')`))break;await delay(300);if(i===99)throw Error('Load timeout '+route+' '+JSON.stringify({errors,body:await evaluate('document.body.innerText.slice(0,1800)')}))}
  const selector=route.includes('/sleep')?'.render-quality-control select':'#renderQuality';
  for(const quality of ['low','high','balanced']){
   await evaluate(`(()=>{const s=document.querySelector('${selector}');if(!s)throw Error('Quality selector missing');s.value='${quality}';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);await delay(1600);if(await evaluate("localStorage.getItem('soma.body.quality')")!==quality)throw Error('Selection not saved: '+route+' '+quality);
   console.log(JSON.stringify({route,quality,state:await evaluate(`({saved:localStorage.getItem('soma.body.quality'),canvases:[...document.querySelectorAll('canvas')].filter(c=>c.clientWidth>100).map(c=>({width:c.width,css:c.clientWidth})).slice(0,3),status:document.querySelector('#renderQualityStatus')?.textContent})`)}));
  }
 }
 if(errors.length)throw Error(errors.join('\n'));console.log('Sleep and wrist runtime smoke passed');
}finally{ws?.close();chrome.kill();await new Promise(r=>chrome.once('exit',r));await rm(profile,{recursive:true,force:true})}
