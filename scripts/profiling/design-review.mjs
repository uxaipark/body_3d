// Run with the local app on port 3000; isolated Chrome verifies real UI quality changes.
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
 await send('Network.setCookie',{name:'soma_language',value:process.env.SOMA_LANGUAGE||'ko',url:process.env.SOMA_TEST_URL||'http://localhost:3000',path:'/'});
 await mkdir('outputs/design',{recursive:true});
 for(const width of [1440,390])for(const [name,route]of [['home','/'],['body','/simulators/body'],['sleep','/simulators/sleep'],['wrist','/simulators/wrist'],['research','/research'],['manual','/manual'],['reader','/documents/manual/body']]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:(process.env.SOMA_TEST_URL||'http://localhost:3000')+route});
  for(let i=0;i<100;i++){if(await evaluate(`!!document.querySelector('[data-site-header] .render-quality-control select')?._dd`))break;await delay(100);if(i===99)throw Error('UI timeout '+route)}
  await evaluate('document.fonts.ready');await delay(1000);
  const state=await evaluate(`({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,title:document.querySelector('h1')?.textContent,headingColor:getComputedStyle(document.querySelector('h1')||document.body).color})`);
  if(state.scroll>width+1)throw Error('Page overflow '+route+' '+width+' '+JSON.stringify(state));
  const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile('outputs/design/'+name+'-'+width+'-'+(process.env.SOMA_LANGUAGE||'ko')+'.png',Buffer.from(shot.data,'base64'));console.log(JSON.stringify({name,width,...state}));
 }

 if(errors.length)throw Error(errors.join('\n'));console.log('All page design captures complete');
}finally{ws?.close();chrome.kill();await new Promise(r=>chrome.once('exit',r));await rm(profile,{recursive:true,force:true})}
