import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseFrontMatter, markdownToCandidate, rowsToCandidates, csvToCandidates, htmlToCandidate, missingImages, bundleToFiles } from '@/features/import/sources';

describe('front matter', () => {
  it('reads scalars, inline lists and dash lists', () => {
    const { data, body } = parseFrontMatter('---\ntitle: "Hello: world"\ntags: [a, b]\ncategories:\n  - Study Tips\n  - Extra\ndraft: true\n---\nBody');
    expect(data).toEqual({ title: 'Hello: world', tags: ['a', 'b'], categories: ['Study Tips', 'Extra'], draft: 'true' });
    expect(body).toBe('Body');
  });
  it('leaves files without front matter alone', () => {
    expect(parseFrontMatter('# Title\ntext').data).toEqual({});
  });
});

describe('markdown', () => {
  const c = markdownToCandidate(readFileSync('tests/fixtures/import/revision-week.md', 'utf8'), 'revision-week.md');
  it('takes metadata from front matter', () => {
    expect(c.title).toBe('How to plan a revision week');
    expect(c.slug).toBe('how-to-plan-a-revision-week');
    expect(c.fileStatus).toBe('published');
    expect(c.category).toBe('Study Tips');
    expect(c.tags).toEqual(['revision', 'planning']);
    expect(c.excerpt).toBe('A simple plan for the week before exams.');
    expect(c.featuredImage).toBe('cover.jpg');
    expect(c.publishedAt?.slice(0, 10)).toBe('2025-03-02');
  });
  it('converts headings, bold, images and equations', () => {
    expect(c.html).toContain('<h2>Make a timetable</h2>');
    expect(c.html).toContain('<strong>two short sessions</strong>');
    expect(c.html).toContain('<img src="planner.jpg"');
    expect(c.html).toMatch(/data-type="inline-math" data-latex="\\bar\{x\}/);
    expect(c.html).toContain('data-type="block-math"');
  });
  it('uses a leading # heading as the title when front matter has none', () => {
    const m = markdownToCandidate('# My Title\n\nText', 'x.md');
    expect(m.title).toBe('My Title');
    expect(m.html).not.toContain('<h1>');
  });
  it('falls back to a tidy file name', () => {
    expect(markdownToCandidate('Just text', '2024-01-05-my-first_post.md').title).toBe('My first post');
  });
  it('does not treat prices as maths', () => {
    expect(markdownToCandidate('It costs $5 and $10 today', 'x.md').html).not.toContain('inline-math');
  });
  it('reports images that were not provided', () => {
    expect(missingImages(c, new Map())).toEqual(['planner.jpg', 'cover.jpg']);
    const imgs = new Map([['planner.jpg', new File([], 'planner.jpg')], ['cover.jpg', new File([], 'cover.jpg')]]);
    expect(missingImages(c, imgs)).toEqual([]);
  });
});

describe('spreadsheets and lists', () => {
  it('reads the CSV template', async () => {
    const rows = await csvToCandidates(readFileSync('public/import-template.csv', 'utf8'), 'posts.csv');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ title: 'How to plan a revision week', fileStatus: 'published', category: 'Study Tips', tags: ['revision', 'planning'] });
    expect(rows[0].html).toContain('<h2>Make a timetable</h2>');
    expect(rows[1]).toMatchObject({ fileStatus: 'draft', category: 'Wellbeing', publishedAt: null });
  });
  it('accepts common column names and day/month/year dates', () => {
    const [c] = rowsToCandidates([{ Title: 'A', Body: '<p>Hi</p>', Date: '17/08/2024', Labels: 'x; y' }], 'list.json');
    expect(c.html).toBe('<p>Hi</p>');
    expect(c.publishedAt?.slice(0, 10)).toBe('2024-08-17');
    expect(c.tags).toEqual(['x', 'y']);
  });
  it('skips empty rows and warns about missing titles', () => {
    const rows = rowsToCandidates([{ title: '', content: '' }, { content: 'text only' }], 'x.csv');
    expect(rows).toHaveLength(1);
    expect(rows[0].warnings[0]).toMatch(/No title/);
  });
});

describe('html and bundles', () => {
  it('pulls the title and body from a saved page', () => {
    const c = htmlToCandidate('<html><head><title>Site | Post</title><meta name="description" content="Desc"></head><body><nav>menu</nav><article><h1>Real title</h1><p>Body</p></article></body></html>', 'post.html');
    expect(c.title).toBe('Real title');
    expect(c.html).toBe('<p>Body</p>');
    expect(c.excerpt).toBe('Desc');
  });
  it('unpacks bundle files', async () => {
    const json = JSON.parse(readFileSync('tests/fixtures/import-bundle.json', 'utf8'));
    const files = bundleToFiles(json);
    expect(files.map((f) => f.name).sort()).toEqual(['cover.jpg', 'faith-and-focus.docx', 'planner.jpg', 'posts.csv', 'revision-week.md']);
    const md = files.find((f) => f.name === 'revision-week.md')!;
    expect(await md.text()).toContain('How to plan a revision week');
  });
});
