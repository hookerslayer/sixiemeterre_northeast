-- Carry complete field armies on ships and restore them when they disembark.
alter table public.military_forces drop constraint if exists military_forces_status_check;
alter table public.military_forces
    add constraint military_forces_status_check check (status in ('active','embarked','disbanded'));
alter table public.military_forces add column if not exists embarked_turn integer;

create or replace function public.military_passenger_load(p_passengers jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $function$
    select coalesce((select sum(coalesce((unit.value->>'count')::numeric,0)
        * case when unit.value->>'type' in ('Конные копейщики','Лёгкая конница','Конные лучники') then 2 else 1 end)
        from jsonb_array_elements(coalesce(p_passengers,'[]'::jsonb)) passenger(value)
        cross join lateral jsonb_array_elements(coalesce(passenger.value->'unit_groups','[]'::jsonb)) unit(value)),0)
      + coalesce((select sum(
            coalesce((passenger.value->'siege_equipment'->>'Малая пушка / пищаль')::numeric,0)*10
          + coalesce((passenger.value->'siege_equipment'->>'Требюше')::numeric,0)*20
          + coalesce((passenger.value->'siege_equipment'->>'Бомбарда')::numeric,0)*20
          + coalesce((passenger.value->'siege_equipment'->>'Таран')::numeric,0)*30
          + coalesce((passenger.value->'siege_equipment'->>'Осадная башня')::numeric,0)*30)
        from jsonb_array_elements(coalesce(p_passengers,'[]'::jsonb)) passenger(value)),0)
$function$;
revoke all on function public.military_passenger_load(jsonb) from public,anon,authenticated;

create or replace function public.guard_military_ship_capacity()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
    ship jsonb;
    capacity integer;
    used numeric;
begin
    for ship in select value from jsonb_array_elements(coalesce(new.ships,'[]'::jsonb)) as item(value) loop
        capacity:=case ship->>'type' when 'Ушкуй' then 18 when 'Насад' then 36 when 'Ладья' then 25 when 'Когг' then 50 when 'Хольк' then 70 else 0 end;
        used:=coalesce((select sum(value::numeric) from jsonb_each_text(coalesce(ship->'cargo','{}'::jsonb))),0)
            + greatest(coalesce((ship->>'boarding_troops')::numeric,0),coalesce((ship->>'boardingMen')::numeric,0))
            + public.military_passenger_load(ship->'passengers');
        if capacity=0 or used>capacity then
            raise exception 'A ship cannot carry more than its cargo capacity (% places)',capacity using errcode='23514';
        end if;
    end loop;
    return new;
end;
$function$;
revoke all on function public.guard_military_ship_capacity() from public,anon,authenticated;
drop trigger if exists military_ship_capacity_guard on public.military_fleets;
create trigger military_ship_capacity_guard before insert or update of ships on public.military_fleets
    for each row execute function public.guard_military_ship_capacity();

-- The economy resolver now includes force updates for armies aboard ships.
create or replace function public.apply_reported_military_maintenance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    caller_role text;
    force_update jsonb;
begin
    select profile.role into caller_role from public.profiles profile where profile.id = (select auth.uid());
    if caller_role is distinct from 'admin' then
        raise exception 'Only an administrator can persist military turn results' using errcode='42501';
    end if;
    for force_update in select value from jsonb_array_elements(coalesce(new.report#>'{military,force_updates}','[]'::jsonb)) loop
        if jsonb_typeof(force_update) is distinct from 'object'
           or jsonb_typeof(force_update->'unit_groups') is distinct from 'array'
           or jsonb_typeof(force_update->'morale') is distinct from 'number'
           or (force_update->>'morale')::numeric not between 0 and 100
           or jsonb_typeof(force_update->'underfunded_turns') is distinct from 'number'
           or (force_update->>'underfunded_turns')::integer < 0
           or jsonb_typeof(force_update->'deserter_carry') is distinct from 'number'
           or (force_update->>'deserter_carry')::numeric not between 0 and 0.9999999
           or jsonb_typeof(force_update->'maintenance_coverage') is distinct from 'number'
           or (force_update->>'maintenance_coverage')::numeric not between 0 and 1
           or jsonb_typeof(force_update->'noncombat_carry') is distinct from 'number'
           or (force_update->>'noncombat_carry')::numeric not between 0 and 0.9999999
           or force_update->>'status' not in ('active','embarked','disbanded') then
            raise exception 'Invalid seasonal military maintenance row' using errcode='22023';
        end if;
        update public.military_forces force
           set unit_groups=force_update->'unit_groups', morale=(force_update->>'morale')::numeric,
               underfunded_turns=(force_update->>'underfunded_turns')::integer,
               deserter_carry=(force_update->>'deserter_carry')::numeric,
               maintenance_coverage=(force_update->>'maintenance_coverage')::numeric,
               noncombat_carry=(force_update->>'noncombat_carry')::numeric,
               last_maintenance_turn=new.turn, status=force_update->>'status', updated_at=now()
         where force.id=(force_update->>'id')::uuid and force.owner=new.owner and force.status in ('active','embarked');
        if not found then raise exception 'A military force changed while the turn was being processed' using errcode='40001'; end if;
    end loop;
    return new;
end;
$function$;
revoke all on function public.apply_reported_military_maintenance() from public,anon,authenticated;

create or replace function public.embark_military_force(
    p_force_id uuid,
    p_fleet_id uuid,
    p_ship_index integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    profile public.profiles%rowtype;
    force public.military_forces%rowtype;
    fleet public.military_fleets%rowtype;
    port_marker public.markers%rowtype;
    ship jsonb;
    passenger jsonb;
    ship_capacity integer;
    ship_used numeric;
    passenger_places numeric;
    adjacent_x integer;
    adjacent_y integer;
    pending_battle boolean;
    current_turn integer;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role not in ('player','admin') then
        raise exception 'Authentication required' using errcode='42501';
    end if;
    select turn into current_turn from public.game_calendar where singleton=true;
    select * into force from public.military_forces where id=p_force_id for update;
    if not found or force.force_kind<>'land_army' or force.status<>'active'
       or (profile.role<>'admin' and force.owner is distinct from profile.owner) then
        raise exception 'Choose an active field army under your command' using errcode='42501';
    end if;
    select * into fleet from public.military_fleets where id=p_fleet_id and status='active' for update;
    if not found or (profile.role<>'admin' and fleet.owner is distinct from profile.owner) then
        raise exception 'Choose a fleet under your command' using errcode='42501';
    end if;
    if fleet.location_kind not in ('water','port') then
        raise exception 'The fleet must be at sea or in port' using errcode='55000';
    end if;
    select exists(
        select 1 from public.military_battle_armies army
        join public.military_battles battle on battle.id=army.battle_id
        where battle.status='pending'
          and (army.persistent_force_id=force.id or army.persistent_fleet_id=fleet.id)
    ) into pending_battle;
    if pending_battle then raise exception 'A force or fleet in an unresolved battle cannot be loaded' using errcode='55000'; end if;
    if force.action_points<1 then raise exception 'The army needs 1 AP to embark' using errcode='55000'; end if;
    if p_ship_index<1 or p_ship_index>jsonb_array_length(fleet.ships) then
        raise exception 'Choose a ship in this fleet' using errcode='22023';
    end if;
    if fleet.location_kind='water' then
        adjacent_x:=fleet.cell_x;
        adjacent_y:=fleet.cell_y;
    else
        select * into port_marker from public.markers where id=fleet.port_marker_id and owner=fleet.owner;
        if not found then raise exception 'The fleet is not in a friendly port' using errcode='42501'; end if;
        adjacent_x:=floor(port_marker.coord_1::numeric/24)::integer;
        adjacent_y:=floor(port_marker.coord_2::numeric/24)::integer;
    end if;
    if greatest(abs(force.cell_x-adjacent_x),abs(force.cell_y-adjacent_y))>1 then
        raise exception 'The army must be next to the fleet or its port' using errcode='22023';
    end if;

    ship:=fleet.ships->(p_ship_index-1);
    ship_capacity:=case ship->>'type'
        when 'Ушкуй' then 18 when 'Насад' then 36 when 'Ладья' then 25
        when 'Когг' then 50 when 'Хольк' then 70 else 0 end;
    if ship_capacity=0 then raise exception 'Unknown ship type' using errcode='22023'; end if;
    passenger_places:=coalesce((
        select sum(coalesce((unit.value->>'count')::numeric,0)
            * case when unit.value->>'type' in ('Конные копейщики','Лёгкая конница','Конные лучники') then 2 else 1 end)
        from jsonb_array_elements(force.unit_groups) unit(value)
    ),0)
    + coalesce((force.siege_equipment->>'Малая пушка / пищаль')::numeric,0)*10
    + coalesce((force.siege_equipment->>'Требюше')::numeric,0)*20
    + coalesce((force.siege_equipment->>'Бомбарда')::numeric,0)*20
    + coalesce((force.siege_equipment->>'Таран')::numeric,0)*30
    + coalesce((force.siege_equipment->>'Осадная башня')::numeric,0)*30;
    if passenger_places<=0 then raise exception 'The army has no passengers or siege equipment' using errcode='23514'; end if;
    if exists(select 1 from jsonb_array_elements(coalesce(ship->'passengers','[]'::jsonb)) p
        where p.value->>'force_id'=force.id::text) then
        raise exception 'This army is already recorded aboard the ship' using errcode='23514';
    end if;
    ship_used:=coalesce((select sum(value::numeric) from jsonb_each_text(coalesce(ship->'cargo','{}'::jsonb))),0)
        + greatest(coalesce((ship->>'boarding_troops')::numeric,0),coalesce((ship->>'boardingMen')::numeric,0))
        + public.military_passenger_load(ship->'passengers');
    if ship_used+passenger_places>ship_capacity then
        raise exception 'The army needs % cargo places, only % are free',passenger_places,ship_capacity-ship_used using errcode='23514';
    end if;
    passenger:=jsonb_build_object(
        'force_id',force.id,'owner',force.owner,'name',force.name,
        'unit_groups',force.unit_groups,'siege_equipment',force.siege_equipment,
        'morale',force.morale,'commander_name',force.commander_name,'commander_age',force.commander_age,
        'commander_skills',force.commander_skills,'commander_experience',force.commander_experience
    );
    ship:=jsonb_set(ship,'{passengers}',coalesce(ship->'passengers','[]'::jsonb)||jsonb_build_array(passenger),true);
    update public.military_fleets
       set ships=jsonb_set(ships,array[(p_ship_index-1)::text],ship,true),updated_at=now()
     where id=fleet.id;
    update public.military_forces set status='embarked',action_points=action_points-1,embarked_turn=current_turn,updated_at=now() where id=force.id;
    return jsonb_build_object('force_id',force.id,'fleet_id',fleet.id,'ship_index',p_ship_index,'cargo_places',passenger_places);
end;
$function$;
revoke all on function public.embark_military_force(uuid,uuid,integer) from public,anon;
grant execute on function public.embark_military_force(uuid,uuid,integer) to authenticated;

create or replace function public.disembark_military_force(
    p_force_id uuid,
    p_fleet_id uuid,
    p_cell_x integer,
    p_cell_y integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    profile public.profiles%rowtype;
    force public.military_forces%rowtype;
    fleet public.military_fleets%rowtype;
    ship jsonb;
    passenger_rows jsonb;
    target public.military_grid_cells%rowtype;
    terrain text;
    port_marker public.markers%rowtype;
    adjacent_x integer;
    adjacent_y integer;
    ship_index integer;
    pending_battle boolean;
    found_passenger boolean := false;
    current_turn integer;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role not in ('player','admin') then
        raise exception 'Authentication required' using errcode='42501';
    end if;
    select turn into current_turn from public.game_calendar where singleton=true;
    select * into force from public.military_forces where id=p_force_id and force_kind='land_army' and status='embarked' for update;
    if not found or (profile.role<>'admin' and force.owner is distinct from profile.owner) then
        raise exception 'Embarked army not found under your command' using errcode='42501';
    end if;
    select * into fleet from public.military_fleets where id=p_fleet_id and status='active' for update;
    if not found or (profile.role<>'admin' and fleet.owner is distinct from profile.owner) then
        raise exception 'Choose a fleet under your command' using errcode='42501';
    end if;
    select exists(
        select 1 from public.military_battle_armies army
        join public.military_battles battle on battle.id=army.battle_id
        where battle.status='pending'
          and (army.persistent_force_id=force.id or army.persistent_fleet_id=fleet.id)
    ) into pending_battle;
    if pending_battle then raise exception 'A force or fleet in an unresolved battle cannot disembark' using errcode='55000'; end if;
    if fleet.location_kind='water' then
        adjacent_x:=fleet.cell_x;
        adjacent_y:=fleet.cell_y;
    elsif fleet.location_kind='port' then
        select * into port_marker from public.markers where id=fleet.port_marker_id and owner=fleet.owner;
        if not found then raise exception 'The fleet is not in a friendly port' using errcode='42501'; end if;
        adjacent_x:=floor(port_marker.coord_1::numeric/24)::integer;
        adjacent_y:=floor(port_marker.coord_2::numeric/24)::integer;
    else
        raise exception 'The fleet is not at sea or in port' using errcode='55000';
    end if;
    if p_cell_x is null or p_cell_y is null or greatest(abs(p_cell_x-adjacent_x),abs(p_cell_y-adjacent_y))>1 then
        raise exception 'Choose a neighboring land cell' using errcode='22023';
    end if;
    select * into target from public.military_grid_cells where cell_x=p_cell_x and cell_y=p_cell_y;
    if not found or target.province_id is null or target.base_terrain='water' then
        raise exception 'Choose a mapped land cell' using errcode='22023';
    end if;
    select coalesce(terrain_cell.terrain,target.base_terrain) into terrain
      from (select 1) seed
      left join public.military_terrain_cells terrain_cell on terrain_cell.cell_x=p_cell_x and terrain_cell.cell_y=p_cell_y;
    if terrain='water' then raise exception 'Choose a land cell, not a water cell' using errcode='22023'; end if;
    if exists(select 1 from public.military_forces other where other.status='active' and other.force_kind='land_army' and other.cell_x=p_cell_x and other.cell_y=p_cell_y) then
        raise exception 'The landing cell is occupied by an army' using errcode='55000';
    end if;
    for ship_index in 0..jsonb_array_length(fleet.ships)-1 loop
        ship:=fleet.ships->ship_index;
        if exists(select 1 from jsonb_array_elements(coalesce(ship->'passengers','[]'::jsonb)) p where p.value->>'force_id'=force.id::text) then
            ship:=jsonb_set(ship,'{passengers}',coalesce((select jsonb_agg(p.value) from jsonb_array_elements(coalesce(ship->'passengers','[]'::jsonb)) p where p.value->>'force_id'<>force.id::text),'[]'::jsonb),true);
            update public.military_fleets set ships=jsonb_set(ships,array[ship_index::text],ship,true),updated_at=now() where id=fleet.id;
            found_passenger:=true;
            exit;
        end if;
    end loop;
    if not found_passenger then raise exception 'This fleet is not carrying the selected army' using errcode='22023'; end if;
    update public.military_forces
       set status='active',province_id=target.province_id,marker_id=null,cell_x=p_cell_x,cell_y=p_cell_y,
           action_points=case when force.embarked_turn is not null and force.embarked_turn<current_turn then 99 else greatest(0,action_points-1) end,
           embarked_turn=null,updated_at=now()
     where id=force.id;
    return jsonb_build_object('force_id',force.id,'fleet_id',fleet.id,'cell_x',p_cell_x,'cell_y',p_cell_y,'action_points_spent',1);
end;
$function$;
revoke all on function public.disembark_military_force(uuid,uuid,integer,integer) from public,anon;
grant execute on function public.disembark_military_force(uuid,uuid,integer,integer) to authenticated;

-- Keep forces represented in the battle engine as passengers and synchronize
-- their surviving unit groups after an administrator confirms a naval battle.
create or replace function public.apply_confirmed_naval_passengers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    passenger_id uuid;
    survivors jsonb;
    groups jsonb;
    siege jsonb;
    owner_name text;
begin
    if not exists(select 1 from public.military_battles battle where battle.id=new.battle_id and battle.battle_type='naval') then
        return new;
    end if;
    for passenger_id,owner_name in
        select distinct (passenger.value->>'force_id')::uuid, passenger.value->>'owner'
          from public.military_battle_armies army
          cross join lateral jsonb_array_elements(coalesce(army.unit_data->'ships','[]'::jsonb)) ship(value)
          cross join lateral jsonb_array_elements(coalesce(ship.value->'passengers','[]'::jsonb)) passenger(value)
         where army.battle_id=new.battle_id and nullif(passenger.value->>'force_id','') is not null
    loop
        select coalesce(jsonb_agg(jsonb_build_object('type',unit_type,'count',unit_count) order by unit_type),'[]'::jsonb)
          into groups
          from (
            select passenger_group.value->>'type' as unit_type,
                   sum(coalesce((passenger_group.value->>'count')::integer,0))::integer as unit_count
              from jsonb_each(coalesce(new.report->'fleets','{}'::jsonb)) side(key,value)
              cross join lateral jsonb_array_elements(coalesce(side.value->'ships','[]'::jsonb)) ship(value)
              cross join lateral jsonb_array_elements(coalesce(ship.value->'passengers','[]'::jsonb)) passenger(value)
              cross join lateral jsonb_array_elements(coalesce(passenger.value->'unit_groups','[]'::jsonb)) passenger_group(value)
             where passenger.value->>'force_id'=passenger_id::text
               and coalesce(passenger.value->>'captured_by','')=''
               and coalesce((ship.value->>'sunk')::boolean,false)=false
               and coalesce((ship.value->>'captured')::boolean,false)=false
               and coalesce((ship.value->>'crew')::integer,0)>0
             group by passenger_group.value->>'type'
          ) remaining_units;
        select coalesce(jsonb_object_agg(equipment.name,equipment.amount),'{}'::jsonb)
          into siege
          from (
            select entry.key as name, sum((entry.value)::numeric)::integer as amount
              from jsonb_each(coalesce(new.report->'fleets','{}'::jsonb)) side(key,value)
              cross join lateral jsonb_array_elements(coalesce(side.value->'ships','[]'::jsonb)) ship(value)
              cross join lateral jsonb_array_elements(coalesce(ship.value->'passengers','[]'::jsonb)) passenger(value)
              cross join lateral jsonb_each(coalesce(passenger.value->'siege_equipment','{}'::jsonb)) entry(key,value)
             where passenger.value->>'force_id'=passenger_id::text
               and coalesce(passenger.value->>'captured_by','')=''
               and coalesce((ship.value->>'sunk')::boolean,false)=false
               and coalesce((ship.value->>'captured')::boolean,false)=false
               and coalesce((ship.value->>'crew')::integer,0)>0
             group by entry.key
          ) equipment;
        if jsonb_array_length(groups)=0 then
            update public.military_forces set status='disbanded',unit_groups='[]'::jsonb,updated_at=now()
             where id=passenger_id and owner=owner_name and status='embarked';
        else
            update public.military_forces set status='embarked',unit_groups=groups,siege_equipment=siege,updated_at=now()
             where id=passenger_id and owner=owner_name and status='embarked';
        end if;
    end loop;
    return new;
end;
$function$;
revoke all on function public.apply_confirmed_naval_passengers() from public,anon,authenticated;
drop trigger if exists military_naval_passengers_sync on public.military_battle_admin_results;
create trigger military_naval_passengers_sync
    after insert or update on public.military_battle_admin_results
    for each row execute function public.apply_confirmed_naval_passengers();
