-- Endowed Academy: full database setup in one script (all migrations, in order).
-- Paste into Supabase → SQL Editor → New query, then Run. Safe to run once on a new project.

-- ===== 20261020000100_initial_schema.sql =====
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

-- ===== 20261020000200_functions_triggers.sql =====
-- Triggers that keep data consistent no matter which client writes it.

-- updated_at + version bump on every post update.
-- security definer: the slug-history insert must work for admins, who have no
-- direct write access to post_slug_history.
create or replace function public.posts_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  -- Keep the old address working once an article has been public.
  if new.slug is distinct from old.slug and old.published_at is not null then
    insert into public.post_slug_history (slug, post_id) values (old.slug, old.id)
    on conflict (slug) do update set post_id = excluded.post_id;
  end if;
  -- A trashed or unpublished article can't stay featured.
  if new.deleted_at is not null or new.status <> 'published' then
    new.is_featured := false;
  end if;
  return new;
end $$;
create trigger posts_before_update before update on public.posts
for each row execute function public.posts_before_update();

-- Featuring one article un-features the previous one.
create or replace function public.posts_single_featured()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_featured then
    update public.posts set is_featured = false where id <> new.id and is_featured;
  end if;
  return new;
end $$;
create trigger posts_single_featured before insert or update of is_featured on public.posts
for each row when (new.is_featured) execute function public.posts_single_featured();

-- A slug can't collide with another article's old slug.
create or replace function public.posts_slug_free()
returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.post_slug_history h where h.slug = new.slug and h.post_id <> new.id) then
    raise exception 'slug_taken' using errcode = '23505';
  end if;
  return new;
end $$;
create trigger posts_slug_free before insert or update of slug on public.posts
for each row execute function public.posts_slug_free();

-- Revision retention: keep the latest 30 per article.
create or replace function public.trim_revisions()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.post_revisions
  where post_id = new.post_id
    and id not in (
      select id from public.post_revisions where post_id = new.post_id order by created_at desc limit 30
    );
  return null;
end $$;
create trigger post_revisions_trim after insert on public.post_revisions
for each row execute function public.trim_revisions();

-- Public helpers ------------------------------------------------------------

-- Is a post visible to the public right now?
create or replace function public.is_public_post(p public.posts)
returns boolean language sql stable as $$
  select p.status = 'published' and p.deleted_at is null and p.published_at <= now();
$$;

-- Search with ranking, used by the blog search box.
create or replace function public.search_posts(q text, page int default 1, page_size int default 9)
returns table (id uuid, total bigint)
language sql stable
set search_path = public
as $$
  with matches as (
    select p.id, ts_rank(p.search, websearch_to_tsquery('english', q)) as rank, p.published_at
    from public.posts p
    where p.status = 'published' and p.deleted_at is null and p.published_at <= now()
      and (
        p.search @@ websearch_to_tsquery('english', q)
        or exists (select 1 from public.categories c where c.id = p.category_id and c.name ilike '%' || q || '%')
        or exists (select 1 from public.post_tags pt join public.tags t on t.id = pt.tag_id where pt.post_id = p.id and t.name ilike '%' || q || '%')
      )
  )
  select id, count(*) over () as total
  from matches
  order by rank desc, published_at desc
  limit greatest(1, least(page_size, 50)) offset greatest(0, (page - 1) * page_size);
$$;
grant execute on function public.search_posts(text, int, int) to anon, authenticated;

-- Resolve an old slug to the current one.
-- security definer: slug history is private, but this only ever returns the
-- slug of an article that is already public.
create or replace function public.resolve_slug(old_slug text)
returns text language sql stable security definer set search_path = public as $$
  select p.slug from public.post_slug_history h join public.posts p on p.id = h.post_id
  where h.slug = old_slug and p.status = 'published' and p.deleted_at is null and p.published_at <= now();
$$;
grant execute on function public.resolve_slug(text) to anon, authenticated;

-- ===== 20261020000300_rls_and_grants.sql =====
-- Row Level Security and grants. Least privilege: start from nothing, then
-- grant exactly what each role needs. RLS and grants must both allow an action.

