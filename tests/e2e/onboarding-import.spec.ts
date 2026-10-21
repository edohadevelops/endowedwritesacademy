import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { resetBrowserData, setupAdmin, seedArticles } from './helpers';

const fx = (...p: string[]) => join(import.meta.dirname, '..', 'fixtures', ...p);

test('page tours show until dismissed, replay on demand, and every page has one', async ({ page }) => {
  await resetBrowserData(page, { tours: true });
  await setupAdmin(page);

  // Dashboard tour starts by itself.
  const tour = page.getByRole('dialog', { name: 'Everything lives in this menu' });
  await expect(tour).toBeVisible();
  await expect(tour.getByText('1 of')).toBeVisible();
  const axe = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  await expect(tour.getByRole('button', { name: 'Next' })).toBeFocused();
  await tour.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('dialog', { name: 'Start writing' })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(tour).toBeVisible();
  // Walk to the end.
  for (let i = 0; i < 12; i++) {
    const done = page.getByRole('button', { name: 'Got it' });
    if (await done.isVisible()) { await done.click(); break; }
    await page.getByRole('button', { name: 'Next' }).click();
  }
  await expect(page.locator('#tour-title')).toHaveCount(0);

  // Dismissed: doesn't come back on reload.
  await page.reload();
  await page.waitForTimeout(1500);
  await expect(page.locator('#tour-title')).toHaveCount(0);

  // The ? button replays it.
  await page.getByRole('button', { name: 'Show tips for this page' }).click();
  await expect(page.getByRole('dialog', { name: 'Everything lives in this menu' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#tour-title')).toHaveCount(0);

  // Every admin page opens its own tour the first time; Skip dismisses it.
  await seedArticles(page);
  const pages: [string, string][] = [
    ['/admin/posts', 'Filter by status'],
    ['/admin/posts/new', 'Give it a title'],
    ['/admin/comments', 'Nothing appears without you'],
    ['/admin/media', 'Upload images'],
    ['/admin/categories', 'Categories'],
    ['/admin/settings', 'Everything is grouped'],
    ['/admin/import', 'Drop your files here'],
  ];
  for (const [path, first] of pages) {
    await page.goto(path);
    await expect(page.locator('#tour-title'), path).toHaveText(first, { timeout: 8000 });
    await page.getByRole('button', { name: 'Skip tips' }).click();
    await expect(page.locator('#tour-title')).toHaveCount(0);
  }

  // Hover tips explain actions.
  await page.goto('/admin/posts');
  await page.getByRole('tab', { name: /Scheduled/ }).hover();
  await expect(page.getByRole('tooltip')).toHaveText('Will go live on their own at the time you set');

  // Tips can be switched off, and tours reset, from Settings → Account.
  await page.goto('/admin/settings?tab=account');
  await page.getByLabel('Show tips when hovering over buttons').uncheck();
  await page.getByRole('tab', { name: 'Brand' }).hover();
  await page.waitForTimeout(700);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show all page tours again' }).click();
  await page.goto('/admin/media');
  await expect(page.locator('#tour-title')).toHaveText('Upload images');
});

test('editor tour on a phone skips hidden panels and uses the settings button', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await resetBrowserData(page, { tours: true });
  await setupAdmin(page);
  await page.getByRole('button', { name: 'Skip tips' }).click();
  await page.goto('/admin/posts/new');
  const titles: string[] = [];
  for (let i = 0; i < 20; i++) {
    titles.push((await page.locator('#tour-title').textContent()) ?? '');
    const done = page.getByRole('button', { name: 'Got it' });
    if (await done.isVisible()) { await done.click(); break; }
    await page.getByRole('button', { name: 'Next' }).click();
  }
  expect(titles).toContain('Article settings');
  expect(titles).not.toContain('Publish or schedule'); // inside the closed panel on phones
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over).toBeLessThanOrEqual(1);
});

test('bulk import: Word, Markdown with images, spreadsheet and a bundle', async ({ page }) => {
  await resetBrowserData(page);
  await setupAdmin(page);
  await page.goto('/admin/import');

  await page.locator('input[type=file]').first().setInputFiles([
    fx('import', 'revision-week.md'), fx('import', 'cover.jpg'), fx('import', 'planner.jpg'),
    fx('import', 'posts.csv'), fx('import', 'faith-and-focus.docx'),
  ]);
  const titles = page.getByLabel('Title');
  await expect(titles).toHaveCount(4);
  await expect(titles.nth(0)).toHaveValue('How to plan a revision week');
  await expect(page.getByText(/not found/)).toHaveCount(0); // both images were supplied
  await expect(page.getByLabel('Title').nth(3)).toHaveValue('Faith and focus in exam season');

  // Override one row: keep the Word article as a draft in a new category.
  await page.getByLabel('Status').nth(3).selectOption('draft');
  await page.getByLabel('Title').nth(2).fill('Why sleep helps you learn (imported)');

  await page.getByRole('button', { name: 'Import 4 articles' }).click();
  await expect(page.getByText('Imported 4 articles').first()).toBeVisible();

  // Published Markdown article with its images moved into the library.
  await page.goto('/blog/how-to-plan-a-revision-week');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('How to plan a revision week');
  await expect(page.locator('#article-body img[data-media-id]')).toHaveCount(1);
  await expect(page.locator('#article-body .katex').first()).toBeVisible();
  await expect(page.locator('time').first()).toContainText('2025');

  // Draft from the spreadsheet stays private; the Word draft too.
  await page.goto('/blog/why-sleep-helps-you-learn');
  await expect(page.getByRole('heading', { name: 'This page isn’t here.' })).toBeVisible();
  await page.goto('/admin/posts?status=draft');
  await expect(page.getByRole('link', { name: 'Faith and focus in exam season' })).toBeVisible();
  await page.getByRole('link', { name: 'Faith and focus in exam season' }).click();
  await expect(page.locator('.ProseMirror strong')).toHaveText('They test patience.');
  await expect(page.locator('.ProseMirror ul li')).toHaveCount(2);

  await page.goto('/admin/media');
  await expect(page.locator('[data-tour="media-grid"] img')).toHaveCount(3); // cover, planner, Word image

  // Same files again: everything is recognised as already imported.
  await page.goto('/admin/import');
  await page.locator('input[type=file]').first().setInputFiles(fx('import-bundle.json'));
  await expect(page.getByLabel('Title')).toHaveCount(4);
  await expect(page.getByText(/Already on the site/)).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Import 0 articles' })).toBeDisabled();
});

test('import warns about missing images and unsupported files', async ({ page }) => {
  await resetBrowserData(page);
  await setupAdmin(page);
  await page.goto('/admin/import');
  await page.locator('input[type=file]').first().setInputFiles([fx('import', 'revision-week.md'), fx('cover-1.jpg').replace('cover-1.jpg', 'blogger-sample.xml')]);
  await expect(page.getByText(/2 images not found \(planner\.jpg, cover\.jpg\)/)).toBeVisible();
  await page.locator('input[type=file]').first().setInputFiles({ name: 'old.doc', mimeType: 'application/msword', buffer: Buffer.from('x') });
  await expect(page.getByRole('alert')).toContainText('save as .docx');
});

test('export everything, then import it into a fresh site (the preview → live path)', async ({ page }) => {
  await resetBrowserData(page);
  await setupAdmin(page);
  await seedArticles(page);
  // One approved comment to carry across.
  await page.evaluate(async () => {
    const api = await import('/src/lib/data/index.ts');
    const { items } = await api.adminPosts.list({ status: 'published' });
    localStorage.removeItem('endowed.comment-times');
    await api.publicApi.submitComment(items[0].id, { name: 'Ada', body: 'Carried across.', elapsedMs: 9000 });
    const pending = await api.adminComments.list({ status: 'pending' });
    await api.adminComments.setStatus(pending.items.map((c) => c.id), 'approved');
  });
  await page.goto('/admin/import');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export all articles' }).click()]);
  const file = join(import.meta.dirname, '..', '.artifacts', 'local-export.json');
  await download.saveAs(file);
  await expect(page.getByRole('status').getByText('Exported 7 articles')).toBeVisible();

  // Brand-new site in a clean browser.
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise<void>((res) => { const r = indexedDB.deleteDatabase('endowed-academy'); r.onsuccess = r.onerror = r.onblocked = () => res(); });
  });
  await page.goto('/blog');
  await expect(page.getByText('No articles yet.')).toBeVisible();
  await setupAdmin(page);
  await page.goto('/admin/import');
  await page.locator('input[type=file]').first().setInputFiles(file);
  await expect(page.getByLabel('Title')).toHaveCount(7);
  await page.getByRole('button', { name: 'Import 7 articles' }).click();
  await expect(page.getByText('Imported 7 articles').first()).toBeVisible({ timeout: 30000 });

  await page.goto('/blog/how-to-build-a-study-routine-that-actually-works');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('How to build a study routine that actually works');
  await expect(page.locator('.katex').first()).toBeVisible();
  await page.goto('/admin/media');
  await expect(page.locator('[data-tour="media-grid"] img')).toHaveCount(6); // featured images came across
  await page.goto('/admin/comments?status=approved');
  await expect(page.getByText('Carried across.')).toBeVisible();
});
