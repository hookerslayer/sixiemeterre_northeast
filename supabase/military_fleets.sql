-- Persistent naval fleets. Apply after military_battles.sql.
create table if not exists public.military_fleets (
    id uuid primary key default gen_random_uuid(),
    owner text not null references public.state_mechanics(owner) on delete restrict,
    name text not null check (length(btrim(name)) between 1 and 80),
    ships jsonb not null default '[]'::jsonb check (case when jsonb_typeof(ships) = 'array' then jsonb_array_length(ships) between 0 and 12 else false end),
    morale numeric(5,2) not null default 100 check (morale between 0 and 100),
    action_points integer not null default 100 check (action_points between 0 and 100),
    status text not null default 'active' check (status in ('active', 'disbanded')),
    updated_at timestamptz not null default now(),
    unique (owner, name)
);

alter table public.military_battle_armies
    add column if not exists persistent_fleet_id uuid
        references public.military_fleets(id) on delete set null;

create unique index if not exists military_battle_armies_fleet_once_idx
    on public.military_battle_armies(battle_id, persistent_fleet_id)
    where persistent_fleet_id is not null;
create index if not exists military_fleets_owner_status_idx
    on public.military_fleets(owner, status, name);

alter table public.military_fleets enable row level security;
drop policy if exists "Owners and admins can read naval fleets" on public.military_fleets;
create policy "Owners and admins can read naval fleets"
    on public.military_fleets for select to authenticated
    using (exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid())
          and (p.role = 'admin' or p.owner = military_fleets.owner)
    ));
drop policy if exists "Admins can insert naval fleets" on public.military_fleets;
create policy "Admins can insert naval fleets"
    on public.military_fleets for insert to authenticated
    with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));
drop policy if exists "Admins can update naval fleets" on public.military_fleets;
create policy "Admins can update naval fleets"
    on public.military_fleets for update to authenticated
    using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'))
    with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));

revoke all on public.military_fleets from anon, authenticated;
grant select, insert, update on public.military_fleets to authenticated;

create or replace function public.save_military_fleets(p_fleets jsonb)
returns void
language plpgsql
set search_path = ''
as $function$
declare
    v_fleet jsonb;
    v_id uuid;
begin
    if not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin') then
        raise exception 'Only an administrator can save naval fleets';
    end if;
    if jsonb_typeof(p_fleets) is distinct from 'array' then
        raise exception 'Provide an array of one or two fleets';
    end if;
    if jsonb_array_length(p_fleets) not between 1 and 2 then
        raise exception 'Provide one or two fleets';
    end if;
    for v_fleet in select item.value from jsonb_array_elements(p_fleets) as item(value) loop
        if nullif(btrim(v_fleet->>'owner'), '') is null
           or nullif(btrim(v_fleet->>'name'), '') is null then
            raise exception 'Fleet owner and name are required';
        end if;
        if jsonb_typeof(v_fleet->'ships') is distinct from 'array' then
            raise exception 'Fleet ships must be an array';
        end if;
        if jsonb_array_length(v_fleet->'ships') not between 1 and 12 then
            raise exception 'Fleet must contain one to twelve ships';
        end if;
        v_id := nullif(v_fleet->>'id', '')::uuid;
        insert into public.military_fleets (id, owner, name, ships, morale, status)
        values (
            coalesce(v_id, pg_catalog.gen_random_uuid()), v_fleet->>'owner', btrim(v_fleet->>'name'), v_fleet->'ships',
            coalesce((v_fleet->>'morale')::numeric, 100), coalesce(v_fleet->>'status', 'active')
        )
        on conflict (id) do update
            set owner = excluded.owner,
                name = excluded.name,
                ships = excluded.ships,
                morale = excluded.morale,
                status = excluded.status,
                updated_at = now();
    end loop;
end;
$function$;

revoke all on function public.save_military_fleets(jsonb) from public, anon;
grant execute on function public.save_military_fleets(jsonb) to authenticated;

create or replace function public.guard_pending_military_fleet_update()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
    if exists (
        select 1 from public.military_battle_armies army
        join public.military_battles battle on battle.id = army.battle_id
        where army.persistent_fleet_id = old.id and battle.status = 'pending'
    ) then
        raise exception 'A fleet committed to a pending battle cannot be edited' using errcode = '55000';
    end if;
    return new;
