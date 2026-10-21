// End-to-end tests of the Supabase adapter against the local stand-in
// (real Supabase Auth + PostgREST + this project's migrations + the real
// submit-comment Edge Function). Run: npm run test:supabase
import { test, expect, type Page, type Browser } from '@playwright/test';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
// @ts-expect-error plain ESM helper without types
import { ANON_KEY, SERVICE_KEY } from '../supabase-local/keys.mjs';

const API = 'http://localhost:54321';
const OWNER = { email: 'owner@endowed.test', password: 'Study-hard-2026' };
const READER = { email: 'reader@example.com', password: 'Just-a-reader-2026' };
const fx = (...p: string[]) => join(import.meta.dirname, '..', 'fixtures', ...p);

function sql(query: string) {
  return execFileSync('psql', ['-tAq', '-d', process.env.SUPA_DB ?? 'endowed_supa', '-c', query], { encoding: 'utf8' }).trim();
}
async function createUser(email: string, password: string) {
  const r = await fetch(`${API}/auth/v1/admin/users`, {
    method: 'POST', headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!r.ok && r.status !== 422) throw new Error(`create user failed: ${r.status} ${await r.text()}`);
}
async function anonFetch(path: string) {
  return (await fetch(`${API}/rest/v1/${path}`, { headers: { apikey: ANON_KEY } })).json();
}

async function signIn(page: Page, who = OWNER, expectSuccess = who === OWNER) {
  await page.addInitScript(() => {
    localStorage.setItem('endowed.onboarding.v1', JSON.stringify({ dismissed: Object.fromEntries(['dashboard', 'posts', 'editor', 'comments', 'media', 'categories', 'settings', 'import', 'preview'].map((i) => [i, 'x'])), tipsOn: true }));
  });
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password', { exact: true }).fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  if (expectSuccess) await page.waitForURL(/\/admin(\?|$)/);
}
async function readerPage(browser: Browser) {
  const ctx = await browser.newContext();
  return ctx.newPage();
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  // Fresh content each run; keep auth users.
  sql("truncate public.posts, public.comments, public.comment_rate_events, public.media_assets, public.audit_log, public.post_slug_history, public.categories, public.tags restart identity cascade; update public.site_settings set settings='{}'; update public.moderation_settings set blocked_terms='{}', mode='all';");
  await createUser(OWNER.email, OWNER.password);
  await createUser(READER.email, READER.password);
  sql(`insert into public.admin_roles (user_id, role, display_name) select id, 'owner', 'Grace Adeyemi' from auth.users where email = '${OWNER.email}' on conflict do nothing`);
  sql("insert into public.categories (name, slug, sort_order) values ('Study Tips','study-tips',0), ('Wellbeing','wellbeing',1)");
});

