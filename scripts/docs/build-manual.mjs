import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
const sources=[['start','docs/manual/start.md'],['body','docs/manual/body.md'],['wrist','docs/manual/wrist.md'],['skin','docs/manual/skin.md'],['install','docs/operations/demo-guide.md']];
const chapters=[];await mkdir('public/manual',{recursive:true});
for(const [id,file] of sources){
 const text=await readFile(file,'utf8'),lines=text.split('\n'),title=lines.shift().replace(/^# /,'');
 const blocks=[];let paragraph=[],items=[];
 const flush=()=>{if(paragraph.length){blocks.push({type:'paragraph',text:paragraph.join(' ')});paragraph=[];}if(items.length){blocks.push({type:'list',items});items=[];}};
 for(const line of lines){if(line.startsWith('## ')){flush();blocks.push({type:'heading',text:line.slice(3)});}else if(/^(- |\d+\. )/.test(line)){if(paragraph.length)flush();items.push(line.replace(/^(- |\d+\. )/,''));}else if(!line.trim())flush();else{if(items.length)flush();paragraph.push(line);}}
 flush();chapters.push({id,title,blocks});await copyFile(file,`public/manual/${id}.md`);
}
await writeFile('app/manual/content.json',JSON.stringify(chapters,null,2)+'\n');
console.log(`Generated ${chapters.length} manual chapters.`);
