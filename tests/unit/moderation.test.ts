import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateComment, assessComment, normalizeForMatching, isRateLimited, cleanText, LIMITS } from '@/features/comments/moderation';

const check = (name: string, body: string, extra: string[] = [], opts: { website?: string; elapsedMs?: number } = {}) => {
  const v = validateComment({ name, body });
  return assessComment({ name, body, elapsedMs: 10_000, ...opts }, v.clean, extra);
};

describe('comment validation', () => {
  it('requires a name and a comment', () => {
    const r = validateComment({ name: ' ', body: '' });
    expect(r.ok).toBe(false);
    expect(r.errors.name).toBeTruthy();
    expect(r.errors.body).toBeTruthy();
  });
  it('enforces length limits', () => {
    expect(validateComment({ name: 'Ada', body: 'x'.repeat(LIMITS.bodyMax + 1) }).errors.body).toMatch(/under/);
    expect(validateComment({ name: 'A'.repeat(61), body: 'Fine comment' }).errors.name).toMatch(/under/);
  });
  it('rejects links and HTML in names', () => {
    expect(validateComment({ name: 'http://spam.biz', body: 'hello there' }).ok).toBe(false);
    expect(validateComment({ name: '<b>Ada</b>', body: 'hello there' }).ok).toBe(false);
  });
  it('keeps HTML in bodies as plain text, stripping control characters', () => {
    const r = validateComment({ name: 'Ada', body: '<script>alert(1)</script>​\u0007 ok' });
    expect(r.ok).toBe(true);
    expect(r.clean.body).toBe('<script>alert(1)</script> ok'); // rendered as text by React, never as HTML
  });
  it('collapses whitespace', () => {
    expect(cleanText('  a \t b\n\n\n\nc ')).toBe('a b\n\nc');
  });
});

describe('abuse checks', () => {
  it('passes an ordinary comment', () => {
    expect(check('Ada', 'This helped me plan my revision, thank you!').action).toBe('clean');
  });
  it('silently rejects the honeypot and instant submissions', () => {
    expect(check('Bot', 'Nice post', [], { website: 'http://x' }).action).toBe('reject');
    expect(check('Bot', 'Nice post', [], { elapsedMs: 200 }).action).toBe('reject');
  });
  it('marks obvious spam', () => {
    expect(check('Max', 'Best crypto signals here, WhatsApp +234 801 234 5678').action).toBe('spam');
  });
  it('sends too many links to review, and lots of links to spam', () => {
    expect(check('Ada', 'see http://a.com http://b.com http://c.com').action).toBe('review');
    expect(check('Ada', 'http://a.com http://b.com http://c.com http://d.com http://e.com').action).toBe('spam');
  });
  it('catches disguised blocked terms', () => {
    expect(normalizeForMatching('R3t@rrd')).toBe('retard');
    expect(check('Ada', 'you are a r.e.t.a.r.d').action).toBe('review');
    expect(check('Ada', 'this is so b@ddd', ['bad']).action).toBe('review');
  });
  it('does not flag innocent words that merely share letters', () => {
    expect(check('Ada', 'I passed my class and my assessment').action).toBe('clean');
  });
  it('flags shouting', () => {
    expect(check('Ada', 'THIS IS THE WORST ARTICLE I HAVE EVER READ').action).toBe('review');
  });
});

describe('rate limiting', () => {
  it('allows a few comments then blocks within the window', () => {
    const now = Date.now();
    expect(isRateLimited([now - 1000, now - 2000], now)).toBe(false);
    expect(isRateLimited(Array.from({ length: LIMITS.rateMax }, (_, i) => now - i * 1000), now)).toBe(true);
    expect(isRateLimited(Array.from({ length: LIMITS.rateMax }, () => now - LIMITS.rateWindowMs - 1), now)).toBe(false);
  });
});

describe('edge function copy', () => {
  it('matches the browser module exactly', () => {
    const src = readFileSync('src/features/comments/moderation.ts', 'utf8');
    const copy = readFileSync('supabase/functions/_shared/moderation.ts', 'utf8');
    expect(copy.endsWith(src)).toBe(true);
  });
});