test('there is no in-app sign-up, and non-admin accounts are refused', async ({ page }) => {
  await page.goto('/admin/setup');
  await page.waitForURL('**/admin/login');
  await signIn(page, READER);
  await expect(page.getByRole('alert')).toHaveText('This account isn’t an administrator for this site.');
  await page.getByLabel('Password', { exact: true }).fill('wrong-password-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('That email and password don’t match.');
});

test('owner writes, uploads, autosaves, publishes; readers see it from the database', async ({ page, browser }) => {
  await signIn(page);
  await page.waitForURL(/\/admin$/);
  await expect(page.getByText('Preview mode')).toHaveCount(0); // shared mode: no "this browser only" note

  await page.goto('/admin/posts/new');
  await page.getByLabel('Title', { exact: true }).fill('Live from Supabase');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Spaced practice beats cramming.');
  await page.keyboard.press('Enter');
  await page.getByLabel('Text style').selectOption('h2');
  await page.keyboard.type('Plan your week');
  await page.getByLabel('Category').selectOption({ label: 'Study Tips' });
  await page.getByRole('button', { name: 'Image', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Insert an image' });
  await dialog.locator('input[type=file]').setInputFiles(fx('cover-3.jpg'));
  await dialog.getByLabel('Alt text').fill('Desk under a lamp');
  await dialog.getByRole('button', { name: 'Use this image' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Saved/ })).toBeVisible({ timeout: 15000 });

  // Saved in Postgres, private until published.
  expect(sql("select status from public.posts where slug='live-from-supabase'")).toBe('draft');
  expect(await anonFetch('posts?select=id&slug=eq.live-from-supabase')).toEqual([]);
  expect(Number(sql('select count(*) from public.media_assets'))).toBe(1);

  await page.reload();
  await expect(page.locator('.ProseMirror h2')).toHaveText('Plan your week');

  await page.getByRole('button', { name: 'Publish', exact: true }).first().click();
  await expect(page.getByText('Published. It’s live on the blog.')).toBeVisible();
  expect(sql("select string_agg(r.reason, ',') from public.post_revisions r join public.posts p on p.id=r.post_id where p.slug='live-from-supabase'")).toContain('publish');

  const reader = await readerPage(browser);
  await reader.goto('/blog');
  await expect(reader.getByText('Featured in Study Tips')).toBeVisible();
  await reader.goto('/blog/live-from-supabase');
  await expect(reader.getByRole('heading', { level: 1 })).toHaveText('Live from Supabase');
  const img = reader.locator('#article-body img[alt="Desk under a lamp"]');
  await expect(img).toBeVisible();
  expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  expect(await img.getAttribute('src')).toContain('/storage/v1/object/public/media/');

  // Search uses Postgres full-text search.
  await reader.goto('/blog?q=cramming');
  await expect(reader.getByRole('heading', { name: 'Live from Supabase' })).toBeVisible();
});

test('comments go through the Edge Function and wait for approval', async ({ page, browser }) => {
  const reader = await readerPage(browser);
  await reader.goto('/blog/live-from-supabase');
  await reader.waitForTimeout(2700);
  await reader.getByLabel('Name', { exact: true }).fill('Tobi');
  await reader.getByLabel('Comment', { exact: true }).fill('<b>Bold?</b> This helped a lot.');
  await reader.getByRole('button', { name: 'Post comment' }).click();
  await expect(reader.getByText('Thanks, your comment is awaiting approval.')).toBeVisible();
  expect(sql("select status from public.comments where author_name='Tobi'")).toBe('pending');
  expect(await anonFetch('comments?select=id&status=eq.pending')).toEqual([]);

  // Spam is caught server-side.
  await reader.getByRole('button', { name: 'Write another comment' }).click();
  await reader.waitForTimeout(2700);
  await reader.getByLabel('Name', { exact: true }).fill('Max');
  await reader.getByLabel('Comment', { exact: true }).fill('Best crypto signals here, WhatsApp +234 801 234 5678');
  await reader.getByRole('button', { name: 'Post comment' }).click();
  await expect(reader.getByText('Thanks, your comment is awaiting approval.')).toBeVisible();
  expect(sql("select status from public.comments where author_name='Max'")).toBe('spam');

  // Direct inserts with the public key are refused.
  const direct = await fetch(`${API}/rest/v1/comments`, { method: 'POST', headers: { apikey: ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ post_id: sql("select id from public.posts where slug='live-from-supabase'"), author_name: 'Bot', body: 'direct' }) });
  expect(direct.status).toBe(401);

  await signIn(page);
  await page.goto('/admin/comments');
  await expect(page.getByText('This helped a lot.')).toBeVisible();
  await page.getByRole('button', { name: 'Approve', exact: true }).first().click();
  await expect(page.getByRole('status').getByText('Approved', { exact: true })).toBeVisible();

  await reader.reload();
  await expect(reader.getByText('<b>Bold?</b> This helped a lot.')).toBeVisible();
});

test('conflicting edits from two tabs are caught', async ({ page, context }) => {
  await signIn(page);
  await page.goto('/admin/posts/new');
  await page.getByLabel('Title', { exact: true }).fill('Two tabs');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('First version.');
  await expect(page.getByRole('status').filter({ hasText: /Saved/ })).toBeVisible({ timeout: 15000 });
  const editUrl = page.url();

  const tab2 = await context.newPage();
  await tab2.goto(editUrl);
  await tab2.locator('.ProseMirror').click();
  await tab2.keyboard.press('End');
  await tab2.keyboard.type(' Edited in tab two.');
  await expect(tab2.getByRole('status').filter({ hasText: /Saved/ })).toBeVisible({ timeout: 15000 });

  await page.locator('.ProseMirror').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Stale edit.');
  await expect(page.getByText('This article was changed in another tab or window.')).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Load the latest version' }).click();
  await expect(page.locator('.ProseMirror')).toContainText('Edited in tab two.');
});

test('bulk import writes articles, images and comments to Supabase', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/import');
  await page.locator('input[type=file]').first().setInputFiles([
    fx('import', 'revision-week.md'), fx('import', 'cover.jpg'), fx('import', 'planner.jpg'), fx('blogger-sample.xml'),
  ]);
  await expect(page.getByLabel('Title')).toHaveCount(3);
  await page.getByRole('button', { name: 'Import 3 articles' }).click();
  await expect(page.getByText('Imported 3 articles').first()).toBeVisible({ timeout: 30000 });

  expect(sql("select status || ' ' || to_char(published_at,'YYYY') from public.posts where slug='how-to-plan-a-revision-week'")).toBe('published 2025');
  expect(sql("select count(*) from public.comments c join public.posts p on p.id=c.post_id where p.slug='identity' and c.status='approved'")).toBe('1');
  expect(sql("select name from public.categories where name='Self Development'")).toBe('Self Development');
  const visible = await anonFetch('posts?select=slug&slug=in.(identity,unfinished-thoughts)');
  expect(visible).toEqual([{ slug: 'identity' }]);
});

