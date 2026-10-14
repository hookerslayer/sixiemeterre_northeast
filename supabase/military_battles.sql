-- Persistent, role-filtered battle events.
-- Apply once in the Supabase SQL Editor after reviewing the project schema.

create table if not exists public.military_battles (
    id uuid primary key default gen_random_uuid(),
    battle_type text not null default 'land' check (battle_type in ('land', 'naval')),
    terrain text not null default 'plain',
    status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled')),
    participant_owners text[] not null check (cardinality(participant_owners) >= 2),
    location jsonb not null default '{}'::jsonb,
    random_seed uuid not null default gen_random_uuid(),
    version integer not null default 1 check (version > 0),
    public_outcome text check (public_outcome in ('attacker', 'defender', 'draw')),
    created_by uuid not null references auth.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    confirmed_by uuid references auth.users(id),
    confirmed_at timestamptz,
    check ((status = 'confirmed') = (confirmed_at is not null)),
    check ((status = 'confirmed') = (public_outcome is not null))
);

create table if not exists public.military_battle_armies (
    id uuid primary key default gen_random_uuid(),
    battle_id uuid not null references public.military_battles(id) on delete cascade,
    owner text not null references public.state_mechanics(owner),
    side text not null check (side in ('attacker', 'defender')),
    name text not null check (length(btrim(name)) between 1 and 80),
    unit_data jsonb not null default '{}'::jsonb,
    morale numeric(5,2) not null default 100 check (morale between 0 and 100),
    order_name text not null default 'осторожный' check (order_name in ('обычный', 'решительный', 'осторожный')),
    tactic text not null default 'none',
    decision text not null default 'pending' check (decision in ('pending', 'fight', 'withdraw')),
    withdrawal_route jsonb,
    updated_at timestamptz not null default now(),
    check ((decision = 'withdraw') = (withdrawal_route is not null))
);

create index if not exists military_battles_status_created_idx
    on public.military_battles(status, created_at desc);
create index if not exists military_battle_armies_battle_idx
    on public.military_battle_armies(battle_id, side, updated_at);
create index if not exists military_battle_armies_owner_idx
    on public.military_battle_armies(owner, battle_id);

create table if not exists public.military_battle_reports (
    battle_id uuid not null references public.military_battles(id) on delete cascade,
    owner text not null references public.state_mechanics(owner),
    report jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    primary key (battle_id, owner)
);

create table if not exists public.military_battle_admin_results (
    battle_id uuid primary key references public.military_battles(id) on delete cascade,
    report jsonb not null,
    created_at timestamptz not null default now()
);

alter table public.military_battles enable row level security;
alter table public.military_battle_armies enable row level security;
alter table public.military_battle_reports enable row level security;
alter table public.military_battle_admin_results enable row level security;

drop policy if exists "Participants and admins can read battle headers" on public.military_battles;
create policy "Participants and admins can read battle headers"
    on public.military_battles for select to authenticated
    using (exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid())
          and (p.role = 'admin' or p.owner = any(military_battles.participant_owners))
    ));

drop policy if exists "Owners and admins can read their battle armies" on public.military_battle_armies;
create policy "Owners and admins can read their battle armies"
    on public.military_battle_armies for select to authenticated
    using (exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid()) and (p.role = 'admin' or p.owner = military_battle_armies.owner)
    ));

drop policy if exists "Owners can update pending battle decisions" on public.military_battle_armies;
create policy "Owners can update pending battle decisions"
    on public.military_battle_armies for update to authenticated
    using (
        exists (
            select 1 from public.profiles p
            where p.id = (select auth.uid()) and p.role <> 'admin' and p.owner = military_battle_armies.owner
        )
        and exists (
            select 1 from public.military_battles b
            where b.id = military_battle_armies.battle_id and b.status = 'pending'
        )
    )
    with check (
        exists (
            select 1 from public.profiles p
            where p.id = (select auth.uid()) and p.role <> 'admin' and p.owner = military_battle_armies.owner
        )
    );

