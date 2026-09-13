import {readFile,writeFile,mkdir} from 'node:fs/promises';
const sources=[['start','docs/manual/start.md'],['body','docs/manual/body.md'],['wrist','docs/manual/wrist.md'],['skin','docs/manual/skin.md'],['install','docs/operations/demo-guide.md']];
const check=process.argv.includes('--check');
async function output(file,text){
 if(check){if(await readFile(file,'utf8').catch(()=>null)!==text)throw new Error(`Manual is out of date: ${file}. Run npm run docs:build.`);}
 else await writeFile(file,text);
}
const chapters=[];if(!check)await mkdir('public/manual',{recursive:true});
for(const [id,file] of sources){
 const text=await readFile(file,'utf8'),lines=text.split('\n'),title=lines.shift().replace(/^# /,'');
 const blocks=[];let paragraph=[],items=[];
 const flush=()=>{if(paragraph.length){blocks.push({type:'paragraph',text:paragraph.join(' ')});paragraph=[];}if(items.length){blocks.push({type:'list',items});items=[];}};
 for(const line of lines){if(line.startsWith('## ')){flush();blocks.push({type:'heading',text:line.slice(3)});}else if(/^(- |\d+\. )/.test(line)){if(paragraph.length)flush();items.push(line.replace(/^(- |\d+\. )/,''));}else if(!line.trim())flush();else{if(items.length)flush();paragraph.push(line);}}
 flush();chapters.push({id,title,blocks});await output(`public/manual/${id}.md`,text);
}
await output('app/manual/content.json',JSON.stringify(chapters,null,2)+'\n');
console.log(`${check?'Verified':'Generated'} ${chapters.length} manual chapters.`);
