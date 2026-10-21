// Turns uploaded files into import candidates. Supported:
//   .md / .markdown / .txt  Markdown, with optional front matter (title, date, category, tags…)
//   .docx                   Word documents (images inside are kept)
//   .html / .htm            Web pages or exported articles
//   .csv                    A spreadsheet, one article per row (see public/import-template.csv)
//   .json                   An import bundle (scripts/make-import-bundle.mjs) or a list of articles
//   .xml                    A Blogger backup
//   images                  Any images referenced by the files above, matched by file name

import { marked, type TokenizerAndRendererExtension } from 'marked';
import { slugify } from '@/lib/utils/content';
import type { DocJSON } from '@/lib/types';

export interface ImportCandidate {
  key: string;
  source: string;
  title: string;
  slug: string;
  /** Article body as HTML (Markdown, Word, HTML, CSV) … */
  html?: string;
  /** … or already-structured content (Blogger). */
  doc?: DocJSON;
  excerpt: string;
  publishedAt: string | null;
  /** Status stated in the file, if any. */
  fileStatus: 'draft' | 'published' | null;
  category: string | null;
  tags: string[];
  author: string | null;
  featuredImage: string | null; // URL, data: URI or a local file name
  seoTitle: string;
  seoDescription: string;
  comments: { authorName: string; body: string; createdAt: string }[];
  warnings: string[];
}

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif)$/i;
export const ACCEPTED = '.md,.markdown,.txt,.docx,.html,.htm,.csv,.json,.xml,image/*';

let counter = 0;
const nextKey = () => `c${++counter}`;
const base = (name: string) => name.split(/[\\/]/).pop() ?? name;
const stem = (name: string) => base(name).replace(/\.[^.]+$/, '');
const titleFromFilename = (name: string) => {
  const t = stem(name).replace(/^\d{4}-\d{2}-\d{2}[-_ ]?/, '').replace(/[-_]+/g, ' ').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Untitled';
};

