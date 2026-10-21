// Local implementation of the data API (Phase 1 prototype backend).
//
// Every admin operation checks the signed-in session first, mirroring the
// RLS policies in supabase/migrations. Public functions only ever return
// content that is published, visible now and not trashed.

import {
  read, update, putBlob, getBlob, deleteBlob,
  type LocalMediaRecord, type LocalAdminRecord,
} from './store';
import { AppError } from './errors';
import { processImage, safeFilename } from './media';
import type {
  Post, PostDraftInput, Revision, RevisionReason, Category, Tag, Comment, CommentStatus, PublicComment,
  MediaAsset, SiteSettings, AdminUser, Page, DisplayStatus, DocJSON, ImageRef,
} from '../types';
import { DEFAULT_CATEGORIES, REVISION_LIMIT, CHECKPOINT_INTERVAL_MS } from '@/config/defaults';
import { uid, nowIso } from '../utils/format';
import {
  isPubliclyVisible, displayStatus, mergeSettings, validateSettings,
  type PostSummary, type AdminPostRow, type StatusFilter, type SortKey, type AdminCommentRow, type ImportPostInput, type BackendInfo,
} from './shared';
import {
  slugify, uniqueSlug, docToText, readingMinutes, emptyDoc, excerptFrom, collectNodes, mapDoc,
} from '../utils/content';
import { hashPassword, safeEqual, passwordProblems } from '@/features/auth/crypto';
import {
  validateComment, assessComment, isRateLimited, type CommentInput,
} from '@/features/comments/moderation';

// ============================================================================
// Helpers
// ============================================================================

export { isPubliclyVisible, displayStatus };
export type { PostSummary, AdminPostRow, StatusFilter, SortKey, AdminCommentRow };

export const backend: BackendInfo = { kind: 'local', firstRunSetup: true, passwordReset: false, shared: false };

// ---- media URL resolution ---------------------------------------------------
const objectUrls = new Map<string, string>();
async function mediaUrl(id: string): Promise<string> {
  const cached = objectUrls.get(id);
  if (cached) return cached;
  const blob = await getBlob(id);
  if (!blob) return '';
  const url = URL.createObjectURL(blob);
  objectUrls.set(id, url);
  return url;
}
function forgetUrl(id: string) {
  const u = objectUrls.get(id);
  if (u) URL.revokeObjectURL(u);
  objectUrls.delete(id);
}

async function resolveImage(ref: ImageRef | null): Promise<ImageRef | null> {
  if (!ref) return null;
  if (ref.mediaId) return { ...ref, src: (await mediaUrl(ref.mediaId)) || ref.src };
  return ref;
}

/** Point library images inside content at this session's URLs. */
export async function resolveDocMedia(doc: DocJSON): Promise<DocJSON> {
  const ids = collectNodes(doc, 'image').map((n) => n.attrs?.mediaId).filter(Boolean) as string[];
  if (!ids.length) return doc;
  const urls = new Map<string, string>();
  for (const id of ids) urls.set(id, await mediaUrl(id));
  return mapDoc(doc, (n) =>
    n.type === 'image' && n.attrs?.mediaId && urls.get(String(n.attrs.mediaId))
      ? { ...n, attrs: { ...n.attrs, src: urls.get(String(n.attrs.mediaId)) } }
      : n,
  );
}

/** Same for rendered HTML. */
export async function resolveHtmlMedia(html: string): Promise<string> {
  const ids = [...html.matchAll(/data-media-id="([\w-]+)"/g)].map((m) => m[1]);
  if (!ids.length) return html;
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  for (const img of tpl.content.querySelectorAll<HTMLImageElement>('img[data-media-id]')) {
    const url = await mediaUrl(img.dataset.mediaId!);
    if (url) img.src = url;
  }
  const div = document.createElement('div');
  div.appendChild(tpl.content.cloneNode(true));
  return div.innerHTML;
}

async function withMedia(p: Post): Promise<Post> {
  return { ...p, featuredImage: await resolveImage(p.featuredImage) };
}

async function audit(action: string, target: string) {
  const s = currentSession();
  await update('audit', (list) => ({
    next: [{ id: uid(), at: nowIso(), actor: s?.email ?? 'system', action, target }, ...list].slice(0, 200),
    result: undefined,
  }));
}

// ============================================================================
// Auth (local prototype)
// ============================================================================

const SESSION_KEY = 'endowed.admin-session';
const LOCKOUT_KEY = 'endowed.login-attempts';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

interface SessionRecord { userId: string; email: string; expiresAt: number }

function currentSession(): SessionRecord | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SessionRecord;
    if (Date.now() > s.expiresAt) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

async function requireAdmin(): Promise<AdminUser> {
  const s = currentSession();
  if (!s) throw new AppError('unauthorized', 'Your session has ended. Sign in again to continue.');
  const admins = await read('admins');
  const a = admins.find((x) => x.id === s.userId);
  if (!a) throw new AppError('forbidden', 'This account doesn’t have access to the admin.');
  return toAdmin(a);
}
const toAdmin = (a: LocalAdminRecord): AdminUser => ({ id: a.id, email: a.email, displayName: a.displayName, role: a.role });

