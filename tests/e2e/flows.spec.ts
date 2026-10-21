import { test, expect, type Page } from '@playwright/test';
import { join } from 'node:path';
import { resetBrowserData, setupAdmin, signIn, seedArticles } from './helpers';

const FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'cover-3.jpg');

async function waitSaved(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /Saved/ })).toBeVisible({ timeout: 15_000 });
}



test('administrator: write, upload, autosave, preview, publish, edit, restore, moderate, sign out', async ({ page, context }) => {
  await resetBrowserData(page);
  await setupAdmin(page);

  // Sign out and back in to exercise the login form.
  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await page.waitForURL('**/admin/login');
  await signIn(page);

  // ---- create
  await page.getByRole('link', { name: 'New article' }).first().click();
  await page.getByLabel('Title', { exact: true }).fill('Revision that sticks');
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.keyboard.type('Spaced practice beats cramming for long-term memory.');
  await page.keyboard.press('Enter');
  await page.getByLabel('Text style').selectOption('h2');
  await page.keyboard.type('Plan your week');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+b');
  await page.keyboard.type('Bold idea:');
  await page.keyboard.press('Control+b');
  await page.keyboard.type(' review each topic three times.');

  // ---- image upload through the media picker
  await page.getByRole('button', { name: 'Image', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Insert an image' });
  await dialog.locator('input[type=file]').setInputFiles(FIXTURE);
  await dialog.getByLabel('Alt text').fill('A desk lit by a warm lamp');
  await dialog.getByRole('button', { name: 'Use this image' }).click();
  await expect(editor.locator('img[alt="A desk lit by a warm lamp"]')).toBeVisible();

  await waitSaved(page);
  const editUrl = page.url();
  expect(editUrl).toMatch(/\/admin\/posts\/[\w-]+\/edit$/);

  // ---- refresh and recover the draft from storage
  await page.reload();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Revision that sticks');
  await expect(page.locator('.ProseMirror h2')).toHaveText('Plan your week');
  await expect(page.locator('.ProseMirror strong')).toHaveText('Bold idea:');

  // ---- draft is not public
  const anon = await context.newPage();
  await anon.goto('/blog/revision-that-sticks');
  await expect(anon.getByRole('heading', { name: 'This page isn’t here.' })).toBeVisible();

  // ---- private preview
  const [preview] = await Promise.all([context.waitForEvent('page'), page.getByRole('button', { name: 'Preview' }).click()]);
  await expect(preview.getByText('Preview only. Readers can’t see this page.')).toBeVisible();
  await expect(preview.getByRole('heading', { level: 1, name: 'Revision that sticks' })).toBeVisible();
  await preview.close();

  // ---- publish
  await page.getByRole('button', { name: 'Publish', exact: true }).first().click();
  await expect(page.getByText('Published. It’s live on the blog.')).toBeVisible();

  await anon.goto('/blog/revision-that-sticks');
  await expect(anon.getByRole('heading', { level: 1, name: 'Revision that sticks' })).toBeVisible();
  await expect(anon.locator('#article-body img[alt="A desk lit by a warm lamp"]')).toBeVisible();
  await expect(anon.locator('meta[property="og:title"]')).toHaveAttribute('content', 'Revision that sticks');

  // ---- edit a live article: changes wait for Update
  await page.locator('.ProseMirror p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Even ten minutes helps.');
  await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toBeVisible();
  await anon.reload();
  await expect(anon.locator('#article-body')).not.toContainText('Even ten minutes helps.');
  await page.getByRole('button', { name: 'Update' }).first().click();
  await expect(page.getByText('Updated. Readers now see the new version.')).toBeVisible();
  await anon.reload();
  await expect(anon.locator('#article-body')).toContainText('Even ten minutes helps.');

  // ---- restore the published version from history
  await page.getByRole('button', { name: 'Revision history' }).click();
  const hist = page.getByRole('dialog', { name: 'Revision history' });
  await hist.getByRole('button', { name: /Published/ }).first().click();
  await hist.getByRole('button', { name: 'Restore this version' }).click();
  await expect(page.locator('.ProseMirror')).not.toContainText('Even ten minutes helps.');
  await anon.reload();
  await expect(anon.locator('#article-body')).not.toContainText('Even ten minutes helps.');

  // ---- reader comments, including an HTML injection attempt
  await anon.waitForTimeout(2600); // the form rejects instant (bot-speed) submissions
  await anon.getByLabel('Name', { exact: true }).fill('Tobi');
  await anon.getByLabel('Comment', { exact: true }).fill('<img src=x onerror=alert(1)> This helped me a lot!');
  await anon.getByRole('button', { name: 'Post comment' }).click();
  await expect(anon.getByText('Thanks, your comment is awaiting approval.')).toBeVisible();
  await anon.reload();
  await expect(anon.getByText('This helped me a lot!')).toHaveCount(0);

  await page.goto('/admin/comments');
  await expect(page.getByText('This helped me a lot!')).toBeVisible();
  await page.getByRole('button', { name: 'Approve', exact: true }).first().click();
  await expect(page.getByRole('status').getByText('Approved', { exact: true })).toBeVisible();

  let alerted = false;
  anon.on('dialog', (d) => { alerted = true; void d.dismiss(); });
  await anon.reload();
  await expect(anon.getByText('<img src=x onerror=alert(1)> This helped me a lot!')).toBeVisible();
  expect(alerted).toBe(false);
  expect(await anon.locator('#comments-title ~ ol img').count()).toBe(0);

  // ---- sign out ends access
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await page.goto(editUrl);
  await page.waitForURL(/\/admin\/login/);
});

test('reader: browse, search, filter, open by URL, table of contents', async ({ page }) => {
  await resetBrowserData(page);
  await setupAdmin(page);
  await seedArticles(page);
  await page.getByRole('button', { name: 'Sign out' }).first().click();

  await page.goto('/');
  await page.waitForURL('**/blog');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bring out what you have been given.');
  await expect(page.getByText('Featured in Study Tips')).toBeVisible();

  // pagination: 7 seeded, 1 featured, 9 per page → one page, so no pagination
  await expect(page.getByRole('navigation', { name: 'Article pages' })).toHaveCount(0);

  // search
  await page.locator('#blog-search').fill('stress');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/q=stress/);
  await expect(page.getByRole('heading', { name: 'Managing stress during exam season' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('stress');

  await page.goto('/blog?q=zzzznomatch');
  await expect(page.getByText('Nothing matches “zzzznomatch”.')).toBeVisible();

  // category
  await page.goto('/blog');
  await page.getByRole('navigation', { name: 'Topics' }).getByRole('link', { name: 'Wellbeing' }).click();
  await expect(page).toHaveURL(/\/blog\/category\/wellbeing$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Wellbeing' })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(2);

  // direct URL + TOC
  await page.goto('/blog/the-science-of-effective-learning');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('The science of effective learning');
  const toc = page.getByRole('navigation', { name: 'Table of contents' }).first();
  await toc.getByRole('link', { name: 'Protect your attention' }).click();
  await expect(page).toHaveURL(/#protect-your-attention$/);
  await expect(page.locator('#protect-your-attention')).toBeInViewport();
  await expect(page.locator('.katex').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Keep reading' })).toBeVisible();

  // unknown URLs
  await page.goto('/blog/does-not-exist');
  await expect(page.getByRole('heading', { name: 'This page isn’t here.' })).toBeVisible();
  await page.goto('/courses');
  await expect(page.getByRole('heading', { level: 1, name: 'Courses' })).toBeVisible();
});

test('security: admin pages and drafts need a signed-in administrator', async ({ page }) => {
  await resetBrowserData(page);
  await setupAdmin(page);
  await page.getByRole('button', { name: 'Sign out' }).first().click();

  for (const path of ['/admin', '/admin/posts', '/admin/comments', '/admin/settings', '/admin/media', '/admin/posts/abc/preview']) {
    await page.goto(path);
    await page.waitForURL(/\/admin\/login/);
  }
  // The setup page closes once an owner exists.
  await page.goto('/admin/setup');
  await page.waitForURL(/\/admin\/login/);

  // Data calls refuse without a session, even when called directly.
  const results = await page.evaluate(async () => {
    const api = await import('/src/lib/data/index.ts');
    const tryIt = async (fn: () => Promise<unknown>) => { try { await fn(); return 'allowed'; } catch (e) { return (e as { code?: string }).code ?? 'error'; } };
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'x.jpg', { type: 'image/jpeg' });
    return {
      create: await tryIt(() => api.adminPosts.create({ title: 'x' })),
      settings: await tryIt(async () => api.settings.save(await api.settings.get())),
      upload: await tryIt(() => api.adminMedia.upload(file)),
      comments: await tryIt(() => api.adminComments.list({})),
    };
  });
  expect(results).toEqual({ create: 'unauthorized', settings: 'unauthorized', upload: 'unauthorized', comments: 'unauthorized' });

  // Wrong passwords lock the form after five tries.
  await page.goto('/admin/login');
  for (let i = 0; i < 5; i++) {
    await page.getByLabel('Email').fill('owner@endowed.test');
    await page.getByLabel('Password', { exact: true }).fill('not-the-password-1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
  }
  await page.getByLabel('Password', { exact: true }).fill('not-the-password-1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Too many attempts');
});

test('responsive: no horizontal overflow from 320px to 1440px', async ({ page }) => {
  await resetBrowserData(page);
  await setupAdmin(page);
  await seedArticles(page);
  const paths = ['/blog', '/blog/how-to-build-a-study-routine-that-actually-works', '/blog/category/study-tips', '/admin', '/admin/posts', '/admin/comments', '/admin/settings', '/admin/posts/new'];
  const problems: string[] = [];
  for (const width of [320, 375, 425, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of paths) {
      await page.goto(path);
      await page.waitForTimeout(250);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (over > 1) problems.push(`${path} @${width}px overflows by ${over}px`);
    }
  }
  expect(problems).toEqual([]);

  // Mobile menu works by keyboard.
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/blog');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.locator('#mobile-menu').getByRole('link', { name: 'Courses' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#mobile-menu')).toHaveCount(0);
});
