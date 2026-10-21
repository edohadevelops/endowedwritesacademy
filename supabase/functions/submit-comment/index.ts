// Public comment endpoint (Supabase Edge Function, Deno).
//
// The only way a visitor can create a comment. It validates input, checks the
// article is public and open for comments, applies rate limits by a salted
// hash of the caller's IP, runs the shared abuse checks, and writes with the
// service role. The browser never gets write access to the comments table.
//
// Deploy:  supabase functions deploy submit-comment   (verify_jwt = false is set in supabase/config.toml)
// Secrets: supabase secrets set COMMENT_IP_SALT=<random string> ALLOWED_ORIGINS=https://your-site
// SUPABASE_URL and the secret key are provided by the platform automatically:
// SUPABASE_SECRET_KEYS (new API keys, JSON) or SUPABASE_SERVICE_ROLE_KEY (legacy).

import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { validateComment, assessComment, LIMITS } from '../_shared/moderation.ts';

const allowed = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

function cors(origin: string | null): Record<string, string> {
  const ok = origin && (allowed.length === 0 || allowed.includes(origin));
  return {
    'Access-Control-Allow-Origin': ok ? origin! : allowed[0] ?? '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info',
    Vary: 'Origin',
  };
}

/** The server-side key: new-style secret key if present, else the legacy service_role key. */
function secretKey(): string {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (keys) {
    try {
      const parsed = JSON.parse(keys) as Record<string, string>;
      if (parsed.default) return parsed.default;
      const first = Object.values(parsed)[0];
      if (first) return first;
    } catch { /* fall through */ }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}

const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, 'content-type': 'application/json' } });

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const headers = cors(origin);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, headers);
  if (allowed.length && origin && !allowed.includes(origin)) return json({ error: 'forbidden' }, 403, headers);

  let input: { postId?: string; name?: string; body?: string; website?: string; elapsedMs?: number };
  try {
    const raw = await req.text();
    if (raw.length > 10_000) return json({ error: 'too_large' }, 413, headers);
    input = JSON.parse(raw);
  } catch {
    return json({ error: 'invalid_json' }, 400, headers);
  }
  if (typeof input.postId !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.postId)) return json({ error: 'not_found' }, 404, headers);

  const v = validateComment({ name: String(input.name ?? ''), body: String(input.body ?? '') });
  if (!v.ok) return json({ error: 'validation', fields: v.errors }, 422, headers);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), { auth: { persistSession: false } });

  const { data: post } = await db
    .from('posts')
    .select('id, status, published_at, deleted_at, comments_enabled')
    .eq('id', input.postId)
    .maybeSingle();
  const visible = post && post.status === 'published' && !post.deleted_at && new Date(post.published_at).getTime() <= Date.now();
  if (!visible) return json({ error: 'not_found' }, 404, headers);

  const { data: site } = await db.from('site_settings').select('settings').eq('id', 1).single();
  const commentsOn = (site?.settings as { comments?: { enabled?: boolean } } | null)?.comments?.enabled !== false;
  if (!commentsOn || !post.comments_enabled) return json({ error: 'closed' }, 403, headers);

  // Rate limit per salted IP hash. Records older than a day are purged here.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const ipHash = await sha256(`${Deno.env.get('COMMENT_IP_SALT') ?? ''}:${ip}`);
  const since = new Date(Date.now() - LIMITS.rateWindowMs).toISOString();
  const { count } = await db.from('comment_rate_events').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', since);
  if ((count ?? 0) >= LIMITS.rateMax) return json({ error: 'rate_limited' }, 429, headers);
  await db.from('comment_rate_events').insert({ ip_hash: ipHash });
  await db.from('comment_rate_events').delete().lt('created_at', new Date(Date.now() - 86_400_000).toISOString());

  const { data: mod } = await db.from('moderation_settings').select('blocked_terms, mode').eq('id', 1).single();
  const verdict = assessComment(
    { name: v.clean.name, body: v.clean.body, website: input.website, elapsedMs: input.elapsedMs },
    v.clean,
    mod?.blocked_terms ?? [],
  );
  // Bots get an ordinary-looking reply and nothing is stored.
  if (verdict.action === 'reject') return json({ status: 'pending' }, 200, headers);

  const status = verdict.action === 'spam' ? 'spam' : verdict.action === 'clean' && mod?.mode === 'flagged' ? 'approved' : 'pending';
  const { error } = await db.from('comments').insert({
    post_id: post.id,
    author_name: v.clean.name,
    body: v.clean.body,
    status,
    flags: verdict.action === 'clean' ? [] : verdict.flags,
  });
  if (error) return json({ error: 'server' }, 500, headers);
  return json({ status: status === 'approved' ? 'approved' : 'pending' }, 200, headers);
});
