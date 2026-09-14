import documents from '../../../content.json';

export async function GET(_request: Request, {params}: {params: Promise<{collection: string; slug: string}>}) {
  const {collection, slug} = await params;
  const doc = documents.find(d => d.collection === collection && d.slug === slug);
  if (!doc) return new Response('문서를 찾을 수 없습니다.', {status: 404, headers: {'Content-Type': 'text/plain; charset=utf-8'}});
  return new Response('\uFEFF' + doc.markdown, {headers: {
    'Content-Type': 'text/markdown; charset=utf-8',
    'Content-Disposition': `attachment; filename="${doc.slug}.md"`,
    'X-Content-Type-Options': 'nosniff',
  }});
}
