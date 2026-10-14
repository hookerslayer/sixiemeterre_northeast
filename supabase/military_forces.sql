-- Persistent land armies and garrisons. Positions use the validated 24 px grid.
create table if not exists public.military_forces (
    id uuid primary key default gen_random_uuid(),
    owner text not null,
    name text not null check (length(btrim(name)) between 1 and 80),
    force_kind text not null check (force_kind in ('land_army', 'garrison')),
    province_id bigint references public."Provinces"(id) on delete restrict,
    marker_id bigint references public.markers(id) on delete cascade,
    cell_x integer,
    cell_y integer,
    commander_name text,
    commander_age integer check (commander_age between 16 and 100),
    commander_skills jsonb not null default '{}'::jsonb check (jsonb_typeof(commander_skills) = 'object'),
    unit_groups jsonb not null default '[]'::jsonb check (jsonb_typeof(unit_groups) = 'array'),
    siege_equipment jsonb not null default '{}'::jsonb check (jsonb_typeof(siege_equipment) = 'object'),
    morale numeric(5,2) not null default 100 check (morale between 0 and 100),
    action_points integer not null default 100 check (action_points between 0 and 100),
    order_name text not null default 'обычный' check (order_name in ('обычный', 'решительный', 'осторожный')),
    tactic text not null default 'none',
    status text not null default 'active' check (status in ('active', 'disbanded')),
    updated_at timestamptz not null default now(),
    check (
        (force_kind = 'land_army' and province_id is not null and marker_id is null
            and cell_x is not null and cell_y is not null
            and cell_x between 0 and 10000 and cell_y between 0 and 10000
            and nullif(btrim(commander_name), '') is not null and commander_age is not null)
        or
        (force_kind = 'garrison' and ((province_id is not null and marker_id is null) or (province_id is null and marker_id is not null))
            and cell_x is null and cell_y is null)
    )
);

create index if not exists military_forces_owner_active_idx on public.military_forces(owner, status);
create index if not exists military_forces_map_idx on public.military_forces(cell_x, cell_y) where force_kind = 'land_army' and status = 'active';

alter table public.military_forces enable row level security;
drop policy if exists "Owners and admins can read military forces" on public.military_forces;
create policy "Owners and admins can read military forces" on public.military_forces
    for select to authenticated
    using (exists (
        select 1 from public.profiles as profile
        where profile.id = (select auth.uid())
          and (profile.role = 'admin' or profile.owner = military_forces.owner)
    ));
revoke all on public.military_forces from anon, authenticated;
grant select on public.military_forces to authenticated;

-- Refill field-army AP every game turn, age commanders once per game year,
-- and move a deceased commander's army into a state garrison.
create or replace function public.advance_military_forces_with_calendar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    years_elapsed integer;
begin
    if new.turn <= old.turn then return new; end if;
    years_elapsed := greatest(0, new.year - old.year);

    with evaluated as (
        select force.id, force.owner,
               force.commander_age + years_elapsed as next_age,
               case when years_elapsed > 0 and force.commander_age + years_elapsed >= 50
                    then least(1.0, 0.005 * power(2.0, (force.commander_age + years_elapsed - 50) / 5.0))
                    else 0.0 end as death_probability,
               mod(abs(hashtextextended(new.turn::text || ':' || force.id::text, 0)::numeric), 1000000) / 1000000.0 as death_roll
          from public.military_forces as force
         where force.force_kind = 'land_army' and force.status = 'active'
    ),
    destinations as (
        select evaluated.*,
               evaluated.death_roll < evaluated.death_probability as commander_died,
               (select marker.id from public.markers as marker
                 where marker.owner = evaluated.owner and marker.type <> 'ruins'
                 order by md5(new.turn::text || ':' || evaluated.id::text || ':' || marker.id::text)
                 limit 1) as destination_marker_id,
               (select province.id from public."Provinces" as province
                 where province.owner = evaluated.owner
                 order by md5(new.turn::text || ':' || evaluated.id::text || ':' || province.id::text)
                 limit 1) as destination_province_id
          from evaluated
    )
    update public.military_forces as force
       set force_kind = case when destinations.commander_died then 'garrison' else force.force_kind end,
           province_id = case when destinations.commander_died then
               case when destinations.destination_marker_id is not null then null else destinations.destination_province_id end
               else force.province_id end,
           marker_id = case when destinations.commander_died then destinations.destination_marker_id else force.marker_id end,
           cell_x = case when destinations.commander_died then null else force.cell_x end,
           cell_y = case when destinations.commander_died then null else force.cell_y end,
           commander_name = case when destinations.commander_died then null else force.commander_name end,
           commander_age = case when destinations.commander_died then null else destinations.next_age end,
           commander_skills = case when destinations.commander_died then '{}'::jsonb else force.commander_skills end,
           morale = force.morale,
           action_points = case when destinations.commander_died then 0 else 100 end,
           order_name = case when destinations.commander_died then 'осторожный' else force.order_name end,
           tactic = case when destinations.commander_died then 'none' else force.tactic end,
           updated_at = now()
      from destinations
     where force.id = destinations.id;
    return new;
end;
$function$;

revoke all on function public.advance_military_forces_with_calendar() from public, anon, authenticated;
drop trigger if exists advance_military_forces_on_game_turn on public.game_calendar;
create trigger advance_military_forces_on_game_turn
    after update of turn, year on public.game_calendar
    for each row execute function public.advance_military_forces_with_calendar();