drop policy if exists "Admins can update pending battle decisions" on public.military_battle_armies;
create policy "Admins can update pending battle decisions"
    on public.military_battle_armies for update to authenticated
    using (
        exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
        and exists (select 1 from public.military_battles b where b.id = military_battle_armies.battle_id and b.status = 'pending')
    )
    with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));

drop policy if exists "Owners and admins can read battle reports" on public.military_battle_reports;
create policy "Owners and admins can read battle reports"
    on public.military_battle_reports for select to authenticated
    using (exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid()) and (p.role = 'admin' or p.owner = military_battle_reports.owner)
    ));

drop policy if exists "Only admins can read full battle calculations" on public.military_battle_admin_results;
create policy "Only admins can read full battle calculations"
    on public.military_battle_admin_results for select to authenticated
    using (exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid()) and p.role = 'admin'
    ));

revoke all on public.military_battles, public.military_battle_armies,
    public.military_battle_reports, public.military_battle_admin_results from anon, authenticated;
grant select on public.military_battles, public.military_battle_armies,
    public.military_battle_reports, public.military_battle_admin_results to authenticated;
grant update (order_name, tactic, decision, withdrawal_route)
    on public.military_battle_armies to authenticated;

create or replace function public.guard_pending_military_battle()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
    v_status text;
begin
    select status into v_status from public.military_battles where id = new.battle_id for update;
    if v_status is distinct from 'pending' then raise exception 'Battle is no longer open for participant decisions'; end if;
    return new;
end;
$$;
revoke execute on function public.guard_pending_military_battle() from public, anon, authenticated;

drop trigger if exists military_battle_army_pending_guard on public.military_battle_armies;
create trigger military_battle_army_pending_guard
    before update on public.military_battle_armies
    for each row execute function public.guard_pending_military_battle();

create or replace function public.bump_military_battle_version()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
    update public.military_battles
       set version = version + 1, updated_at = now()
     where id = coalesce(new.battle_id, old.battle_id) and status = 'pending';
    return null;
end;
$$;
revoke execute on function public.bump_military_battle_version() from public, anon, authenticated;

drop trigger if exists military_battle_army_version on public.military_battle_armies;
create trigger military_battle_army_version
    after insert or update or delete on public.military_battle_armies
    for each row execute function public.bump_military_battle_version();

create or replace function public.create_military_battle(p_battle jsonb, p_armies jsonb)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
    v_id uuid;
    v_owner text;
    v_army jsonb;
    v_owners text[];
    v_admin boolean;
begin
    select p.role = 'admin' into v_admin
      from public.profiles p where p.id = auth.uid();
    if coalesce(v_admin, false) is not true then raise exception 'Only an administrator can create battle events'; end if;
    if jsonb_typeof(p_armies) <> 'array' or jsonb_array_length(p_armies) < 2 or jsonb_array_length(p_armies) > 24 then
        raise exception 'A battle must contain between 2 and 24 armies';
    end if;
    if p_battle->>'battle_type' not in ('land', 'naval') then raise exception 'Invalid battle type'; end if;
    if p_battle->>'terrain' is null or length(p_battle->>'terrain') > 40 then raise exception 'Invalid battle terrain'; end if;

    select array_agg(distinct item.value->>'owner') into v_owners
      from jsonb_array_elements(p_armies) as item(value)
     where nullif(item.value->>'owner', '') is not null;
    if coalesce(cardinality(v_owners), 0) < 2 then raise exception 'A battle must involve at least two state owners'; end if;
    if not exists (select 1 from jsonb_array_elements(p_armies) as item(value) where item.value->>'side' = 'attacker')
       or not exists (select 1 from jsonb_array_elements(p_armies) as item(value) where item.value->>'side' = 'defender') then
        raise exception 'A battle must contain armies on both sides';
    end if;

    insert into public.military_battles (battle_type, terrain, participant_owners, location, created_by)
    values (p_battle->>'battle_type', p_battle->>'terrain', v_owners, coalesce(p_battle->'location', '{}'::jsonb), auth.uid())
    returning id into v_id;

    for v_army in select item.value from jsonb_array_elements(p_armies) as item(value) loop
        v_owner := nullif(v_army->>'owner', '');
        if v_owner is null or not (v_army->>'side' in ('attacker','defender')) then raise exception 'Invalid army owner or side'; end if;
        if not exists (select 1 from public.state_mechanics sm where sm.owner = v_owner) then raise exception 'Unknown state owner'; end if;
        if jsonb_typeof(coalesce(v_army->'unit_data', '{}'::jsonb)) <> 'object' then raise exception 'Army unit_data must be an object'; end if;
        insert into public.military_battle_armies (battle_id, owner, side, name, unit_data, morale, order_name, tactic, decision, withdrawal_route)
        values (
            v_id, v_owner, v_army->>'side', coalesce(nullif(btrim(v_army->>'name'), ''), 'Армия'),
            coalesce(v_army->'unit_data', '{}'::jsonb), coalesce((v_army->>'morale')::numeric, 100),
            coalesce(v_army->>'order_name', 'осторожный'), coalesce(v_army->>'tactic', 'none'),
            coalesce(v_army->>'decision', 'pending'), v_army->'withdrawal_route'
        );
    end loop;
    return v_id;
