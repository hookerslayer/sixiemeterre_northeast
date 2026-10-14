-- Generate deterministic regional conditions once per game turn and attach
-- the conditions to battle records. Weather never participates in visibility.
create table if not exists public.regional_weather (
    region text not null,
    turn integer not null,
    season text not null,
    year integer not null,
    land_condition text not null check (land_condition in ('clear','rain','mud','snow','frost','heat')),
    sea_condition text not null check (sea_condition in ('calm','rough','storm')),
    generated_at timestamptz not null default now(),
    primary key (region, turn)
);

alter table public.regional_weather enable row level security;
drop policy if exists "Regional weather is readable" on public.regional_weather;
create policy "Regional weather is readable" on public.regional_weather for select to anon, authenticated using (true);
revoke all on public.regional_weather from anon, authenticated;
grant select on public.regional_weather to anon, authenticated;

create or replace function public.ensure_regional_weather(p_region text, p_turn integer, p_season text, p_year integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    weather_row public.regional_weather%rowtype;
    land_roll integer;
    sea_roll integer;
    normalized_season text := lower(coalesce(p_season, ''));
    land text;
    sea text;
begin
    select * into weather_row from public.regional_weather where region=p_region and turn=p_turn;
    if found then return to_jsonb(weather_row); end if;

    land_roll := mod(abs(hashtextextended('land|'||p_region||'|'||p_year||'|'||p_turn||'|'||p_season, 0)), 100)::integer;
    sea_roll := mod(abs(hashtextextended('sea|'||p_region||'|'||p_year||'|'||p_turn||'|'||p_season, 0)), 100)::integer;
    land := case
        when normalized_season in ('зима','winter') then case when land_roll < 25 then 'clear' when land_roll < 65 then 'snow' when land_roll < 90 then 'frost' else 'snow' end
        when normalized_season in ('весна','spring') then case when land_roll < 20 then 'clear' when land_roll < 55 then 'rain' when land_roll < 85 then 'mud' else 'frost' end
        when normalized_season in ('лето','summer') then case when land_roll < 55 then 'clear' when land_roll < 80 then 'rain' when land_roll < 90 then 'heat' else 'rain' end
        else case when land_roll < 20 then 'clear' when land_roll < 55 then 'rain' when land_roll < 85 then 'mud' else 'frost' end
    end;
    sea := case
        when normalized_season in ('зима','winter') then case when sea_roll < 20 then 'calm' when sea_roll < 60 then 'rough' else 'storm' end
        when normalized_season in ('весна','spring') then case when sea_roll < 35 then 'calm' when sea_roll < 80 then 'rough' else 'storm' end
        when normalized_season in ('лето','summer') then case when sea_roll < 55 then 'calm' when sea_roll < 90 then 'rough' else 'storm' end
        else case when sea_roll < 30 then 'calm' when sea_roll < 75 then 'rough' else 'storm' end
    end;

    insert into public.regional_weather(region,turn,season,year,land_condition,sea_condition)
    values(p_region,p_turn,p_season,p_year,land,sea)
    on conflict(region,turn) do nothing;
    select * into weather_row from public.regional_weather where region=p_region and turn=p_turn;
    return to_jsonb(weather_row);
end;
$function$;
revoke all on function public.ensure_regional_weather(text,integer,text,integer) from public, anon, authenticated;

create or replace function public.generate_weather_for_new_turn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    region_name text;
begin
    if new.turn <= old.turn then return new; end if;
    for region_name in select distinct region from public."Provinces" where region is not null loop
        perform public.ensure_regional_weather(region_name,new.turn,new.season,new.year);
    end loop;
    perform public.ensure_regional_weather('Общая зона',new.turn,new.season,new.year);
    return new;
end;
$function$;
revoke all on function public.generate_weather_for_new_turn() from public, anon, authenticated;
drop trigger if exists generate_regional_weather_after_turn on public.game_calendar;
create trigger generate_regional_weather_after_turn after update of turn on public.game_calendar
for each row execute function public.generate_weather_for_new_turn();

create or replace function public.attach_weather_to_military_battle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    calendar public.game_calendar%rowtype;
    region_name text;
    province_key bigint;
    weather_data jsonb;
begin
    select * into calendar from public.game_calendar where singleton=true;
    province_key := nullif(new.location->>'province_id','')::bigint;
    if province_key is null and nullif(new.location->>'cell_x','') is not null and nullif(new.location->>'cell_y','') is not null then
        select grid.province_id into province_key from public.military_grid_cells grid
         where grid.cell_x=(new.location->>'cell_x')::integer and grid.cell_y=(new.location->>'cell_y')::integer;
    end if;
    select province.region into region_name from public."Provinces" province where province.id=province_key;
    region_name := coalesce(nullif(new.location->>'region',''),region_name,'Общая зона');
    weather_data := public.ensure_regional_weather(region_name,calendar.turn,calendar.season,calendar.year);
    new.location := coalesce(new.location,'{}'::jsonb) || jsonb_build_object('region',region_name,'weather',weather_data);
    return new;
end;
$function$;
revoke all on function public.attach_weather_to_military_battle() from public, anon, authenticated;
drop trigger if exists attach_weather_to_military_battle on public.military_battles;
create trigger attach_weather_to_military_battle before insert on public.military_battles
for each row execute function public.attach_weather_to_military_battle();

-- Ensure the current game turn has a weather record for every region.
do $block$
declare
    calendar public.game_calendar%rowtype;
    region_name text;
begin
    select * into calendar from public.game_calendar where singleton=true;
    for region_name in select distinct region from public."Provinces" where region is not null loop
        perform public.ensure_regional_weather(region_name,calendar.turn,calendar.season,calendar.year);
    end loop;
    perform public.ensure_regional_weather('Общая зона',calendar.turn,calendar.season,calendar.year);
end;
$block$;

-- Weather has no effect on observers, sight radii, or fog of war.
create or replace function public.get_visible_military_forces()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_profile public.profiles%rowtype;
    v_result jsonb;
begin
    select * into v_profile from public.profiles where id=(select auth.uid());
    if not found or v_profile.role not in ('player','admin') then raise exception 'Player authentication required' using errcode='42501'; end if;
    if v_profile.role='admin' then
        select jsonb_build_object('forces',coalesce((select jsonb_agg(to_jsonb(force)) from public.military_forces force where force.status='active'),'[]'::jsonb),
          'visible_cells',coalesce((select jsonb_agg(jsonb_build_object('x',cell.cell_x,'y',cell.cell_y)) from public.military_grid_cells cell),'[]'::jsonb)) into v_result;
        return v_result;
    end if;
    if nullif(v_profile.owner,'') is null then raise exception 'State player has no state' using errcode='42501'; end if;
    with controlled as (
        select grid.cell_x,grid.cell_y from public.military_grid_cells grid join public."Provinces" province on province.id=grid.province_id
         where province.owner=v_profile.owner or province.occupied_by=v_profile.owner
    ), territory_open as (
        select cell_x,cell_y from controlled union
        select neighbor.cell_x,neighbor.cell_y from public.military_grid_cells neighbor join controlled own
          on abs(neighbor.cell_x-own.cell_x)<=1 and abs(neighbor.cell_y-own.cell_y)<=1
    ), observers as (
        select force.cell_x,force.cell_y,coalesce(terrain.terrain,grid.base_terrain) as terrain,
               case when coalesce(terrain.terrain,grid.base_terrain)='hill' then 3 else 2 end as radius
          from public.military_forces force join public.military_grid_cells grid on grid.cell_x=force.cell_x and grid.cell_y=force.cell_y
          left join public.military_terrain_cells terrain on terrain.cell_x=force.cell_x and terrain.cell_y=force.cell_y
         where force.owner=v_profile.owner and force.force_kind='land_army' and force.status='active'
        union all
        select structure.cell_x,structure.cell_y,coalesce(terrain.terrain,grid.base_terrain),2
          from public.military_structures structure join public.military_grid_cells grid on grid.cell_x=structure.cell_x and grid.cell_y=structure.cell_y
          left join public.military_terrain_cells terrain on terrain.cell_x=structure.cell_x and terrain.cell_y=structure.cell_y
         where structure.owner=v_profile.owner and structure.structure_type='watchtower' and structure.status='active'
           and structure.available_from_turn<=(select turn from public.game_calendar where singleton=true)
        union all
        select structure.cell_x,structure.cell_y,coalesce(terrain.terrain,grid.base_terrain),1
          from public.military_structures structure join public.military_grid_cells grid on grid.cell_x=structure.cell_x and grid.cell_y=structure.cell_y
          left join public.military_terrain_cells terrain on terrain.cell_x=structure.cell_x and terrain.cell_y=structure.cell_y
         where structure.owner=v_profile.owner and structure.structure_type='camp' and structure.status='active'
           and structure.available_from_turn<=(select turn from public.game_calendar where singleton=true)
    ), army_vision as (
        select distinct target.cell_x,target.cell_y from public.military_grid_cells target join observers observer
          on greatest(abs(target.cell_x-observer.cell_x),abs(target.cell_y-observer.cell_y))<=observer.radius
         where (coalesce((select terrain.terrain from public.military_terrain_cells terrain where terrain.cell_x=target.cell_x and terrain.cell_y=target.cell_y),target.base_terrain)<>'forest'
           or exists(select 1 from observers adjacent_observer where greatest(abs(target.cell_x-adjacent_observer.cell_x),abs(target.cell_y-adjacent_observer.cell_y))<=1 and adjacent_observer.terrain in ('forest','hill')))
           and not exists(
             select 1 from generate_series(1,greatest(abs(target.cell_x-observer.cell_x),abs(target.cell_y-observer.cell_y))-1) step_no
             cross join lateral (select round(observer.cell_x+(target.cell_x-observer.cell_x)*step_no::numeric/greatest(abs(target.cell_x-observer.cell_x),abs(target.cell_y-observer.cell_y)))::integer x,
               round(observer.cell_y+(target.cell_y-observer.cell_y)*step_no::numeric/greatest(abs(target.cell_x-observer.cell_x),abs(target.cell_y-observer.cell_y)))::integer y) point
             left join public.military_grid_cells blocker_grid on blocker_grid.cell_x=point.x and blocker_grid.cell_y=point.y
             left join public.military_terrain_cells blocker on blocker.cell_x=point.x and blocker.cell_y=point.y
             where coalesce(blocker.terrain,blocker_grid.base_terrain) in ('forest','hill')
           )
    ), visible as (select cell_x,cell_y from territory_open union select cell_x,cell_y from army_vision)
    select jsonb_build_object('forces',coalesce((select jsonb_agg(to_jsonb(force)) from public.military_forces force where force.status='active'
      and (force.owner=v_profile.owner or exists(select 1 from visible where visible.cell_x=force.cell_x and visible.cell_y=force.cell_y))),'[]'::jsonb),
      'visible_cells',coalesce((select jsonb_agg(jsonb_build_object('x',cell_x,'y',cell_y)) from visible),'[]'::jsonb)) into v_result;
    return v_result;
end;
$function$;
revoke all on function public.get_visible_military_forces() from public,anon;
grant execute on function public.get_visible_military_forces() to authenticated;

-- Preserve the province's local culture and religion when land or sea
-- colonization succeeds; only ownership and settlement values change.
create or replace function public.resolve_military_colonization_on_turn()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
    mission public.military_colonization_missions%rowtype;
    province public."Provinces"%rowtype;
    roll integer;
    paid boolean;
    cost_factor numeric;
    payment numeric;
begin
    if new.turn<=old.turn then return new; end if;
    for mission in select * from public.military_colonization_missions where status='active' and started_turn<new.turn for update loop
        paid:=true;
        if new.turn<=mission.started_turn+3 then
            select greatest(0,1+coalesce(sum(value),0)/100) into cost_factor from public.state_modifiers
             where owner=mission.owner and effect_key='colonization_cost_pct' and scope_type='state' and status='active'
               and starts_turn<=new.turn and (ends_turn is null or ends_turn>=new.turn);
            payment:=round(500*cost_factor,2);
            update public.state_mechanics sm set settings=sm.settings||jsonb_build_object('economy',coalesce(sm.settings->'economy','{}'::jsonb)||
              jsonb_build_object('treasury',greatest(0,coalesce((sm.settings#>>'{economy,treasury}')::numeric,0)-payment))),updated_at=now()
             where sm.owner=mission.owner and coalesce((sm.settings#>>'{economy,treasury}')::numeric,0)>=payment;
            paid:=found;
        end if;
        if not paid then
            update public.markers set yards=yards+25 where id=mission.source_marker_id;
            update public.military_colonization_missions set status='failed',result=jsonb_build_object('reason','payment_failed','returned_settlers',100,'lost_settlers',100),resolved_at=now() where id=mission.id;
            update public.military_fleets set colonization_mission_id=null,updated_at=now() where id=mission.fleet_id and colonization_mission_id=mission.id;
            continue;
        end if;
        if new.turn<mission.started_turn+4 then continue; end if;
        select * into province from public."Provinces" where id=mission.target_province_id for update;
        if not found or province.owner is not null then
            update public.markers set yards=yards+25 where id=mission.source_marker_id;
            update public.military_colonization_missions set status='failed',result=jsonb_build_object('reason','target_no_longer_neutral','returned_settlers',100,'lost_settlers',100),resolved_at=now() where id=mission.id;
            update public.military_fleets set colonization_mission_id=null,updated_at=now() where id=mission.fleet_id and colonization_mission_id=mission.id;
            continue;
        end if;
        roll:=mod(abs(hashtextextended(mission.id::text||':'||mission.started_turn::text,0)::numeric),100)::integer+1;
        if roll<=mission.success_chance then
            update public."Provinces" set owner=mission.owner,yards=45,development=20,occupied_by=null,target_marker_id=null,stored_resource_qty=0 where id=province.id;
            update public.military_colonization_missions set status='succeeded',result=jsonb_build_object('roll',roll,'success_chance',mission.success_chance,'settlers_lost',20,'settlers_established',180),resolved_at=now() where id=mission.id;
        else
            update public.markers set yards=yards+25 where id=mission.source_marker_id;
            update public.military_colonization_missions set status='failed',result=jsonb_build_object('roll',roll,'success_chance',mission.success_chance,'settlers_lost',100,'settlers_returned',100),resolved_at=now() where id=mission.id;
        end if;
        update public.military_fleets set colonization_mission_id=null,updated_at=now() where id=mission.fleet_id and colonization_mission_id=mission.id;
    end loop;
    return new;
end;
$function$;
revoke all on function public.resolve_military_colonization_on_turn() from public,anon,authenticated;
drop trigger if exists resolve_military_colonization_on_turn on public.game_calendar;
create trigger resolve_military_colonization_on_turn after update of turn on public.game_calendar
for each row execute function public.resolve_military_colonization_on_turn();
