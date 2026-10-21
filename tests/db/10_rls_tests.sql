-- Security tests for the RLS policies and grants.
-- Run with tests/db/run.sh. Each check raises an exception on failure.
\set ON_ERROR_STOP on
set client_min_messages = notice;

grant all on all tables in schema public to service_role;

-- --------------------------------------------------------------- fixtures
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@endowed.test'),
  ('00000000-0000-0000-0000-00000000000b', 'reader@example.com');
insert into public.admin_roles (user_id, role, display_name) values ('00000000-0000-0000-0000-00000000000a', 'owner', 'Owner');
insert into public.categories (id, name, slug) values ('11111111-1111-1111-1111-111111111111', 'Study Tips', 'study-tips');
insert into public.posts (id, title, slug, status, published_at, content_text) values
  ('22222222-2222-2222-2222-000000000001', 'Published article', 'published-article', 'published', now() - interval '1 day', 'Revision and memory'),
  ('22222222-2222-2222-2222-000000000002', 'Secret draft', 'secret-draft', 'draft', null, 'unfinished'),
  ('22222222-2222-2222-2222-000000000003', 'Scheduled article', 'scheduled-article', 'published', now() + interval '2 days', 'not yet'),
  ('22222222-2222-2222-2222-000000000004', 'Trashed article', 'trashed-article', 'published', now() - interval '3 days', 'gone');
update public.posts set deleted_at = now() where id = '22222222-2222-2222-2222-000000000004';
insert into public.comments (post_id, author_name, body, status, flags) values
  ('22222222-2222-2222-2222-000000000001', 'Ada', 'Approved comment', 'approved', '{}'),
  ('22222222-2222-2222-2222-000000000001', 'Spammer', 'Waiting comment', 'pending', '{"matches a spam pattern"}');
insert into public.post_revisions (post_id, title, content, reason) values ('22222222-2222-2222-2222-000000000002', 'Secret draft', '{}', 'manual');

create or replace function pg_temp.expect_fail(sql text, label text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    raise notice 'PASS  %', label;
    return;
  end;
  raise exception 'FAIL  % (statement succeeded)', label;
end $$;
create or replace function pg_temp.expect_rows(sql text, expected int, label text) returns void language plpgsql as $$
declare n int;
begin
  execute format('with q as (%s) select count(*) from q', sql) into n;
  if n <> expected then raise exception 'FAIL  % (expected %, got %)', label, expected, n; end if;
  raise notice 'PASS  %', label;
end $$;
grant execute on all functions in schema pg_temp to anon, authenticated;

-- ======================================================= anonymous visitor
set role anon;
select set_config('request.jwt.claim.sub', '', false);

select pg_temp.expect_rows('select * from public.posts', 1, 'anon sees only the visible published article');
select pg_temp.expect_rows($q$select * from public.posts where slug = 'secret-draft'$q$, 0, 'anon cannot read a draft by slug');
select pg_temp.expect_rows($q$select * from public.posts where slug = 'scheduled-article'$q$, 0, 'anon cannot read a scheduled article early');
select pg_temp.expect_rows($q$select * from public.posts where slug = 'trashed-article'$q$, 0, 'anon cannot read a trashed article');
select pg_temp.expect_rows('select id, author_name, body from public.comments', 1, 'anon sees only approved comments');
select pg_temp.expect_fail('select flags from public.comments', 'anon cannot read moderation flags');
select pg_temp.expect_fail('select * from public.post_revisions', 'anon cannot read revisions');
select pg_temp.expect_fail('select * from public.moderation_settings', 'anon cannot read moderation settings');
select pg_temp.expect_fail('select * from public.admin_roles', 'anon cannot read admin roles');
select pg_temp.expect_fail($q$insert into public.posts (title, slug) values ('x', 'x')$q$, 'anon cannot create articles');
select pg_temp.expect_fail($q$update public.posts set title = 'hacked'$q$, 'anon cannot edit articles');
select pg_temp.expect_fail($q$delete from public.posts$q$, 'anon cannot delete articles');
select pg_temp.expect_fail($q$insert into public.comments (post_id, author_name, body) values ('22222222-2222-2222-2222-000000000001', 'Bot', 'direct insert')$q$, 'anon cannot insert comments directly (must use the Edge Function)');
select pg_temp.expect_fail($q$update public.site_settings set settings = '{"siteName":"pwned"}'$q$, 'anon cannot change site settings');
select pg_temp.expect_fail($q$insert into storage.objects (bucket_id, name) values ('media', 'evil.webp')$q$, 'anon cannot upload media');
select pg_temp.expect_rows('select * from public.search_posts(''memory'')', 1, 'search finds the published article');
select pg_temp.expect_rows('select * from public.search_posts(''unfinished'')', 0, 'search never returns drafts');
reset role;

-- ================================================ signed-in, but not admin
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);

