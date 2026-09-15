import {readFile,writeFile,mkdir} from 'node:fs/promises';
const sources=[['start','docs/manual/start.md'],['body','docs/manual/body.md'],['sleep','docs/manual/sleep.md'],['wrist','docs/manual/wrist.md'],['skin','docs/manual/skin.md'],['install','docs/operations/demo-guide.md']];
const check=process.argv.includes('--check');
async function output(file,text){
 if(check){if(await readFile(file,'utf8').catch(()=>null)!==text)throw new Error(`Manual is out of date: ${file}. Run npm run docs:build.`);}
 else await writeFile(file,text);
}
const chapters=[];if(!check)await mkdir('public/manual/en',{recursive:true});
function parse(text){
 const lines=text.split('\n'),title=lines.shift().replace(/^# /,'');
 const blocks=[];let paragraph=[],items=[];
 const flush=()=>{if(paragraph.length){blocks.push({type:'paragraph',text:paragraph.join(' ')});paragraph=[];}if(items.length){blocks.push({type:'list',items});items=[];}};
 for(const line of lines){if(line.startsWith('## ')){flush();blocks.push({type:'heading',text:line.slice(3)});}else if(/^(- |\d+\. )/.test(line)){if(paragraph.length)flush();items.push(line.replace(/^(- |\d+\. )/,''));}else if(!line.trim())flush();else{if(items.length)flush();paragraph.push(line);}}
 flush();return {title,blocks};
}
const decoder=new TextDecoder('utf-8',{fatal:true});
for(const [id,file] of sources){
 const enFile=id==='install'?'docs/operations/demo-guide.en.md':`docs/manual/en/${id}.md`;
 const text=decoder.decode(await readFile(file)),english=decoder.decode(await readFile(enFile));
 if(text.includes('\uFFFD')||english.includes('\uFFFD'))throw new Error(`Invalid replacement character: ${file}`);
 chapters.push({id,...parse(text),en:parse(english)});
 await output(`public/manual/${id}.md`,text);
 await output(`public/manual/en/${id}.md`,english);
}
await output('app/manual/content.json',JSON.stringify(chapters,null,2)+'\n');
console.log(`${check?'Verified':'Generated'} ${chapters.length} manual chapters.`);
