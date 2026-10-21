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