function parseDate(v: unknown): string | null {
  if (!v) return null;
  const s = String(v).trim();
  // Accept 2024-08-17, 17/08/2024 and anything Date understands.
  const dmy = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(s);
  const d = dmy ? new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]), 9) : new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T09:00:00` : s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function parseStatus(v: unknown): 'draft' | 'published' | null {
  const s = String(v ?? '').trim().toLowerCase();
  if (['published', 'publish', 'live', 'public', 'yes', 'true'].includes(s)) return 'published';
  if (['draft', 'private', 'no', 'false', 'unpublished'].includes(s)) return 'draft';
  return null;
}
const splitList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String).map((x) => x.trim()).filter(Boolean) : String(v ?? '').split(/[,;|]/).map((x) => x.trim()).filter(Boolean);

function candidate(source: string, partial: Partial<ImportCandidate> & { title: string }): ImportCandidate {
  return {
    key: nextKey(), source, excerpt: '', publishedAt: null, fileStatus: null,
    category: null, tags: [], author: null, featuredImage: null, seoTitle: '', seoDescription: '', comments: [], warnings: [],
    ...partial,
    slug: slugify(partial.slug || partial.title) || 'untitled',
  };
}

// ---------------------------------------------------------------- front matter
/** Minimal YAML front matter: `key: value`, `key: [a, b]` and `- item` lists. */
export function parseFrontMatter(text: string): { data: Record<string, unknown>; body: string } {
  const m = /^﻿?---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(text);
  if (!m) return { data: {}, body: text };
  const data: Record<string, unknown> = {};
  let listKey: string | null = null;
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '');
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) { (data[listKey] as string[]).push(unquote(item[1])); continue; }
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    const val = kv[2].trim();
    if (val === '') { data[key] = []; listKey = key; continue; }
    listKey = null;
    data[key] = /^\[.*\]$/.test(val) ? val.slice(1, -1).split(',').map((x) => unquote(x.trim())).filter(Boolean) : unquote(val);
  }
  return { data, body: text.slice(m[0].length) };
}
const unquote = (s: string) => s.replace(/^(['"])(.*)\1$/, '$2');

function fromMeta(data: Record<string, unknown>) {
  const pick = (...keys: string[]) => keys.map((k) => data[k]).find((v) => v !== undefined && v !== '' && !(Array.isArray(v) && !v.length));
  const draft = pick('draft');
  const categories = splitList(pick('category', 'categories'));
  return {
    title: pick('title') ? String(pick('title')) : undefined,
    slug: pick('slug') ? String(pick('slug')) : undefined,
    publishedAt: parseDate(pick('date', 'published_at', 'published', 'publish_date')),
    fileStatus: parseStatus(pick('status')) ?? (draft !== undefined ? (parseStatus(draft) === 'published' ? 'draft' : 'published') : null),
    category: categories[0] ?? null,
    tags: [...categories.slice(1), ...splitList(pick('tags', 'labels', 'keywords'))],
    excerpt: pick('excerpt', 'summary', 'description') ? String(pick('excerpt', 'summary', 'description')) : '',
    author: pick('author') ? String(pick('author')) : null,
    featuredImage: pick('image', 'cover', 'featured_image', 'featuredimage', 'thumbnail') ? String(pick('image', 'cover', 'featured_image', 'featuredimage', 'thumbnail')) : null,
    seoTitle: pick('seo_title') ? String(pick('seo_title')) : '',
    seoDescription: pick('seo_description') ? String(pick('seo_description')) : '',
  };
}

// ------------------------------------------------------------------- markdown
const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const mathBlock: TokenizerAndRendererExtension = {
  name: 'mathBlock', level: 'block',
  start: (src) => src.indexOf('$$'),
  tokenizer(src) {
    const m = /^\$\$\s*([\s\S]+?)\s*\$\$(?:\n|$)/.exec(src);
    return m ? { type: 'mathBlock', raw: m[0], text: m[1] } : undefined;
  },
  renderer: (t) => `<div data-type="block-math" data-latex="${escapeAttr(t.text)}"></div>\n`,
};
const mathInline: TokenizerAndRendererExtension = {
  name: 'mathInline', level: 'inline',
  start: (src) => src.indexOf('$'),
  tokenizer(src) {
    const m = /^\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/.exec(src);
    return m ? { type: 'mathInline', raw: m[0], text: m[1] } : undefined;
  },
  renderer: (t) => `<span data-type="inline-math" data-latex="${escapeAttr(t.text)}"></span>`,
};
marked.use({ extensions: [mathBlock, mathInline], gfm: true });

export function markdownToCandidate(text: string, source: string): ImportCandidate {
  const { data, body } = parseFrontMatter(text);
  const meta = fromMeta(data);
  let md = body;
  let title = meta.title;
  if (!title) {
    const h1 = /^\s*#\s+(.+?)\s*#*\s*$/m.exec(md);
    if (h1 && md.trimStart().startsWith(h1[0].trim())) { title = h1[1]; md = md.replace(h1[0], ''); }
  }
  const html = marked.parse(md, { async: false }) as string;
  return candidate(source, { ...meta, title: title ?? titleFromFilename(source), html });
}

// ----------------------------------------------------------------------- html
export function htmlToCandidate(text: string, source: string): ImportCandidate {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const article = doc.querySelector('article') ?? doc.querySelector('main') ?? doc.body;
  const h1 = article.querySelector('h1');
  const title = h1?.textContent?.trim() || doc.title?.trim() || titleFromFilename(source);
  h1?.remove();
  const metaDate = doc.querySelector('meta[property="article:published_time"], time[datetime]');
  const description = doc.querySelector('meta[name="description"]')?.getAttribute('content') ?? '';
  return candidate(source, {
    title, html: article.innerHTML, excerpt: description,
    publishedAt: parseDate(metaDate?.getAttribute('content') ?? metaDate?.getAttribute('datetime')),
  });
}

// ----------------------------------------------------------------------- docx
export async function docxToCandidate(file: File): Promise<ImportCandidate> {
  const mammoth = (await import('mammoth')).default;
  const result = await mammoth.convertToHtml(
    { arrayBuffer: await file.arrayBuffer() },
    {
      styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => p.subtitle:fresh", "p[style-name='Quote'] => blockquote > p:fresh"],
      convertImage: mammoth.images.dataUri,
    },
  );
  const c = htmlToCandidate(`<body>${result.value}</body>`, file.name);
  const lost = result.messages.filter((m) => m.type === 'warning').length;
  if (lost) c.warnings.push('Some Word formatting wasn’t carried over. Check the article after importing.');
  return c;
}

// ------------------------------------------------------------------------ csv
export async function csvToCandidates(text: string, source: string): Promise<ImportCandidate[]> {
  const Papa = (await import('papaparse')).default;
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_') });
  return rowsToCandidates(parsed.data, source);
}

export function rowsToCandidates(rows: Record<string, unknown>[], source: string): ImportCandidate[] {
  const out: ImportCandidate[] = [];
  rows.forEach((row, i) => {
    const r = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase().replace(/\s+/g, '_'), v]));
    const body = String(r.content ?? r.body ?? r.html ?? r.markdown ?? r.text ?? '');
    const title = String(r.title ?? '').trim();
    if (!title && !body.trim()) return;
    const meta = fromMeta(r);
    const html = /^\s*</.test(body) ? body : (marked.parse(body, { async: false }) as string);
    const comments = Array.isArray(r.comments) ? (r.comments as ImportCandidate['comments']).filter((x) => x && x.authorName && x.body) : [];
    const c = candidate(`${source} row ${i + 2}`, { ...meta, title: title || 'Untitled', html, comments });
    if (!title) c.warnings.push('No title in this row.');
    if (!body.trim()) c.warnings.push('This row has no article text.');
    out.push(c);
  });
  return out;
}

// --------------------------------------------------------------------- bundle
interface BundleFile { name: string; type?: string; text?: string; base64?: string }
export function bundleToFiles(json: { format?: string; files?: BundleFile[] }): File[] {
  return (json.files ?? []).map((f) => {
    const data = f.base64 !== undefined ? Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0)) : new TextEncoder().encode(f.text ?? '');
    return new File([data], f.name, { type: f.type ?? '' });
  });
}

// ---------------------------------------------------------------------- entry
export interface ParsedFiles { candidates: ImportCandidate[]; images: Map<string, File>; errors: string[] }

export async function parseFiles(files: File[], depth = 0): Promise<ParsedFiles> {
  const candidates: ImportCandidate[] = [];
  const images = new Map<string, File>();
  const errors: string[] = [];
  for (const file of files) {
    const name = file.name;
    const ext = name.toLowerCase().split('.').pop() ?? '';
    try {
      if (IMAGE_EXT.test(name) || file.type.startsWith('image/')) {
        images.set(base(name).toLowerCase(), file);
      } else if (['md', 'markdown', 'txt'].includes(ext)) {
        candidates.push(markdownToCandidate(await file.text(), name));
      } else if (['html', 'htm'].includes(ext)) {
        candidates.push(htmlToCandidate(await file.text(), name));
      } else if (ext === 'docx') {
        candidates.push(await docxToCandidate(file));
      } else if (ext === 'csv') {
        candidates.push(...(await csvToCandidates(await file.text(), name)));
      } else if (ext === 'xml') {
        const { parseBloggerXml } = await import('./blogger');
        const res = parseBloggerXml(await file.text());
        for (const p of res.posts) {
          candidates.push(candidate(name, {
            title: p.title, slug: p.slug, doc: p.content, publishedAt: p.publishedAt, fileStatus: p.isDraft ? 'draft' : 'published',
            category: p.labels[0] ?? null, tags: p.labels.slice(1), author: p.authorName || null, featuredImage: p.featuredImageUrl, comments: p.comments,
          }));
        }
      } else if (ext === 'json') {
        const json = JSON.parse(await file.text());
        if (json && json.format === 'endowed-import' && depth === 0) {
          const inner = await parseFiles(bundleToFiles(json), depth + 1);
          candidates.push(...inner.candidates);
          inner.images.forEach((v, k) => images.set(k, v));
          errors.push(...inner.errors);
        } else if (Array.isArray(json) || Array.isArray(json?.posts)) {
          candidates.push(...rowsToCandidates(Array.isArray(json) ? json : json.posts, name));
        } else {
          errors.push(`${name}: this JSON file isn’t an import bundle or a list of articles.`);
        }
      } else if (ext === 'doc') {
        errors.push(`${name}: old .doc files can’t be read. Open it in Word and save as .docx.`);
      } else {
        errors.push(`${name}: this file type isn’t supported.`);
      }
    } catch (e) {
      errors.push(`${name}: ${e instanceof Error ? e.message : 'couldn’t be read.'}`);
    }
  }
  return { candidates, images, errors };
}

/** Local images an article refers to that haven't been provided. */
export function missingImages(c: ImportCandidate, images: Map<string, File>): string[] {
  const refs = c.html ? [...c.html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]) : [];
  if (c.featuredImage) refs.push(c.featuredImage);
  return refs.filter((src) => !/^(https?:|data:)/.test(src) && !images.has(base(safeDecode(src)).toLowerCase())).map((s) => base(s));
}
const safeDecode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

export { base as fileBaseName };
