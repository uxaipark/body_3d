// Run against the built Worker (npm run build, then npm start -- --port 4320).
// The dev server does not reproduce Worker-only module initialization failures.
import assert from 'node:assert/strict';

const base = new URL(process.argv[2] || 'http://localhost:4320');
const routes = [
  ['/', '어떤 실험을 시작할까요?'],
  ['/simulators/body', '전신 3D 해부학 모델'],
  ['/simulators/wrist', 'wrist-simulator-frame'],
  ['/research', '구현의 기록, 다음 실험의 설계.'],
];
for (const [path, content] of routes) {
  const response = await fetch(new URL(path, base), {redirect: 'manual'});
  assert.equal(response.status, 200, `${path}: HTTP ${response.status}`);
  const html = await response.text();
  assert.ok(!html.includes('__next_error__'), `${path}: server error shell`);
  assert.ok(html.includes(content), `${path}: missing workspace content`);
  for (const [destination] of routes) {
    assert.ok(html.includes(`href="${destination}"`), `${path}: missing menu link ${destination}`);
  }
  console.log(`PASS ${path}: workspace content and navigation destinations`);
}
