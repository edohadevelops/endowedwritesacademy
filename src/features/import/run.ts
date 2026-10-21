// Commits reviewed import candidates: uploads their images to the media
// library, converts HTML to the article schema, maps categories and tags,
// and inserts the articles (skipping web addresses that already exist).

import { generateJSON } from '@tiptap/html';
import DOMPurify from 'dompurify';
import { adminMedia, importer, taxonomy } from '@/lib/data';
import type { DocJSON, ImageRef, MediaAsset } from '@/lib/types';
import { articleExtensions } from '@/features/editor/extensions';
import { uniqueSlug } from '@/lib/utils/content';
import { fileBaseName, type ImportCandidate } from './sources';

export interface ImportChoice {
  candidate: ImportCandidate;
  title: string;
  status: 'draft' | 'published';
  categoryName: string | null;
}

export interface ImportResult { imported: number; skipped: string[]; imageFailures: string[] }

function dataUriToFile(uri: string, name: string): File | null {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(uri);
  if (!m) return null;
  const bytes = m[2] ? Uint8Array.from(atob(m[3]), (c) => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(m[3]));
  return new File([bytes], name, { type: m[1] });
}

const safeDecode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

export async function runImport(
  choices: ImportChoice[],
  images: Map<string, File>,
  defaultAuthor: string,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> {
  const imageFailures: string[] = [];
  const uploaded = new Map<string, MediaAsset>();

  // Upload an image once, however many articles use it.
  const resolve = async (src: string, alt: string, hint: string): Promise<MediaAsset | null> => {
    if (/^https?:/.test(src)) return null;
    const key = src.startsWith('data:') ? `data:${src.length}:${src.slice(-40)}` : fileBaseName(safeDecode(src)).toLowerCase();
    if (uploaded.has(key)) return uploaded.get(key)!;
    const file = src.startsWith('data:') ? dataUriToFile(src, `${hint}.${src.slice(11, src.indexOf(';')) || 'png'}`) : images.get(key);
    if (!file) return null;
    try {
      const asset = await adminMedia.upload(file, { alt });
      uploaded.set(key, asset);
      return asset;
    } catch (e) {
      imageFailures.push(`${file.name}: ${e instanceof Error ? e.message : 'upload failed'}`);
      return null;
    }
  };

  const cats = await taxonomy.categories();
  const taken = await importer.existingImportSlugs();
  const skipped: string[] = [];
  const items: Parameters<typeof importer.insertPosts>[0] = [];

  for (const [i, ch] of choices.entries()) {
    const c = ch.candidate;
    onProgress?.(i, choices.length);
    if (taken.has(c.slug)) { skipped.push(`${ch.title} (already on the site)`); continue; }

    // ---- content
    let doc: DocJSON;
    let firstImage: ImageRef | null = null;
    if (c.doc) {
      doc = c.doc;
    } else {
      const tpl = document.createElement('template');
      tpl.innerHTML = DOMPurify.sanitize(c.html ?? '', { ADD_TAGS: ['iframe'], ADD_ATTR: ['data-latex', 'data-type', 'allow', 'allowfullscreen'] });
      for (const img of [...tpl.content.querySelectorAll('img')]) {
        const src = img.getAttribute('src') ?? '';
        const asset = await resolve(src, img.getAttribute('alt') ?? '', `${c.slug}-image`);
        if (asset) {
          img.setAttribute('src', asset.url);
          img.setAttribute('data-media-id', asset.id);
          img.setAttribute('width', String(asset.width));
          img.setAttribute('height', String(asset.height));
        } else if (!/^https?:/.test(src)) {
          img.remove(); // a local file that wasn't provided
        }
      }
      const div = document.createElement('div');
      div.appendChild(tpl.content.cloneNode(true));
      doc = generateJSON(div.innerHTML, articleExtensions()) as DocJSON;
    }
    const firstNode = doc.content?.find((n) => n.type === 'image');
    if (firstNode?.attrs?.src) {
      firstImage = { src: String(firstNode.attrs.src), alt: String(firstNode.attrs.alt ?? ''), mediaId: (firstNode.attrs.mediaId as string) ?? null };
    }

    // ---- featured image
    let featuredImage: ImageRef | null = null;
    if (c.featuredImage) {
      const asset = await resolve(c.featuredImage, ch.title, `${c.slug}-cover`);
      featuredImage = asset
        ? { mediaId: asset.id, src: asset.url, alt: asset.alt || ch.title, width: asset.width, height: asset.height }
        : /^https?:/.test(c.featuredImage) ? { src: c.featuredImage, alt: '', mediaId: null } : null;
    }
    featuredImage ??= firstImage;
    if (featuredImage && doc.content?.[0]?.type === 'image' && doc.content[0].attrs?.src === featuredImage.src) {
      doc = { ...doc, content: doc.content.slice(1) }; // don't show the cover twice
    }

    // ---- taxonomy
    let categoryId: string | null = null;
    if (ch.categoryName) {
      const match = cats.find((x) => x.name.toLowerCase() === ch.categoryName!.toLowerCase());
      categoryId = match ? match.id : (await taxonomy.saveCategory({ name: ch.categoryName, description: '' })).id;
      if (!match) cats.push({ id: categoryId, name: ch.categoryName, slug: '', description: '', sortOrder: 99 });
    }
    const tagIds = c.tags.length ? (await taxonomy.ensureTags(c.tags)).map((t) => t.id) : [];

    const slug = uniqueSlug(c.slug || ch.title, taken);
    taken.add(slug);
    items.push({
      title: ch.title, slug, excerpt: c.excerpt, content: doc, featuredImage,
      authorName: c.author || defaultAuthor, categoryId, tagIds,
      status: ch.status,
      publishedAt: ch.status === 'published' ? (c.publishedAt ?? new Date().toISOString()) : c.publishedAt,
      seoTitle: c.seoTitle, seoDescription: c.seoDescription, isFeatured: false, commentsEnabled: true,
      source: c.source.toLowerCase().endsWith('.xml') ? 'blogger-import' : 'import', comments: c.comments,
    });
  }
  const imported = items.length ? await importer.insertPosts(items) : 0;
  onProgress?.(choices.length, choices.length);
  return { imported, skipped, imageFailures };
}
