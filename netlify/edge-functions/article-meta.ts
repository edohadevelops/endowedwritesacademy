// Injects article-specific <title>, description, Open Graph, Twitter and
// JSON-LD tags into the SPA's HTML for /blog/<slug>, so link previews and
// crawlers that don't run JavaScript still see the right article.
import type { Context } from '@netlify/edge-functions';
import { env, rest, escapeHtml, type PublicPost } from '../shared/supabase.ts';

export default async (request: Request, context: Context) => {
  const url = new URL(request.url);
  const m = url.pathname.match(/^\/blog\/([a-z0-9-]+)\/?$/);
  if (!m || m[1] === 'category' || m[1] === 'tag' || !env()) return context.next();

  const [response, posts, settingsRows] = await Promise.all([
    context.next(),
    rest<PublicPost[]>(`posts?slug=eq.${m[1]}&select=title,slug,excerpt,seo_title,seo_description,featured_image,published_at,updated_at,author_name&limit=1`),
    rest<{ settings: { siteName?: string } }[]>('site_settings?select=settings&id=eq.1'),
  ]);
  const post = posts?.[0];
  const type = response.headers.get('content-type') ?? '';
  if (!post || !type.includes('text/html')) return response;

  const e = env()!;
  const siteName = settingsRows?.[0]?.settings?.siteName ?? 'Endowed Academy';
  const origin = e.site || url.origin;
  const canonical = `${origin}/blog/${post.slug}`;
  const title = post.seo_title || post.title;
  const description = post.seo_description || post.excerpt;
  const image = post.featured_image?.src && /^https:/.test(post.featured_image.src) ? post.featured_image.src : '';
  const ld = {
    '@context': 'https://schema.org', '@type': 'Article', headline: post.title, description,
    datePublished: post.published_at, dateModified: post.updated_at,
    author: { '@type': 'Person', name: post.author_name }, publisher: { '@type': 'Organization', name: siteName },
    mainEntityOfPage: canonical, ...(image ? { image: [image] } : {}),
  };
  const tags = [
    `<title>${escapeHtml(title)} | ${escapeHtml(siteName)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    `<meta property="og:type" content="article" />`,
    `<meta property="og:site_name" content="${escapeHtml(siteName)}" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    image ? `<meta property="og:image" content="${escapeHtml(image)}" />` : '',
    `<meta property="article:published_time" content="${escapeHtml(post.published_at)}" />`,
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />`,
    `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`,
  ].join('\n    ');

  let html = await response.text();
  html = html
    .replace(/<title>[\s\S]*?<\/title>/, '')
    .replace(/<meta name="description"[^>]*>/, '')
    .replace('</head>', `    ${tags}\n  </head>`);
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'public, max-age=0, must-revalidate');
  return new Response(html, { status: response.status, headers });
};
