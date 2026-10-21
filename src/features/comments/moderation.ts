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
