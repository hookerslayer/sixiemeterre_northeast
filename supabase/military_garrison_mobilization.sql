-- Let a state player turn an active garrison into a field army.
create or replace function public.mobilize_military_garrison(
    p_force_id uuid,
    p_name text,
    p_commander_name text,
    p_commander_age integer,
    p_province_id bigint,
    p_cell_x integer,
    p_cell_y integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_profile public.profiles%rowtype;
    v_force public.military_forces%rowtype;
    v_marker public.markers%rowtype;
    v_province public."Provinces"%rowtype;
    v_calendar public.game_calendar%rowtype;
    v_terrain public.military_terrain_cells%rowtype;
    v_source_province_id bigint;
begin
    select * into v_profile from public.profiles where id = (select auth.uid());
    if not found or coalesce(v_profile.role, '') <> 'player' or nullif(v_profile.owner, '') is null then
        raise exception 'Only a state player can mobilize a garrison' using errcode = '42501';
    end if;
    if p_force_id is null or nullif(btrim(p_name), '') is null or char_length(btrim(p_name)) > 80
       or nullif(btrim(p_commander_name), '') is null or char_length(btrim(p_commander_name)) > 80
       or p_commander_age is null or p_commander_age < 16 or p_commander_age > 100
       or p_province_id is null or p_cell_x is null or p_cell_y is null
       or p_cell_x < 0 or p_cell_y < 0 or p_cell_x > 10000 or p_cell_y > 10000 then
        raise exception 'Invalid army or commander data' using errcode = '22023';
    end if;

    select * into v_force from public.military_forces where id = p_force_id for update;
    if not found or v_force.owner is distinct from v_profile.owner or v_force.force_kind <> 'garrison' or v_force.status <> 'active' then
        raise exception 'The garrison is unavailable to this state' using errcode = '42501';
    end if;
    if not exists (
        select 1 from jsonb_array_elements(v_force.unit_groups) as item(group_row)
        where coalesce((group_row->>'count')::integer, 0) > 0
    ) then
        raise exception 'The garrison has no active troops' using errcode = '23514';
    end if;

    if v_force.marker_id is not null then
        select * into v_marker from public.markers where id = v_force.marker_id for update;
        if not found or v_marker.owner is distinct from v_profile.owner or v_marker.type = 'ruins' or v_marker.province_id is null then
            raise exception 'The settlement containing the garrison is unavailable' using errcode = '23514';
        end if;
        v_source_province_id := v_marker.province_id;
    else
        v_source_province_id := v_force.province_id;
    end if;
    if p_province_id <> v_source_province_id then
        raise exception 'The field army must remain in the garrison province' using errcode = '22023';
    end if;
    select * into v_province from public."Provinces" where id = p_province_id for update;
    if not found or v_province.owner is distinct from v_profile.owner or v_province.occupied_by is not null then
        raise exception 'The province is not under uncontested control' using errcode = '23514';
    end if;
    select * into v_calendar from public.game_calendar where singleton = true;
    if not found then raise exception 'Game calendar is unavailable' using errcode = '22023'; end if;
    if v_force.is_militia and v_force.service_end_turn is not null and v_force.service_end_turn <= v_calendar.turn then
        raise exception 'The militia service period has ended' using errcode = '23514';
    end if;
    select * into v_terrain from public.military_terrain_cells where cell_x = p_cell_x and cell_y = p_cell_y;
    if found and v_terrain.terrain = 'water' and not v_terrain.bridge then
        raise exception 'A field army cannot be placed on a water cell without a bridge' using errcode = '22023';
    end if;
    if found and v_terrain.province_id is not null and v_terrain.province_id <> p_province_id then
        raise exception 'The selected cell belongs to another province' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(p_cell_x::text || ':' || p_cell_y::text, 0));
    if exists (
        select 1 from public.military_forces other_force
        where other_force.force_kind = 'land_army' and other_force.status = 'active'
          and other_force.cell_x = p_cell_x and other_force.cell_y = p_cell_y
    ) then
        raise exception 'This military grid cell is already occupied' using errcode = '23505';
    end if;

    update public.military_forces
       set name = btrim(p_name), force_kind = 'land_army', province_id = p_province_id, marker_id = null,
           cell_x = p_cell_x, cell_y = p_cell_y, commander_name = btrim(p_commander_name),
           commander_age = p_commander_age, commander_skills = '{}'::jsonb,
           commander_experience = 0, last_battle_experience_turn = null,
           action_points = 100, updated_at = now()
     where id = v_force.id
     returning * into v_force;
    return to_jsonb(v_force);
end;
$function$;

revoke all on function public.mobilize_military_garrison(uuid,text,text,integer,bigint,integer,integer) from public, anon;
grant execute on function public.mobilize_military_garrison(uuid,text,text,integer,bigint,integer,integer) to authenticated;
