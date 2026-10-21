// Runs the Netlify Edge Functions against the stand-in and checks their output.
// Usage (after `npm run test:supabase` has created content):
//   node tests/supabase-local/edge-check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ANON_KEY } from './keys.mjs';

const env = { VITE_SUPABASE_URL: 'http://localhost:54321', VITE_SUPABASE_PUBLISHABLE_KEY: ANON_KEY, SITE_URL: 'https://www.endowed.example' };
globalThis.Netlify = { env: { get: (k) => env[k] } };
const html = readFileSync('index.html', 'utf8');
const context = { next: async () => new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }) };

const meta = (await import('../../netlify/edge-functions/article-meta.ts')).default;
const sitemap = (await import('../../netlify/edge-functions/sitemap.ts')).default;
const robots = (await import('../../netlify/edge-functions/robots.ts')).default;

const page = await (await meta(new Request('https://www.endowed.example/blog/how-to-plan-a-revision-week'), context)).text();
assert.match(page, /<title>How to plan a revision week \| Endowed Academy<\/title>/);
assert.match(page, /<meta property="og:title" content="How to plan a revision week" \/>/);
assert.match(page, /<meta property="og:image" content="http:\/\/localhost:54321\/storage\/v1\/object\/public\/media\/[^"]+"|summary"/);
assert.match(page, /<link rel="canonical" href="https:\/\/www\.endowed\.example\/blog\/how-to-plan-a-revision-week" \/>/);
assert.match(page, /"@type":"Article"/);
assert.equal((page.match(/<title>/g) ?? []).length, 1, 'only one <title>');
console.log('PASS  article-meta injects title, Open Graph, canonical and JSON-LD');

const draft = await (await meta(new Request('https://www.endowed.example/blog/unfinished-thoughts'), context)).text();
assert.match(draft, /<title>Endowed Academy<\/title>/);
console.log('PASS  article-meta leaves drafts untouched (no leaked title)');

const xml = await (await sitemap(new Request('https://www.endowed.example/sitemap.xml'))).text();
assert.match(xml, /<loc>https:\/\/www\.endowed\.example\/blog\/how-to-plan-a-revision-week<\/loc>/);
assert.match(xml, /<loc>https:\/\/www\.endowed\.example\/blog\/identity<\/loc>/);
assert.doesNotMatch(xml, /unfinished-thoughts/);
console.log('PASS  sitemap lists published articles only');

const txt = await (await robots(new Request('https://www.endowed.example/robots.txt'))).text();
assert.match(txt, /Disallow: \/admin/);
assert.match(txt, /Sitemap: https:\/\/www\.endowed\.example\/sitemap\.xml/);
console.log('PASS  robots.txt blocks /admin and points at the sitemap');
