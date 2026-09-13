import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {createWriteStream,existsSync} from 'node:fs';
import {createServer} from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const [action='start',...args]=process.argv.slice(2);
const options={port:3000,host:'127.0.0.1'};
function fail(message){throw new Error(message);}
for(let i=0;i<args.length;i+=2){const key=args[i];if(!['--port','--host'].includes(key)||args[i+1]===undefined)fail('Use --port 3000 --host 127.0.0.1');options[key.slice(2)]=args[i+1];}
options.port=Number(options.port);
if(!Number.isInteger(options.port)||options.port<1024||options.port>65535)fail('Port must be an integer between 1024 and 65535.');
if(!['127.0.0.1','0.0.0.0'].includes(options.host))fail('Host must be 127.0.0.1 (local) or 0.0.0.0 (LAN).');
const env={...process.env,CI:'1',WRANGLER_SEND_METRICS:'false',CLOUDFLARE_SEND_METRICS:'false',WRANGLER_WRITE_LOGS:'false',WRANGLER_LOG_PATH:path.join(root,'.runtime','logs'),MINIFLARE_REGISTRY_PATH:path.join(root,'.runtime','registry')};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function integrity(){
 const manifest=JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8'));
 for(const [name,expected] of Object.entries(manifest.files)){
  if(path.isAbsolute(name)||name.split('/').includes('..'))fail('Invalid manifest path.');
  const actual=hash(await readFile(path.join(root,name)));
  if(actual!==expected)fail(`Demo file changed or damaged: ${name}. Extract a fresh bundle.`);
 }
 return manifest;
}
async function run(binary,argv){
 await new Promise((resolve,reject)=>{const child=spawn(binary,argv,{cwd:root,env,stdio:'inherit'});child.on('error',reject);child.on('exit',(code,signal)=>code===0?resolve():reject(new Error(`Command failed (${code??signal}).`)));});
}
async function install(){
 const version=(await readFile(path.join(root,'runtime/node-version.txt'),'utf8')).trim();
 if(process.version!==version)fail(`Use the OS installer: this demo uses Node.js ${version}.`);
 const lock=await readFile(path.join(root,'package-lock.json'));
 const stamp=path.join(root,'.runtime','dependencies.json'),key=`${process.platform}-${process.arch}-${process.version}-${hash(lock)}`;
 let ready=false;try{ready=JSON.parse(await readFile(stamp,'utf8')).key===key;}catch{}
 if(ready&&existsSync(path.join(root,'node_modules/wrangler/bin/wrangler.js'))){console.log('Dependencies already installed.');return;}
 const prefix=path.dirname(process.execPath);
 const npm=process.platform==='win32'?path.join(prefix,'node_modules/npm/bin/npm-cli.js'):path.resolve(prefix,'../lib/node_modules/npm/bin/npm-cli.js');
 await access(npm);console.log('Installing locked server packages...');
 await run(process.execPath,[npm,'ci','--no-audit','--no-fund']);
 await writeFile(stamp,JSON.stringify({key,installedAt:new Date().toISOString()},null,2));
}
async function portAvailable(){await new Promise((resolve,reject)=>{const probe=createServer();probe.once('error',()=>reject(new Error(`Port ${options.port} is already in use or unavailable. Choose another --port; no existing server was stopped.`)));probe.listen(options.port,options.host,()=>probe.close(resolve));});}
function server(log){
 const argv=[path.join(root,'node_modules/wrangler/bin/wrangler.js'),'dev','--local','--config',path.join(root,'dist/server/wrangler.json'),'--ip',options.host,'--port',String(options.port),'--inspector-port','0','--show-interactive-dev-session=false','--log-level','warn'];
 const child=spawn(process.execPath,argv,{cwd:root,env,detached:process.platform!=='win32',stdio:log?['ignore','pipe','pipe']:'inherit'});
 if(log){child.stdout.pipe(log);child.stderr.pipe(log);}
 child.on('error',e=>console.error(e.message));return child;
}
async function stop(child){
 if(!child.pid)return;
 if(process.platform==='win32'){try{execFileSync('taskkill',['/pid',String(child.pid),'/T','/F'],{stdio:'ignore'});}catch{}}
 else {try{process.kill(-child.pid,'SIGTERM');}catch{}}
 await Promise.race([new Promise(resolve=>child.exitCode!==null||child.signalCode?resolve():child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,4000))]);
 if(child.exitCode===null&&!child.signalCode&&process.platform!=='win32'){try{process.kill(-child.pid,'SIGKILL');}catch{}}
}
const url=`http://127.0.0.1:${options.port}`;
async function get(route){const res=await fetch(url+route,{signal:AbortSignal.timeout(20000)});if(res.status!==200)fail(`${route}: HTTP ${res.status}`);return res;}
async function verify(){
 await portAvailable();const logPath=path.join(root,'.runtime','verification-server.log'),log=createWriteStream(logPath);
 const child=server(log),started=Date.now(),checks=[];
 const shutdown=()=>{void stop(child).then(()=>process.exit(130));};process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
 try{
  let ready=false;
  while(Date.now()-started<60000){if(child.exitCode!==null||child.signalCode)fail(`Server exited during startup. See ${logPath}`);try{await get('/');ready=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,500));}}
  if(!ready)fail(`Server did not become ready. See ${logPath}`);
  for(const [route,needle] of [['/','어떤 실험을 시작할까요?'],['/simulators/body','전신 3D 해부학 모델'],['/simulators/wrist','wrist-simulator-frame'],['/research','구현의 기록'],['/manual','사용 매뉴얼'],['/simulators/radial/','Radial Artery Digital Twin']]){
   const html=await (await get(route)).text();if(!html.includes(needle)||html.includes('__next_error__'))fail(`${route}: missing content or server error shell`);
   for(const match of html.matchAll(/<script[^>]+src="([^"]+)"/g)){const asset=match[1].replaceAll('&amp;','&');if(asset.startsWith('/'))await get(asset);}
   checks.push({route,status:'passed'});console.log(`PASS ${route}`);
  }
  for(const route of ['/models/wrist/atlas.glb','/models/skin-atlas-web.glb']){const b=new Uint8Array(await (await get(route)).arrayBuffer());if(new TextDecoder().decode(b.slice(0,4))!=='glTF')fail(`Invalid model: ${route}`);checks.push({route,bytes:b.length,status:'passed'});console.log(`PASS ${route} (${b.length} bytes)`);}
  const wasm=await (await get('/simulators/radial/js/analysis/dt_core.wasm')).arrayBuffer();await WebAssembly.compile(wasm);checks.push({route:'/simulators/radial/js/analysis/dt_core.wasm',status:'compiled'});console.log('PASS signal analysis WebAssembly compilation');
  const controls=await (await get('/simulators/radial/js/viewInteraction.js')).text();if(!controls.includes('dragWristCamera'))fail('Wrist interaction module missing.');
  const report={status:'passed',date:new Date().toISOString(),platform:process.platform,architecture:process.arch,node:process.version,checks,browserRendering:'not tested'};
  await writeFile(path.join(root,'.runtime','verification.json'),JSON.stringify(report,null,2));console.log('PASS local demo verification. Report: .runtime/verification.json');
 }finally{await stop(child);log.end();process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);}
}
try{
 if(!['install','start','verify'].includes(action))fail('Expected install, start or verify.');
 await mkdir(path.join(root,'.runtime'),{recursive:true});await integrity();await install();
 if(action==='install')console.log('SOMA is ready. Run the Start launcher.');
 else if(action==='verify')await verify();
 else{
  await portAvailable();console.log(`SOMA: ${url}\nStop: Ctrl+C`);const child=server();
  let stopping=false;const shutdown=()=>{if(stopping)return;stopping=true;void stop(child).then(()=>process.exit(0));};process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
  child.once('exit',code=>{if(!stopping)process.exit(code??1);});
 }
}catch(error){console.error(`SOMA: ${error.message}`);process.exitCode=1;}
