// Parses a Blogger backup (Settings → Manage blog → Back up content) or a
// Blogger Atom feed into articles that fit our schema.

import { generateJSON } from '@tiptap/html';
import DOMPurify from 'dompurify';
import type { DocJSON, DocNode } from '@/lib/types';
import { articleExtensions } from '@/features/editor/extensions';
import { slugify } from '@/lib/utils/content';

export interface ParsedBloggerPost {
  bloggerId: string;
  title: string;
  slug: string;
  publishedAt: string;
  isDraft: boolean;
  labels: string[];
  authorName: string;
  content: DocJSON;
  featuredImageUrl: string | null;
  comments: { authorName: string; body: string; createdAt: string }[];
}

const KIND_POST = 'kind#post';
const KIND_COMMENT = 'kind#comment';

function text(el: Element | null | undefined): string {
  return el?.textContent?.trim() ?? '';
}
function byLocal(parent: Element, name: string): Element[] {
  return [...parent.children].filter((c) => c.localName === name);
}

function entryKind(entry: Element): 'post' | 'comment' | 'other' {
  const type = byLocal(entry, 'type')[0]; // new backups: <blogger:type>POST</blogger:type>
  if (type) {
    const t = text(type).toUpperCase();
    return t === 'POST' ? 'post' : t === 'COMMENT' ? 'comment' : 'other';
  }
  const cat = byLocal(entry, 'category').find((c) => c.getAttribute('scheme')?.endsWith('#kind'));
  const term = cat?.getAttribute('term') ?? '';
  if (term.endsWith(KIND_POST)) return 'post';
  if (term.endsWith(KIND_COMMENT)) return 'comment';
  // Public feeds don't mark kind; every entry is a post.
  return cat ? 'other' : 'post';
}

/** Blogger HTML is mostly <div>s and <br>s. Normalise to paragraphs first. */
function normaliseHtml(raw: string): string {
  const clean = DOMPurify.sanitize(raw, {
    FORBID_TAGS: ['style', 'script', 'form', 'input', 'button', 'font'],
    FORBID_ATTR: ['style', 'class', 'id', 'align', 'face', 'size', 'color'],
    ADD_TAGS: ['iframe'],
  });
  const tpl = document.createElement('template');
  tpl.innerHTML = clean;
  const root = tpl.content;

  // Unwrap links around images (Blogger wraps every image in a link to the original).
  root.querySelectorAll('a > img').forEach((img) => {
    const a = img.parentElement!;
    if (a.childElementCount === 1 && !a.textContent?.trim()) {
      const href = a.getAttribute('href');
      if (href && /\.(jpe?g|png|gif|webp)|blogger\.googleusercontent|bp\.blogspot/i.test(href)) img.setAttribute('src', img.getAttribute('src') ?? href);
      a.replaceWith(img);
    }
  });
  // Divs without block children become paragraphs; double <br> splits paragraphs.
  const blockTags = /^(P|DIV|H[1-6]|UL|OL|TABLE|BLOCKQUOTE|PRE|FIGURE|IMG|IFRAME)$/;
  root.querySelectorAll('div').forEach((div) => {
    const hasBlock = [...div.children].some((c) => blockTags.test(c.tagName));
    if (!hasBlock) {
      const p = document.createElement('p');
      p.innerHTML = div.innerHTML;
      div.replaceWith(p);
    } else {
      div.replaceWith(...div.childNodes);
    }
  });
  let html = (() => { const d = document.createElement('div'); d.appendChild(root.cloneNode(true)); return d.innerHTML; })();
  html = html.replace(/(<br\s*\/?>\s*){2,}/gi, '</p><p>');
  // Blogger H1s are content headings in our article layout.
  html = html.replace(/<h1(\s|>)/gi, '<h2$1').replace(/<\/h1>/gi, '</h2>');
  if (!/^\s*<(p|h\d|ul|ol|figure|blockquote|table|img|iframe)/i.test(html)) html = `<p>${html}</p>`;
  return html;
}

