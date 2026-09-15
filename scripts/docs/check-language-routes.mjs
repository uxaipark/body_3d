import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const base=process.argv[2]||'http://localhost:4393';
const docs=JSON.parse(await readFile('app/documents/content.json','utf8'));
let checked=0;
for(const language of ['en','ko','en']){
 const headers={cookie:`soma_language=${language}`};
 for(const path of ['/','/simulators/body','/simulators/wrist','/research','/manual',...docs.map(d=>`/documents/${d.collection}/${d.slug}`)]){
  const response=await fetch(base+path,{headers});assert.equal(response.status,200,path);
  const html=await response.text();assert.ok(html.includes(`<html lang="${language}">`),path);
  const visible=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/g,'').replace(/<[^>]+>/g,' ');
  assert.ok(!visible.includes('\uFFFD'),path);
  if(language==='en')assert.ok(!/[가-힣]/.test(visible.replaceAll('한국어','')),`${path}: untranslated English output`);
  else assert.match(visible,/전신 트윈|사용 매뉴얼|연구 기록/,path);
  checked++;
 }
 for(const doc of docs){
  const response=await fetch(`${base}/documents/${doc.collection}/${doc.slug}/download`,{headers});assert.equal(response.status,200);
  assert.equal(response.headers.get('content-language'),language);
  assert.match(response.headers.get('content-type'),/charset=utf-8/);
  const bytes=new Uint8Array(await response.arrayBuffer());assert.deepEqual([...bytes.slice(0,3)],[239,187,191]);
  assert.equal(new TextDecoder('utf-8',{fatal:true}).decode(bytes),language==='en'?doc.en.markdown:doc.markdown);
  checked++;
 }
}
const response=await fetch(`${base}/documents/manual/start/download?lang=en`,{headers:{cookie:'soma_language=ko'}});assert.equal(response.headers.get('content-language'),'en');
console.log(`Verified ${checked+1} bilingual page/download responses, cookie isolation, numeric symbols and UTF-8 BOM.`);