end;
$function$;

revoke all on function public.guard_pending_military_fleet_update() from public, anon, authenticated;
drop trigger if exists military_fleet_pending_battle_guard on public.military_fleets;
create trigger military_fleet_pending_battle_guard
    before update on public.military_fleets
    for each row execute function public.guard_pending_military_fleet_update();

grant select on public.military_battle_armies to authenticated;

create or replace function public.link_persistent_fleet_to_battle_army()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
    v_fleet_id uuid := nullif(new.unit_data->>'persistent_fleet_id', '')::uuid;
    v_fleet public.military_fleets%rowtype;
    v_battle_type text;
begin
    if v_fleet_id is null then
        new.persistent_fleet_id := null;
        return new;
    end if;
    select battle_type into v_battle_type
      from public.military_battles where id = new.battle_id;
    if v_battle_type is distinct from 'naval' then
        raise exception 'A persistent fleet can only join a naval battle' using errcode = '22023';
    end if;
    select * into v_fleet
      from public.military_fleets fleet
     where fleet.id = v_fleet_id and fleet.owner = new.owner and fleet.status = 'active'
     for update;
    if not found then
        raise exception 'Selected fleet is unavailable to this participant' using errcode = '22023';
    end if;
    if exists (
        select 1 from public.military_battle_armies other_army
        join public.military_battles other_battle on other_battle.id = other_army.battle_id
        where other_army.persistent_fleet_id = v_fleet_id and other_battle.status = 'pending'
    ) then
        raise exception 'This fleet is already committed to another pending battle' using errcode = '23505';
    end if;
    new.persistent_fleet_id := v_fleet_id;
    new.morale := v_fleet.morale;
    new.unit_data := jsonb_set(new.unit_data, '{ships}', v_fleet.ships, true);
    return new;
end;
$function$;

revoke all on function public.link_persistent_fleet_to_battle_army() from public, anon, authenticated;
drop trigger if exists military_battle_army_link_fleet on public.military_battle_armies;
create trigger military_battle_army_link_fleet
    before insert on public.military_battle_armies
    for each row execute function public.link_persistent_fleet_to_battle_army();

create or replace function public.apply_confirmed_naval_battle_to_fleets()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
    v_army record;
    v_fleet_result jsonb;
    v_survivors jsonb;
begin
    if not exists (select 1 from public.military_battles b where b.id = new.battle_id and b.battle_type = 'naval') then
        return new;
    end if;
    for v_army in
        select army.id, army.side, army.persistent_fleet_id
          from public.military_battle_armies army
         where army.battle_id = new.battle_id and army.persistent_fleet_id is not null
    loop
        v_fleet_result := new.report #> array['fleets', v_army.side];
        if jsonb_typeof(v_fleet_result->'ships') is distinct from 'array' then
            raise exception 'Confirmed naval report is missing fleet survivors';
        end if;
        select coalesce(jsonb_agg(ship.value order by ship.ordinality), '[]'::jsonb)
          into v_survivors
          from jsonb_array_elements(v_fleet_result->'ships') with ordinality as ship(value, ordinality)
         where coalesce((ship.value->>'sunk')::boolean, false) = false
           and coalesce((ship.value->>'captured')::boolean, false) = false
           and coalesce((ship.value->>'crew')::integer, 0) > 0;
        update public.military_fleets fleet
           set ships = v_survivors,
               morale = greatest(0, least(100, coalesce((v_fleet_result->>'morale')::numeric, fleet.morale))),
               status = case when jsonb_array_length(v_survivors) = 0 then 'disbanded' else fleet.status end,
               updated_at = now()
         where fleet.id = v_army.persistent_fleet_id;
    end loop;
    return new;
end;
$function$;

revoke all on function public.apply_confirmed_naval_battle_to_fleets() from public, anon, authenticated;
drop trigger if exists military_naval_fleet_sync on public.military_battle_admin_results;
create trigger military_naval_fleet_sync
    after insert or update on public.military_battle_admin_results
    for each row execute function public.apply_confirmed_naval_battle_to_fleets();
