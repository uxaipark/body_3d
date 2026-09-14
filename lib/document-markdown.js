// A deliberately limited Markdown grammar for the bundled documentation.
// HTML stays text; only local document paths and HTTPS links are navigable.
/** @param {string} href @param {string} collection */
export function documentHref(href, collection) {
  if (/^https:\/\//i.test(href)) return href;
  if (/^#[^\s]*$/.test(href)) return href;
  const local = href.match(/^(?:\.\/)?([\w-]+)\.md(#[^\s]*)?$/);
  if (local) return `/documents/${collection}/${local[1]}${local[2] || ''}`;
  if (/^[\w.-]+\.json$/.test(href)) return collection === 'research' ? `/research/hand-wrist/${href}` : null;
  if (/^\/(?!\/)[\w/.-]+(?:#[^\s]*)?$/.test(href) && !href.split('/').includes('..')) return href;
  return null;
}

/** @param {string} text */
export function inlineTokens(text) {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^\s)]+\))/g;
  return text.split(pattern).filter(Boolean).map(part => {
    if (part.startsWith('`')) return {type: 'code', text: part.slice(1, -1)};
    if (part.startsWith('**')) return {type: 'strong', text: part.slice(2, -2)};
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    return link ? {type: 'link', text: link[1], href: link[2]} : {type: 'text', text: part};
  });
}

/** @param {string} markdown */
export function parseDocument(markdown) {
  const lines = markdown.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  const headingCounts = new Map();
  const heading = /^(#{1,6})\s+(.+)$/;
  const list = /^\s*(?:([-*])|([0-9]+)\.)\s+(.+)$/;
  const cells = (/** @type {string} */ line) => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
  const separator = line => line?.includes('|') && cells(line).every(c => /^:?-{3,}:?$/.test(c));
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('```')) {
      const language = line.slice(3).trim(); const code = []; i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push({type: 'code', text: code.join('\n'), language}); continue;
    }
    const h = line.match(heading);
    if (h) {
      const base = h[2].toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');
      const n = headingCounts.get(base) || 0; headingCounts.set(base, n + 1);
      blocks.push({type: 'heading', text: h[2], level: h[1].length, id: base + (n ? `-${n}` : '')}); i++; continue;
    }
    if (line.includes('|') && separator(lines[i + 1])) {
      const headers = cells(line), rows = []; i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(cells(lines[i++]));
      blocks.push({type: 'table', headers, rows}); continue;
    }
    const item = line.match(list);
    if (item) {
      const ordered = !!item[2], items = [], start = ordered ? Number(item[2]) : undefined;
      while (i < lines.length) {
        const next = lines[i].match(list);
        if (!next || !!next[2] !== ordered) break;
        items.push(next[3]); i++;
      }
      blocks.push({type: 'list', ordered, start, items}); continue;
    }
    const paragraph = [line]; i++;
    while (i < lines.length && lines[i].trim() && !heading.test(lines[i]) && !list.test(lines[i]) && !lines[i].startsWith('```') && !separator(lines[i + 1])) paragraph.push(lines[i++]);
    blocks.push({type: 'paragraph', text: paragraph.join(' ')});
  }
  return blocks;
}
