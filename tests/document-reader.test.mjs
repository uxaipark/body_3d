import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {documentHref, inlineTokens, parseDocument} from '../lib/document-markdown.js';

test('document reader retains Korean, scientific symbols, tables and fenced code', () => {
  const blocks = parseDocument('\uFEFF# 한글 SpO₂\r\n\r\n## 표\r\n| 조직 | 변화 |\r\n| --- | --- |\r\n| 동맥 | Δr → µm |\r\n\r\n```\r\n<h1>text, not HTML</h1>\r\n```\r\n\r\n3. 한글\r\n4. 다음');
  assert.equal(blocks[0].text, '한글 SpO₂');
  assert.deepEqual(blocks.find(b => b.type === 'table').rows, [['동맥', 'Δr → µm']]);
  assert.equal(blocks.find(b => b.type === 'code').text, '<h1>text, not HTML</h1>');
  assert.equal(blocks.find(b => b.type === 'list').start, 3);
  assert.deepEqual(parseDocument('## 같은 제목\n## 같은 제목').map(b => b.id), ['같은-제목', '같은-제목-1']);
});

test('document links use the web reader and reject unsafe or private destinations', () => {
  assert.equal(documentHref('03-anatomy.md', 'research'), '/documents/research/03-anatomy');
  assert.equal(documentHref('wrist.md#회전', 'manual'), '/documents/manual/wrist#회전');
  assert.equal(documentHref('scenario.example.json', 'research'), '/research/hand-wrist/scenario.example.json');
  for (const link of ['javascript:alert(1)', 'data:text/html,x', 'file:///private/document', '//example.test', '../private.md', '/../../private']) assert.equal(documentHref(link, 'research'), null);
  assert.equal(inlineTokens('<script>alert(1)</script>')[0].type, 'text');
});

test('all bundled documents decode strictly as UTF-8 and exclude private implementation records', async () => {
  const docs = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(await readFile(new URL('../app/documents/content.json', import.meta.url))));
  assert.equal(docs.filter(d => d.collection === 'research').length, 10);
  assert.equal(docs.filter(d => d.collection === 'manual').length, 6);
  for (const doc of docs) {
    assert.ok(doc.markdown.includes(doc.title));
    assert.ok(!/\uFFFD|\/Users\/|\/home\/|[A-Z]:\\Users\\|appg(?:prj|ver|dep)_|\b[\da-f]{40}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(doc.markdown), doc.slug);
  }
});
