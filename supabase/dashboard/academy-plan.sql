-- The Endowed Academy planning form: where Esther's answers are stored.
-- Paste into Supabase → SQL Editor → New query, change the email on the two lines marked CHANGE, then Run.
-- Anyone with the form link can SEND answers; only the email below can READ or delete them.

create table if not exists public.academy_plan_responses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text check (char_length(name) <= 200),
  answered integer check (answered between 0 and 100),
  answers jsonb not null check (pg_column_size(answers) < 300000),
  summary text check (char_length(summary) <= 150000)
);

alter table public.academy_plan_responses enable row level security;

revoke all on public.academy_plan_responses from anon, authenticated;
grant insert on public.academy_plan_responses to anon, authenticated;
grant select, delete on public.academy_plan_responses to authenticated;

drop policy if exists "anyone can send answers" on public.academy_plan_responses;
create policy "anyone can send answers" on public.academy_plan_responses
  for insert to anon, authenticated with check (true);

drop policy if exists "only Amen can read answers" on public.academy_plan_responses;
create policy "only Amen can read answers" on public.academy_plan_responses
  for select to authenticated
  using (lower(auth.jwt() ->> 'email') = lower('YOUR-EMAIL@example.com'));   -- CHANGE

drop policy if exists "only Amen can delete answers" on public.academy_plan_responses;
create policy "only Amen can delete answers" on public.academy_plan_responses
  for delete to authenticated
  using (lower(auth.jwt() ->> 'email') = lower('YOUR-EMAIL@example.com'));   -- CHANGE
