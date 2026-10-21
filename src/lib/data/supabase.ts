// Supabase implementation of the data API. Exports exactly the same names as
// ./local, so pages don't change. Selected at build time when
// VITE_SUPABASE_URL is set (see vite.config.ts).
//
// Authorisation is enforced by Postgres (RLS + grants in supabase/migrations).
// The checks here only give friendlier errors; they are not the security.

import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js';
import { AppError } from './errors';
import { notify, type DataKey } from './events';
import { processImage, safeFilename } from './media';
import {
  isPubliclyVisible, displayStatus, mergeSettings, validateSettings,
  type PostSummary, type AdminPostRow, type StatusFilter, type SortKey, type AdminCommentRow, type ImportPostInput, type BackendInfo,
} from './shared';
import type {
  AdminUser, Category, Comment, CommentStatus, DisplayStatus, DocJSON, ImageRef, MediaAsset, Page, Post, PostDraftInput,
  PublicComment, Revision, RevisionReason, SiteSettings, Tag,
} from '../types';
import { CHECKPOINT_INTERVAL_MS } from '@/config/defaults';
import { collectNodes, docToText, emptyDoc, excerptFrom, mapDoc, readingMinutes, slugify, uniqueSlug } from '../utils/content';
import { passwordProblems } from '@/features/auth/crypto';
import type { CommentInput } from '@/features/comments/moderation';

export { isPubliclyVisible, displayStatus };
export type { PostSummary, AdminPostRow, StatusFilter, SortKey, AdminCommentRow };

export const backend: BackendInfo = { kind: 'supabase', firstRunSetup: false, passwordReset: true, shared: true };

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
export const supabase: SupabaseClient = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const BUCKET = 'media';
const now = () => new Date().toISOString();

// ============================================================================
// Errors
// ============================================================================

function fail(error: PostgrestError | { message?: string; code?: string; status?: number } | null, fallback = 'Something went wrong. Try again.'): never {
  const code = (error as PostgrestError | null)?.code ?? '';
  const status = (error as { status?: number } | null)?.status;
  if (code === '42501' || code === 'PGRST301' || status === 401) throw new AppError('unauthorized', 'Your session has ended. Sign in again to continue.');
  if (status === 403) throw new AppError('forbidden', 'This account doesn’t have permission to do that.');
  if (code === '23505') throw new AppError('validation', 'That name or web address is already used.', { slug: 'Another article already uses this web address.', name: 'This name is already used.' });
  if (code === '23514') throw new AppError('validation', 'Some of the details are too long or not allowed. Check and try again.');
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new AppError('unknown', 'You’re offline. Check your connection and try again.');
  throw new AppError('unknown', fallback);
}
function must<T>(res: { data: T | null; error: PostgrestError | null }, fallback?: string): T {
  if (res.error) fail(res.error, fallback);
  return res.data as T;
}

// ============================================================================
// Row mapping
// ============================================================================

interface PostRow {
  id: string; title: string; slug: string; excerpt: string; content: DocJSON; content_html: string; content_text: string;
  featured_image: ImageRef | null; author_name: string; category_id: string | null; status: Post['status'];
  published_at: string | null; seo_title: string; seo_description: string; is_featured: boolean; comments_enabled: boolean;
  reading_minutes: number; version: number; source: string | null; created_at: string; updated_at: string; deleted_at: string | null;
  post_tags?: { tag_id: string }[];
}
const POST_COLS = 'id,title,slug,excerpt,content,content_html,content_text,featured_image,author_name,category_id,status,published_at,seo_title,seo_description,is_featured,comments_enabled,reading_minutes,version,source,created_at,updated_at,deleted_at,post_tags(tag_id)';
const SUMMARY_COLS = 'id,title,slug,excerpt,featured_image,category_id,published_at,reading_minutes,author_name';

const toPost = (r: PostRow): Post => ({
  id: r.id, title: r.title, slug: r.slug, previousSlugs: [], excerpt: r.excerpt, content: r.content, contentHtml: r.content_html,
  contentText: r.content_text, featuredImage: r.featured_image, authorName: r.author_name, categoryId: r.category_id,
  tagIds: (r.post_tags ?? []).map((t) => t.tag_id), status: r.status, publishedAt: r.published_at, createdAt: r.created_at,
  updatedAt: r.updated_at, deletedAt: r.deleted_at, seoTitle: r.seo_title, seoDescription: r.seo_description, isFeatured: r.is_featured,
  commentsEnabled: r.comments_enabled, readingMinutes: r.reading_minutes, version: r.version,
  source: (r.source as Post['source']) ?? null,
});

type CategoryRow = { id: string; name: string; slug: string; description: string; sort_order: number };
const toCategory = (r: CategoryRow): Category => ({ id: r.id, name: r.name, slug: r.slug, description: r.description, sortOrder: r.sort_order });

type CommentRow = { id: string; post_id: string; author_name: string; body: string; status: CommentStatus; flags: string[]; created_at: string; moderated_at: string | null };
const toComment = (r: CommentRow): Comment => ({ id: r.id, postId: r.post_id, authorName: r.author_name, body: r.body, status: r.status, flags: r.flags ?? [], createdAt: r.created_at, moderatedAt: r.moderated_at });

type MediaRow = { id: string; storage_path: string; filename: string; mime_type: string; size_bytes: number; width: number; height: number; alt: string; caption: string; created_at: string };
const publicUrl = (path: string) => supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
const toAsset = (r: MediaRow): MediaAsset => ({
  id: r.id, filename: r.filename, mimeType: r.mime_type, sizeBytes: r.size_bytes, width: r.width, height: r.height,
  alt: r.alt, caption: r.caption, createdAt: r.created_at, url: publicUrl(r.storage_path),
});

/** Plain-text and reading time are derived from content on every save. */
async function contentColumns(doc: DocJSON) {
  const { renderArticleHtml } = await import('@/features/content/render');
  const text = docToText(doc);
  return { content: doc, content_html: renderArticleHtml(doc), content_text: text, reading_minutes: readingMinutes(text) };
}

