import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,copyFile,writeFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
const root=path.resolve(process.argv[2]);
const platform=process.platform==='darwin'?'macOS.command':'Linux.sh';
const result=spawnSync('bash',[path.join(root,`Start-${platform}`),'--port','3000'],{encoding:'utf8',timeout:20000});
assert.equal(result.status,1);assert.match(result.stderr,/already in use/);
assert.equal((await fetch('http://127.0.0.1:3000')).status,200,'occupied server survives');
const badPort=spawnSync('bash',[path.join(root,`Start-${platform}`),'--port','-1'],{encoding:'utf8',timeout:20000});
assert.equal(badPort.status,1);assert.match(badPort.stderr,/Port must/);
const broken=await mkdtemp(path.join(os.tmpdir(),'SOMA damaged demo '));
try{
 const manifest=JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8'));
 const first=Object.keys(manifest.files)[0];
 await mkdir(path.join(broken,'runtime'),{recursive:true});await mkdir(path.dirname(path.join(broken,first)),{recursive:true});
 await copyFile(path.join(root,'runtime/runner.mjs'),path.join(broken,'runtime/runner.mjs'));
 await writeFile(path.join(broken,'manifest.json'),JSON.stringify(manifest));await writeFile(path.join(broken,first),'damaged');
 const run=spawnSync(process.execPath,[path.join(broken,'runtime/runner.mjs'),'install'],{encoding:'utf8',timeout:10000});
 assert.equal(run.status,1);assert.match(run.stderr,/changed or damaged/);
}finally{await rm(broken,{recursive:true,force:true});}
console.log('PASS occupied port preserves server, invalid port rejection, corrupt bundle rejection, paths with spaces.');
