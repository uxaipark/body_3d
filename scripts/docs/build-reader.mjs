import {readFile, readdir, writeFile, mkdir} from 'node:fs/promises';

const check = process.argv.includes('--check');
const documents = [];
for (const [collection, directory] of [['research', 'public/research/hand-wrist'], ['manual', 'public/manual']]) {
  for (const file of (await readdir(directory)).filter(f => f.endsWith('.md')).sort()) {
    const markdown = new TextDecoder('utf-8', {fatal: true}).decode(await readFile(`${directory}/${file}`)).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    if (markdown.includes('\uFFFD')) throw new Error(`Invalid replacement character in ${directory}/${file}`);
    documents.push({collection, slug: file.slice(0, -3), title: markdown.match(/^# (.+)$/m)?.[1] || file, markdown});
  }
}
const file = 'app/documents/content.json';
const content = JSON.stringify(documents, null, 2) + '\n';
if (check) {
  if (await readFile(file, 'utf8').catch(() => null) !== content) throw new Error('Document reader is out of date. Run npm run docs:build.');
} else {
  await mkdir('app/documents', {recursive: true});
  await writeFile(file, content, 'utf8');
}
console.log(`${check ? 'Verified' : 'Generated'} ${documents.length} UTF-8 reader documents.`);