function attemptsState(): { count: number; until: number } {
  try {
    return JSON.parse(localStorage.getItem(LOCKOUT_KEY) ?? '') as { count: number; until: number };
  } catch {
    return { count: 0, until: 0 };
  }
}

export const auth = {
  async needsSetup(): Promise<boolean> {
    return (await read('admins')).length === 0;
  },

  /** First-run bootstrap. Only works while no administrator exists. */
  async createFirstAdmin(input: { email: string; password: string; displayName: string }): Promise<AdminUser> {
    const email = input.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError('validation', 'Enter a valid email address.', { email: 'Enter a valid email address.' });
    const problem = passwordProblems(input.password);
    if (problem) throw new AppError('validation', problem, { password: problem });
    const { salt, hash } = await hashPassword(input.password);
    const user = await update('admins', (admins) => {
      if (admins.length > 0) throw new AppError('forbidden', 'An administrator already exists. Sign in instead.');
      const rec: LocalAdminRecord = {
        id: uid(), email, displayName: input.displayName.trim() || 'Administrator', role: 'owner', salt, hash, createdAt: nowIso(),
      };
      return { next: [rec], result: rec };
    });
    await ensureSeeded();
    localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: user.id, email, expiresAt: Date.now() + SESSION_TTL_MS }));
    return toAdmin(user);
  },

  async signIn(emailRaw: string, password: string): Promise<AdminUser> {
    const st = attemptsState();
    if (st.until > Date.now()) {
      const secs = Math.ceil((st.until - Date.now()) / 1000);
      throw new AppError('rate_limited', `Too many attempts. Try again in ${secs} seconds.`);
    }
    const email = emailRaw.trim().toLowerCase();
    const admins = await read('admins');
    const a = admins.find((x) => x.email === email);
    // Always hash, so timing doesn't reveal whether the email exists.
    const { hash } = await hashPassword(password, a?.salt ?? '00'.repeat(16));
    if (!a || !safeEqual(hash, a.hash)) {
      const count = st.count + 1;
      const until = count >= 5 ? Date.now() + Math.min(15 * 60_000, 30_000 * 2 ** (count - 5)) : 0;
      localStorage.setItem(LOCKOUT_KEY, JSON.stringify({ count, until }));
      throw new AppError('unauthorized', 'That email and password don’t match.');
    }
    localStorage.removeItem(LOCKOUT_KEY);
    localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: a.id, email: a.email, expiresAt: Date.now() + SESSION_TTL_MS }));
    await audit('signed in', a.email);
    return toAdmin(a);
  },

  async signOut(): Promise<void> {
    localStorage.removeItem(SESSION_KEY);
  },

  async getUser(): Promise<AdminUser | null> {
    try {
      return await requireAdmin();
    } catch {
      return null;
    }
  },

  async requestPasswordReset(_email: string): Promise<void> {
    throw new AppError('unknown', 'Password reset emails start working once the site is connected to Supabase.');
  },

  async updatePassword(_next: string): Promise<void> {
    throw new AppError('unknown', 'Use Settings → Account to change your password.');
  },

  async changePassword(current: string, next: string): Promise<void> {
    const me = await requireAdmin();
    const problem = passwordProblems(next);
    if (problem) throw new AppError('validation', problem, { next: problem });
    const admins = await read('admins');
    const rec = admins.find((a) => a.id === me.id)!;
    const { hash } = await hashPassword(current, rec.salt);
    if (!safeEqual(hash, rec.hash)) throw new AppError('validation', 'Your current password is incorrect.', { current: 'Your current password is incorrect.' });
    const fresh = await hashPassword(next);
    await update('admins', (list) => ({
      next: list.map((a) => (a.id === me.id ? { ...a, ...fresh } : a)),
      result: undefined,
    }));
    await audit('changed password', me.email);
  },
};

async function ensureSeeded() {
  await update('categories', (cats) => {
    if (cats.length) return { next: cats, result: undefined };
    return {
      next: DEFAULT_CATEGORIES.map((c, i) => ({ id: uid(), name: c.name, slug: slugify(c.name), description: c.description, sortOrder: i })),
      result: undefined,
    };
  });
}

// ============================================================================
// Settings
// ============================================================================

export const settings = {
  async get(): Promise<SiteSettings> {
    return mergeSettings(await read('settings'));
  },
  async logoUrl(s: SiteSettings): Promise<string | null> {
    return s.logoMediaId ? (await mediaUrl(s.logoMediaId)) || null : null;
  },
  validate: validateSettings,
  async save(next: SiteSettings): Promise<SiteSettings> {
    await requireAdmin();
    const errors = settings.validate(next);
    if (Object.keys(errors).length) throw new AppError('validation', 'Check the highlighted settings.', errors);
    await update('settings', () => ({ next, result: undefined }));
    await audit('updated settings', 'site');
    return next;
  },
};

// ============================================================================
// Categories & tags
// ============================================================================