create or replace function public.save_military_force(p_force jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
    caller_role text;
    v_id uuid;
    v_owner text := nullif(btrim(p_force->>'owner'), '');
    v_kind text := p_force->>'force_kind';
    v_province_id bigint := nullif(p_force->>'province_id', '')::bigint;
    v_marker_id bigint := nullif(p_force->>'marker_id', '')::bigint;
    v_cell_x integer := nullif(p_force->>'cell_x', '')::integer;
    v_cell_y integer := nullif(p_force->>'cell_y', '')::integer;
begin
    select profile.role into caller_role
      from public.profiles as profile where profile.id = (select auth.uid());
    if caller_role is distinct from 'admin' then
        raise exception 'Only an administrator can create or edit military forces' using errcode = '42501';
    end if;
    if jsonb_typeof(p_force) is distinct from 'object' then raise exception 'Invalid force payload' using errcode = '22023'; end if;
    if v_owner is null or not exists (select 1 from public.profiles as profile where profile.owner = v_owner) then
        raise exception 'State owner not found' using errcode = '22023';
    end if;
    if nullif(btrim(p_force->>'name'), '') is null or char_length(btrim(p_force->>'name')) > 80 then
        raise exception 'Force name must contain 1 to 80 characters' using errcode = '22023';
    end if;
    if v_kind not in ('land_army', 'garrison') then raise exception 'Invalid force kind' using errcode = '22023'; end if;
    if jsonb_typeof(coalesce(p_force->'unit_groups', '[]'::jsonb)) is distinct from 'array'
       or jsonb_typeof(coalesce(p_force->'commander_skills', '{}'::jsonb)) is distinct from 'object'
       or jsonb_typeof(coalesce(p_force->'siege_equipment', '{}'::jsonb)) is distinct from 'object' then
        raise exception 'Invalid army composition or commander skills' using errcode = '22023';
    end if;
    if v_kind = 'land_army' then
        if v_province_id is null or v_marker_id is not null or v_cell_x is null or v_cell_y is null
           or v_cell_x < 0 or v_cell_x > 10000 or v_cell_y < 0 or v_cell_y > 10000
           or nullif(btrim(p_force->>'commander_name'), '') is null
           or nullif(p_force->>'commander_age', '') is null then
            raise exception 'A field army needs a province, grid cell, named commander and age' using errcode = '22023';
        end if;
        if not exists (select 1 from public."Provinces" as province where province.id = v_province_id) then
            raise exception 'Province not found' using errcode = '22023';
        end if;
    else
        if ((v_province_id is null) = (v_marker_id is null)) or v_cell_x is not null or v_cell_y is not null then
            raise exception 'A garrison must belong to exactly one province or settlement' using errcode = '22023';
        end if;
        if v_province_id is not null and not exists (select 1 from public."Provinces" as province where province.id = v_province_id) then
            raise exception 'Province not found' using errcode = '22023';
        end if;
        if v_marker_id is not null and not exists (select 1 from public.markers as marker where marker.id = v_marker_id) then
            raise exception 'Settlement not found' using errcode = '22023';
        end if;
    end if;

    v_id := nullif(p_force->>'id', '')::uuid;
    if v_id is not null and not exists (select 1 from public.military_forces as force where force.id = v_id) then
        raise exception 'Military force not found' using errcode = '22023';
    end if;
    insert into public.military_forces (
        id, owner, name, force_kind, province_id, marker_id, cell_x, cell_y,
        commander_name, commander_age, commander_skills, unit_groups, siege_equipment,
        morale, action_points, order_name, tactic, status, updated_at
    ) values (
        coalesce(v_id, gen_random_uuid()), v_owner, btrim(p_force->>'name'), v_kind, v_province_id, v_marker_id, v_cell_x, v_cell_y,
        nullif(btrim(p_force->>'commander_name'), ''), nullif(p_force->>'commander_age', '')::integer,
        coalesce(p_force->'commander_skills', '{}'::jsonb), coalesce(p_force->'unit_groups', '[]'::jsonb),
        coalesce(p_force->'siege_equipment', '{}'::jsonb), coalesce((p_force->>'morale')::numeric, 100),
        coalesce((p_force->>'action_points')::integer, 100), coalesce(p_force->>'order_name', 'обычный'),
        coalesce(p_force->>'tactic', 'none'), coalesce(p_force->>'status', 'active'), now()
    ) on conflict (id) do update set
        owner = excluded.owner, name = excluded.name, force_kind = excluded.force_kind,
        province_id = excluded.province_id, marker_id = excluded.marker_id,
        cell_x = excluded.cell_x, cell_y = excluded.cell_y,
        commander_name = excluded.commander_name, commander_age = excluded.commander_age,
        commander_skills = excluded.commander_skills, unit_groups = excluded.unit_groups,
        siege_equipment = excluded.siege_equipment, morale = excluded.morale,
        action_points = excluded.action_points, order_name = excluded.order_name,
        tactic = excluded.tactic, status = excluded.status, updated_at = now()
    returning id into v_id;
    return v_id;
end;
$function$;

revoke all on function public.save_military_force(jsonb) from public, anon;
grant execute on function public.save_military_force(jsonb) to authenticated;
