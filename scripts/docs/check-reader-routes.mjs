import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const base = process.argv[2] || 'http://127.0.0.1:4393';
const documents = JSON.parse(await readFile('app/documents/content.json', 'utf8'));
for (const doc of documents) {
  const path = `/documents/${doc.collection}/${doc.slug}`;
  const response = await fetch(new URL(path, base));
  assert.equal(response.status, 200, path);
  assert.match(response.headers.get('content-type'), /text\/html.*charset=utf-8/i);
  const html = new TextDecoder('utf-8', {fatal: true}).decode(await response.arrayBuffer());
  assert.ok(html.includes('document-content') && !html.includes('__next_error__'), path);
  assert.ok(html.includes('lang="ko"') && html.includes(doc.title), path);
  assert.ok(!/\/Users\/|\/home\/|appg(?:prj|ver|dep)_|\uFFFD/.test(html), path);
  if (doc.markdown.includes('|---') || doc.markdown.includes('| ---')) assert.ok(html.includes('<table>'), path);
  const download = await fetch(new URL(`${path}/download`, base));
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-type'), /text\/markdown; charset=utf-8/i);
  assert.match(download.headers.get('content-disposition'), /attachment/);
  const bytes = new Uint8Array(await download.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [239, 187, 191], 'UTF-8 BOM');
  assert.equal(new TextDecoder('utf-8', {fatal: true}).decode(bytes), doc.markdown);
}
for (const path of ['/research', '/manual']) {
  const html = await (await fetch(new URL(path, base))).text();
  assert.ok(html.includes('/documents/'), `${path}: missing viewer links`);
  assert.ok(!/href="\/(?:research\/hand-wrist|manual)\/[^" ]+\.md"/.test(html), `${path}: raw Markdown navigation`);
}
assert.equal((await fetch(new URL('/documents/research/missing/download', base))).status, 404);
console.log(`PASS ${documents.length} web documents, UTF-8 downloads, navigation and missing document response.`);
