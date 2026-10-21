// /sitemap.xml built from published articles only (RLS hides drafts and
// scheduled articles from the public key, so they can never appear here).
import { env, rest } from '../shared/supabase.ts';

export default async (request: Request) => {
  const e = env();
  const origin = e?.site || new URL(request.url).origin;
  const posts = (await rest<{ slug: string; updated_at: string }[]>('posts?select=slug,updated_at&order=published_at.desc&limit=5000')) ?? [];
  const cats = (await rest<{ slug: string }[]>('categories?select=slug')) ?? [];
  const urls = [
    `<url><loc>${origin}/blog</loc></url>`,
    ...cats.map((c) => `<url><loc>${origin}/blog/category/${c.slug}</loc></url>`),
    ...posts.map((p) => `<url><loc>${origin}/blog/${p.slug}</loc><lastmod>${p.updated_at.slice(0, 10)}</lastmod></url>`),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=300' } });
};