end;
$$;

create or replace function public.confirm_military_battle(
    p_battle_id uuid,
    p_expected_version integer,
    p_outcome text,
    p_admin_report jsonb,
    p_owner_reports jsonb
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
    v_battle public.military_battles%rowtype;
    v_report jsonb;
    v_report_owner text;
begin
    if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin') then
        raise exception 'Only an administrator can confirm a battle';
    end if;
    select * into v_battle from public.military_battles where id = p_battle_id for update;
    if not found then raise exception 'Battle not found'; end if;
    if v_battle.status <> 'pending' then raise exception 'Battle is already closed'; end if;
    if v_battle.version <> p_expected_version then raise exception 'Battle changed after preview; recalculate before confirming'; end if;
    if p_outcome not in ('attacker','defender','draw') then raise exception 'Invalid battle outcome'; end if;
    if jsonb_typeof(p_admin_report) <> 'object' or jsonb_typeof(p_owner_reports) <> 'array' then raise exception 'Invalid battle report'; end if;
    if (select count(distinct item.value->>'owner') from jsonb_array_elements(p_owner_reports) as item(value)) <> cardinality(v_battle.participant_owners) then
        raise exception 'A separate report is required for every participant';
    end if;
    if exists (select 1 from public.military_battle_armies a where a.battle_id = p_battle_id and a.decision = 'pending') then
        raise exception 'Every participating army must have a confirmed decision before battle resolution';
    end if;

    update public.military_battles
       set status = 'confirmed', public_outcome = p_outcome, confirmed_by = auth.uid(), confirmed_at = now(), updated_at = now()
     where id = p_battle_id;
    insert into public.military_battle_admin_results (battle_id, report)
    values (p_battle_id, p_admin_report)
    on conflict (battle_id) do update set report = excluded.report, created_at = now();

    for v_report in select item.value from jsonb_array_elements(p_owner_reports) as item(value) loop
        v_report_owner := nullif(v_report->>'owner', '');
        if v_report_owner is null or not (v_report_owner = any(v_battle.participant_owners)) then raise exception 'Report owner is not a battle participant'; end if;
        if jsonb_typeof(v_report->'report') <> 'object' then raise exception 'Participant report must be an object'; end if;
        insert into public.military_battle_reports (battle_id, owner, report)
        values (p_battle_id, v_report_owner, v_report->'report')
        on conflict (battle_id, owner) do update set report = excluded.report, created_at = now();
    end loop;
    return v_battle.version;
end;
$$;

revoke execute on function public.create_military_battle(jsonb, jsonb) from public, anon;
revoke execute on function public.confirm_military_battle(uuid, integer, text, jsonb, jsonb) from public, anon;
grant execute on function public.create_military_battle(jsonb, jsonb) to authenticated;
grant execute on function public.confirm_military_battle(uuid, integer, text, jsonb, jsonb) to authenticated;