export const taxonomy = {
  async categories(): Promise<Category[]> {
    return [...(await read('categories'))].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  },
  async tags(): Promise<Tag[]> {
    return [...(await read('tags'))].sort((a, b) => a.name.localeCompare(b.name));
  },
  /** Categories that have at least one public article, with counts. */
  async publicCategories(): Promise<(Category & { count: number })[]> {
    const [cats, posts] = await Promise.all([taxonomy.categories(), read('posts')]);
    const now = Date.now();
    return cats
      .map((c) => ({ ...c, count: posts.filter((p) => p.categoryId === c.id && isPubliclyVisible(p, now)).length }))
      .filter((c) => c.count > 0);
  },
  async saveCategory(input: { id?: string; name: string; description: string }): Promise<Category> {
    await requireAdmin();
    const name = input.name.trim();
    if (!name) throw new AppError('validation', 'Enter a category name.', { name: 'Enter a category name.' });
    return update('categories', (cats) => {
      const others = cats.filter((c) => c.id !== input.id);
      if (others.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
        throw new AppError('validation', 'A category with this name already exists.', { name: 'A category with this name already exists.' });
      }
      const existing = cats.find((c) => c.id === input.id);
      const slug = existing?.name === name ? existing.slug : uniqueSlug(name, new Set(others.map((c) => c.slug)));
      const cat: Category = existing
        ? { ...existing, name, slug, description: input.description.trim() }
        : { id: uid(), name, slug, description: input.description.trim(), sortOrder: cats.length };
      return { next: existing ? cats.map((c) => (c.id === cat.id ? cat : c)) : [...cats, cat], result: cat };
    });
  },
  async reorderCategories(ids: string[]): Promise<void> {
    await requireAdmin();
    await update('categories', (cats) => ({
      next: cats.map((c) => ({ ...c, sortOrder: ids.indexOf(c.id) === -1 ? 999 : ids.indexOf(c.id) })),
      result: undefined,
    }));
  },
  async deleteCategory(id: string): Promise<void> {
    await requireAdmin();
    await update('posts', (posts) => ({ next: posts.map((p) => (p.categoryId === id ? { ...p, categoryId: null } : p)), result: undefined }));
    await update('categories', (cats) => ({ next: cats.filter((c) => c.id !== id), result: undefined }));
  },
  /** Find-or-create tags by name. */
  async ensureTags(names: string[]): Promise<Tag[]> {
    await requireAdmin();
    return update('tags', (tags) => {
      const out: Tag[] = [];
      const next = [...tags];
      for (const raw of names) {
        const name = raw.trim().replace(/\s+/g, ' ').slice(0, 40);
        if (!name) continue;
        let t = next.find((x) => x.name.toLowerCase() === name.toLowerCase());
        if (!t) {
          t = { id: uid(), name, slug: uniqueSlug(name, new Set(next.map((x) => x.slug))) };
          next.push(t);
        }
        if (!out.includes(t)) out.push(t);
      }
      return { next, result: out };
    });
  },
  async deleteTag(id: string): Promise<void> {
    await requireAdmin();
    await update('posts', (posts) => ({ next: posts.map((p) => ({ ...p, tagIds: p.tagIds.filter((t) => t !== id) })), result: undefined }));
    await update('tags', (tags) => ({ next: tags.filter((t) => t.id !== id), result: undefined }));
  },
};

// ============================================================================
// Public reading API
// ============================================================================


function summarize(p: Post, cats: Category[]): PostSummary {
  return {
    id: p.id, title: p.title, slug: p.slug, excerpt: p.excerpt, featuredImage: p.featuredImage,
    category: cats.find((c) => c.id === p.categoryId) ?? null,
    publishedAt: p.publishedAt, readingMinutes: p.readingMinutes, authorName: p.authorName,
  };
}

async function summaries(list: Post[]): Promise<PostSummary[]> {
  const cats = await read('categories');
  return Promise.all(list.map(async (p) => summarize(await withMedia(p), cats)));
}

const byPublishedDesc = (a: Post, b: Post) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '');

/** Relevance scoring that stands in for Postgres full-text search. */
function searchScore(p: Post, terms: string[], cat?: Category, tags: Tag[] = []): number {
  const title = p.title.toLowerCase();
  const excerpt = p.excerpt.toLowerCase();
  const body = p.contentText.toLowerCase();
  const meta = `${cat?.name ?? ''} ${tags.map((t) => t.name).join(' ')}`.toLowerCase();
  let score = 0;
  for (const t of terms) {
    const hit = (s: string) => s.includes(t);
    const any = hit(title) || hit(excerpt) || hit(body) || hit(meta);
    if (!any) return 0; // every term must match somewhere
    if (hit(title)) score += 6;
    if (hit(meta)) score += 4;
    if (hit(excerpt)) score += 3;
    if (hit(body)) score += 1;
  }
  return score;
}

