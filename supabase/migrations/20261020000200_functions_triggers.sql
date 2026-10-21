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
