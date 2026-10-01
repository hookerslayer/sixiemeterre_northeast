-- Stores player-editable tax rates, cultural/religious statuses and assimilation periods.
-- Apply once in the Supabase SQL Editor for the existing project.
create table if not exists public.state_mechanics (
    owner text primary key,
    settings jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
);

alter table public.state_mechanics enable row level security;

drop policy if exists "State members and admins can read mechanics" on public.state_mechanics;
create policy "State members and admins can read mechanics"
    on public.state_mechanics for select to authenticated
    using (exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid()) and (p.role = 'admin' or p.owner = state_mechanics.owner)
    ));

drop policy if exists "State members and admins can insert mechanics" on public.state_mechanics;
create policy "State members and admins can insert mechanics"
    on public.state_mechanics for insert to authenticated
    with check (exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid()) and (p.role = 'admin' or p.owner = state_mechanics.owner)
    ));

drop policy if exists "State members and admins can update mechanics" on public.state_mechanics;
create policy "State members and admins can update mechanics"
    on public.state_mechanics for update to authenticated
    using (exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid()) and (p.role = 'admin' or p.owner = state_mechanics.owner)
    ))
    with check (exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid()) and (p.role = 'admin' or p.owner = state_mechanics.owner)
    ));

grant select, insert, update on public.state_mechanics to authenticated;

-- The existing profile policies permit users to update their own profile row.
-- Keep role assignment server-side so a player cannot grant themselves admin access.
revoke insert, update on public.profiles from anon, authenticated;
