-- Endowed Academy: Phase 1 blog schema
-- Applies with `supabase db push` (or `supabase db reset` locally).
-- Everything the app needs lives here; nothing is configured by hand in the dashboard.

create extension if not exists pgcrypto;

-- ===========================================================================
-- Roles
-- ===========================================================================
-- Admin rights come from this table, never from client-editable profile data.
-- Only the service role (or an existing owner) can add rows.
create table public.admin_roles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null check (role in ('owner', 'editor')),
  display_name text not null default '',
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_roles where user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- ===========================================================================
-- Taxonomy
-- ===========================================================================
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 60),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text not null default '' check (char_length(description) <= 300),
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);
create unique index categories_name_lower_idx on public.categories (lower(name));

create table public.tags (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 40),
  slug       text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_at timestamptz not null default now()
);
create unique index tags_name_lower_idx on public.tags (lower(name));

-- ===========================================================================
-- Media
-- ===========================================================================
create table public.media_assets (
  id           uuid primary key default gen_random_uuid(),
  storage_path text not null unique,           -- e.g. 2026/10/<uuid>.webp in bucket "media"
  filename     text not null,
  mime_type    text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif')),
  size_bytes   int  not null check (size_bytes > 0 and size_bytes <= 8388608),
  width        int  not null check (width > 0),
  height       int  not null check (height > 0),
  alt          text not null default '' check (char_length(alt) <= 500),
  caption      text not null default '' check (char_length(caption) <= 500),
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);

-- ===========================================================================
-- Posts
-- ===========================================================================
create table public.posts (
  id               uuid primary key default gen_random_uuid(),
  title            text not null check (char_length(title) between 1 and 200),
  slug             text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  excerpt          text not null default '' check (char_length(excerpt) <= 300),
  content          jsonb not null default '{"type":"doc","content":[]}'::jsonb,  -- TipTap JSON
  content_html     text not null default '',   -- sanitised render, what readers receive
  content_text     text not null default '',   -- plain text for search and reading time
  featured_image   jsonb,                       -- { mediaId, src, alt, width, height }
  author_id        uuid references auth.users (id) on delete set null,
  author_name      text not null default '',
  category_id      uuid references public.categories (id) on delete set null,
  status           text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  -- "Scheduled" = published with published_at in the future. Public queries
  -- compare against now(), so no background job is needed to go live.
  published_at     timestamptz,
  seo_title        text not null default '' check (char_length(seo_title) <= 120),
  seo_description  text not null default '' check (char_length(seo_description) <= 300),
  is_featured      boolean not null default false,
  comments_enabled boolean not null default true,
  reading_minutes  int not null default 1 check (reading_minutes >= 1),
  version          int not null default 1,     -- optimistic concurrency for autosave
  source           text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,                -- soft delete (trash)
  search           tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(excerpt, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(content_text, '')), 'C')
  ) stored,
  constraint published_needs_date check (status <> 'published' or published_at is not null)
);

create index posts_public_listing_idx on public.posts (published_at desc) where status = 'published' and deleted_at is null;
create index posts_category_idx on public.posts (category_id, published_at desc) where deleted_at is null;
create index posts_search_idx on public.posts using gin (search);
create index posts_updated_idx on public.posts (updated_at desc);
-- At most one featured article.
create unique index posts_single_featured_idx on public.posts (is_featured) where is_featured and deleted_at is null;

create table public.post_tags (
  post_id uuid not null references public.posts (id) on delete cascade,
  tag_id  uuid not null references public.tags (id) on delete cascade,
  primary key (post_id, tag_id)
);
create index post_tags_tag_idx on public.post_tags (tag_id);

-- Old slugs keep working after a published article is renamed.
create table public.post_slug_history (
  slug       text primary key,
  post_id    uuid not null references public.posts (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.post_revisions (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  title      text not null,
  excerpt    text not null default '',
  content    jsonb not null,
  reason     text not null check (reason in ('manual', 'publish', 'checkpoint', 'before-restore', 'import')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index post_revisions_post_idx on public.post_revisions (post_id, created_at desc);

-- ===========================================================================
-- Comments
-- ===========================================================================
create table public.comments (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts (id) on delete cascade,
  author_name text not null check (char_length(author_name) between 2 and 60),
  body        text not null check (char_length(body) between 3 and 2000),
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'spam')),
  flags       text[] not null default '{}',      -- moderator-only
  moderated_at timestamptz,
  created_at  timestamptz not null default now()
);
create index comments_public_idx on public.comments (post_id, created_at) where status = 'approved';
create index comments_moderation_idx on public.comments (status, created_at desc);

-- Short-lived abuse-control records. Stores a salted hash of the IP, never the IP.
create table public.comment_rate_events (
  id         bigint generated always as identity primary key,
  ip_hash    text not null,
  created_at timestamptz not null default now()
);
create index comment_rate_events_idx on public.comment_rate_events (ip_hash, created_at desc);

-- ===========================================================================
-- Settings & audit
-- ===========================================================================
-- Public appearance settings (no secrets). Single row.
create table public.site_settings (
  id         int primary key default 1 check (id = 1),
  settings   jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.site_settings (id) values (1);

-- Moderation configuration the public must not read.
create table public.moderation_settings (
  id            int primary key default 1 check (id = 1),
  blocked_terms text[] not null default '{}',
  mode          text not null default 'all' check (mode in ('all', 'flagged')),
  updated_at    timestamptz not null default now()
);
insert into public.moderation_settings (id) values (1);

create table public.audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid references auth.users (id) on delete set null,
  action     text not null,
  target     text not null default '',
  created_at timestamptz not null default now()
);
create index audit_log_created_idx on public.audit_log (created_at desc);