function stripEmpty(doc: DocJSON): DocJSON {
  const isEmptyP = (n: DocNode) => n.type === 'paragraph' && (!n.content || n.content.every((c) => c.type === 'hardBreak' || (c.type === 'text' && !c.text?.trim())));
  const content = (doc.content ?? []).filter((n) => !isEmptyP(n));
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

export function parseBloggerXml(xml: string): { posts: ParsedBloggerPost[]; skipped: number } {
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  if (dom.querySelector('parsererror')) throw new Error('This file isn’t a valid Blogger backup. Download it again from Blogger → Settings → Back up content.');
  const entries = [...dom.getElementsByTagName('entry')];
  if (!entries.length) throw new Error('No posts were found in this file.');

  const posts = new Map<string, ParsedBloggerPost>();
  const pending: { parent: string; c: ParsedBloggerPost['comments'][number] }[] = [];
  let skipped = 0;

  for (const e of entries) {
    const kind = entryKind(e);
    const id = text(byLocal(e, 'id')[0]);
    if (kind === 'comment') {
      const parent = byLocal(e, 'in-reply-to')[0]?.getAttribute('ref') ?? text(byLocal(e, 'parent')[0]);
      const body = new DOMParser().parseFromString(text(byLocal(e, 'content')[0]), 'text/html').body.textContent?.trim() ?? '';
      if (parent && body) {
        pending.push({ parent, c: { authorName: text(byLocal(byLocal(e, 'author')[0] ?? e, 'name')[0]) || 'Reader', body: body.slice(0, 2000), createdAt: new Date(text(byLocal(e, 'published')[0])).toISOString() } });
      }
      continue;
    }
    if (kind !== 'post') continue;

    const statusEl = byLocal(e, 'status')[0];
    const draftEl = [...e.getElementsByTagName('*')].find((x) => x.localName === 'draft');
    const isDraft = (statusEl && text(statusEl).toUpperCase() !== 'LIVE') || text(draftEl) === 'yes';
    if (statusEl && text(statusEl).toUpperCase() === 'DELETED') { skipped++; continue; }

    const title = text(byLocal(e, 'title')[0]) || 'Untitled';
    const rawHtml = text(byLocal(e, 'content')[0]);
    if (!rawHtml) { skipped++; continue; }
    const filename = text(byLocal(e, 'filename')[0]);
    const altLink = byLocal(e, 'link').find((l) => l.getAttribute('rel') === 'alternate')?.getAttribute('href') ?? '';
    const pathSlug = (filename || altLink).split('/').pop()?.replace(/\.html$/, '') ?? '';
    const labels = byLocal(e, 'category')
      .filter((c) => !c.getAttribute('scheme')?.endsWith('#kind'))
      .map((c) => c.getAttribute('term') ?? '')
      .filter(Boolean);

    let content = stripEmpty(generateJSON(normaliseHtml(rawHtml), articleExtensions()) as DocJSON);
    // If the article opens with an image, use it as the featured image instead.
    let featuredImageUrl: string | null = null;
    const first = content.content?.[0];
    if (first?.type === 'image' && typeof first.attrs?.src === 'string') {
      featuredImageUrl = first.attrs.src;
      content = { ...content, content: content.content!.slice(1) };
    } else {
      const firstImg = (content.content ?? []).find((n) => n.type === 'image');
      featuredImageUrl = (firstImg?.attrs?.src as string) ?? null;
    }

    const published = text(byLocal(e, 'published')[0]);
    posts.set(id, {
      bloggerId: id,
      title,
      slug: slugify(pathSlug || title) || slugify(title),
      publishedAt: published ? new Date(published).toISOString() : new Date().toISOString(),
      isDraft: Boolean(isDraft),
      labels,
      authorName: text(byLocal(byLocal(e, 'author')[0] ?? e, 'name')[0]),
      content,
      featuredImageUrl,
      comments: [],
    });
  }
  for (const { parent, c } of pending) {
    const p = posts.get(parent) ?? [...posts.values()].find((x) => parent.endsWith(x.bloggerId.split('post-').pop() ?? '###'));
    p?.comments.push(c);
  }
  return { posts: [...posts.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)), skipped };
}
