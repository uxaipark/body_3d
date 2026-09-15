// Run from web/: npm run build && npm run demo:prepare -- /path/to/soma-demo
import {cp,readFile,writeFile,mkdir,rm,readdir,chmod,lstat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const out=path.resolve(process.argv[2]||path.join(root,'../demo/soma-demo'));
if(out===root||root.startsWith(out+path.sep)||out.startsWith(root+path.sep))throw new Error('Use a separate demo directory outside the source checkout.');
let prior;try{prior=JSON.parse(await readFile(path.join(out,'manifest.json'),'utf8'));}catch{}
try{const names=await readdir(out);if(names.length&&!prior?.somaDemo)throw new Error('Destination is not an existing SOMA demo; choose an empty directory.');}catch(e){if(e.code!=='ENOENT')throw e;}
await readFile(path.join(root,'dist/server/index.js'));await mkdir(out,{recursive:true});
// Replace generated application/runtime only; retain this machine's installed dependencies.
for(const dir of ['dist','runtime','docs','scripts','lib']){await rm(path.join(out,dir),{recursive:true,force:true});await mkdir(path.join(out,dir),{recursive:true});}
for(const dir of ['server','client'])await cp(path.join(root,'dist',dir),path.join(out,'dist',dir),{recursive:true,filter:src=>!['.wrangler','.openai','.git'].includes(path.basename(src))&&!/^\.(env|dev\.vars)(\.|$)/.test(path.basename(src))});
await mkdir(path.join(out,'scripts/sleep'),{recursive:true});await mkdir(path.join(out,'lib/sleep'),{recursive:true});
await cp(path.join(root,'scripts/sleep/gateway.mjs'),path.join(out,'scripts/sleep/gateway.mjs'));await cp(path.join(root,'lib/sleep/model.js'),path.join(out,'lib/sleep/model.js'));
const built=JSON.parse(await readFile(path.join(root,'dist/server/wrangler.json'),'utf8'));
const config={name:'soma-local-demo',main:'index.js',compatibility_date:built.compatibility_date,compatibility_flags:built.compatibility_flags,no_bundle:true,rules:[{type:'ESModule',globs:['**/*.js','**/*.mjs']}],assets:{directory:'../client'},dev:{ip:'127.0.0.1',port:3000},observability:{enabled:false}};
await writeFile(path.join(out,'dist/server/wrangler.json'),JSON.stringify(config,null,2)+'\n');
for(const name of ['package.json','package-lock.json'])await cp(path.join(root,'scripts/demo/runtime',name),path.join(out,name));
for(const name of ['bootstrap.sh','bootstrap.ps1','runner.mjs','node-version.txt','node-shasums.txt'])await cp(path.join(root,'scripts/demo/runtime',name),path.join(out,'runtime',name));
await cp(path.join(root,'docs/operations/demo-guide.md'),path.join(out,'README.md'));
await cp(path.join(root,'docs/operations/demo-validation.md'),path.join(out,'VALIDATION.md'));
await cp(path.join(root,'docs'),path.join(out,'docs'),{recursive:true});
await cp(path.join(root,'public/models/ATTRIBUTION.md'),path.join(out,'ATTRIBUTION.md'));
for(const action of ['Install','Start','Verify']){
 const verb=action.toLowerCase();
 for(const [os,ext] of [['macOS','command'],['Linux','sh']]){
  const name=`${action}-${os}.${ext}`;
  const expected=os==='macOS'?'Darwin':'Linux';
  const script=`#!/usr/bin/env bash\nset -euo pipefail\nif [ "$(uname -s)" != "${expected}" ]; then echo 'Use the launcher for your operating system.' >&2; exit 1; fi\nSOMA_ROOT="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"\nexec bash "$SOMA_ROOT/runtime/bootstrap.sh" ${verb} "$@"\n`;
  await writeFile(path.join(out,name),script);await chmod(path.join(out,name),0o755);
 }
 const cmd=`@echo off\r\nsetlocal\r\npowershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0runtime\\bootstrap.ps1" -Action ${verb} %*\r\nset "SOMA_EXIT=%ERRORLEVEL%"\r\nif not "%SOMA_EXIT%"=="0" (\r\n  echo SOMA failed. Review the message above.\r\n  if not defined SOMA_NONINTERACTIVE pause\r\n)\r\nexit /b %SOMA_EXIT%\r\n`;
 await writeFile(path.join(out,`${action}-Windows.cmd`),cmd);
}
await chmod(path.join(out,'runtime/bootstrap.sh'),0o755);
const files={};async function walk(dir){for(const name of (await readdir(dir)).sort()){if(['.runtime','node_modules','manifest.json'].includes(name))continue;const file=path.join(dir,name),stat=await lstat(file);if(stat.isSymbolicLink())throw new Error(`Unexpected symlink: ${file}`);if(stat.isDirectory())await walk(file);else files[path.relative(out,file).split(path.sep).join('/')]=createHash('sha256').update(await readFile(file)).digest('hex');}}
// Only generated payload roots enter the manifest; unrelated local files never ship.
for(const name of ['dist','runtime','docs','scripts','lib'])await walk(path.join(out,name));
for(const name of ['README.md','ATTRIBUTION.md','VALIDATION.md','package.json','package-lock.json',...['Install','Start','Verify'].flatMap(action=>[`${action}-macOS.command`,`${action}-Linux.sh`,`${action}-Windows.cmd`])])files[name]=createHash('sha256').update(await readFile(path.join(out,name))).digest('hex');
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
await writeFile(path.join(out,'manifest.json'),JSON.stringify({somaDemo:true,generatedAt:new Date().toISOString(),sourceCommit:commit,files},null,2)+'\n');
console.log(`Prepared ${out} (${Object.keys(files).length} verified files).`);
