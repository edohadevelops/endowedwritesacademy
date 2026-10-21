// submit-comment: single-file version for the Supabase dashboard editor.
// Edge Functions → Deploy a new function → Via Editor, name it "submit-comment",
// paste this whole file, deploy, then turn OFF "Enforce JWT verification".
// (Generated from supabase/functions/submit-comment + src/features/comments/moderation.ts.)

import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

// ---------------- comment rules (moderation.ts) ----------------
// Comment validation and abuse checks.
//
// Pure TypeScript with no browser or Node APIs so the exact same module can
// run in the Supabase Edge Function (Deno) that will accept public comments.
// Regex matching is a first filter, not a hate-speech classifier: anything
// uncertain goes to the moderator instead of being silently dropped.

export const LIMITS = {
  nameMin: 2,
  nameMax: 60,
  bodyMin: 3,
  bodyMax: 2000,
  maxLinks: 2,
  /** Submissions faster than this after the form loaded are treated as bots. */
  minFillMs: 2500,
  rateWindowMs: 10 * 60 * 1000,
  rateMax: 4,
} as const;

export interface CommentInput {
  name: string;
  body: string;
  /** Hidden field; humans leave it empty. */
  website?: string;
  /** ms between form render and submit. */
  elapsedMs?: number;
}

export interface ValidationResult {
  ok: boolean;
  errors: { name?: string; body?: string; form?: string };
  clean: { name: string; body: string };
}

/** Collapse whitespace, strip control/zero-width characters. Output is plain text. */
export function cleanText(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[​-‍⁠﻿]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function validateComment(input: CommentInput): ValidationResult {
  const name = cleanText(input.name ?? '').replace(/\n/g, ' ');
  const body = cleanText(input.body ?? '');
  const errors: ValidationResult['errors'] = {};

  if (name.length < LIMITS.nameMin) errors.name = 'Enter your name.';
  else if (name.length > LIMITS.nameMax) errors.name = `Keep your name under ${LIMITS.nameMax} characters.`;
  else if (/https?:|www\.|<|>/i.test(name)) errors.name = 'Names can’t contain links or HTML.';

  if (body.length < LIMITS.bodyMin) errors.body = 'Write a comment before posting.';
  else if (body.length > LIMITS.bodyMax) errors.body = `Keep comments under ${LIMITS.bodyMax} characters.`;

  return { ok: !errors.name && !errors.body, errors, clean: { name, body } };
}

const LEET: Record<string, string> = {
  '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '8': 'b', '+': 't',
};

/** Lower-case, undo common substitutions, drop separators and repeated letters ("f.u.u.c.k" → "fuck"). */
export function normalizeForMatching(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[0-9!|@$+]/g, (c) => LEET[c] ?? c)
    .replace(/[^a-z]/g, '')
    .replace(/(.)\1+/g, '$1');
}

// A deliberately short built-in list of unambiguous slurs/abuse. Owners add
// their own terms in Settings. Kept as normalised stems so evasions match.
const BUILT_IN_BLOCKED = ['nigger', 'nigga', 'faggot', 'retard', 'kys', 'killyourself'];

// Spam signals common on blog comment forms.
const SPAM_PATTERNS: RegExp[] = [
  /\b(casino|viagra|cialis|crypto ?signals?|forex ?signals?|loan offer|betting tips)\b/i,
  /\b(whats ?app|telegram)\s*[:+]?\s*\+?\d[\d\s-]{7,}/i,
  /\b(buy|cheap|discount)\b.{0,30}\b(followers|likes|backlinks|seo)\b/i,
  /\b(spell ?caster|hack(ed|er) (your|my) account|recover (your|my) funds)\b/i,
];

export type Verdict =
  | { action: 'reject'; reason: string }
  | { action: 'spam'; flags: string[] }
  | { action: 'review'; flags: string[] }
  | { action: 'clean'; flags: [] };

export function assessComment(
  input: CommentInput,
  clean: { name: string; body: string },
  extraBlocked: string[] = [],
): Verdict {
  // Bot traps: reject outright, but never tell the bot why.
  if (input.website && input.website.trim() !== '') return { action: 'reject', reason: 'honeypot' };
  if (typeof input.elapsedMs === 'number' && input.elapsedMs < LIMITS.minFillMs) {
    return { action: 'reject', reason: 'too-fast' };
  }

  const flags: string[] = [];
  const text = `${clean.name}\n${clean.body}`;

  const links = text.match(/https?:\/\/|www\./gi)?.length ?? 0;
  if (links > LIMITS.maxLinks) flags.push(`contains ${links} links`);

  const spamHit = SPAM_PATTERNS.find((p) => p.test(text));
  if (spamHit) flags.push('matches a spam pattern');

  const normalised = normalizeForMatching(text);
  const blocked = [...BUILT_IN_BLOCKED, ...extraBlocked.map(normalizeForMatching)].filter((t) => t.length >= 3);
  const term = blocked.find((t) => normalised.includes(t));
  if (term) flags.push('contains a blocked term');

  const letters = clean.body.replace(/[^A-Za-z]/g, '');
  if (letters.length > 24 && letters === letters.toUpperCase()) flags.push('written in all capitals');
  if (/(.)\1{9,}/.test(clean.body)) flags.push('long repeated characters');

  if (spamHit || links > LIMITS.maxLinks + 2) return { action: 'spam', flags };
  if (flags.length) return { action: 'review', flags };
  return { action: 'clean', flags: [] };
}

/** Sliding-window limiter over prior submission timestamps (ms). */
export function isRateLimited(previous: number[], now: number): boolean {
  const recent = previous.filter((t) => now - t < LIMITS.rateWindowMs);
  return recent.length >= LIMITS.rateMax;
}

// ---------------- endpoint ----------------
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