export const publicApi = {
  async listPosts(opts: {
    page?: number; pageSize?: number; q?: string; categorySlug?: string; tagSlug?: string; excludeIds?: string[];
  }): Promise<Page<PostSummary> & { category?: Category; tag?: Tag }> {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = opts.pageSize ?? 9;
    const [posts, cats, tags] = await Promise.all([read('posts'), read('categories'), read('tags')]);
    const now = Date.now();
    let list = posts.filter((p) => isPubliclyVisible(p, now) && !(opts.excludeIds ?? []).includes(p.id));
    const category = opts.categorySlug ? cats.find((c) => c.slug === opts.categorySlug) : undefined;
    const tag = opts.tagSlug ? tags.find((t) => t.slug === opts.tagSlug) : undefined;
    if (opts.categorySlug) list = category ? list.filter((p) => p.categoryId === category.id) : [];
    if (opts.tagSlug) list = tag ? list.filter((p) => p.tagIds.includes(tag.id)) : [];

    const terms = (opts.q ?? '').toLowerCase().split(/\s+/).map((t) => t.replace(/[^\p{L}\p{N}'-]/gu, '')).filter((t) => t.length > 1);
    if (terms.length) {
      list = list
        .map((p) => ({ p, s: searchScore(p, terms, cats.find((c) => c.id === p.categoryId), tags.filter((t) => p.tagIds.includes(t.id))) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s || byPublishedDesc(a.p, b.p))
        .map((x) => x.p);
    } else {
      list.sort(byPublishedDesc);
    }
    const total = list.length;
    const items = await summaries(list.slice((page - 1) * pageSize, page * pageSize));
    return { items, total, page, pageSize, category, tag };
  },

  /** The owner's chosen featured article, or the newest one if none is chosen. */
  async featured(): Promise<PostSummary | null> {
    const posts = (await read('posts')).filter((p) => isPubliclyVisible(p));
    const chosen = posts.find((p) => p.isFeatured) ?? posts.sort(byPublishedDesc)[0];
    return chosen ? (await summaries([chosen]))[0] : null;
  },

  async postBySlug(slug: string): Promise<
    | { kind: 'post'; post: Post; category: Category | null; tags: Tag[] }
    | { kind: 'redirect'; slug: string }
    | null
  > {
    const posts = await read('posts');
    const visible = posts.filter((p) => isPubliclyVisible(p));
    const p = visible.find((x) => x.slug === slug);
    if (!p) {
      const moved = visible.find((x) => x.previousSlugs.includes(slug));
      return moved ? { kind: 'redirect', slug: moved.slug } : null;
    }
    const [cats, tags] = await Promise.all([read('categories'), read('tags')]);
    const post = await withMedia(p);
    post.contentHtml = await resolveHtmlMedia(post.contentHtml);
    return { kind: 'post', post, category: cats.find((c) => c.id === p.categoryId) ?? null, tags: tags.filter((t) => p.tagIds.includes(t.id)) };
  },

  /** Deterministic: shared tags weigh most, then same category, then recency. */
  async related(post: Post, limit = 3): Promise<PostSummary[]> {
    const posts = (await read('posts')).filter((p) => p.id !== post.id && isPubliclyVisible(p));
    const scored = posts
      .map((p) => ({
        p,
        s: p.tagIds.filter((t) => post.tagIds.includes(t)).length * 2 + (post.categoryId && p.categoryId === post.categoryId ? 3 : 0),
      }))
      .sort((a, b) => b.s - a.s || byPublishedDesc(a.p, b.p))
      .slice(0, limit)
      .map((x) => x.p);
    return summaries(scored);
  },

  async approvedComments(postId: string): Promise<PublicComment[]> {
    return (await read('comments'))
      .filter((c) => c.postId === postId && c.status === 'approved')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(({ id, authorName, body, createdAt }) => ({ id, authorName, body, createdAt }));
  },

  /**
   * Public comment endpoint. In production this is the `submit-comment`
   * Edge Function; here it runs the same validation module locally.
   */
  async submitComment(postId: string, input: CommentInput): Promise<{ status: 'pending' | 'approved' }> {
    const [posts, s] = await Promise.all([read('posts'), settings.get()]);
    const post = posts.find((p) => p.id === postId);
    if (!post || !isPubliclyVisible(post)) throw new AppError('not_found', 'This article is no longer available.');
    if (!s.comments.enabled || !post.commentsEnabled) throw new AppError('forbidden', 'Comments are closed for this article.');

    const v = validateComment(input);
    if (!v.ok) throw new AppError('validation', 'Check the highlighted fields.', v.errors as Record<string, string>);

    const RATE_KEY = 'endowed.comment-times';
    let times: number[] = [];
    try { times = JSON.parse(localStorage.getItem(RATE_KEY) ?? '[]'); } catch { /* ignore */ }
    const now = Date.now();
    if (isRateLimited(times, now)) throw new AppError('rate_limited', 'You’ve posted several comments in a short time. Wait a few minutes and try again.');

    const verdict = assessComment(input, v.clean, s.comments.blockedTerms);
    localStorage.setItem(RATE_KEY, JSON.stringify([...times.filter((t) => now - t < 3_600_000), now]));
    // Bots get a normal-looking response and nothing is stored.
    if (verdict.action === 'reject') return { status: 'pending' };

    const status: CommentStatus =
      verdict.action === 'spam' ? 'spam'
        : verdict.action === 'clean' && s.comments.moderation === 'flagged' ? 'approved'
          : 'pending';
    const flags = verdict.action === 'clean' ? [] : verdict.flags;
    await update('comments', (list) => ({
      next: [...list, { id: uid(), postId, authorName: v.clean.name, body: v.clean.body, status, flags, createdAt: nowIso(), moderatedAt: null }],
      result: undefined,
    }));
    return { status: status === 'approved' ? 'approved' : 'pending' };
  },

  async sitemapEntries(): Promise<{ slug: string; updatedAt: string }[]> {
    return (await read('posts')).filter((p) => isPubliclyVisible(p)).map((p) => ({ slug: p.slug, updatedAt: p.updatedAt }));
  },
};

// ============================================================================
// Admin: posts
// ============================================================================


function takenSlugs(posts: Post[], exceptId?: string): Set<string> {
  const s = new Set<string>();
  for (const p of posts) {
    if (p.id === exceptId) continue;
    s.add(p.slug);
    p.previousSlugs.forEach((x) => s.add(x));
  }
  return s;
}

function derive(p: Post): Post {
  const contentText = docToText(p.content);
  return { ...p, contentText, readingMinutes: readingMinutes(contentText) };
}

async function renderHtml(doc: DocJSON): Promise<string> {
  const { renderArticleHtml } = await import('@/features/content/render');
  return renderArticleHtml(doc);
}

async function addRevision(post: Post, reason: RevisionReason) {
  await update('revisions', (revs) => {
    const mine = revs.filter((r) => r.postId === post.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const last = mine[0];
    // Skip identical snapshots.
    if (last && last.title === post.title && JSON.stringify(last.content) === JSON.stringify(post.content) && reason !== 'before-restore') {
      return { next: revs, result: undefined };
    }
    const rev: Revision = { id: uid(), postId: post.id, title: post.title, excerpt: post.excerpt, content: post.content, reason, createdAt: nowIso() };
    const keepIds = new Set([rev, ...mine].slice(0, REVISION_LIMIT).map((r) => r.id));
    return { next: [...revs.filter((r) => r.postId !== post.id || keepIds.has(r.id)), rev], result: undefined };
  });
}

export const adminPosts = {
  async list(opts: { page?: number; pageSize?: number; q?: string; status?: StatusFilter; sort?: SortKey; dir?: 'asc' | 'desc'; categoryId?: string }): Promise<Page<AdminPostRow>> {
    await requireAdmin();
    const [posts, cats, comments] = await Promise.all([read('posts'), read('categories'), read('comments')]);
    const now = Date.now();
    const status = opts.status ?? 'all';
    let list = posts.map((p) => ({ p, d: displayStatus(p, now) }));
    list = status === 'all' ? list.filter((x) => x.d !== 'trashed') : list.filter((x) => x.d === status);
    if (opts.categoryId) list = list.filter((x) => x.p.categoryId === opts.categoryId);
    const q = opts.q?.trim().toLowerCase();
    if (q) list = list.filter((x) => x.p.title.toLowerCase().includes(q) || x.p.slug.includes(q) || x.p.excerpt.toLowerCase().includes(q));
    const sort = opts.sort ?? 'updatedAt';
    const dir = opts.dir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      const av = sort === 'title' ? a.p.title.toLowerCase() : (a.p[sort] ?? '');
      const bv = sort === 'title' ? b.p.title.toLowerCase() : (b.p[sort] ?? '');
      return av < bv ? -dir : av > bv ? dir : 0;
    });
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = opts.pageSize ?? 15;
    const items = await Promise.all(
      list.slice((page - 1) * pageSize, page * pageSize).map(async ({ p, d }) => ({
        ...(await withMedia(p)),
        display: d,
        category: cats.find((c) => c.id === p.categoryId) ?? null,
        commentCount: comments.filter((c) => c.postId === p.id && c.status === 'approved').length,
        pendingCount: comments.filter((c) => c.postId === p.id && c.status === 'pending').length,
      })),
    );
    return { items, total: list.length, page, pageSize };
  },

  async counts(): Promise<Record<DisplayStatus, number>> {
    await requireAdmin();
    const posts = await read('posts');
    const now = Date.now();
    const c: Record<DisplayStatus, number> = { draft: 0, scheduled: 0, published: 0, archived: 0, trashed: 0 };
    posts.forEach((p) => { c[displayStatus(p, now)]++; });
    return c;
  },

  async get(id: string): Promise<Post> {
    await requireAdmin();
    const p = (await read('posts')).find((x) => x.id === id);
    if (!p) throw new AppError('not_found', 'This article doesn’t exist or was deleted.');
    return { ...(await withMedia(p)), content: await resolveDocMedia(p.content) };
  },

  async create(input: PostDraftInput = {}): Promise<Post> {
    const me = await requireAdmin();
    const s = await settings.get();
    const post = await update('posts', async (posts) => {
      const title = input.title?.trim() || 'Untitled article';
      const content = input.content ?? emptyDoc();
      const p = derive({
        id: uid(), title, slug: uniqueSlug(input.slug || title, takenSlugs(posts)), previousSlugs: [],
        excerpt: input.excerpt ?? '', content, contentHtml: await renderHtml(content), contentText: '',
        featuredImage: input.featuredImage ?? null, authorName: input.authorName ?? s.defaultAuthorName ?? me.displayName,
        categoryId: input.categoryId ?? null, tagIds: input.tagIds ?? [], status: 'draft', publishedAt: null,
        createdAt: nowIso(), updatedAt: nowIso(), deletedAt: null, seoTitle: input.seoTitle ?? '', seoDescription: input.seoDescription ?? '',
        isFeatured: false, commentsEnabled: input.commentsEnabled ?? true, readingMinutes: 1, version: 1, source: null,
      });
      return { next: [...posts, p], result: p };
    });
    await audit('created article', post.title);
    return post;
  },

  /**
   * Conflict-aware save. The caller passes the version it last saw; if the
   * stored article has moved on (another tab, a restore) the save is refused
   * instead of silently overwriting newer work.
   */
  async save(id: string, patch: PostDraftInput, expectedVersion: number, opts: { revision?: RevisionReason } = {}): Promise<Post> {
    await requireAdmin();
    const htmlPromise = patch.content ? renderHtml(patch.content) : null;
    const contentHtml = htmlPromise ? await htmlPromise : undefined;
    const { saved, prev } = await update('posts', (posts) => {
      const cur = posts.find((p) => p.id === id);
      if (!cur || cur.deletedAt) throw new AppError('not_found', 'This article was deleted.');
      if (cur.version !== expectedVersion) {
        throw new AppError('conflict', 'This article was changed somewhere else (another tab or a restore). Reload to get the latest version.');
      }
      const next: Post = derive({ ...cur, ...patch, ...(contentHtml !== undefined ? { contentHtml } : {}), updatedAt: nowIso(), version: cur.version + 1 });
      if (patch.title !== undefined && !next.title.trim()) next.title = 'Untitled article';
      if (patch.slug !== undefined) {
        const wanted = slugify(patch.slug) || slugify(next.title) || 'untitled';
        if (wanted !== cur.slug) {
          const taken = takenSlugs(posts, id);
          if (taken.has(wanted)) throw new AppError('validation', 'Another article already uses this URL.', { slug: 'Another article already uses this URL.' });
          next.slug = wanted;
          // Keep the old address working once readers may have seen it.
          if (cur.publishedAt) next.previousSlugs = [...new Set([...cur.previousSlugs, cur.slug])].filter((s) => s !== wanted);
        }
      }
      if (!next.excerpt.trim()) next.excerpt = '';
      let list = posts.map((p) => (p.id === id ? next : p));
      if (patch.isFeatured) list = list.map((p) => (p.id !== id && p.isFeatured ? { ...p, isFeatured: false } : p));
      return { next: list, result: { saved: next, prev: cur } };
    });
    if (opts.revision) await addRevision(saved, opts.revision);
    else {
      // Autosave: take a checkpoint revision at most every 10 minutes.
      const revs = (await read('revisions')).filter((r) => r.postId === id && r.reason === 'checkpoint');
      const latest = revs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (!latest || Date.now() - new Date(latest.createdAt).getTime() > CHECKPOINT_INTERVAL_MS) await addRevision(prev, 'checkpoint');
    }
    return { ...(await withMedia(saved)), content: patch.content ?? (await resolveDocMedia(saved.content)) };
  },

  /** Publish now, or schedule if `at` is in the future. */
  async publish(id: string, expectedVersion: number, at?: string | null): Promise<Post> {
    const cur = await adminPosts.get(id);
    if (!cur.title.trim() || cur.title === 'Untitled article') throw new AppError('validation', 'Give the article a title before publishing.');
    if (!cur.contentText.trim()) throw new AppError('validation', 'Write something before publishing.');
    // Imported articles keep their original date when first published.
    const publishedAt = at ?? (cur.publishedAt && (cur.status === 'published' || cur.source) ? cur.publishedAt : nowIso());
    const patch: PostDraftInput = {
      status: 'published', publishedAt,
      excerpt: cur.excerpt.trim() || excerptFrom(cur.contentText),
    };
    const saved = await adminPosts.save(id, patch, expectedVersion, { revision: 'publish' });
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
    await update('posts', (posts) => ({
      next: posts.map((p) => (p.id === id ? { ...p, isFeatured: featured, version: p.version + 1 } : featured ? { ...p, isFeatured: false } : p)),
      result: undefined,
    }));
  },

  async duplicate(id: string): Promise<Post> {
    const src = await adminPosts.get(id);
    const copy = await adminPosts.create({
      title: `${src.title} (copy)`, excerpt: src.excerpt, content: (await read('posts')).find((p) => p.id === id)!.content,
      featuredImage: src.featuredImage ? { ...src.featuredImage } : null, categoryId: src.categoryId, tagIds: src.tagIds,
      seoTitle: src.seoTitle, seoDescription: src.seoDescription, commentsEnabled: src.commentsEnabled, authorName: src.authorName,
    });
    return copy;
  },

  /** Moves to trash. Recoverable from the Trash filter. */
  async trash(ids: string[]): Promise<void> {
    await requireAdmin();
    const at = nowIso();
    await update('posts', (posts) => ({
      next: posts.map((p) => (ids.includes(p.id) ? { ...p, deletedAt: at, isFeatured: false, version: p.version + 1 } : p)),
      result: undefined,
    }));
    const titles = (await read('posts')).filter((p) => ids.includes(p.id)).map((p) => p.title);
    await audit(ids.length === 1 ? 'moved to trash' : `moved ${ids.length} articles to trash`, ids.length === 1 ? titles[0] ?? 'articles' : 'articles');
  },

  async restore(ids: string[]): Promise<void> {
    await requireAdmin();
    await update('posts', (posts) => ({
      next: posts.map((p) => (ids.includes(p.id) ? { ...p, deletedAt: null, status: p.status === 'published' ? 'draft' : p.status, version: p.version + 1 } : p)),
      result: undefined,
    }));
    await audit(`restored ${ids.length} from trash`, 'articles');
  },

  /** Permanent. Only allowed from the trash. */
  async deleteForever(ids: string[]): Promise<void> {
    await requireAdmin();
    await update('posts', (posts) => {
      if (posts.some((p) => ids.includes(p.id) && !p.deletedAt)) throw new AppError('validation', 'Move articles to the trash before deleting them permanently.');
      return { next: posts.filter((p) => !ids.includes(p.id)), result: undefined };
    });
    await update('revisions', (r) => ({ next: r.filter((x) => !ids.includes(x.postId)), result: undefined }));
    await update('comments', (c) => ({ next: c.filter((x) => !ids.includes(x.postId)), result: undefined }));
    await audit(`permanently deleted ${ids.length}`, 'articles');
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
    return (await read('revisions')).filter((r) => r.postId === postId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async restoreRevision(revisionId: string, expectedVersion: number): Promise<Post> {
    await requireAdmin();
    const rev = (await read('revisions')).find((r) => r.id === revisionId);
    if (!rev) throw new AppError('not_found', 'That revision no longer exists.');
    const cur = (await read('posts')).find((p) => p.id === rev.postId);
    if (cur) await addRevision(cur, 'before-restore');
    const saved = await adminPosts.save(rev.postId, { title: rev.title, excerpt: rev.excerpt, content: rev.content }, expectedVersion, { revision: 'manual' });
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
    const [comments, posts] = await Promise.all([read('comments'), read('posts')]);
    let list = comments;
    if (opts.status && opts.status !== 'all') list = list.filter((c) => c.status === opts.status);
    if (opts.postId) list = list.filter((c) => c.postId === opts.postId);
    list = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = opts.pageSize ?? 20;
    const items = list.slice((page - 1) * pageSize, page * pageSize).map((c) => {
      const p = posts.find((x) => x.id === c.postId);
      return { ...c, postTitle: p?.title ?? 'Deleted article', postSlug: p?.slug ?? '' };
    });
    return { items, total: list.length, page, pageSize };
  },
  async counts(): Promise<Record<CommentStatus, number>> {
    await requireAdmin();
    const c: Record<CommentStatus, number> = { pending: 0, approved: 0, rejected: 0, spam: 0 };
    (await read('comments')).forEach((x) => { c[x.status]++; });
    return c;
  },
  async setStatus(ids: string[], status: CommentStatus): Promise<void> {
    await requireAdmin();
    const at = nowIso();
    await update('comments', (list) => ({ next: list.map((c) => (ids.includes(c.id) ? { ...c, status, moderatedAt: at } : c)), result: undefined }));
  },
  async remove(ids: string[]): Promise<void> {
    await requireAdmin();
    await update('comments', (list) => ({ next: list.filter((c) => !ids.includes(c.id)), result: undefined }));
  },
};

// ============================================================================
// Admin: media library
// ============================================================================

async function toAsset(m: LocalMediaRecord): Promise<MediaAsset> {
  return { ...m, url: await mediaUrl(m.id) };
}

export const adminMedia = {
  async list(q = ''): Promise<MediaAsset[]> {
    await requireAdmin();
    const term = q.trim().toLowerCase();
    const list = (await read('media'))
      .filter((m) => !term || m.filename.toLowerCase().includes(term) || m.alt.toLowerCase().includes(term))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return Promise.all(list.map(toAsset));
  },
  async upload(file: File, meta: { alt?: string; caption?: string } = {}): Promise<MediaAsset> {
    await requireAdmin();
    const img = await processImage(file);
    const id = uid();
    await putBlob(id, img.blob);
    const ext = img.mimeType.split('/')[1];
    const rec: LocalMediaRecord = {
      id, filename: `${safeFilename(file.name)}.${ext}`, mimeType: img.mimeType, sizeBytes: img.blob.size,
      width: img.width, height: img.height, alt: meta.alt ?? '', caption: meta.caption ?? '', createdAt: nowIso(),
    };
    await update('media', (list) => ({ next: [rec, ...list], result: undefined }));
    return toAsset(rec);
  },
  async updateMeta(id: string, meta: { alt: string; caption: string }): Promise<void> {
    await requireAdmin();
    await update('media', (list) => ({ next: list.map((m) => (m.id === id ? { ...m, alt: meta.alt.trim(), caption: meta.caption.trim() } : m)), result: undefined }));
  },
  /** Swap the file but keep the id, so every article using it updates. */
  async replace(id: string, file: File): Promise<MediaAsset> {
    await requireAdmin();
    const img = await processImage(file);
    await putBlob(id, img.blob);
    forgetUrl(id);
    const rec = await update('media', (list) => {
      const cur = list.find((m) => m.id === id);
      if (!cur) throw new AppError('not_found', 'That image no longer exists.');
      const next = { ...cur, mimeType: img.mimeType, sizeBytes: img.blob.size, width: img.width, height: img.height };
      return { next: list.map((m) => (m.id === id ? next : m)), result: next };
    });
    // Regenerate stored HTML isn't needed: images reference the media id.
    return toAsset(rec);
  },
  /** Articles that use this image as featured image or in their body. */
  async usage(id: string): Promise<{ id: string; title: string }[]> {
    await requireAdmin();
    const [posts, s] = await Promise.all([read('posts'), read('settings')]);
    const out = posts
      .filter((p) => p.featuredImage?.mediaId === id || collectNodes(p.content, 'image').some((n) => n.attrs?.mediaId === id))
      .map((p) => ({ id: p.id, title: p.title }));
    if (s?.logoMediaId === id) out.push({ id: 'settings', title: 'Site logo' });
    return out;
  },
  async remove(id: string): Promise<void> {
    const used = await adminMedia.usage(id);
    if (used.length) throw new AppError('validation', `This image is still used in: ${used.map((u) => u.title).join(', ')}. Remove it there first.`);
    await update('media', (list) => ({ next: list.filter((m) => m.id !== id), result: undefined }));
    await deleteBlob(id);
    forgetUrl(id);
  },
};

// ============================================================================
// Dashboard
// ============================================================================

export const dashboard = {
  async overview() {
    await requireAdmin();
    const [posts, comments, auditLog] = await Promise.all([read('posts'), read('comments'), read('audit')]);
    const now = Date.now();
    const counts = { published: 0, scheduled: 0, draft: 0, archived: 0, trashed: 0 } as Record<DisplayStatus, number>;
    posts.forEach((p) => { counts[displayStatus(p, now)]++; });
    const upcoming = posts
      .filter((p) => displayStatus(p, now) === 'scheduled')
      .sort((a, b) => (a.publishedAt ?? '').localeCompare(b.publishedAt ?? ''))
      .slice(0, 3);
    const recent = [...posts].filter((p) => !p.deletedAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6);
    return {
      counts,
      pendingComments: comments.filter((c) => c.status === 'pending').length,
      approvedComments: comments.filter((c) => c.status === 'approved').length,
      recent: await Promise.all(recent.map(async (p) => ({ ...(await withMedia(p)), display: displayStatus(p, now) }))),
      upcoming,
      activity: auditLog.slice(0, 8),
    };
  },
};

// ============================================================================
// Import (used by the Blogger importer)
// ============================================================================

export const importer = {
  async existingImportSlugs(): Promise<Set<string>> {
    await requireAdmin();
    return new Set((await read('posts')).map((p) => p.slug));
  },
  async insertPosts(items: ImportPostInput[]): Promise<number> {
    await requireAdmin();
    const prepared: { post: Post; comments: Comment[] }[] = [];
    for (const it of items) {
      const { comments: cs, ...rest } = it;
      const id = uid();
      const post = derive({
        ...rest, id, version: 1, previousSlugs: [], contentHtml: await renderHtml(rest.content), contentText: '', readingMinutes: 1,
        createdAt: rest.publishedAt ?? nowIso(), updatedAt: rest.publishedAt ?? nowIso(), deletedAt: null,
      });
      if (!post.excerpt) post.excerpt = excerptFrom(post.contentText);
      prepared.push({
        post,
        comments: cs.map((c) => ({ id: uid(), postId: id, authorName: c.authorName, body: c.body, status: 'approved' as const, flags: [], createdAt: c.createdAt, moderatedAt: nowIso() })),
      });
    }
    const fresh = await update('posts', (posts) => {
      const taken = takenSlugs(posts);
      const kept = prepared.filter((x) => !taken.has(x.post.slug));
      return { next: [...posts, ...kept.map((x) => x.post)], result: kept };
    });
    await update('comments', (list) => ({ next: [...list, ...fresh.flatMap((x) => x.comments)], result: undefined }));
    for (const x of fresh) await addRevision(x.post, 'import');
    await audit(`imported ${fresh.length} articles`, 'import');
    return fresh.length;
  },
};