alter table public.admin_roles          enable row level security;
alter table public.categories           enable row level security;
alter table public.tags                 enable row level security;
alter table public.media_assets         enable row level security;
alter table public.posts                enable row level security;
alter table public.post_tags            enable row level security;
alter table public.post_slug_history    enable row level security;
alter table public.post_revisions       enable row level security;
alter table public.comments             enable row level security;
alter table public.comment_rate_events  enable row level security;
alter table public.site_settings        enable row level security;
alter table public.moderation_settings  enable row level security;
alter table public.audit_log            enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- ---------------------------------------------------------------- public read
grant select on public.categories, public.tags, public.post_tags, public.site_settings, public.media_assets to anon, authenticated;
grant select on public.posts to anon, authenticated;
-- Comments: the public may read only these columns (no moderation flags).
grant select (id, post_id, author_name, body, created_at, status) on public.comments to anon;
grant select on public.comments to authenticated;

create policy "public reads categories" on public.categories for select using (true);
create policy "public reads tags" on public.tags for select using (true);
create policy "public reads settings" on public.site_settings for select using (true);
create policy "public reads media metadata" on public.media_assets for select using (true);

create policy "public reads visible posts" on public.posts for select
  using ((status = 'published' and deleted_at is null and published_at <= now()) or public.is_admin());

create policy "public reads tags of visible posts" on public.post_tags for select
  using (exists (select 1 from public.posts p where p.id = post_id and ((p.status = 'published' and p.deleted_at is null and p.published_at <= now()) or public.is_admin())));

create policy "public reads approved comments" on public.comments for select
  using (
    (status = 'approved' and exists (
      select 1 from public.posts p where p.id = post_id and p.status = 'published' and p.deleted_at is null and p.published_at <= now()
    ))
    or public.is_admin()
  );

-- ------------------------------------------------------------- admin writes
grant insert, update, delete on public.categories, public.tags, public.post_tags, public.media_assets,
  public.posts, public.post_revisions, public.site_settings, public.moderation_settings to authenticated;
grant update (status, moderated_at), delete on public.comments to authenticated;
grant select on public.post_revisions, public.moderation_settings, public.audit_log, public.admin_roles, public.post_slug_history to authenticated;
grant insert on public.audit_log to authenticated;
grant usage on sequence public.audit_log_id_seq to authenticated;

create policy "admins manage categories" on public.categories for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins manage tags" on public.tags for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins manage post tags" on public.post_tags for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins manage media" on public.media_assets for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins insert posts" on public.posts for insert to authenticated with check (public.is_admin());
create policy "admins update posts" on public.posts for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins delete trashed posts" on public.posts for delete to authenticated using (public.is_admin() and deleted_at is not null);
create policy "admins manage revisions" on public.post_revisions for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins read slug history" on public.post_slug_history for select to authenticated using (public.is_admin());
create policy "admins moderate comments" on public.comments for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins delete comments" on public.comments for delete to authenticated using (public.is_admin());
create policy "admins update settings" on public.site_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins manage moderation" on public.moderation_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins read audit" on public.audit_log for select to authenticated using (public.is_admin());
create policy "admins write audit" on public.audit_log for insert to authenticated with check (public.is_admin() and actor_id = auth.uid());
create policy "admins read roles" on public.admin_roles for select to authenticated using (public.is_admin());
-- No insert/update/delete policies on admin_roles: only the service role can
-- grant admin rights, so a signed-in user can never promote themselves.

-- comment_rate_events: no policies at all. Only the Edge Function (service role) touches it.
-- comments INSERT: no policy for anon/authenticated. Public comments arrive only
-- through the submit-comment Edge Function, which validates and rate-limits.

-- ===========================================================================
-- Storage
-- ===========================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Public bucket: objects are readable by URL. Paths are random UUIDs, so an
-- image uploaded for an unpublished draft can't be discovered by listing.
create policy "admins upload media" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and public.is_admin());
create policy "admins update media" on storage.objects for update to authenticated
  using (bucket_id = 'media' and public.is_admin()) with check (bucket_id = 'media' and public.is_admin());
create policy "admins delete media" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and public.is_admin());
create policy "admins list media" on storage.objects for select to authenticated
  using (bucket_id = 'media' and public.is_admin());

-- ===== 20261020000400_import_and_defaults.sql =====
-- Small additions used by the Supabase data adapter.

-- New articles are attributed to whoever creates them.
alter table public.posts alter column author_id set default auth.uid();

-- Bulk import can bring comments across from Blogger. Only admins can insert
-- comments directly; visitors still go through the submit-comment function.
grant insert on public.comments to authenticated;
create policy "admins import comments" on public.comments for insert to authenticated
  with check (public.is_admin());

-- Revisions record who made them.
alter table public.post_revisions alter column created_by set default auth.uid();
alter table public.media_assets alter column created_by set default auth.uid();
alter table public.audit_log alter column actor_id set default auth.uid();