select pg_temp.expect_rows('select * from public.posts', 1, 'non-admin sees only public articles');
select pg_temp.expect_fail($q$insert into public.posts (title, slug) values ('x', 'x-2')$q$, 'non-admin cannot create articles');
select pg_temp.expect_rows($q$update public.posts set title = 'hacked' returning id$q$, 0, 'non-admin update affects no articles');
select pg_temp.expect_fail($q$insert into public.admin_roles (user_id, role) values ('00000000-0000-0000-0000-00000000000b', 'owner')$q$, 'non-admin cannot make themselves admin');
select pg_temp.expect_rows($q$update public.comments set status = 'approved' returning id$q$, 0, 'non-admin cannot approve comments');
select pg_temp.expect_rows($q$update public.site_settings set settings = '{}' returning id$q$, 0, 'non-admin cannot change settings');
select pg_temp.expect_rows('select * from public.post_revisions', 0, 'non-admin cannot read revisions');
select pg_temp.expect_fail($q$insert into public.comments (post_id, author_name, body, status) values ('22222222-2222-2222-2222-000000000001', 'Sneaky', 'self-approved', 'approved')$q$, 'non-admin cannot insert comments directly (even approved ones)');
select pg_temp.expect_fail($q$insert into storage.objects (bucket_id, name) values ('media', 'evil.webp')$q$, 'non-admin cannot upload media');
reset role;

-- ==================================================================== admin
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);

select pg_temp.expect_rows('select * from public.posts', 4, 'admin sees drafts, scheduled and trashed articles');
select pg_temp.expect_rows('select * from public.comments', 2, 'admin sees pending comments');
select pg_temp.expect_rows($q$insert into public.posts (title, slug) values ('New', 'new-article') returning id$q$, 1, 'admin can create an article');
select pg_temp.expect_rows($q$update public.posts set title = 'Edited' where slug = 'secret-draft' and version = 1 returning version$q$, 1, 'admin can save with the expected version');
select pg_temp.expect_rows($q$update public.posts set title = 'Stale' where slug = 'secret-draft' and version = 1 returning version$q$, 0, 'stale autosave (old version) is rejected');
select pg_temp.expect_rows($q$update public.comments set status = 'approved' where status = 'pending' returning id$q$, 1, 'admin can approve a comment');
select pg_temp.expect_rows($q$delete from public.posts where slug = 'published-article' returning id$q$, 0, 'admin cannot hard-delete an article that is not in the trash');
select pg_temp.expect_rows($q$delete from public.posts where slug = 'trashed-article' returning id$q$, 1, 'admin can permanently delete from the trash');
select pg_temp.expect_rows($q$insert into storage.objects (bucket_id, name) values ('media', '2026/10/ok.webp') returning id$q$, 1, 'admin can upload media');
select pg_temp.expect_fail($q$insert into public.admin_roles (user_id, role) values ('00000000-0000-0000-0000-00000000000b', 'editor')$q$, 'even admins cannot grant roles from the client');

-- slug history keeps old links working
update public.posts set slug = 'published-article-renamed' where slug = 'published-article';
reset role;
set role anon;
select pg_temp.expect_rows($q$select public.resolve_slug('published-article') as s where public.resolve_slug('published-article') = 'published-article-renamed'$q$, 1, 'old slug redirects to the new one');
reset role;

-- featuring is exclusive
update public.posts set is_featured = true where slug = 'published-article-renamed';
insert into public.posts (title, slug, status, published_at, is_featured) values ('Another', 'another', 'published', now(), true);
select pg_temp.expect_rows('select * from public.posts where is_featured', 1, 'only one article is featured at a time');

\echo 'All database security tests passed.'
