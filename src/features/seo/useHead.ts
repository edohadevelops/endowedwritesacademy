import { useEffect } from 'react';
import { useSite } from '@/context/SiteContext';

export interface HeadOptions {
  title?: string;
  description?: string;
  path?: string;
  image?: string | null;
  type?: 'website' | 'article';
  publishedAt?: string | null;
  updatedAt?: string | null;
  author?: string;
  noindex?: boolean;
  jsonLd?: Record<string, unknown> | null;
}

function setMeta(attr: 'name' | 'property', key: string, value: string | null | undefined) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!value) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', value);
}

/**
 * Client-side head tags. Crawlers that don't run JavaScript get the same
 * tags from the Netlify edge function (netlify/edge-functions/article-meta.ts)
 * once the site reads from Supabase.
 */
export function useHead(o: HeadOptions) {
  const { settings } = useSite();
  const site = settings.siteName;
  const origin = settings.seo.siteUrl || window.location.origin;
  const key = JSON.stringify(o);

  useEffect(() => {
    const fullTitle = o.title ? `${o.title} | ${site}` : `${site} | ${settings.tagline}`;
    const description = o.description || settings.seo.defaultDescription;
    const url = `${origin}${o.path ?? window.location.pathname}`;
    const image = o.image && /^https?:/.test(o.image) ? o.image : null;

    document.title = fullTitle;
    setMeta('name', 'description', description);
    setMeta('name', 'robots', o.noindex ? 'noindex, nofollow' : 'index, follow');
    setMeta('property', 'og:site_name', site);
    setMeta('property', 'og:title', o.title ?? site);
    setMeta('property', 'og:description', description);
    setMeta('property', 'og:type', o.type ?? 'website');
    setMeta('property', 'og:url', url);
    setMeta('property', 'og:image', image);
    setMeta('property', 'article:published_time', o.publishedAt ?? null);
    setMeta('property', 'article:modified_time', o.updatedAt ?? null);
    setMeta('name', 'twitter:card', image ? 'summary_large_image' : 'summary');
    setMeta('name', 'twitter:title', o.title ?? site);
    setMeta('name', 'twitter:description', description);

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = url;

    document.getElementById('ld-json')?.remove();
    if (o.jsonLd) {
      const s = document.createElement('script');
      s.type = 'application/ld+json';
      s.id = 'ld-json';
      s.textContent = JSON.stringify(o.jsonLd);
      document.head.appendChild(s);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, site, origin]);
}