function draftToRow(p: PostDraftInput): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (p.title !== undefined) row.title = p.title.trim() || 'Untitled article';
  if (p.excerpt !== undefined) row.excerpt = p.excerpt;
  if (p.featuredImage !== undefined) row.featured_image = p.featuredImage;
  if (p.authorName !== undefined) row.author_name = p.authorName;
  if (p.categoryId !== undefined) row.category_id = p.categoryId;
  if (p.status !== undefined) row.status = p.status;
  if (p.publishedAt !== undefined) row.published_at = p.publishedAt;
  if (p.seoTitle !== undefined) row.seo_title = p.seoTitle;
  if (p.seoDescription !== undefined) row.seo_description = p.seoDescription;
  if (p.isFeatured !== undefined) row.is_featured = p.isFeatured;
  if (p.commentsEnabled !== undefined) row.comments_enabled = p.commentsEnabled;
  return row;
}

// ---- media lookups ----------------------------------------------------------
const mediaCache = new Map<string, string>();
async function mediaUrls(ids: string[]): Promise<Map<string, string>> {
  const missing = [...new Set(ids)].filter((id) => !mediaCache.has(id));
  if (missing.length) {
    const { data } = await supabase.from('media_assets').select('id,storage_path').in('id', missing);
    (data ?? []).forEach((m) => mediaCache.set(m.id, publicUrl(m.storage_path)));
  }
  return new Map(ids.filter((id) => mediaCache.has(id)).map((id) => [id, mediaCache.get(id)!]));
}
async function withImages<T extends { featuredImage: ImageRef | null }>(items: T[]): Promise<T[]> {
  const urls = await mediaUrls(items.map((i) => i.featuredImage?.mediaId).filter(Boolean) as string[]);
  return items.map((i) => (i.featuredImage?.mediaId && urls.get(i.featuredImage.mediaId) ? { ...i, featuredImage: { ...i.featuredImage, src: urls.get(i.featuredImage.mediaId)! } } : i));
}

