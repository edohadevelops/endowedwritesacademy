import { test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { resetBrowserData, setupAdmin, seedArticles } from './helpers';

// Visual review: captures key screens at several widths into SHOTS_DIR.
const OUT = process.env.SHOTS_DIR ?? 'test-results/shots';

/** Scroll through so lazy images load before a full-page capture. */
async function settle(page: Page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(500);
}

test('capture screens', async ({ page }) => {
  test.skip(!process.env.SHOTS, 'Set SHOTS=1 to capture screenshots');
  await resetBrowserData(page);
  await setupAdmin(page);
  await seedArticles(page);

  for (const w of [375, 768, 1280, 1440]) {
    await page.setViewportSize({ width: w, height: w < 500 ? 812 : 900 });
    await page.goto('/blog');
    await settle(page);
    await page.screenshot({ path: `${OUT}/home-${w}.png`, fullPage: true });
    await page.goto('/blog/how-to-build-a-study-routine-that-actually-works');
    await settle(page);
    await page.screenshot({ path: `${OUT}/article-${w}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const [name, url] of [['dashboard', '/admin'], ['posts', '/admin/posts'], ['settings', '/admin/settings'], ['media', '/admin/media']] as const) {
    await page.goto(url);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/admin-${name}.png`, fullPage: true });
  }
  await page.goto('/admin/posts');
  await page.getByRole('link', { name: 'How to build a study routine that actually works' }).click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/admin-editor.png` });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: `${OUT}/admin-editor-375.png` });
});
