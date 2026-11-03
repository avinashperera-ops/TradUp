-- Run once in Supabase → SQL Editor
create table if not exists public.accounts (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  cash      numeric not null default 100000,
  positions jsonb   not null default '{}',
  tx        jsonb   not null default '[]',
  watch     jsonb   not null default '[]',
  created_at timestamptz default now()
);
alter table public.accounts enable row level security;
create policy "own row select" on public.accounts for select using (auth.uid() = user_id);
create policy "own row insert" on public.accounts for insert with check (auth.uid() = user_id);
create policy "own row update" on public.accounts for update using (auth.uid() = user_id);
