import type { DocJSON, DocNode } from '../types';

export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

export function uniqueSlug(base: string, taken: Set<string>): string {
  const root = slugify(base) || 'untitled';
  if (!taken.has(root)) return root;
  let i = 2;
  while (taken.has(`${root}-${i}`)) i++;
  return `${root}-${i}`;
}

export const emptyDoc = (): DocJSON => ({ type: 'doc', content: [{ type: 'paragraph' }] });

function nodeText(node: DocNode, out: string[]): void {
  if (node.text) out.push(node.text);
  if (node.type === 'inlineMath' || node.type === 'blockMath') {
    out.push(String(node.attrs?.latex ?? ''));
  }
  if (node.content) for (const c of node.content) nodeText(c, out);
  if (['paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock', 'tableCell', 'tableHeader', 'figure'].includes(node.type)) {
    out.push('\n');
  }
}

export function docToText(doc: DocJSON | null | undefined): string {
  if (!doc?.content) return '';
  const out: string[] = [];
  for (const n of doc.content) nodeText(n, out);
  return out.join('').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
}

export function wordCount(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

/** ~220 wpm for considered educational reading. Minimum one minute. */
export function readingMinutes(text: string): number {
  return Math.max(1, Math.round(wordCount(text) / 220));
}

export function excerptFrom(text: string, max = 180): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:.\s]+$/, '')}…`;
}

export interface TocEntry { id: string; text: string; level: 2 | 3 }

/** Headings used for the table of contents. Ids match what ArticleBody assigns. */
export function extractToc(doc: DocJSON | null | undefined): TocEntry[] {
  const seen = new Map<string, number>();
  const toc: TocEntry[] = [];
  for (const node of doc?.content ?? []) {
    if (node.type !== 'heading') continue;
    const level = Number(node.attrs?.level);
    if (level !== 2 && level !== 3) continue;
    const text = docToText({ type: 'doc', content: [node] }).trim();
    if (!text) continue;
    toc.push({ id: headingId(text, seen), text, level });
  }
  return toc;
}

export function headingId(text: string, seen: Map<string, number>): string {
  const base = slugify(text) || 'section';
  const n = seen.get(base) ?? 0;
  seen.set(base, n + 1);
  return n === 0 ? base : `${base}-${n + 1}`;
}

/** Walks a document and returns every node of a given type (used for media checks). */
export function collectNodes(doc: DocJSON, type: string): DocNode[] {
  const out: DocNode[] = [];
  const walk = (n: DocNode) => {
    if (n.type === type) out.push(n);
    n.content?.forEach(walk);
  };
  doc.content?.forEach(walk);
  return out;
}

/** Returns a deep-mapped copy of the document. */
export function mapDoc(doc: DocJSON, fn: (n: DocNode) => DocNode): DocJSON {
  const walk = (n: DocNode): DocNode => {
    const mapped = fn(n);
    return mapped.content ? { ...mapped, content: mapped.content.map(walk) } : mapped;
  };
  return { ...doc, content: doc.content?.map(walk) };
}
