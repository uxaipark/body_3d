import {readdir, readFile, access} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';

// Check repository-relative inline Markdown links. External URLs and heading
// anchors are intentionally outside this check's scope.
async function markdownFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await markdownFiles(path));
    else if (entry.name.endsWith('.md')) files.push(path);
  }
  return files;
}

const files = ['README.md', ...await markdownFiles('docs'), ...await markdownFiles('public')];
const errors = [];
let links = 0;
for (const file of files) {
  const content = (await readFile(file, 'utf8')).replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
  for (const match of content.matchAll(/\[[^\]\n]*\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"\n]*")?\)/g)) {
    const href = match[1].replace(/^<|>$/g, '');
    if (/^(?:[a-z][\w+.-]*:|\/|#)/i.test(href)) continue;
    const path = decodeURIComponent(href.split(/[?#]/)[0]);
    if (!path) continue;
    links++;
    try { await access(resolve(dirname(file), path)); }
    catch { errors.push(`${file}: missing link target ${href}`); }
  }
}
for (const file of await markdownFiles('scripts')) errors.push(`${file}: move documentation into docs and update links`);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else console.log(`Verified ${files.length} Markdown files, ${links} relative file links; scripts contains no Markdown.`);