/** Point library images inside content at their current URLs. */
export async function resolveDocMedia(doc: DocJSON): Promise<DocJSON> {
  const ids = collectNodes(doc, 'image').map((n) => n.attrs?.mediaId).filter(Boolean) as string[];
  if (!ids.length) return doc;
  const urls = await mediaUrls(ids);
  return mapDoc(doc, (n) => (n.type === 'image' && n.attrs?.mediaId && urls.get(String(n.attrs.mediaId)) ? { ...n, attrs: { ...n.attrs, src: urls.get(String(n.attrs.mediaId)) } } : n));
}
export async function resolveHtmlMedia(html: string): Promise<string> {
  const ids = [...html.matchAll(/data-media-id="([\w-]+)"/g)].map((m) => m[1]);
  if (!ids.length) return html;
  const urls = await mediaUrls(ids);
  return html.replace(/<img\b[^>]*>/g, (tag) => {
    const id = /data-media-id="([\w-]+)"/.exec(tag)?.[1];
    const u = id && urls.get(id);
    return u ? tag.replace(/\ssrc="[^"]*"/, ` src="${u.replace(/"/g, '&quot;')}"`) : tag;
  });
}

// ============================================================================
// Auth
// ============================================================================

let cachedAdmin: { userId: string; admin: AdminUser | null } | null = null;

async function currentAdmin(): Promise<AdminUser | null> {
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) { cachedAdmin = null; return null; }
  if (cachedAdmin?.userId === user.id) return cachedAdmin.admin;
  const { data: role } = await supabase.from('admin_roles').select('role, display_name').eq('user_id', user.id).maybeSingle();
  const admin = role ? { id: user.id, email: user.email ?? '', displayName: role.display_name || user.email || 'Administrator', role: role.role as AdminUser['role'] } : null;
  cachedAdmin = { userId: user.id, admin };
  return admin;
}
async function requireAdmin(): Promise<AdminUser> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new AppError('unauthorized', 'Your session has ended. Sign in again to continue.');
  const a = await currentAdmin();
  if (!a) throw new AppError('forbidden', 'This account doesn’t have access to the admin.');
  return a;
}
supabase.auth.onAuthStateChange(() => { cachedAdmin = null; });

async function audit(action: string, target: string) {
  await supabase.from('audit_log').insert({ action, target: target.slice(0, 300) });
  notify('audit');
}

export const auth = {
  async needsSetup(): Promise<boolean> {
    return false; // the owner is invited from the Supabase dashboard (see MIGRATION.md)
  },
  async createFirstAdmin(_input: { email: string; password: string; displayName: string }): Promise<AdminUser> {
    throw new AppError('forbidden', 'Accounts are created by invitation. See MIGRATION.md, step 5.');
  },
  async signIn(email: string, password: string): Promise<AdminUser> {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) {
      if (error.status === 429) throw new AppError('rate_limited', 'Too many attempts. Wait a few minutes and try again.');
      if (/confirm/i.test(error.message)) throw new AppError('unauthorized', 'Confirm your email address first, using the link in your invitation.');
      throw new AppError('unauthorized', 'That email and password don’t match.');
    }
    cachedAdmin = null;
    const admin = await currentAdmin();
    if (!admin) {
      await supabase.auth.signOut();
      throw new AppError('forbidden', 'This account isn’t an administrator for this site.');
    }
    await audit('signed in', admin.email);
    return admin;
  },
  async signOut(): Promise<void> {
    await supabase.auth.signOut();
    cachedAdmin = null;
  },
  async getUser(): Promise<AdminUser | null> {
    try { return await currentAdmin(); } catch { return null; }
  },
  async requestPasswordReset(email: string): Promise<void> {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: `${window.location.origin}/admin/reset-password` });
    if (error?.status === 429) throw new AppError('rate_limited', 'A reset email was sent recently. Wait a minute before asking again.');
    // Other errors are not shown, so the form never reveals which emails have accounts.
  },
  async updatePassword(next: string): Promise<void> {
    const problem = passwordProblems(next);
    if (problem) throw new AppError('validation', problem, { next: problem });
    const { error } = await supabase.auth.updateUser({ password: next });
    if (error) throw new AppError('unauthorized', 'This reset link has expired. Ask for a new one from the sign-in page.');
  },
  async changePassword(current: string, next: string): Promise<void> {
    const me = await requireAdmin();
    const problem = passwordProblems(next);
    if (problem) throw new AppError('validation', problem, { next: problem });
    const { error: reauth } = await supabase.auth.signInWithPassword({ email: me.email, password: current });
    if (reauth) throw new AppError('validation', 'Your current password is incorrect.', { current: 'Your current password is incorrect.' });
    const { error } = await supabase.auth.updateUser({ password: next });
    if (error) throw new AppError('validation', error.message.includes('different') ? 'Choose a password you haven’t used here before.' : 'Couldn’t change the password. Try again.', { next: 'Try a different password.' });
    await audit('changed password', me.email);
  },
};

// ============================================================================
// Settings
// ============================================================================

export const settings = {
  async get(): Promise<SiteSettings> {
    const { data } = await supabase.from('site_settings').select('settings').eq('id', 1).maybeSingle();
    const s = mergeSettings((data?.settings ?? {}) as Partial<SiteSettings>);
    // Blocked words are private; only an admin session can read them.
    const { data: session } = await supabase.auth.getSession();
    if (session.session) {
      const { data: mod } = await supabase.from('moderation_settings').select('blocked_terms, mode').eq('id', 1).maybeSingle();
      if (mod) s.comments = { ...s.comments, blockedTerms: mod.blocked_terms ?? [], moderation: mod.mode };
    }
    return s;
  },
  async logoUrl(s: SiteSettings): Promise<string | null> {
    return s.logoMediaId ? (await mediaUrls([s.logoMediaId])).get(s.logoMediaId) ?? null : null;
  },
  validate: validateSettings,
  async save(next: SiteSettings): Promise<SiteSettings> {
    await requireAdmin();
    const errors = validateSettings(next);
    if (Object.keys(errors).length) throw new AppError('validation', 'Check the highlighted settings.', errors);
    const { blockedTerms, ...publicComments } = next.comments;
    must(await supabase.from('site_settings').update({ settings: { ...next, comments: { ...publicComments, blockedTerms: [] } }, updated_at: now() }).eq('id', 1));
    must(await supabase.from('moderation_settings').update({ blocked_terms: blockedTerms, mode: next.comments.moderation, updated_at: now() }).eq('id', 1));
    await audit('updated settings', 'site');
    notify('settings');
    return next;
  },
};

// ============================================================================
// Categories & tags
// ============================================================================

/** Only articles that are live right now (an admin browsing the blog must not see drafts there). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const publicOnly = <Q,>(q: Q): Q => (q as any).eq('status', 'published').is('deleted_at', null).lte('published_at', now()) as Q;

export const taxonomy = {
  async categories(): Promise<Category[]> {
    const rows = must(await supabase.from('categories').select('id,name,slug,description,sort_order').order('sort_order').order('name'));
    return (rows as CategoryRow[]).map(toCategory);
  },
  async tags(): Promise<Tag[]> {
    return must(await supabase.from('tags').select('id,name,slug').order('name')) as Tag[];
  },
  async publicCategories(): Promise<(Category & { count: number })[]> {
    const [cats, posts] = await Promise.all([
      taxonomy.categories(),
      publicOnly(supabase.from('posts').select('category_id')).limit(10000),
    ]);
    const counts = new Map<string, number>();
    (posts.data ?? []).forEach((p) => p.category_id && counts.set(p.category_id, (counts.get(p.category_id) ?? 0) + 1));
    return cats.map((c) => ({ ...c, count: counts.get(c.id) ?? 0 })).filter((c) => c.count > 0);
  },
  async saveCategory(input: { id?: string; name: string; description: string }): Promise<Category> {
    await requireAdmin();
    const name = input.name.trim();
    if (!name) throw new AppError('validation', 'Enter a category name.', { name: 'Enter a category name.' });
    const all = await taxonomy.categories();
    const others = all.filter((c) => c.id !== input.id);
    if (others.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      throw new AppError('validation', 'A category with this name already exists.', { name: 'A category with this name already exists.' });
    }
    const existing = all.find((c) => c.id === input.id);
    const slug = existing?.name === name ? existing.slug : uniqueSlug(name, new Set(others.map((c) => c.slug)));
    const row = { name, slug, description: input.description.trim() };
    const res = existing
      ? await supabase.from('categories').update(row).eq('id', existing.id).select().single()
      : await supabase.from('categories').insert({ ...row, sort_order: all.length }).select().single();
    notify('categories');
    return toCategory(must(res) as CategoryRow);
  },
  async reorderCategories(ids: string[]): Promise<void> {
    await requireAdmin();
    await Promise.all(ids.map((id, i) => supabase.from('categories').update({ sort_order: i }).eq('id', id)));
    notify('categories');
  },
  async deleteCategory(id: string): Promise<void> {
    await requireAdmin();
    must(await supabase.from('categories').delete().eq('id', id));
    notify('categories'); notify('posts');
  },
  async ensureTags(names: string[]): Promise<Tag[]> {
    await requireAdmin();
    const clean = [...new Set(names.map((n) => n.trim().replace(/\s+/g, ' ').slice(0, 40)).filter(Boolean))];
    if (!clean.length) return [];
    const existing = await taxonomy.tags();
    const out: Tag[] = [];
    const taken = new Set(existing.map((t) => t.slug));
    for (const name of clean) {
      const found = existing.find((t) => t.name.toLowerCase() === name.toLowerCase());
      if (found) { out.push(found); continue; }
      const slug = uniqueSlug(name, taken);
      taken.add(slug);
      out.push(must(await supabase.from('tags').insert({ name, slug }).select('id,name,slug').single()) as Tag);
    }
    notify('tags');
    return out;
  },
  async deleteTag(id: string): Promise<void> {
    await requireAdmin();
    must(await supabase.from('tags').delete().eq('id', id));
    notify('tags'); notify('posts');
  },
};

// ============================================================================
// Public reading API
// ============================================================================

type SummaryRow = { id: string; title: string; slug: string; excerpt: string; featured_image: ImageRef | null; category_id: string | null; published_at: string | null; reading_minutes: number; author_name: string };
async function toSummaries(rows: SummaryRow[]): Promise<PostSummary[]> {
  const cats = await taxonomy.categories();
  return withImages(rows.map((r) => ({
    id: r.id, title: r.title, slug: r.slug, excerpt: r.excerpt, featuredImage: r.featured_image,
    category: cats.find((c) => c.id === r.category_id) ?? null, publishedAt: r.published_at, readingMinutes: r.reading_minutes, authorName: r.author_name,
  })));
}

export const publicApi = {
  async listPosts(opts: { page?: number; pageSize?: number; q?: string; categorySlug?: string; tagSlug?: string; excludeIds?: string[] }): Promise<Page<PostSummary> & { category?: Category; tag?: Tag }> {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = opts.pageSize ?? 9;
    const q = (opts.q ?? '').trim();

    let category: Category | undefined;
    let tag: Tag | undefined;
    if (opts.categorySlug) {
      category = (await taxonomy.categories()).find((c) => c.slug === opts.categorySlug);
      if (!category) return { items: [], total: 0, page, pageSize };
    }
    if (opts.tagSlug) {
      tag = (await taxonomy.tags()).find((t) => t.slug === opts.tagSlug);
      if (!tag) return { items: [], total: 0, page, pageSize };
    }

    if (q) {
      // Postgres full-text search, ranked (see search_posts in the migrations).
      const hits = must(await supabase.rpc('search_posts', { q, page, page_size: pageSize })) as { id: string; total: number }[];
      if (!hits.length) return { items: [], total: 0, page, pageSize, category, tag };
      const rows = must(await supabase.from('posts').select(SUMMARY_COLS).in('id', hits.map((h) => h.id))) as SummaryRow[];
      const ordered = hits.map((h) => rows.find((r) => r.id === h.id)).filter(Boolean) as SummaryRow[];
      return { items: await toSummaries(ordered), total: Number(hits[0].total), page, pageSize, category, tag };
    }

    let query = publicOnly(supabase.from('posts').select(tag ? `${SUMMARY_COLS},post_tags!inner(tag_id)` : SUMMARY_COLS, { count: 'exact' }));
    if (category) query = query.eq('category_id', category.id);
    if (tag) query = query.eq('post_tags.tag_id', tag.id);
    if (opts.excludeIds?.length) query = query.not('id', 'in', `(${opts.excludeIds.join(',')})`);
    const res = await query.order('published_at', { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
    const rows = must(res) as unknown as SummaryRow[];
    return { items: await toSummaries(rows), total: res.count ?? rows.length, page, pageSize, category, tag };
  },

  async featured(): Promise<PostSummary | null> {
    const chosen = await publicOnly(supabase.from('posts').select(SUMMARY_COLS)).eq('is_featured', true).limit(1);
    const rows = (chosen.data ?? []) as SummaryRow[];
    if (!rows.length) {
      const latest = await publicOnly(supabase.from('posts').select(SUMMARY_COLS)).order('published_at', { ascending: false }).limit(1);
      rows.push(...((latest.data ?? []) as SummaryRow[]));
    }
    return rows.length ? (await toSummaries(rows))[0] : null;
  },

  async postBySlug(slug: string): Promise<{ kind: 'post'; post: Post; category: Category | null; tags: Tag[] } | { kind: 'redirect'; slug: string } | null> {
    const { data, error } = await publicOnly(supabase.from('posts').select(POST_COLS)).eq('slug', slug).maybeSingle();
    if (error) fail(error);
    if (!data) {
      const { data: moved } = await supabase.rpc('resolve_slug', { old_slug: slug });
      return moved ? { kind: 'redirect', slug: moved as string } : null;
    }
    const [withImg] = await withImages([toPost(data as unknown as PostRow)]);
    const post = { ...withImg, contentHtml: await resolveHtmlMedia(withImg.contentHtml) };
    const [cats, tags] = await Promise.all([taxonomy.categories(), taxonomy.tags()]);
    return { kind: 'post', post, category: cats.find((c) => c.id === post.categoryId) ?? null, tags: tags.filter((t) => post.tagIds.includes(t.id)) };
  },

  /** Deterministic: shared tags weigh most, then same category, then recency. */
  async related(post: Post, limit = 3): Promise<PostSummary[]> {
    const rows = must(await publicOnly(supabase.from('posts').select(`${SUMMARY_COLS},post_tags(tag_id)`)).neq('id', post.id).order('published_at', { ascending: false }).limit(60)) as unknown as (SummaryRow & { post_tags: { tag_id: string }[] })[];
    const scored = rows
      .map((r) => ({ r, s: r.post_tags.filter((t) => post.tagIds.includes(t.tag_id)).length * 2 + (post.categoryId && r.category_id === post.categoryId ? 3 : 0) }))
      .sort((a, b) => b.s - a.s || (b.r.published_at ?? '').localeCompare(a.r.published_at ?? ''))
      .slice(0, limit)
      .map((x) => x.r);
    return toSummaries(scored);
  },

  async approvedComments(postId: string): Promise<PublicComment[]> {
    const rows = must(await supabase.from('comments').select('id,author_name,body,created_at').eq('post_id', postId).eq('status', 'approved').order('created_at')) as { id: string; author_name: string; body: string; created_at: string }[];
    return rows.map((r) => ({ id: r.id, authorName: r.author_name, body: r.body, createdAt: r.created_at }));
  },

  /** Goes through the submit-comment Edge Function; the browser can't write comments directly. */
  async submitComment(postId: string, input: CommentInput): Promise<{ status: 'pending' | 'approved' }> {
    const { data, error } = await supabase.functions.invoke('submit-comment', { body: { postId, ...input } });
    if (!error) return { status: (data as { status: 'pending' | 'approved' }).status };
    const ctx = (error as { context?: Response }).context;
    let body: { error?: string; fields?: Record<string, string> } = {};
    try { body = (await ctx?.json()) ?? {}; } catch { /* not JSON */ }
    if (body.error === 'validation') throw new AppError('validation', 'Check the highlighted fields.', body.fields);
    if (body.error === 'rate_limited') throw new AppError('rate_limited', 'You’ve posted several comments in a short time. Wait a few minutes and try again.');
    if (body.error === 'closed') throw new AppError('forbidden', 'Comments are closed for this article.');
    if (body.error === 'not_found') throw new AppError('not_found', 'This article is no longer available.');
    throw new AppError('unknown', 'Your comment couldn’t be sent. Check your connection and try again.');
  },

  async sitemapEntries(): Promise<{ slug: string; updatedAt: string }[]> {
    const rows = must(await publicOnly(supabase.from('posts').select('slug,updated_at')).limit(5000)) as { slug: string; updated_at: string }[];
    return rows.map((r) => ({ slug: r.slug, updatedAt: r.updated_at }));
  },
};

// ============================================================================
// Admin: posts
// ============================================================================

async function takenSlugs(exceptId?: string): Promise<Set<string>> {
  const [posts, history] = await Promise.all([
    supabase.from('posts').select('id,slug').limit(10000),
    supabase.from('post_slug_history').select('slug,post_id').limit(10000),
  ]);
  const s = new Set<string>();
  (posts.data ?? []).forEach((p) => p.id !== exceptId && s.add(p.slug));
  (history.data ?? []).forEach((h) => h.post_id !== exceptId && s.add(h.slug));
  return s;
}

async function addRevision(p: Pick<Post, 'id' | 'title' | 'excerpt' | 'content'>, reason: RevisionReason) {
  await supabase.from('post_revisions').insert({ post_id: p.id, title: p.title, excerpt: p.excerpt, content: p.content, reason });
  notify('revisions');
}

async function setTags(postId: string, tagIds: string[]) {
  must(await supabase.from('post_tags').delete().eq('post_id', postId));
  if (tagIds.length) must(await supabase.from('post_tags').insert(tagIds.map((tag_id) => ({ post_id: postId, tag_id }))));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyStatusFilter<Q,>(query: Q, status: StatusFilter): Q {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = query as any;
  const t = now();
  switch (status) {
    case 'trashed': return q.not('deleted_at', 'is', null);
    case 'published': return q.is('deleted_at', null).eq('status', 'published').lte('published_at', t);
    case 'scheduled': return q.is('deleted_at', null).eq('status', 'published').gt('published_at', t);
    case 'draft': case 'archived': return q.is('deleted_at', null).eq('status', status);
    default: return q.is('deleted_at', null);
  }
}

const safeSearch = (s: string) => s.replace(/[,()%*\\]/g, ' ').trim();

export const adminPosts = {
  async list(opts: { page?: number; pageSize?: number; q?: string; status?: StatusFilter; sort?: SortKey; dir?: 'asc' | 'desc'; categoryId?: string }): Promise<Page<AdminPostRow>> {
    await requireAdmin();
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = opts.pageSize ?? 15;
    const sortCol = { updatedAt: 'updated_at', publishedAt: 'published_at', title: 'title' }[opts.sort ?? 'updatedAt'];
    let q = applyStatusFilter(supabase.from('posts').select(POST_COLS, { count: 'exact' }), opts.status ?? 'all');
    if (opts.categoryId) q = q.eq('category_id', opts.categoryId);
    const term = safeSearch(opts.q ?? '');
    if (term) q = q.or(`title.ilike.%${term}%,slug.ilike.%${term}%,excerpt.ilike.%${term}%`);
    const res = await q.order(sortCol, { ascending: opts.dir === 'asc', nullsFirst: false }).range((page - 1) * pageSize, page * pageSize - 1);
    const rows = (must(res) as unknown as PostRow[]).map(toPost);
    const ids = rows.map((r) => r.id);
    const [cats, comments] = await Promise.all([
      taxonomy.categories(),
      ids.length ? supabase.from('comments').select('post_id,status').in('post_id', ids) : Promise.resolve({ data: [] as { post_id: string; status: string }[] }),
    ]);
    const items = (await withImages(rows)).map((p) => ({
      ...p, display: displayStatus(p), category: cats.find((c) => c.id === p.categoryId) ?? null,
      commentCount: (comments.data ?? []).filter((c) => c.post_id === p.id && c.status === 'approved').length,
      pendingCount: (comments.data ?? []).filter((c) => c.post_id === p.id && c.status === 'pending').length,
    }));
    return { items, total: res.count ?? items.length, page, pageSize };
  },

  async counts(): Promise<Record<DisplayStatus, number>> {
    await requireAdmin();
    const keys: DisplayStatus[] = ['draft', 'scheduled', 'published', 'archived', 'trashed'];
    const results = await Promise.all(keys.map((k) => applyStatusFilter(supabase.from('posts').select('id', { count: 'exact', head: true }), k)));
    return Object.fromEntries(keys.map((k, i) => [k, results[i].count ?? 0])) as Record<DisplayStatus, number>;
  },

  async get(id: string): Promise<Post> {
    await requireAdmin();
    const { data, error } = await supabase.from('posts').select(POST_COLS).eq('id', id).maybeSingle();
    if (error) fail(error);
    if (!data) throw new AppError('not_found', 'This article doesn’t exist or was deleted.');
    const [p] = await withImages([toPost(data as unknown as PostRow)]);
    return { ...p, content: await resolveDocMedia(p.content) };
  },

  async create(input: PostDraftInput = {}): Promise<Post> {
    const me = await requireAdmin();
    const s = await settings.get();
    const title = input.title?.trim() || 'Untitled article';
    const content = input.content ?? emptyDoc();
    const row = {
      ...draftToRow(input), title, slug: uniqueSlug(input.slug || title, await takenSlugs()), status: 'draft', published_at: null, is_featured: false,
      author_name: input.authorName ?? s.defaultAuthorName ?? me.displayName, ...(await contentColumns(content)),
    };
    const saved = toPost(must(await supabase.from('posts').insert(row).select(POST_COLS).single()) as unknown as PostRow);
    if (input.tagIds?.length) await setTags(saved.id, input.tagIds);
    await audit('created article', saved.title);
    notify('posts');
    return { ...saved, tagIds: input.tagIds ?? [] };
  },

  /** Conflict-aware: only updates if the stored version is the one the editor last saw. */
  async save(id: string, patch: PostDraftInput, expectedVersion: number, opts: { revision?: RevisionReason } = {}): Promise<Post> {
    await requireAdmin();
    const row: Record<string, unknown> = draftToRow(patch);
    if (patch.content) Object.assign(row, await contentColumns(patch.content));
    if (patch.slug !== undefined) {
      const wanted = slugify(patch.slug) || slugify(patch.title ?? '') || 'untitled';
      const { data: cur } = await supabase.from('posts').select('slug').eq('id', id).maybeSingle();
      if (cur && wanted !== cur.slug) {
        if ((await takenSlugs(id)).has(wanted)) throw new AppError('validation', 'Another article already uses this URL.', { slug: 'Another article already uses this URL.' });
        row.slug = wanted;
      }
    }
    if (!opts.revision) {
      // Autosave: keep a checkpoint of the previous state at most every 10 minutes.
      const { data: last } = await supabase.from('post_revisions').select('created_at').eq('post_id', id).eq('reason', 'checkpoint').order('created_at', { ascending: false }).limit(1);
      if (!last?.length || Date.now() - new Date(last[0].created_at).getTime() > CHECKPOINT_INTERVAL_MS) {
        const { data: prev } = await supabase.from('posts').select('id,title,excerpt,content').eq('id', id).maybeSingle();
        if (prev) await addRevision(prev as Pick<Post, 'id' | 'title' | 'excerpt' | 'content'>, 'checkpoint');
      }
    }
    const { data, error } = await supabase.from('posts').update(row).eq('id', id).eq('version', expectedVersion).select(POST_COLS).maybeSingle();
    if (error) {
      if (error.code === '23505' || /slug_taken/.test(error.message)) throw new AppError('validation', 'Another article already uses this URL.', { slug: 'Another article already uses this URL.' });
      fail(error);
    }
    if (!data) {
      const { data: exists } = await supabase.from('posts').select('id,deleted_at').eq('id', id).maybeSingle();
      if (!exists || exists.deleted_at) throw new AppError('not_found', 'This article was deleted.');
      throw new AppError('conflict', 'This article was changed somewhere else (another tab or a restore). Reload to get the latest version.');
    }
    if (patch.tagIds) await setTags(id, patch.tagIds);
    let saved = toPost(data as unknown as PostRow);
    if (patch.tagIds) saved = { ...saved, tagIds: patch.tagIds };
    if (opts.revision) await addRevision(saved, opts.revision);
    notify('posts');
    const [withImg] = await withImages([saved]);
    return { ...withImg, content: patch.content ?? (await resolveDocMedia(saved.content)) };
  },

  async publish(id: string, expectedVersion: number, at?: string | null): Promise<Post> {
    const cur = await adminPosts.get(id);
    if (!cur.title.trim() || cur.title === 'Untitled article') throw new AppError('validation', 'Give the article a title before publishing.');
    if (!cur.contentText.trim()) throw new AppError('validation', 'Write something before publishing.');
    const publishedAt = at ?? (cur.publishedAt && (cur.status === 'published' || cur.source) ? cur.publishedAt : now());
    const saved = await adminPosts.save(id, { status: 'published', publishedAt, excerpt: cur.excerpt.trim() || excerptFrom(cur.contentText) }, expectedVersion, { revision: 'publish' });
    await audit(new Date(publishedAt).getTime() > Date.now() ? 'scheduled' : 'published', saved.title);
    return saved;
  },
  async unpublish(id: string, expectedVersion: number): Promise<Post> {
    const saved = await adminPosts.save(id, { status: 'draft', isFeatured: false }, expectedVersion);
    await audit('unpublished', saved.title);
    return saved;
  },
  async archive(id: string, expectedVersion: number): Promise<Post> {
    const saved = await adminPosts.save(id, { status: 'archived', isFeatured: false }, expectedVersion);
    await audit('archived', saved.title);
    return saved;
  },
  async setFeatured(id: string, featured: boolean): Promise<void> {
    await requireAdmin();
    must(await supabase.from('posts').update({ is_featured: featured }).eq('id', id));
    notify('posts');
  },
  async duplicate(id: string): Promise<Post> {
    const src = await adminPosts.get(id);
    return adminPosts.create({
      title: `${src.title} (copy)`, excerpt: src.excerpt, content: src.content, featuredImage: src.featuredImage, categoryId: src.categoryId,
      tagIds: src.tagIds, seoTitle: src.seoTitle, seoDescription: src.seoDescription, commentsEnabled: src.commentsEnabled, authorName: src.authorName,
    });
  },
  async trash(ids: string[]): Promise<void> {
    await requireAdmin();
    const rows = must(await supabase.from('posts').update({ deleted_at: now(), is_featured: false }).in('id', ids).select('title')) as { title: string }[];
    await audit(ids.length === 1 ? 'moved to trash' : `moved ${ids.length} articles to trash`, ids.length === 1 ? rows[0]?.title ?? 'articles' : 'articles');
    notify('posts');
  },
  async restore(ids: string[]): Promise<void> {
    await requireAdmin();
    must(await supabase.from('posts').update({ status: 'draft' }).in('id', ids).eq('status', 'published'));
    must(await supabase.from('posts').update({ deleted_at: null }).in('id', ids));
    await audit(`restored ${ids.length} from trash`, 'articles');
    notify('posts');
  },
  async deleteForever(ids: string[]): Promise<void> {
    await requireAdmin();
    const live = must(await supabase.from('posts').select('id').in('id', ids).is('deleted_at', null)) as { id: string }[];
    if (live.length) throw new AppError('validation', 'Move articles to the trash before deleting them permanently.');
    must(await supabase.from('posts').delete().in('id', ids));
    await audit(`permanently deleted ${ids.length}`, 'articles');
    notify('posts'); notify('comments');
  },
  async bulkStatus(ids: string[], action: 'publish' | 'unpublish' | 'archive'): Promise<{ done: number; skipped: number }> {
    let done = 0;
    let skipped = 0;
    for (const id of ids) {
      try {
        const p = await adminPosts.get(id);
        if (action === 'publish') await adminPosts.publish(id, p.version);
        else if (action === 'unpublish') await adminPosts.unpublish(id, p.version);
        else await adminPosts.archive(id, p.version);
        done++;
      } catch {
        skipped++;
      }
    }
    return { done, skipped };
  },
  async revisions(postId: string): Promise<Revision[]> {
    await requireAdmin();
    const rows = must(await supabase.from('post_revisions').select('id,post_id,title,excerpt,content,reason,created_at').eq('post_id', postId).order('created_at', { ascending: false })) as { id: string; post_id: string; title: string; excerpt: string; content: DocJSON; reason: RevisionReason; created_at: string }[];
    return rows.map((r) => ({ id: r.id, postId: r.post_id, title: r.title, excerpt: r.excerpt, content: r.content, reason: r.reason, createdAt: r.created_at }));
  },
  async restoreRevision(revisionId: string, expectedVersion: number): Promise<Post> {
    await requireAdmin();
    const { data: rev } = await supabase.from('post_revisions').select('post_id,title,excerpt,content').eq('id', revisionId).maybeSingle();
    if (!rev) throw new AppError('not_found', 'That revision no longer exists.');
    const { data: cur } = await supabase.from('posts').select('id,title,excerpt,content').eq('id', rev.post_id).maybeSingle();
    if (cur) await addRevision(cur as Pick<Post, 'id' | 'title' | 'excerpt' | 'content'>, 'before-restore');
    const saved = await adminPosts.save(rev.post_id, { title: rev.title, excerpt: rev.excerpt, content: rev.content as DocJSON }, expectedVersion, { revision: 'manual' });
    await audit('restored a revision of', saved.title);
    return saved;
  },
};

// ============================================================================
// Admin: comments
// ============================================================================

export const adminComments = {
  async list(opts: { status?: CommentStatus | 'all'; postId?: string; page?: number; pageSize?: number }): Promise<Page<AdminCommentRow>> {
    await requireAdmin();
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = opts.pageSize ?? 20;
    let q = supabase.from('comments').select('id,post_id,author_name,body,status,flags,created_at,moderated_at,posts(title,slug)', { count: 'exact' });
    if (opts.status && opts.status !== 'all') q = q.eq('status', opts.status);
    if (opts.postId) q = q.eq('post_id', opts.postId);
    const res = await q.order('created_at', { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
    const rows = must(res) as unknown as (CommentRow & { posts: { title: string; slug: string } | null })[];
    return {
      items: rows.map((r) => ({ ...toComment(r), postTitle: r.posts?.title ?? 'Deleted article', postSlug: r.posts?.slug ?? '' })),
      total: res.count ?? rows.length, page, pageSize,
    };
  },
  async counts(): Promise<Record<CommentStatus, number>> {
    await requireAdmin();
    const keys: CommentStatus[] = ['pending', 'approved', 'rejected', 'spam'];
    const r = await Promise.all(keys.map((k) => supabase.from('comments').select('id', { count: 'exact', head: true }).eq('status', k)));
    return Object.fromEntries(keys.map((k, i) => [k, r[i].count ?? 0])) as Record<CommentStatus, number>;
  },
  async setStatus(ids: string[], status: CommentStatus): Promise<void> {
    await requireAdmin();
    must(await supabase.from('comments').update({ status, moderated_at: now() }).in('id', ids));
    notify('comments');
  },
  async remove(ids: string[]): Promise<void> {
    await requireAdmin();
    must(await supabase.from('comments').delete().in('id', ids));
    notify('comments');
  },
};

// ============================================================================
// Admin: media (Supabase Storage bucket "media")
// ============================================================================

const storagePath = (ext: string) => {
  const d = new Date();
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.${ext}`;
};

export const adminMedia = {
  async list(q = ''): Promise<MediaAsset[]> {
    await requireAdmin();
    let query = supabase.from('media_assets').select('*').order('created_at', { ascending: false }).limit(500);
    const term = safeSearch(q);
    if (term) query = query.or(`filename.ilike.%${term}%,alt.ilike.%${term}%`);
    return (must(await query) as MediaRow[]).map(toAsset);
  },
  async upload(file: File, meta: { alt?: string; caption?: string } = {}): Promise<MediaAsset> {
    await requireAdmin();
    const img = await processImage(file);
    const ext = img.mimeType.split('/')[1];
    const path = storagePath(ext);
    const up = await supabase.storage.from(BUCKET).upload(path, img.blob, { contentType: img.mimeType, cacheControl: '31536000', upsert: false });
    if (up.error) throw new AppError('storage', 'The image couldn’t be uploaded. Check your connection and try again.');
    const res = await supabase.from('media_assets').insert({
      storage_path: path, filename: `${safeFilename(file.name)}.${ext}`, mime_type: img.mimeType, size_bytes: img.blob.size,
      width: img.width, height: img.height, alt: meta.alt ?? '', caption: meta.caption ?? '',
    }).select().single();
    if (res.error) {
      await supabase.storage.from(BUCKET).remove([path]);
      fail(res.error, 'The image couldn’t be saved.');
    }
    notify('media');
    const asset = toAsset(res.data as MediaRow);
    mediaCache.set(asset.id, asset.url);
    return asset;
  },
  async updateMeta(id: string, meta: { alt: string; caption: string }): Promise<void> {
    await requireAdmin();
    must(await supabase.from('media_assets').update({ alt: meta.alt.trim(), caption: meta.caption.trim() }).eq('id', id));
    notify('media');
  },
  /** New file at a new path (so CDN caches never serve the old one); every use updates. */
  async replace(id: string, file: File): Promise<MediaAsset> {
    await requireAdmin();
    const { data: cur } = await supabase.from('media_assets').select('*').eq('id', id).maybeSingle();
    if (!cur) throw new AppError('not_found', 'That image no longer exists.');
    const img = await processImage(file);
    const path = storagePath(img.mimeType.split('/')[1]);
    const up = await supabase.storage.from(BUCKET).upload(path, img.blob, { contentType: img.mimeType, cacheControl: '31536000' });
    if (up.error) throw new AppError('storage', 'The new image couldn’t be uploaded.');
    const row = must(await supabase.from('media_assets').update({ storage_path: path, mime_type: img.mimeType, size_bytes: img.blob.size, width: img.width, height: img.height }).eq('id', id).select().single()) as MediaRow;
    await supabase.storage.from(BUCKET).remove([cur.storage_path]);
    const asset = toAsset(row);
    mediaCache.set(id, asset.url);
    // Keep stored featured-image URLs (used for link previews) current.
    const { data: uses } = await supabase.from('posts').select('id,featured_image').eq('featured_image->>mediaId', id);
    for (const p of uses ?? []) {
      await supabase.from('posts').update({ featured_image: { ...(p.featured_image as ImageRef), src: asset.url, width: asset.width, height: asset.height } }).eq('id', p.id);
    }
    notify('media'); notify('posts');
    return asset;
  },
  async usage(id: string): Promise<{ id: string; title: string }[]> {
    await requireAdmin();
    const rows = must(await supabase.from('posts').select('id,title').or(`featured_image->>mediaId.eq.${id},content_html.ilike.*data-media-id="${id}"*`)) as { id: string; title: string }[];
    const s = await settings.get();
    return s.logoMediaId === id ? [...rows, { id: 'settings', title: 'Site logo' }] : rows;
  },
  async remove(id: string): Promise<void> {
    const used = await adminMedia.usage(id);
    if (used.length) throw new AppError('validation', `This image is still used in: ${used.map((u) => u.title).join(', ')}. Remove it there first.`);
    const { data: cur } = await supabase.from('media_assets').select('storage_path').eq('id', id).maybeSingle();
    must(await supabase.from('media_assets').delete().eq('id', id));
    if (cur) await supabase.storage.from(BUCKET).remove([cur.storage_path]);
    mediaCache.delete(id);
    notify('media');
  },
};

// ============================================================================
// Dashboard
// ============================================================================

export const dashboard = {
  async overview() {
    await requireAdmin();
    const [counts, comments, recent, upcoming, activity] = await Promise.all([
      adminPosts.counts(),
      adminComments.counts(),
      supabase.from('posts').select(POST_COLS).is('deleted_at', null).order('updated_at', { ascending: false }).limit(6),
      supabase.from('posts').select(POST_COLS).is('deleted_at', null).eq('status', 'published').gt('published_at', now()).order('published_at').limit(3),
      supabase.from('audit_log').select('id,action,target,created_at').order('created_at', { ascending: false }).limit(8),
    ]);
    const recentPosts = await withImages(((recent.data ?? []) as unknown as PostRow[]).map(toPost));
    return {
      counts,
      pendingComments: comments.pending,
      approvedComments: comments.approved,
      recent: recentPosts.map((p) => ({ ...p, display: displayStatus(p) })),
      upcoming: ((upcoming.data ?? []) as unknown as PostRow[]).map(toPost),
      activity: (activity.data ?? []).map((a) => ({ id: String(a.id), at: a.created_at, actor: '', action: a.action, target: a.target })),
    };
  },
};

// ============================================================================
// Import
// ============================================================================

export const importer = {
  async existingImportSlugs(): Promise<Set<string>> {
    await requireAdmin();
    return takenSlugs();
  },
  async insertPosts(items: ImportPostInput[]): Promise<number> {
    await requireAdmin();
    const taken = await takenSlugs();
    let count = 0;
    for (const it of items) {
      if (taken.has(it.slug)) continue;
      const { comments, tagIds, ...rest } = it;
      const cols = await contentColumns(rest.content);
      const row = {
        ...draftToRow(rest), slug: it.slug, source: rest.source ?? 'import', ...cols,
        excerpt: rest.excerpt || excerptFrom(cols.content_text),
        created_at: rest.publishedAt ?? now(),
      };
      const res = await supabase.from('posts').insert(row).select('id').single();
      if (res.error) continue; // skip a bad row, keep importing the rest
      const id = (res.data as { id: string }).id;
      taken.add(it.slug);
      if (tagIds.length) await setTags(id, tagIds);
      if (comments.length) {
        await supabase.from('comments').insert(comments.map((c) => ({ post_id: id, author_name: c.authorName.slice(0, 60).padEnd(2, '.'), body: c.body.slice(0, 2000), status: 'approved', created_at: c.createdAt, moderated_at: now() })));
      }
      await addRevision({ id, title: rest.title, excerpt: row.excerpt, content: rest.content }, 'import');
      count++;
    }
    await audit(`imported ${count} articles`, 'import');
    notify('posts'); notify('comments'); notify('categories');
    return count;
  },
};

// Keep in step with local.ts.
export type { DataKey };