test('settings, featuring, trash and media rules work against the database', async ({ page, browser }) => {
  await signIn(page);
  await page.goto('/admin/settings?tab=home');
  await page.getByLabel('Headline').fill('Grow the gift you carry.');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status').getByText('Settings saved')).toBeVisible();
  await page.goto('/admin/settings?tab=comments');
  await page.getByLabel('Blocked words').fill('rubbish');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status').getByText('Settings saved')).toBeVisible();
  // Blocked words are private: not in the public settings row.
  expect(JSON.stringify(await anonFetch('site_settings?select=settings'))).not.toContain('rubbish');
  expect(sql('select blocked_terms[1] from public.moderation_settings')).toBe('rubbish');

  await page.goto('/admin/posts');
  await page.getByRole('button', { name: 'Actions for How to plan a revision week' }).click();
  await page.getByRole('menuitem', { name: 'Feature on blog home' }).click();
  await expect(page.getByRole('status').getByText('Now featured on the blog home')).toBeVisible();
  expect(sql('select count(*) from public.posts where is_featured')).toBe('1');

  const reader = await readerPage(browser);
  await reader.goto('/blog');
  await expect(reader.getByRole('heading', { level: 1 })).toHaveText('Grow the gift you carry.');
  await expect(reader.getByText('Featured in Study Tips')).toBeVisible();

  // In-use images can't be deleted.
  await page.goto('/admin/media');
  await page.locator('[data-tour="media-grid"] button').first().click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Delete image' }).click();
  await expect(page.getByRole('status').getByText(/still used in/)).toBeVisible();
  await page.keyboard.press('Escape');

  // Trash hides from readers; restore brings it back as a draft.
  await page.goto('/admin/posts');
  await page.getByRole('button', { name: 'Actions for Live from Supabase' }).click();
  await page.getByRole('menuitem', { name: 'Move to trash' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Move to trash' }).click();
  await expect(page.getByRole('status').getByText('Moved to trash')).toBeVisible();
  expect(await anonFetch('posts?select=id&slug=eq.live-from-supabase')).toEqual([]);
  await reader.goto('/blog/live-from-supabase');
  await expect(reader.getByRole('heading', { name: 'This page isn’t here.' })).toBeVisible();
});

test('content exported from the browser preview imports into Supabase', async ({ page, browser }) => {
  const file = join(import.meta.dirname, '..', '.artifacts', 'local-export.json');
  test.skip(!existsSync(file), 'Run the local e2e suite first to produce the export file');
  await signIn(page);
  await page.goto('/admin/import');
  await page.locator('input[type=file]').first().setInputFiles(file);
  await expect(page.getByLabel('Title')).toHaveCount(7);
  await page.getByRole('button', { name: 'Import 7 articles' }).click();
  await expect(page.getByText('Imported 7 articles').first()).toBeVisible({ timeout: 60000 });
  expect(Number(sql("select count(*) from public.posts where slug in ('the-science-of-effective-learning','why-rest-is-part-of-the-work')"))).toBe(2);
  expect(Number(sql("select count(*) from public.comments where body='Carried across.' and status='approved'"))).toBe(1);
  const reader = await readerPage(browser);
  await reader.goto('/blog/the-science-of-effective-learning');
  await expect(reader.getByRole('heading', { level: 1 })).toHaveText('The science of effective learning');
  const cover = reader.locator('figure img').first();
  await expect(cover).toBeVisible();
  expect(await cover.getAttribute('src')).toContain('/storage/v1/object/public/media/');
});

test('the comment endpoint rate-limits bursts and validates input server-side', async () => {
  const postId = sql("select id from public.posts where slug='identity'");
  const send = (body: Record<string, unknown>) => fetch(`${API}/functions/v1/submit-comment`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: ANON_KEY }, body: JSON.stringify({ postId, elapsedMs: 9000, ...body }) });
  const bad = await send({ name: '', body: 'x' });
  expect(bad.status).toBe(422);
  expect((await bad.json()).fields).toMatchObject({ name: 'Enter your name.' });
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) statuses.push((await send({ name: 'Burst', body: `comment ${i}` })).status);
  expect(statuses).toContain(429);
  expect(Number(sql("select count(*) from public.comments where author_name='Burst'"))).toBeLessThanOrEqual(4);
});

test('password reset request and sign-out', async ({ page }) => {
  await page.goto('/admin/login');
  await page.getByRole('button', { name: 'Forgot your password?' }).click();
  await page.getByLabel('Email for the reset link').fill(OWNER.email);
  await page.getByRole('button', { name: 'Email me a reset link' }).click();
  await expect(page.getByText(/a reset link is on its way/)).toBeVisible();

  await signIn(page);
  await page.waitForURL(/\/admin$/);
  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await page.goto('/admin/posts');
  await page.waitForURL(/\/admin\/login/);
});
