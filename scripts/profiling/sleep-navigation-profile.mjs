// Measure real full-document transitions into Sleep. Run against a production build.
// SOMA_TEST_URL defaults to localhost:3000; CHROME_PATH overrides the browser binary.
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
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
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__long=[];new PerformanceObserver(l=>window.__long.push(...l.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});`});
 const results=[];
 for(const from of (process.env.SOMA_FROM?.split(',')||['/','/simulators/body','/simulators/wrist'])){
 await send('Page.navigate',{url:(process.env.SOMA_TEST_URL||'http://localhost:3000')+from});await delay(12000);
 const started=Date.now();await evaluate(`document.querySelector('a[href="/simulators/sleep"]').click()`);
 let shell=null,ready=null;
 for(let i=0;i<900;i++){await delay(100);let state;try{state=await evaluate(`({sleep:!!document.querySelector('.sleep-anatomy'),loading:document.querySelector('.sleep-loading')?.textContent})`)}catch{continue}if(state.sleep&&shell===null)shell=Date.now()-started;if(state.sleep&&!state.loading){ready=Date.now()-started;break}}
 const data=await evaluate(`({navigation:performance.getEntriesByType('navigation').map(e=>({type:e.type,ttfb:e.responseStart,dcl:e.domContentLoadedEventEnd,load:e.loadEventEnd})),resources:performance.getEntriesByType('resource').filter(e=>e.name.includes('/models/')||e.name.includes('/chunks/')).map(e=>({name:e.name.split('/').pop(),start:e.startTime,duration:e.duration,bytes:e.transferSize,decoded:e.decodedBodySize})),long:window.__long})`);
 results.push({from,shell,ready,...data});console.log(JSON.stringify(results.at(-1)));}
 await writeFile('outputs/sleep-navigation-profile.json',JSON.stringify(results,null,2));
 if(errors.length)throw Error(errors.join('\n'));console.log('All page design captures complete');
}finally{ws?.close();chrome.kill();await new Promise(r=>chrome.once('exit',r));await rm(profile,{recursive:true,force:true})}
