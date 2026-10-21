import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { join } from 'node:path';
import { resetBrowserData, setupAdmin, seedArticles } from './helpers';

test('import from a Blogger backup', async ({ page }) => {
  await resetBrowserData(page);
  await setupAdmin(page);
  await page.goto('/admin/import');
  await page.locator('input[type=file]').first().setInputFiles(join(import.meta.dirname, '..', 'fixtures', 'blogger-sample.xml'));
  await expect(page.getByLabel('Title').first()).toHaveValue('Unfinished thoughts');
  await page.getByRole('button', { name: 'Import 2 articles' }).click();
  await expect(page.getByText('Imported 2 articles').first()).toBeVisible();

  await page.goto('/blog/identity');
  await expect(page.getByRole('heading', { level: 1, name: 'IDENTITY' })).toBeVisible();
  await expect(page.locator('#article-body').getByText('First paragraph about identity.')).toBeVisible();
  await expect(page.getByText('This blessed me.')).toBeVisible();
  // the Blogger draft stays a draft
  await page.goto('/blog/unfinished-thoughts');
  await expect(page.getByRole('heading', { name: 'This page isn’t here.' })).toBeVisible();
  // importing again skips what is already there
  await page.goto('/admin/import');
  await page.locator('input[type=file]').first().setInputFiles(join(import.meta.dirname, '..', 'fixtures', 'blogger-sample.xml'));
  await expect(page.getByRole('button', { name: 'Import 0 articles' })).toBeDisabled();
});

test('schedule an article, change brand settings, feature an article', async ({ page }) => {
  await resetBrowserData(page);
  await setupAdmin(page);
  await seedArticles(page);

  // schedule
  await page.goto('/admin/posts/new');
  await page.getByLabel('Title', { exact: true }).fill('Coming next week');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Scheduled content.');
  await page.getByLabel('Schedule for later').check();
  const d = new Date(Date.now() + 7 * 86400000);
  const pad = (n: number) => String(n).padStart(2, '0');
  await page.getByLabel('Publish date and time').fill(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T09:00`);
  await page.getByRole('button', { name: 'Schedule', exact: true }).first().click();
  await expect(page.getByText(/^Scheduled for/)).toBeVisible();
  await page.goto('/blog/coming-next-week');
  await expect(page.getByRole('heading', { name: 'This page isn’t here.' })).toBeVisible();
  await page.goto('/admin/posts?status=scheduled');
  await expect(page.getByRole('link', { name: 'Coming next week' })).toBeVisible();

  // brand settings: invalid colour is refused, valid saves
  await page.goto('/admin/settings');
  await page.getByLabel('Accent colour', { exact: true }).fill('#F6F0E8');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('White button text isn’t readable enough')).toBeVisible();
  await page.getByLabel('Accent colour', { exact: true }).fill('#1F5F8B');
  await page.getByLabel('Academy name').fill('Endowed Academy');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status').getByText('Settings saved')).toBeVisible();
  await page.goto('/admin/settings?tab=home');
  await page.getByLabel('Headline').fill('Grow the gift you carry.');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status').getByText('Settings saved')).toBeVisible();
  await page.goto('/blog');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Grow the gift you carry.');
  const btnColor = await page.getByRole('link', { name: 'Browse articles' }).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(btnColor).toBe('rgb(31, 95, 139)');

  // feature a different article
  await page.goto('/admin/posts');
  await page.getByRole('button', { name: 'Actions for Managing stress during exam season' }).click();
  await page.getByRole('menuitem', { name: 'Feature on blog home' }).click();
  await page.goto('/blog');
  await expect(page.getByText('Featured in Wellbeing')).toBeVisible();
});

test('accessibility: no serious axe violations on key pages', async ({ page }) => {
  await resetBrowserData(page);
  await setupAdmin(page);
  await seedArticles(page);
  const report: string[] = [];
  const pages = ['/blog', '/blog/how-to-build-a-study-routine-that-actually-works', '/blog/category/wellbeing', '/admin', '/admin/posts', '/admin/comments', '/admin/settings', '/admin/media', '/admin/import', '/admin/categories', '/admin/posts/new'];
  for (const path of pages) {
    await page.goto(path);
    await page.waitForTimeout(400);
    const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    for (const v of res.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')) {
      report.push(`${path}: ${v.id} (${v.impact}) ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
    }
  }
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await page.goto('/admin/login');
  const login = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  login.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical').forEach((v) => report.push(`/admin/login: ${v.id}`));
  expect(report).toEqual([]);
});
