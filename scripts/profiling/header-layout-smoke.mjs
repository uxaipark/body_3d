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
 for(const language of ['ko','en'])for(const width of [1600,1000,375]){
  await send('Network.setCookie',{name:'soma_language',value:language,url:process.env.SOMA_TEST_URL||'http://localhost:3000',path:'/'});
  await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});let reference;
  for(const route of ['/','/simulators/body','/simulators/sleep','/simulators/wrist']){
   await send('Page.navigate',{url:(process.env.SOMA_TEST_URL||'http://localhost:3000')+route+'?lang='+language});
   for(let i=0;i<100;i++){if(await evaluate(`!!document.querySelector('[data-site-header] .render-quality-control select')?._dd`))break;await delay(150);if(i===99)throw Error('Header timeout '+route)}
   await evaluate('document.fonts.ready');await delay(200);if(await evaluate('document.documentElement.lang')!==language)throw Error('Wrong test locale');
   const layout=await evaluate(`(()=>{const h=document.querySelector('[data-site-header]'),nav=h.querySelector('nav'),q=h.querySelector('.render-quality-control'),lang=h.querySelector('.language-switch'),button=lang.querySelector('button');const box=e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height].map(n=>Math.round(n*10)/10)};return {header:box(h),nav:box(nav),quality:box(q),language:box(lang),button:box(button),font:getComputedStyle(button).fontSize,background:getComputedStyle(h).backgroundColor,count:document.querySelectorAll('[data-site-header]').length}})()`);
   if(layout.quality[2]<100||layout.count!==1||layout.quality[0]+layout.quality[2]>layout.language[0]+1||Math.abs(layout.quality[1]+layout.quality[3]/2-layout.language[1]-layout.language[3]/2)>1)throw Error('Header alignment '+JSON.stringify({route,width,layout}));
   if(reference&&JSON.stringify(layout)!==JSON.stringify(reference))throw Error('Header differs '+JSON.stringify({route,width,language,reference,layout}));reference=layout;
   console.log(JSON.stringify({route,width,language,layout}));
  }
 }

 if(errors.length)throw Error(errors.join('\n'));console.log('All four headers match at desktop, tablet and mobile widths in Korean and English');
}finally{ws?.close();chrome.kill();await new Promise(r=>chrome.once('exit',r));await rm(profile,{recursive:true,force:true})}
