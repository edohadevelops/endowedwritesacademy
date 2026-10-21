import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseBloggerXml } from '@/features/import/blogger';
import { docToText } from '@/lib/utils/content';
import { renderArticleHtml } from '@/features/content/render';

const xml = readFileSync('tests/fixtures/blogger-sample.xml', 'utf8');

describe('Blogger import', () => {
  const { posts, skipped } = parseBloggerXml(xml);

  it('reads posts and drafts, skipping deleted ones', () => {
    expect(posts.map((p) => p.title)).toEqual(['Unfinished thoughts', 'IDENTITY']);
    expect(posts[0].isDraft).toBe(true);
    expect(posts[1].isDraft).toBe(false);
    expect(skipped).toBe(1);
  });

  it('keeps the original URL slug, date and labels', () => {
    const p = posts[1];
    expect(p.slug).toBe('identity');
    expect(p.publishedAt).toBe('2024-08-17T10:00:00.000Z');
    expect(p.labels).toEqual(['Self Development', 'Youth']);
  });

  it('turns the opening image into the featured image', () => {
    expect(posts[1].featuredImageUrl).toBe('https://blogger.googleusercontent.com/img/s320.jpg');
    expect(posts[1].content.content?.[0].type).not.toBe('image');
  });

  it('converts Blogger’s div-and-br markup into clean paragraphs and headings', () => {
    const types = posts[1].content.content?.map((n) => n.type);
    expect(types).toEqual(['paragraph', 'paragraph', 'heading', 'paragraph']);
    expect(docToText(posts[1].content)).toContain('First paragraph about identity.');
  });

  it('removes scripts', () => {
    const html = renderArticleHtml(posts[1].content);
    expect(html).not.toContain('<script');
    expect(html).toContain('<strong>Bold</strong>');
  });

  it('attaches comments as plain text', () => {
    expect(posts[1].comments).toEqual([{ authorName: 'Reader One', body: 'This blessed me.', createdAt: '2024-08-20T10:00:00.000Z' }]);
  });

  it('rejects files that are not Blogger backups', () => {
    expect(() => parseBloggerXml('<html>nope')).toThrow();
  });
});
