// Read-only helpers for Netlify Edge Functions. Uses the PUBLIC (publishable)
// Supabase key, so RLS guarantees only published articles are ever returned.

export interface PublicPost {
  title: string;
  slug: string;
  excerpt: string;
  seo_title: string;
  seo_description: string;
  featured_image: { src?: string; alt?: string } | null;
  published_at: string;
  updated_at: string;
  author_name: string;
}

export function env() {
  const url = Netlify.env.get('VITE_SUPABASE_URL') ?? Netlify.env.get('SUPABASE_URL');
  const key = Netlify.env.get('VITE_SUPABASE_PUBLISHABLE_KEY') ?? Netlify.env.get('SUPABASE_PUBLISHABLE_KEY');
  const site = (Netlify.env.get('SITE_URL') ?? '').replace(/\/+$/, '');
  return url && key ? { url, key, site } : null;
}

export async function rest<T>(path: string): Promise<T | null> {
  const e = env();
  if (!e) return null;
  // Publishable keys go in the apikey header only (they are not JWTs).
  const res = await fetch(`${e.url}/rest/v1/${path}`, { headers: { apikey: e.key } });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
