import type {ReactNode} from 'react';
import {notFound} from 'next/navigation';
import {ArrowLeft, Download} from 'lucide-react';
import {LabHeader} from '../../../simulator-nav';
import documents from '../../content.json';
import {documentHref, inlineTokens, parseDocument} from '../../../../lib/document-markdown.js';

type Props = {params: Promise<{collection: string; slug: string}>};
function Inline({text, collection}: {text: string; collection: string}): ReactNode {
  return inlineTokens(text).map((token, i) => {
    if (token.type === 'code') return <code key={i}>{token.text}</code>;
    if (token.type === 'strong') return <strong key={i}>{token.text}</strong>;
    if (token.type === 'link') {
      const href = documentHref(token.href!, collection);
      return href ? <a key={i} href={href} {...(href.startsWith('https:') ? {target: '_blank', rel: 'noopener noreferrer'} : {})}>{token.text}</a> : <span key={i}>{token.text}</span>;
    }
    return token.text;
  });
}
export async function generateMetadata({params}: Props) {
  const {collection, slug} = await params;
  const doc = documents.find(d => d.collection === collection && d.slug === slug);
  return {title: doc ? `${doc.title} | SOMA` : '문서를 찾을 수 없습니다 | SOMA'};
}
export default async function DocumentPage({params}: Props) {
  const {collection, slug} = await params;
  const doc = documents.find(d => d.collection === collection && d.slug === slug);
  if (!doc) notFound();
  const blocks = parseDocument(doc.markdown);
  const toc = blocks.filter(b => b.type === 'heading' && b.level !== 1);
  const back = collection === 'manual' ? '/manual' : '/research';
  return <main className="portal document-page"><LabHeader active={collection === 'manual' ? 'manual' : 'research'}/><div className="portal-content">
    <div className="document-toolbar"><a href={back}><ArrowLeft size={17}/>{collection === 'manual' ? '사용 매뉴얼' : '연구 기록'}</a><a href={`/documents/${collection}/${slug}/download`} download><Download size={17}/>Markdown 다운로드</a></div>
    <div className="document-layout"><aside className="document-toc"><nav aria-label="문서 목차">{toc.map(b => <a key={b.id} href={`#${b.id}`}>{b.text}</a>)}</nav></aside>
    <article className="document-content" lang="ko">{blocks.map((b, i) => {
      if (b.type === 'heading') {
        const Tag = `h${b.level}` as 'h1'|'h2'|'h3'|'h4'|'h5'|'h6';
        return <Tag key={i} id={b.id}><Inline text={b.text!} collection={collection}/></Tag>;
      }
      if (b.type === 'code') return <pre key={i}><code>{b.text}</code></pre>;
      if (b.type === 'table') return <div className="document-table" key={i} tabIndex={0} role="region" aria-label="가로로 스크롤 가능한 표"><table><thead><tr>{b.headers!.map((cell, j) => <th scope="col" key={j}><Inline text={cell} collection={collection}/></th>)}</tr></thead><tbody>{b.rows!.map((row, j) => <tr key={j}>{b.headers!.map((_, k) => <td key={k}><Inline text={row[k] || ''} collection={collection}/></td>)}</tr>)}</tbody></table></div>;
      if (b.type === 'list') {
        const items = b.items!.map((item, j) => <li key={j}><Inline text={item} collection={collection}/></li>);
        return b.ordered ? <ol key={i} start={b.start}>{items}</ol> : <ul key={i}>{items}</ul>;
      }
      return <p key={i}><Inline text={b.text!} collection={collection}/></p>;
    })}</article></div>
  </div></main>;
}
