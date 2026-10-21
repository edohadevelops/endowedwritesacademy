// Pure helpers and types shared by both data adapters (local and Supabase).

import type { Category, Comment, DisplayStatus, ImageRef, Post, SiteSettings } from '../types';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { contrastRatio, hexToRgb } from '../utils/format';

export function isPubliclyVisible(p: Pick<Post, 'status' | 'deletedAt' | 'publishedAt'>, now = Date.now()): boolean {
  return p.status === 'published' && !p.deletedAt && !!p.publishedAt && new Date(p.publishedAt).getTime() <= now;
}

export function displayStatus(p: Pick<Post, 'status' | 'deletedAt' | 'publishedAt'>, now = Date.now()): DisplayStatus {
  if (p.deletedAt) return 'trashed';
  if (p.status === 'published' && p.publishedAt && new Date(p.publishedAt).getTime() > now) return 'scheduled';
  return p.status;
}

export interface PostSummary {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  featuredImage: ImageRef | null;
  category: Category | null;
  publishedAt: string | null;
  readingMinutes: number;
  authorName: string;
}

export type AdminPostRow = Post & { display: DisplayStatus; category: Category | null; commentCount: number; pendingCount: number };
export type StatusFilter = 'all' | DisplayStatus;
export type SortKey = 'updatedAt' | 'publishedAt' | 'title';
export type AdminCommentRow = Comment & { postTitle: string; postSlug: string };

export type ImportPostInput = Omit<Post, 'id' | 'version' | 'contentHtml' | 'contentText' | 'readingMinutes' | 'previousSlugs' | 'createdAt' | 'updatedAt' | 'deletedAt'> & {
  comments: { authorName: string; body: string; createdAt: string }[];
};

/** Fill in defaults for settings saved before newer options existed. */
export function mergeSettings(s: Partial<SiteSettings> | null | undefined): SiteSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...(s ?? {}),
    comments: { ...DEFAULT_SETTINGS.comments, ...(s?.comments ?? {}) },
    seo: { ...DEFAULT_SETTINGS.seo, ...(s?.seo ?? {}) },
  };
}

export function validateSettings(s: SiteSettings): Record<string, string> {
  const e: Record<string, string> = {};
  if (!s.siteName.trim()) e.siteName = 'Enter the academy’s name.';
  if (!hexToRgb(s.accentColor)) e.accentColor = 'Use a hex colour like #C65A24.';
  else if (contrastRatio(s.accentColor, '#FFFFFF') < 4.5) e.accentColor = 'White button text isn’t readable enough on this colour. Pick a slightly deeper shade.';
  if (s.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.contactEmail)) e.contactEmail = 'Enter a valid email address.';
  const badUrl = (u: string) => !/^(https?:\/\/|\/|mailto:)/.test(u.trim());
  s.socialLinks.forEach((l, i) => { if (!l.label.trim() || badUrl(l.url)) e[`social.${i}`] = 'Each social link needs a name and a full URL.'; });
  s.navLinks.forEach((l, i) => { if (!l.label.trim() || badUrl(l.url)) e[`nav.${i}`] = 'Each menu link needs a name and a URL starting with / or https://.'; });
  if (s.seo.siteUrl && !/^https:\/\/[^/]+/.test(s.seo.siteUrl)) e.siteUrl = 'Use the full address, starting with https://';
  if (s.cta && s.cta.href && badUrl(s.cta.href)) e.ctaHref = 'Use a URL starting with / or https://';
  return e;
}

/** What the active backend can do, so the UI can adapt (e.g. password reset by email). */
export interface BackendInfo {
  kind: 'local' | 'supabase';
  /** In-app first-run owner setup (local only; Supabase uses an invite). */
  firstRunSetup: boolean;
  /** Password reset emails. */
  passwordReset: boolean;
  /** Content is visible to everyone, not just this browser. */
  shared: boolean;
}
