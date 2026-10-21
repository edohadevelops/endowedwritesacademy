import { env } from '../shared/supabase.ts';

export default (request: Request) => {
  const origin = env()?.site || new URL(request.url).origin;
  const body = `User-agent: *\nDisallow: /admin\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`;
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
};
