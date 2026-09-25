// Run from web/: node scripts/profiling/body-profile.mjs
// Uses an isolated headless Chrome profile; does not touch the user's browser.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm,stat,mkdir,writeFile,readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir,cpus,platform,arch} from 'node:os';
import {join,resolve} from 'node:path';
import WebSocket from 'ws';
import {createHash} from 'node:crypto';
import {bodySourceHash} from '../body-source-hash.mjs';
const baking=Boolean(process.env.BAKE_ASSETS),bundle=await build({entryPoints:[baking?'scripts/profiling/bake-body-browser.ts':'scripts/profiling/body-browser.ts'],bundle:true,write:false,format:'esm',minify:true,target:'es2022'});
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;
 if(baking&&req.method==='POST'&&(path==='/bake'||path==='/bake-manifest')){const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);await mkdir('public/models/body',{recursive:true});
  if(path==='/bake'){const file=createHash('sha256').update(bytes).digest('hex').slice(0,24)+'.bin.gz';await writeFile(`public/models/body/${file}`,bytes);res.end(JSON.stringify({file}));return}
  const manifest=JSON.parse(bytes);manifest.source=await bodySourceHash();await writeFile('public/models/body/manifest.json',JSON.stringify(manifest));
  const keep=new Set(manifest.parts.flatMap(p=>[p.file,p.detail]));for(const file of await readdir('public/models/body'))if(/^[a-f0-9]{24}\.bin\.gz$/.test(file)&&!keep.has(file))await rm('public/models/body/'+file);
  res.end('{}');return;
 }
 const data=path==='/'?'<script type="module" src="/profile.js"></script>':path==='/profile.js'?bundle.outputFiles[0].contents:await readFile(resolve('public','.'+path));res.setHeader('Content-Type',path==='/'?'text/html':path.endsWith('.js')?'application/javascript':path.endsWith('.wasm')?'application/wasm':'application/octet-stream');res.end(data)}catch(error){console.error(error.message);res.statusCode=404;res.end()}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
const profile=await mkdtemp(join(tmpdir(),'soma-body-profile-'));
const executable=process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome=spawn(executable,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--window-size=1100,1000','about:blank'],{stdio:['ignore','ignore','pipe']});
let ws;
try{
 const endpoint=await new Promise((resolve,reject)=>{let text='';const timeout=setTimeout(()=>reject(Error('Chrome startup timeout')),20000);chrome.on('error',reject);chrome.stderr.on('data',b=>{text+=b;const m=text.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timeout);resolve(m[1])}})});
 const targets=await (await fetch(`http://${new URL(endpoint).host}/json/list`)).json();ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.on('open',r));let id=0;const pending=new Map();ws.on('message',raw=>{const data=JSON.parse(raw);if(data.id){const p=pending.get(data.id);pending.delete(data.id);data.error?p.reject(data.error):p.resolve(data.result)}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const request=++id;pending.set(request,{resolve,reject});ws.send(JSON.stringify({id:request,method,params}))});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 await send('Page.enable');await send('Page.navigate',{url:`http://127.0.0.1:${port}/`});
 for(let i=0;i<240;i++){if(await evaluate('Boolean(window.profileBody)'))break;await new Promise(r=>setTimeout(r,500));if(i===239)throw Error('Scene load timeout')}
 console.log(JSON.stringify(await evaluate('window.profileResults'),null,2));
 if(baking){console.log('Precomputed anatomy saved');}
 else if(process.env.POSE_QA){
  await mkdir('outputs/axilla',{recursive:true});
  for(const mode of ['wave','dance']){
   await evaluate(`(()=>{const s=window.anatomyScene;s.running=false;s.params.motion='${mode}';s.setLayers({skin:100,dermis:0,adipose:0,cardiovascular:0,visceral:0,nervous:0,skeleton:0,muscular:0});let best=-Infinity,time=0;for(let t=0;t<10;t+=.1){s.rig.poseExpression('${mode}',t);const h=s.rig.bone('hand.r').matrixWorld.elements[13];if(h>best){best=h;time=t}}s.rig.poseExpression('${mode}',time);s.skinRig.copyPose(s.rig);s.camera.position.set(0,1.25,2.2);s.controls.target.set(0,1.2,0);s.controls.update();s.renderer.render(s.scene,s.camera)})()`);
   await new Promise(r=>setTimeout(r,500));const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(`outputs/axilla/${mode}.png`,Buffer.from(shot.data,'base64'));
   await evaluate('window.anatomyScene.setLayers({skin:12,dermis:0,adipose:0,cardiovascular:0,visceral:0,nervous:100,skeleton:0,muscular:0})');await new Promise(r=>setTimeout(r,500));const nerves=await send('Page.captureScreenshot',{format:'png'});await writeFile(`outputs/axilla/${mode}-nerves.png`,Buffer.from(nerves.data,'base64'));
  }
  console.log('Pose captures: outputs/axilla');
 }else{
 for(const [label,options] of [['balanced-cache',{}],['balanced-no-cache',{cache:false}],['high-cache',{quality:'high'}],['high-no-cache',{quality:'high',cache:false}],['low',{quality:'low',dpr:.85}],['paused',{paused:true}],['balanced-repeat',{}]]){console.log(JSON.stringify(await evaluate(`window.profileBody(${JSON.stringify(label)},${JSON.stringify(options)})`)))}
 const results=await evaluate('window.profileResults');results.environment={date:new Date().toISOString(),cpu:cpus()[0].model,platform:platform(),arch:arch(),browser:await send('Browser.getVersion'),viewport:'1000x850 CSS pixels',scope:'AnatomyScene only; no React panels; headless local Chrome; not target laptop; GPU query results only if extension available'};
 const manifest=JSON.parse(await readFile('public/models/body/manifest.json','utf8'));results.assets=await Promise.all(manifest.parts.map(async p=>({layer:p.layer,region:p.region,initialBytes:(await stat(`public/models/body/${p.file}`)).size,detailBytes:p.detail?(await stat(`public/models/body/${p.detail}`)).size:0})));
 await mkdir('outputs/profiling',{recursive:true});await writeFile('outputs/profiling/body-profile.json',JSON.stringify(results,null,2));
 }
}finally{ws?.close();chrome.kill();server.close();await new Promise(r=>chrome.once('exit',r));await rm(profile,{recursive:true,force:true})}
