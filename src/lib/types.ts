// Domain types. These mirror the Supabase schema in supabase/migrations so
// the local adapter and the future Supabase adapter share one contract.

export type UUID = string;
export type ISODate = string; // always UTC ISO-8601

/** Stored status. "Scheduled" is derived: published with publishedAt in the future. */
export type PostStatus = 'draft' | 'published' | 'archived';
export type DisplayStatus = PostStatus | 'scheduled' | 'trashed';

/** TipTap/ProseMirror JSON document. */
export interface DocJSON {
  type: 'doc';
  content?: DocNode[];
}
export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

export interface ImageRef {
  /** Set for images in our media library. */
  mediaId?: UUID | null;
  /** Displayable URL. For library media this is resolved at runtime. */
  src: string;
  alt: string;
  width?: number | null;
  height?: number | null;
}

export interface Post {
  id: UUID;
  title: string;
  slug: string;
  /** Previous slugs, so old links redirect to the current one. */
  previousSlugs: string[];
  excerpt: string;
  content: DocJSON;
  /** Sanitised HTML rendered from content at save time (what readers get). */
  contentHtml: string;
  /** Plain text extracted from content, used for search and reading time. */
  contentText: string;
  featuredImage: ImageRef | null;
  authorName: string;
  categoryId: UUID | null;
  tagIds: UUID[];
  status: PostStatus;
  publishedAt: ISODate | null;
  createdAt: ISODate;
  updatedAt: ISODate;
  deletedAt: ISODate | null;
  seoTitle: string;
  seoDescription: string;
  isFeatured: boolean;
  commentsEnabled: boolean;
  readingMinutes: number;
  /** Incremented on every save; used for conflict-aware updates. */
  version: number;
  source?: 'blogger-import' | 'import' | null;
}

export type PostDraftInput = Partial<
  Pick<
    Post,
    | 'title' | 'slug' | 'excerpt' | 'content' | 'featuredImage' | 'authorName' | 'categoryId'
    | 'tagIds' | 'status' | 'publishedAt' | 'seoTitle' | 'seoDescription' | 'isFeatured' | 'commentsEnabled'
  >
>;

export type RevisionReason = 'manual' | 'publish' | 'checkpoint' | 'before-restore' | 'import';
export interface Revision {
  id: UUID;
  postId: UUID;
  title: string;
  excerpt: string;
  content: DocJSON;
  reason: RevisionReason;
  createdAt: ISODate;
}

export interface Category {
  id: UUID;
  name: string;
  slug: string;
  description: string;
  sortOrder: number;
}

export interface Tag {
  id: UUID;
  name: string;
  slug: string;
}

export type CommentStatus = 'pending' | 'approved' | 'rejected' | 'spam';
export interface Comment {
  id: UUID;
  postId: UUID;
  authorName: string;
  body: string;
  status: CommentStatus;
  /** Reasons the automatic checks flagged, shown to the moderator only. */
  flags: string[];
  createdAt: ISODate;
  moderatedAt: ISODate | null;
}
/** What the public is allowed to see of a comment. */
export type PublicComment = Pick<Comment, 'id' | 'authorName' | 'body' | 'createdAt'>;

export interface MediaAsset {
  id: UUID;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  alt: string;
  caption: string;
  createdAt: ISODate;
  /** Resolved at read time. */
  url: string;
}

export interface SocialLink { label: string; url: string }
export interface NavLink { label: string; url: string }

export interface CtaContent { title: string; text: string; label: string; href: string }

export interface SiteSettings {
  siteName: string;
  tagline: string;
  logoMediaId: UUID | null;
  accentColor: string; // hex
  typePreset: 'editorial' | 'modern';
  heroTitle: string;
  heroIntro: string;
  navLinks: NavLink[];
  socialLinks: SocialLink[];
  footerText: string;
  contactEmail: string;
  defaultAuthorName: string;
  cta: CtaContent | null;
  showDropCap: boolean;
  comments: {
    enabled: boolean;
    /** "all" = every comment waits for approval; "flagged" = clean comments auto-approve. */
    moderation: 'all' | 'flagged';
    blockedTerms: string[];
  };
  seo: { siteUrl: string; defaultDescription: string };
}

export interface AdminUser {
  id: UUID;
  email: string;
  displayName: string;
  role: 'owner' | 'editor';
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
