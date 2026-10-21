// Exports every article (with images embedded) as one JSON file that the
// Import page can read back. Used to move content from the in-browser
// preview into Supabase, and as a simple backup in either mode.

import { adminComments, adminPosts, taxonomy } from '@/lib/data';

async function toDataUri(src: string): Promise<string | null> {
  if (!src || src.startsWith('data:')) return src || null;
  try {
    const blob = await (await fetch(src)).blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export interface ExportFile { format: 'endowed-export'; version: 1; exportedAt: string; posts: Record<string, unknown>[] }

export async function exportAll(onProgress?: (done: number, total: number) => void): Promise<ExportFile> {
  const [cats, tags] = await Promise.all([taxonomy.categories(), taxonomy.tags()]);
  const first = await adminPosts.list({ pageSize: 10000, sort: 'publishedAt', dir: 'asc' });
  const rows: Record<string, unknown>[] = [];
  for (const [i, summary] of first.items.entries()) {
    onProgress?.(i, first.items.length);
    const p = await adminPosts.get(summary.id);
    // Embed images so the file is self-contained.
    const { renderArticleHtml } = await import('@/features/content/render');
    const tpl = document.createElement('template');
    tpl.innerHTML = renderArticleHtml(p.content);
    for (const img of tpl.content.querySelectorAll('img')) {
      const uri = await toDataUri(img.getAttribute('src') ?? '');
      if (uri) img.setAttribute('src', uri);
      img.removeAttribute('data-media-id');
    }
    const div = document.createElement('div');
    div.appendChild(tpl.content.cloneNode(true));
    const comments = (await adminComments.list({ postId: p.id, status: 'approved', pageSize: 10000 })).items;
    rows.push({
      title: p.title,
      slug: p.slug,
      status: p.status === 'published' ? 'published' : 'draft',
      date: p.publishedAt,
      category: cats.find((c) => c.id === p.categoryId)?.name ?? '',
      tags: tags.filter((t) => p.tagIds.includes(t.id)).map((t) => t.name),
      excerpt: p.excerpt,
      author: p.authorName,
      seo_title: p.seoTitle,
      seo_description: p.seoDescription,
      image: p.featuredImage?.src ? await toDataUri(p.featuredImage.src) : '',
      content: div.innerHTML,
      comments: comments.map((c) => ({ authorName: c.authorName, body: c.body, createdAt: c.createdAt })),
    });
  }
  onProgress?.(first.items.length, first.items.length);
  return { format: 'endowed-export', version: 1, exportedAt: new Date().toISOString(), posts: rows };
}

export function downloadJson(data: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
