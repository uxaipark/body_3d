
import {getServerLanguage} from '../../../../lib/i18n/server';
import {L} from '../../../language';
import type {ReactNode} from 'react';
import {notFound} from 'next/navigation';
import {ArrowLeft, Download} from 'lucide-react';
import {LabHeader} from '../../../simulator-nav';
import documents from '../../content.json';
import {documentHref, inlineTokens, parseDocument} from '../../../../lib/document-markdown.js';

type Props = {params: Promise<{collection: string; slug: string}>};
function Inline({text, collection}: {text: string; collection: string}): ReactNode {
  return inlineTokens(text).map((token, i) => {
    if (token.type === 'code') return <L as="code" key={i}>{token.text}</L>;
    if (token.type === 'strong') return <L as="strong" key={i}>{token.text}</L>;
    if (token.type === 'link') {
      const href = documentHref(token.href!, collection);
      return href ? <L as="a" key={i} href={href} {...(href.startsWith('https:') ? {target: '_blank', rel: 'noopener noreferrer'} : {})}>{token.text}</L> : <L as="span" key={i}>{token.text}</L>;
    }
    return token.text;
  });
}
export async function generateMetadata({params}: Props) {
  const {collection, slug} = await params;
  const language=await getServerLanguage();
  const original = documents.find(d => d.collection === collection && d.slug === slug);
  const doc=original && (language==='en'?{...original,...original.en}:original);
  return {title: doc ? `${doc.title} | SOMA` : (language==='en'?'Document not found | SOMA':'문서를 찾을 수 없습니다 | SOMA')};
}
export default async function DocumentPage({params}: Props) {
  const {collection, slug} = await params;
  const language=await getServerLanguage();
  const original = documents.find(d => d.collection === collection && d.slug === slug);
  const doc=original && (language==='en'?{...original,...original.en}:original);
  if (!doc) notFound();
  const blocks = parseDocument(doc.markdown);
  const toc = blocks.filter(b => b.type === 'heading' && b.level !== 1);
  const back = collection === 'manual' ? '/manual' : '/research';
  return <L as="main" className="portal document-page"><LabHeader active={collection === 'manual' ? 'manual' : 'research'}/><L as="div" className="portal-content">
    <L as="div" className="document-toolbar"><L as="a" href={back}><ArrowLeft size={17}/>{collection === 'manual' ? '사용 매뉴얼' : '연구 기록'}</L><L as="a" href={`/documents/${collection}/${slug}/download`} download><Download size={17}/>Markdown 다운로드</L></L>
    <L as="div" className="document-layout"><L as="aside" className="document-toc"><L as="nav" aria-label="문서 목차">{toc.map(b => <L as="a" key={b.id} href={`#${b.id}`}>{b.text}</L>)}</L></L>
    <L as="article" className="document-content" lang={language}>{blocks.map((b, i) => {
      if (b.type === 'heading') {
        const Tag = `h${b.level}` as 'h1'|'h2'|'h3'|'h4'|'h5'|'h6';
        return <Tag key={i} id={b.id}><Inline text={b.text!} collection={collection}/></Tag>;
      }
      if (b.type === 'code') return <L as="pre" key={i}><L as="code">{b.text}</L></L>;
      if (b.type === 'table') return <L as="div" className="document-table" key={i} tabIndex={0} role="region" aria-label="가로로 스크롤 가능한 표"><L as="table"><L as="thead"><L as="tr">{b.headers!.map((cell, j) => <L as="th" scope="col" key={j}><Inline text={cell} collection={collection}/></L>)}</L></L><L as="tbody">{b.rows!.map((row, j) => <L as="tr" key={j}>{b.headers!.map((_, k) => <L as="td" key={k}><Inline text={row[k] || ''} collection={collection}/></L>)}</L>)}</L></L></L>;
      if (b.type === 'list') {
        const items = b.items!.map((item, j) => <L as="li" key={j}><Inline text={item} collection={collection}/></L>);
        return b.ordered ? <L as="ol" key={i} start={b.start}>{items}</L> : <L as="ul" key={i}>{items}</L>;
      }
      return <L as="p" key={i}><Inline text={b.text!} collection={collection}/></L>;
    })}</L></L>
  </L></L>;
}
