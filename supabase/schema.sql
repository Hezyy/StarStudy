-- 在自己的Supabase项目SQL编辑器执行；不读取或修改现有本地数据库。
create table if not exists public.study_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null check(revision > 0),
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.study_snapshots enable row level security;
revoke all on public.study_snapshots from anon;
grant select, insert, update on public.study_snapshots to authenticated;
drop policy if exists "own_snapshot_select" on public.study_snapshots;
create policy "own_snapshot_select" on public.study_snapshots for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "own_snapshot_insert" on public.study_snapshots;
create policy "own_snapshot_insert" on public.study_snapshots for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "own_snapshot_update" on public.study_snapshots;
create policy "own_snapshot_update" on public.study_snapshots for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
