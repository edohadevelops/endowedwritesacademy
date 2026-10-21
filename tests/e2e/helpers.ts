import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ADMIN = { name: 'Grace Adeyemi', email: 'owner@endowed.test', password: 'Study-hard-2026' };

const TOUR_IDS = ['dashboard', 'posts', 'editor', 'comments', 'media', 'categories', 'settings', 'import', 'preview'];

/**
 * Marks every page tour as already seen so functional tests aren't blocked
 * by the onboarding overlay. Tour tests pass `{ tours: true }` to keep them.
 */
export async function resetBrowserData(page: Page, opts: { tours?: boolean } = {}) {
  if (!opts.tours) {
    await page.addInitScript((ids) => {
      if (!localStorage.getItem('endowed.onboarding.v1')) {
        localStorage.setItem('endowed.onboarding.v1', JSON.stringify({ dismissed: Object.fromEntries(ids.map((i) => [i, 'test'])), tipsOn: true }));
      }
    }, TOUR_IDS);
  }
  await page.goto('/blog');
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise<void>((res) => {
      const r = indexedDB.deleteDatabase('endowed-academy');
      r.onsuccess = r.onerror = r.onblocked = () => res();
    });
  });
}

export async function setupAdmin(page: Page) {
  await page.goto('/admin');
  await page.waitForURL('**/admin/setup');
  await page.getByLabel('Your name').fill(ADMIN.name);
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await page.getByLabel('Confirm password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL('**/admin');
}

export async function signIn(page: Page) {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/admin(\?|$)/);
}

const fixture = (n: number) => readFileSync(join(import.meta.dirname, '..', 'fixtures', `cover-${n}.jpg`)).toString('base64');

/**
 * Test-only seeding through the same data API the app uses (signed in as admin).
 * Never shipped: the production app has no seed content.
 */
export async function seedArticles(page: Page) {
  const images = [1, 2, 3, 4, 5, 6].map(fixture);
  await page.evaluate(async (imgs) => {
    const api = await import('/src/lib/data/index.ts');
    const cats = await api.taxonomy.categories();
    const cat = (name: string) => cats.find((c) => c.name === name)!.id;
    const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
    const h = (level: number, text: string) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });
    const para = 'Good study habits are built, not born. The students who seem effortlessly organised usually have a handful of small routines they repeat every day until the routines carry them. This section looks at one of those routines and how to make it your own, even when your week is unpredictable.';
    const body = (topic: string) => ({
      type: 'doc',
      content: [
        p(`${topic} matters more than most of us were taught. ${para}`),
        h(2, 'Start with what you already do'), p(para), p(para),
        h(2, 'Set goals you can measure'), p(para),
        { type: 'bulletList', content: ['Pick one subject per session', 'Write the goal at the top of the page', 'Stop when the goal is met'].map((t) => ({ type: 'listItem', content: [p(t)] })) },
        h(3, 'A quick worked example'), { type: 'paragraph', content: [{ type: 'text', text: 'If a quiz has n questions and you answer k correctly, your score is ' }, { type: 'inlineMath', attrs: { latex: '\\frac{k}{n} \\times 100\\%' } }, { type: 'text', text: '.' }] },
        { type: 'blockMath', attrs: { latex: '\\bar{x} = \\frac{1}{n}\\sum_{i=1}^{n} x_i' } },
        { type: 'blockquote', content: [p('The key to successful studying isn’t just about time. It’s about studying smarter, not harder.')] },
        h(2, 'Protect your attention'), p(para), p(para),
        h(2, 'Review, then rest'), p(para),
      ],
    });
    const articles = [
      ['How to build a study routine that actually works', 'Study Tips', 'A practical guide to a routine you can keep, even in a busy term.'],
      ['The science of effective learning', 'Academic Success', 'What research says about how memory works, and how to use it when you revise.'],
      ['Managing stress during exam season', 'Wellbeing', 'Simple ways to stay steady when the pressure rises.'],
      ['Skills for the future job market', 'Career Guidance', 'The habits and skills that will matter wherever your career goes.'],
      ['Finding your gift and growing it', 'Self Development', 'Everyone has been endowed with something. Here is how to notice yours.'],
      ['How to make the most of online learning', 'Study Tips', 'Turn a laptop and a quiet corner into a place where real learning happens.'],
      ['Why rest is part of the work', 'Wellbeing', ''],
    ] as const;
    const toFile = (b64: string, name: string) => new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], name, { type: 'image/jpeg' });
    let day = 0;
    for (const [i, [title, c, excerpt]] of articles.entries()) {
      const fi = i < 6 ? await api.adminMedia.upload(toFile(imgs[i], `cover-${i + 1}.jpg`), { alt: `Warm-lit study desk, illustration ${i + 1}` }) : null;
      const post = await api.adminPosts.create({ title, excerpt, content: body(title), categoryId: cat(c),
        featuredImage: fi ? { mediaId: fi.id, src: fi.url, alt: fi.alt, width: fi.width, height: fi.height } : null });
      day += 3;
      await api.adminPosts.publish(post.id, post.version, new Date(Date.now() - day * 86400000).toISOString());
    }
  }, images);
}
