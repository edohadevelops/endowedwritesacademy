-- The Endowed Academy planning form: where Esther's answers are stored.
-- Paste into Supabase → SQL Editor → New query, then Run.
-- Anyone with the form link can send answers, and the responses page shows them without signing in.
-- Note: that also means anyone who has the site's public key can read these answers.

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
grant insert, select on public.academy_plan_responses to anon, authenticated;

drop policy if exists "anyone can send answers" on public.academy_plan_responses;
create policy "anyone can send answers" on public.academy_plan_responses
  for insert to anon, authenticated with check (true);

drop policy if exists "only Amen can read answers" on public.academy_plan_responses;
drop policy if exists "only Amen can delete answers" on public.academy_plan_responses;
drop policy if exists "anyone can read answers" on public.academy_plan_responses;
create policy "anyone can read answers" on public.academy_plan_responses
  for select to anon, authenticated using (true);
