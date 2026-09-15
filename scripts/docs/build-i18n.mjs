import {readFile, writeFile, mkdir} from 'node:fs/promises';
const catalog = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(await readFile('locales/en.json')));
const text = '// Generated from locales/en.json.\nexport const english = '+JSON.stringify(catalog)+';\n';
await mkdir('public/i18n',{recursive:true});
if(process.argv.includes('--check')) {if(await readFile('public/i18n/messages.js','utf8')!==text)throw Error('Run npm run docs:build to update translations.');}
else await writeFile('public/i18n/messages.js',text);
console.log(`English UI catalog: ${Object.keys(catalog).length} entries.`);
