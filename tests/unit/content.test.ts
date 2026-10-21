import { describe, expect, it } from 'vitest';
import { slugify, uniqueSlug, docToText, readingMinutes, excerptFrom, extractToc } from '@/lib/utils/content';
import { renderArticleHtml } from '@/features/content/render';
import { videoEmbedUrl, safeHref } from '@/features/editor/extensions';
import { contrastRatio } from '@/lib/utils/format';
import type { DocJSON } from '@/lib/types';

const h = (level: number, text: string) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });
const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

describe('slugs', () => {
  it('makes readable URLs', () => {
    expect(slugify('How to Build a Study Routine That Actually Works!')).toBe('how-to-build-a-study-routine-that-actually-works');
    expect(slugify('Café & Crème')).toBe('cafe-and-creme');
    expect(slugify('   ')).toBe('');
  });
  it('avoids collisions', () => {
    expect(uniqueSlug('Notes', new Set(['notes', 'notes-2']))).toBe('notes-3');
  });
});

describe('text helpers', () => {
  const doc: DocJSON = { type: 'doc', content: [h(2, 'Intro'), p('one two three'), h(2, 'Intro'), h(3, 'Detail'), p('four')] };
  it('extracts text', () => {
    expect(docToText(doc)).toBe('Intro\none two three\nIntro\nDetail\nfour');
  });
  it('estimates reading time with a one-minute floor', () => {
    expect(readingMinutes('word '.repeat(10))).toBe(1);
    expect(readingMinutes('word '.repeat(1100))).toBe(5);
  });
  it('cuts excerpts on word boundaries', () => {
    expect(excerptFrom('alpha beta gamma delta', 12)).toBe('alpha beta…');
  });
  it('builds a table of contents with unique ids', () => {
    expect(extractToc(doc)).toEqual([
      { id: 'intro', text: 'Intro', level: 2 },
      { id: 'intro-2', text: 'Intro', level: 2 },
      { id: 'detail', text: 'Detail', level: 3 },
    ]);
  });
});

describe('article rendering', () => {
  it('gives headings the same ids as the table of contents', () => {
    const html = renderArticleHtml({ type: 'doc', content: [h(2, 'Intro'), h(2, 'Intro')] });
    expect(html).toContain('id="intro"');
    expect(html).toContain('id="intro-2"');
  });
  it('renders maths with KaTeX', () => {
    const html = renderArticleHtml({ type: 'doc', content: [{ type: 'blockMath', attrs: { latex: '\\frac{a}{b}' } }] });
    expect(html).toContain('katex');
  });
  it('drops dangerous links and markup', () => {
    const html = renderArticleHtml({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }],
    });
    expect(html).not.toContain('javascript:');
  });
  it('wraps tables for horizontal scrolling on phones', () => {
    const html = renderArticleHtml({
      type: 'doc',
      content: [{ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('a')] }] }] }],
    });
    expect(html).toMatch(/class="table-wrap"[^>]*>\s*<table/);
  });
  it('renders images as figures with captions', () => {
    const html = renderArticleHtml({ type: 'doc', content: [{ type: 'image', attrs: { src: 'https://x.test/a.jpg', alt: 'Desk', caption: 'A desk' } }] });
    expect(html).toMatch(/<figure><img[^>]*alt="Desk"[^>]*><figcaption>A desk<\/figcaption><\/figure>/);
  });
});

describe('embeds and links', () => {
  it('only embeds YouTube and Vimeo', () => {
    expect(videoEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(videoEmbedUrl('https://youtu.be/dQw4w9WgXcQ')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(videoEmbedUrl('https://vimeo.com/123456789')).toBe('https://player.vimeo.com/video/123456789');
    expect(videoEmbedUrl('https://evil.example/embed/x')).toBeNull();
  });
  it('allows only safe link protocols', () => {
    expect(safeHref('/about')).toBe('/about');
    expect(safeHref('//evil.com')).toBeNull();
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('mailto:hi@example.com')).toBe('mailto:hi@example.com');
  });
});

describe('brand colour checks', () => {
  it('measures contrast against white text', () => {
    expect(contrastRatio('#BF5520', '#FFFFFF')).toBeGreaterThan(4.5);
    expect(contrastRatio('#C65A24', '#FFFFFF')).toBeLessThan(4.5); // why the default is deepened
    expect(contrastRatio('#F6F0E8', '#FFFFFF')).toBeLessThan(1.2);
  });
});
