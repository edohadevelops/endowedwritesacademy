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
