import {normalizeLanguage} from '../../../../../public/i18n/locale.js';
import documents from '../../../content.json';

export async function GET(_request: Request, {params}: {params: Promise<{collection: string; slug: string}>}) {
  const {collection, slug} = await params;
  const requested = new URL(_request.url).searchParams.get('lang');
  const language=normalizeLanguage(requested || _request.headers.get('cookie')?.match(/(?:^|;\s*)soma_language=(ko|en)(?:;|$)/)?.[1]);
  const original = documents.find(d => d.collection === collection && d.slug === slug);
  const doc=original && (language==='en'?{...original,...original.en}:original);
  if (!doc) return new Response(language==='en'?'Document not found.':'문서를 찾을 수 없습니다.', {status: 404, headers: {'Content-Type': 'text/plain; charset=utf-8'}});
  return new Response('\uFEFF' + doc.markdown, {headers: {
    'Content-Type': 'text/markdown; charset=utf-8',
    'Content-Disposition': `attachment; filename="${doc.slug}.md"`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Language': language,
    'Cache-Control': 'private, no-store',
    'Vary': 'Cookie',
  }});
}
