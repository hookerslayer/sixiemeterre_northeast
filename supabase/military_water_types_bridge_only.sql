-- Admin-managed water classifications persist across map synchronization.
alter table public.military_grid_cells
    add column if not exists source_base_terrain text,
    add column if not exists source_river_edges integer,
    add column if not exists water_types_override integer;
update public.military_grid_cells set river_edges=river_edges | coalesce(ford_edges,0), ford_edges=0, source_base_terrain=coalesce(source_base_terrain,base_terrain), source_river_edges=coalesce(source_river_edges,river_edges | coalesce(ford_edges,0));
alter table public.military_grid_cells
    add constraint military_grid_cells_source_terrain_check check (source_base_terrain is null or source_base_terrain in ('plain','water')),
    add constraint military_grid_cells_source_river_check check (source_river_edges is null or source_river_edges between 0 and 255),
    add constraint military_grid_cells_water_override_check check (water_types_override is null or water_types_override in (0,1,2,4));

create or replace function public.set_military_water_type(p_cell_x integer,p_cell_y integer,p_water_types integer)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare caller_role text; cell public.military_grid_cells%rowtype;
begin
    select role into caller_role from public.profiles where id=(select auth.uid());
    if caller_role is distinct from 'admin' then raise exception 'Only an administrator can edit water cells' using errcode='42501'; end if;
    if p_cell_x is null or p_cell_y is null or p_cell_x not between 0 and 10000 or p_cell_y not between 0 and 10000
       or p_water_types is null or p_water_types not in (0,1,2,4) then raise exception 'Choose river, lake, sea, or no water' using errcode='22023'; end if;
    select * into cell from public.military_grid_cells where cell_x=p_cell_x and cell_y=p_cell_y for update;
    if not found then raise exception 'Water cell is outside the military grid' using errcode='22023'; end if;
    update public.military_grid_cells set
        water_types_override=p_water_types,
        water_types=p_water_types,
        base_terrain=case when p_water_types=0 then 'plain' else 'water' end,
        river_edges=0,
        ford_edges=0, updated_at=now()
    where cell_x=p_cell_x and cell_y=p_cell_y returning * into cell;
    return to_jsonb(cell);
end;
$function$;
revoke all on function public.set_military_water_type(integer,integer,integer) from public,anon;
grant execute on function public.set_military_water_type(integer,integer,integer) to authenticated;

create or replace function public.sync_military_grid_cells(p_cells jsonb)
returns integer language plpgsql security definer set search_path = '' as $function$
declare v_count integer;
begin
    if not exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='admin') then
        raise exception 'Only an administrator can synchronize military grid geometry' using errcode='42501'; end if;
    if jsonb_typeof(p_cells) is distinct from 'array' or jsonb_array_length(p_cells) not between 1 and 50000 then
        raise exception 'Provide between 1 and 50,000 grid cells' using errcode='22023'; end if;
    if exists(select 1 from jsonb_to_recordset(p_cells) as c(cell_x integer,cell_y integer,province_id bigint,base_terrain text,river_edges integer,ford_edges integer,water_coverage numeric,water_types integer)
       where c.cell_x is null or c.cell_y is null or c.cell_x not between 0 and 10000 or c.cell_y not between 0 and 10000
         or c.base_terrain not in ('plain','water') or coalesce(c.river_edges,0) not between 0 and 255
         or coalesce(c.water_coverage,0) not between 0 and 1 or coalesce(c.water_types,0) not between 0 and 7) then
        raise exception 'Grid geometry contains invalid coordinates or values' using errcode='22023'; end if;
    insert into public.military_grid_cells(cell_x,cell_y,province_id,base_terrain,river_edges,ford_edges,water_coverage,water_types,source_base_terrain,source_river_edges,updated_at)
    select c.cell_x,c.cell_y,c.province_id,
           case when g.water_types_override is not null then case when g.water_types_override=0 then 'plain' else 'water' end else c.base_terrain end,
           case when g.water_types_override is not null then 0 else coalesce(c.river_edges,0) end,
           0,coalesce(c.water_coverage,0),coalesce(g.water_types_override,c.water_types),c.base_terrain,coalesce(c.river_edges,0),now()
      from jsonb_to_recordset(p_cells) as c(cell_x integer,cell_y integer,province_id bigint,base_terrain text,river_edges integer,ford_edges integer,water_coverage numeric,water_types integer)
      left join public.military_grid_cells g on g.cell_x=c.cell_x and g.cell_y=c.cell_y
    on conflict(cell_x,cell_y) do update set province_id=excluded.province_id,
        base_terrain=excluded.base_terrain,river_edges=excluded.river_edges,ford_edges=0,
        water_coverage=excluded.water_coverage,water_types=excluded.water_types,
        source_base_terrain=excluded.source_base_terrain,source_river_edges=excluded.source_river_edges,updated_at=now();
    get diagnostics v_count=row_count;
    delete from public.military_grid_cells g where not exists(select 1 from jsonb_to_recordset(p_cells) as c(cell_x integer,cell_y integer) where c.cell_x=g.cell_x and c.cell_y=g.cell_y);
    return v_count;
end;
$function$;
revoke all on function public.sync_military_grid_cells(jsonb) from public,anon;
grant execute on function public.sync_military_grid_cells(jsonb) to authenticated;

-- Water currents and ford annotations are retired; movement is uniform and rivers require bridges.
drop function if exists public.set_military_water_current(integer,integer,smallint,smallint);
drop table if exists public.military_water_currents;
drop function if exists public.set_military_river_crossing(integer,integer,text);
create or replace function public.move_military_force(p_force_id uuid, p_path jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_profile record;
    v_force public.military_forces%rowtype;
    v_step record;
    v_prev record;
    v_next record;
    v_length integer;
    v_index integer := 0;
    v_dx integer;
    v_dy integer;
    v_diagonal boolean;
    v_terrain text;
    v_bridge boolean;
    v_river_crossing boolean;
    v_base_cost integer;
    v_step_cost integer;
    v_total_cost integer := 0;
    v_blocked_corners integer;
    v_troops numeric := 0;
    v_equipment numeric := 0;
    v_weighted numeric := 0;
    v_mobility numeric := 1;
    v_size_factor numeric := 1;
    v_province_id bigint;
begin
    select profile.id, profile.role, profile.owner
      into v_profile
      from public.profiles as profile
     where profile.id = (select auth.uid());
    if not found or v_profile.role not in ('player', 'admin') then
        raise exception 'Player authentication required' using errcode = '42501';
    end if;
    select force.* into v_force
      from public.military_forces as force
     where force.id = p_force_id and force.force_kind = 'land_army' and force.status = 'active'
     for update;
    if not found then raise exception 'Active land army not found' using errcode = '22023'; end if;
    if v_profile.role <> 'admin' and v_force.owner is distinct from v_profile.owner then
        raise exception 'You do not command this army' using errcode = '42501';
    end if;
    if exists (
        select 1 from public.military_battle_armies as participant
        join public.military_battles as battle on battle.id = participant.battle_id
        where participant.persistent_force_id = p_force_id and battle.status = 'pending'
    ) then raise exception 'An army in an unresolved battle cannot move' using errcode = '55000'; end if;
    if jsonb_typeof(p_path) is distinct from 'array' then
        raise exception 'Movement path must be an array of cells' using errcode = '22023';
    end if;
    v_length := jsonb_array_length(p_path);
    if v_length < 2 or v_length > 101 then raise exception 'Choose a route of 1 to 100 steps' using errcode = '22023'; end if;
    if (p_path->0->>'x')::integer <> v_force.cell_x or (p_path->0->>'y')::integer <> v_force.cell_y then
        raise exception 'Route must start at the army current position' using errcode = '22023';
    end if;
    select grid.cell_x as x, grid.cell_y as y, grid.cell_x, grid.cell_y, coalesce(override.province_id, grid.province_id) as province_id,
           case when grid.water_types<>0 then 'water' else coalesce(override.terrain, grid.base_terrain) end as terrain,
           (coalesce(override.bridge, false) or exists(select 1 from public.military_structures structure
              where structure.cell_x=grid.cell_x and structure.cell_y=grid.cell_y and structure.structure_type='bridge'
                and structure.status='active' and structure.available_from_turn<=(select turn from public.game_calendar where singleton=true))) as bridge,
           grid.river_edges
      into v_prev
      from public.military_grid_cells as grid
      left join public.military_terrain_cells as override on override.cell_x = grid.cell_x and override.cell_y = grid.cell_y
     where grid.cell_x = v_force.cell_x and grid.cell_y = v_force.cell_y;
    if not found then raise exception 'Army position is missing from military grid geometry' using errcode = '55000'; end if;

    select coalesce(sum(greatest(0, (group_row->>'count')::numeric)), 0),
           coalesce(sum(greatest(0, (group_row->>'count')::numeric) *
               case group_row->>'type'
                   when 'Конные копейщики' then 1.25
                   when 'Лёгкая конница' then 1.4
                   when 'Конные лучники' then 1.4
                   else 1
               end), 0)
      into v_troops, v_weighted
      from jsonb_array_elements(v_force.unit_groups) as group_row;
    select coalesce(sum(greatest(0, (item.value)::numeric) *
               case item.key
                   when 'Малая пушка / пищаль' then 10
                   when 'Требюше' then 20
                   when 'Бомбарда' then 20
                   when 'Таран' then 30
                   when 'Осадная башня' then 30
                   else 0
               end), 0)
      into v_equipment
      from jsonb_each_text(v_force.siege_equipment) as item;
    if v_troops + v_equipment <= 0 then raise exception 'Army has no units to move' using errcode = '22023'; end if;
    v_weighted := v_weighted + v_equipment * 0.5;
    v_size_factor := greatest(0.7, 1 - 0.05 * floor(greatest(0, v_troops + v_equipment - 500) / 500));
    v_mobility := greatest(0.5, least(1.4, (v_weighted / (v_troops + v_equipment)) * v_size_factor));

    for v_step in
        select (entry.value->>'x')::integer as x, (entry.value->>'y')::integer as y
          from jsonb_array_elements(p_path) with ordinality as entry(value, ordinal)
         where entry.ordinal > 1
         order by entry.ordinal
    loop
        v_index := v_index + 1;
        v_dx := v_step.x - v_prev.x;
        v_dy := v_step.y - v_prev.y;
        if greatest(abs(v_dx), abs(v_dy)) <> 1 then raise exception 'Each route step must lead to a neighboring cell' using errcode = '22023'; end if;
        v_diagonal := v_dx <> 0 and v_dy <> 0;
        select grid.cell_x as x, grid.cell_y as y, grid.cell_x, grid.cell_y, coalesce(override.province_id, grid.province_id) as province_id,
               case when grid.water_types<>0 then 'water' else coalesce(override.terrain, grid.base_terrain) end as terrain,
               (coalesce(override.bridge, false) or exists(select 1 from public.military_structures structure
                  where structure.cell_x=grid.cell_x and structure.cell_y=grid.cell_y and structure.structure_type='bridge'
                    and structure.status='active' and structure.available_from_turn<=(select turn from public.game_calendar where singleton=true))) as bridge,
               grid.river_edges
          into v_next
          from public.military_grid_cells as grid
          left join public.military_terrain_cells as override on override.cell_x = grid.cell_x and override.cell_y = grid.cell_y
         where grid.cell_x = v_step.x and grid.cell_y = v_step.y;
        if not found or (v_next.province_id is null and not v_next.bridge) then raise exception 'Route leaves the mapped land area' using errcode = '22023'; end if;
        if v_next.terrain = 'water' and not v_next.bridge then raise exception 'A land army cannot enter a water cell without a bridge' using errcode = '22023'; end if;
        if exists(select 1 from public.military_structures structure where structure.cell_x=v_next.cell_x and structure.cell_y=v_next.cell_y
            and structure.structure_type='palisade' and structure.status='active'
            and structure.available_from_turn<=(select turn from public.game_calendar where singleton=true)) then
            raise exception 'A palisade blocks this route' using errcode='55000';
        end if;
        if exists (select 1 from public.military_forces as other
                    where other.force_kind = 'land_army' and other.status = 'active'
                      and other.cell_x = v_step.x and other.cell_y = v_step.y and other.id <> p_force_id
                      and (v_index = v_length - 1 or other.owner <> v_force.owner)) then
            raise exception 'Route cell is occupied by another army' using errcode = '55000';
        end if;
        -- Diagonal corner cutting is forbidden when both orthogonal cells are impassable.
        if v_diagonal then
            select count(*) into v_blocked_corners
              from (values (v_prev.x + v_dx, v_prev.y), (v_prev.x, v_prev.y + v_dy)) as corner(x,y)
              left join public.military_grid_cells as cg on cg.cell_x = corner.x and cg.cell_y = corner.y
              left join public.military_terrain_cells as ct on ct.cell_x = corner.x and ct.cell_y = corner.y
             where cg.cell_x is null or coalesce(ct.terrain, cg.base_terrain) = 'water' and not coalesce(ct.bridge, false)
               and not exists(select 1 from public.military_structures structure where structure.cell_x=corner.x and structure.cell_y=corner.y
                   and structure.structure_type='bridge' and structure.status='active'
                   and structure.available_from_turn<=(select turn from public.game_calendar where singleton=true));
            if v_blocked_corners = 2 then raise exception 'Diagonal movement cannot cut between two impassable cells' using errcode = '22023'; end if;
        end if;
        select case when grid.water_types<>0 then 'water' else coalesce(override.terrain, grid.base_terrain) end,
               (coalesce(override.bridge, false) or exists(select 1 from public.military_structures structure
                  where structure.cell_x=grid.cell_x and structure.cell_y=grid.cell_y and structure.structure_type='bridge'
                    and structure.status='active' and structure.available_from_turn<=(select turn from public.game_calendar where singleton=true)))
          into v_terrain, v_bridge
          from public.military_grid_cells as grid
          left join public.military_terrain_cells as override on override.cell_x = grid.cell_x and override.cell_y = grid.cell_y
         where grid.cell_x = v_prev.x and grid.cell_y = v_prev.y;
        v_river_crossing := ((coalesce(v_prev.river_edges, 0) & case when v_dx = 1 and v_dy = 0 then 1 when v_dx = 1 and v_dy = 1 then 2 when v_dx = 0 and v_dy = 1 then 4 when v_dx = -1 and v_dy = 1 then 8 when v_dx = -1 and v_dy = 0 then 16 when v_dx = -1 and v_dy = -1 then 32 when v_dx = 0 and v_dy = -1 then 64 else 128 end) <> 0)
            or ((coalesce(v_next.river_edges, 0) & case when v_dx = 1 and v_dy = 0 then 16 when v_dx = 1 and v_dy = 1 then 32 when v_dx = 0 and v_dy = 1 then 64 when v_dx = -1 and v_dy = 1 then 128 when v_dx = -1 and v_dy = 0 then 1 when v_dx = -1 and v_dy = -1 then 2 when v_dx = 0 and v_dy = -1 then 4 else 8 end) <> 0);
        if v_river_crossing and not (v_bridge or v_next.bridge) then
            raise exception 'A land army cannot cross a river without a bridge' using errcode = '22023';
        end if;
        v_base_cost := case v_next.terrain when 'hill' then case when v_diagonal then 21 else 15 end
                            when 'forest' then case when v_diagonal then 21 else 15 end
                            when 'marsh' then case when v_diagonal then 28 else 20 end
                            when 'water' then case when v_diagonal then 14 else 10 end
                            else case when v_diagonal then 14 else 10 end end;
        v_step_cost := greatest(1, ceil(v_base_cost / v_mobility)::integer);
        v_total_cost := v_total_cost + v_step_cost;
        if v_total_cost > v_force.action_points then raise exception 'The route costs % AP but the army has % AP', v_total_cost, v_force.action_points using errcode = '22023'; end if;
        v_prev := v_next;
    end loop;
    v_province_id := coalesce(v_prev.province_id, v_force.province_id);
    update public.military_forces
       set cell_x = v_prev.cell_x, cell_y = v_prev.cell_y, province_id = v_province_id,
           action_points = action_points - v_total_cost, updated_at = now()
     where id = p_force_id
     returning * into v_force;
    return jsonb_build_object('force', to_jsonb(v_force), 'cost', v_total_cost, 'remaining', v_force.action_points, 'mobility', round(v_mobility, 3));
end;
$function$;
create or replace function public.move_military_fleet(p_fleet_id uuid,p_path jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
    profile public.profiles%rowtype;
    fleet public.military_fleets%rowtype;
    calendar public.game_calendar%rowtype;
    route_step record;
    previous_cell record;
    current_cell record;
    side_cell_a record;
    side_cell_b record;
    ship jsonb;
    max_crew integer;
    crew integer;
    type_name text;
    penalty boolean:=false;
    dx integer;
    dy integer;
    step_cost integer;
    total_cost integer:=0;
    step_count integer;
    idx integer:=0;
    slowest_maneuver integer:=5;
    maneuver integer;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role not in ('player','admin') then raise exception 'Authentication required' using errcode='42501'; end if;
    select * into fleet from public.military_fleets where id=p_fleet_id and status='active' for update;
    if not found or (profile.role<>'admin' and fleet.owner is distinct from profile.owner) then raise exception 'You do not command this fleet' using errcode='42501'; end if;
    if fleet.location_kind<>'water' or fleet.cell_x is null then raise exception 'Fleet is not at sea' using errcode='55000'; end if;
    if exists(select 1 from public.military_battle_armies a join public.military_battles b on b.id=a.battle_id where a.persistent_fleet_id=fleet.id and b.status='pending') then raise exception 'A fleet in an unresolved battle cannot move' using errcode='55000'; end if;
    if jsonb_typeof(p_path) is distinct from 'array' then raise exception 'Fleet path must be an array of cells' using errcode='22023'; end if;
    step_count:=jsonb_array_length(p_path);
    if step_count<2 or step_count>101 then raise exception 'Choose a route of 1 to 100 steps' using errcode='22023'; end if;
    if (p_path->0->>'x')::integer<>fleet.cell_x or (p_path->0->>'y')::integer<>fleet.cell_y then raise exception 'Route must start at the fleet current position' using errcode='22023'; end if;
    select * into calendar from public.game_calendar where singleton=true;
    if jsonb_array_length(fleet.ships)=0 then raise exception 'A fleet without ships cannot move' using errcode='55000'; end if;
    for ship in select value from jsonb_array_elements(fleet.ships) loop
        type_name:=ship->>'type';
        max_crew:=case type_name when 'Ушкуй' then 6 when 'Насад' then 12 when 'Ладья' then 20 when 'Когг' then 20 when 'Хольк' then 30 else 0 end;
        maneuver:=case type_name when 'Ушкуй' then 5 when 'Насад' then 2 when 'Ладья' then 3 when 'Когг' then 2 when 'Хольк' then 1 else 0 end;
        crew:=coalesce((ship->>'crew')::integer,0);
        if max_crew=0 or crew*100<max_crew*75 then raise exception 'Every ship needs at least 75%% of its regular crew to sail' using errcode='55000'; end if;
        if crew<max_crew then penalty:=true; end if;
        slowest_maneuver:=least(slowest_maneuver,maneuver);
    end loop;
    select cell_x,cell_y,water_types into previous_cell from public.military_grid_cells where cell_x=fleet.cell_x and cell_y=fleet.cell_y;
    if not found then raise exception 'Fleet current cell is missing from military grid geometry' using errcode='55000'; end if;
    for route_step in select (entry.value->>'x')::integer as x,(entry.value->>'y')::integer as y from jsonb_array_elements(p_path) with ordinality entry(value,ordinality) where entry.ordinality>1 order by entry.ordinality loop
        idx:=idx+1; dx:=route_step.x-previous_cell.cell_x; dy:=route_step.y-previous_cell.cell_y;
        if greatest(abs(dx),abs(dy))<>1 then raise exception 'Each fleet route step must lead to a neighboring cell' using errcode='22023'; end if;
        select cell_x,cell_y,water_types into current_cell from public.military_grid_cells where cell_x=route_step.x and cell_y=route_step.y;
        if not found or current_cell.water_types=0 then raise exception 'Fleet route leaves navigable water' using errcode='22023'; end if;
        for ship in select value from jsonb_array_elements(fleet.ships) loop
            if not public.military_ship_compatible(ship->>'type',current_cell.water_types,calendar.season) then raise exception 'The route crosses water unavailable to one of the fleet ships' using errcode='22023'; end if;
        end loop;
        if dx<>0 and dy<>0 then
            select water_types into side_cell_a from public.military_grid_cells where cell_x=previous_cell.cell_x+dx and cell_y=previous_cell.cell_y;
            select water_types into side_cell_b from public.military_grid_cells where cell_x=previous_cell.cell_x and cell_y=previous_cell.cell_y+dy;
            if not exists(select 1 from public.military_grid_cells g where g.cell_x=previous_cell.cell_x+dx and g.cell_y=previous_cell.cell_y and g.water_types<>0)
               and not exists(select 1 from public.military_grid_cells g where g.cell_x=previous_cell.cell_x and g.cell_y=previous_cell.cell_y+dy and g.water_types<>0) then
                raise exception 'A diagonal route cannot cut between two land cells' using errcode='22023';
            end if;
        end if;
        if exists(select 1 from public.military_fleets other where other.status='active' and other.location_kind='water' and other.cell_x=route_step.x and other.cell_y=route_step.y and other.id<>fleet.id and (idx=step_count-1 or other.owner<>fleet.owner)) then raise exception 'Route cell is occupied by another fleet' using errcode='55000'; end if;
        step_cost:=greatest(1,(case when dx<>0 and dy<>0 then 14 else 10 end)+(3-slowest_maneuver)+case when penalty then 1 else 0 end);
        total_cost:=total_cost+step_cost;
        if total_cost>fleet.action_points then raise exception 'The route costs % AP but the fleet has % AP',total_cost,fleet.action_points using errcode='22023'; end if;
        previous_cell:=current_cell;
    end loop;
    update public.military_fleets set cell_x=previous_cell.cell_x,cell_y=previous_cell.cell_y,action_points=action_points-total_cost,updated_at=now() where id=fleet.id returning * into fleet;
    return jsonb_build_object('fleet',to_jsonb(fleet),'cost',total_cost,'remaining',fleet.action_points);
end;
$function$;




-- Army-to-army troop transfers use the same bridge-only river rule.
create or replace function public.transfer_military_troops(
    p_source_force_id uuid,
    p_target_force_id uuid,
    p_units jsonb,
    p_path jsonb,
    p_merge boolean default false
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
    profile public.profiles%rowtype;
    source_force public.military_forces%rowtype;
    target_force public.military_forces%rowtype;
    route_row record;
    previous_cell record;
    next_cell record;
    group_row jsonb;
    moved_type text;
    moved_count integer;
    source_next jsonb:='[]'::jsonb;
    target_next jsonb;
    all_units jsonb:='[]'::jsonb;
    total_troops numeric:=0;
    weighted_troops numeric:=0;
    mobility numeric:=1;
    size_factor numeric:=1;
    movement_cost integer:=0;
    spent integer:=0;
    dx integer; dy integer; diagonal boolean; terrain_name text; base_cost integer;
    river_crossing boolean; major_river_crossing boolean; bridge boolean;
    blocked_corners integer;
    equipment_total jsonb;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role not in ('player','admin') then raise exception 'Player authentication required' using errcode='42501'; end if;
    select * into source_force from public.military_forces where id=p_source_force_id and force_kind='land_army' and status='active' for update;
    if not found then raise exception 'Source army is not active' using errcode='22023'; end if;
    select * into target_force from public.military_forces where id=p_target_force_id and force_kind='land_army' and status='active' for update;
    if not found or p_source_force_id=p_target_force_id then raise exception 'Choose a different active target army' using errcode='22023'; end if;
    if profile.role<>'admin' and (source_force.owner is distinct from profile.owner or target_force.owner is distinct from profile.owner) then
        raise exception 'You may reorganize only your own armies' using errcode='42501';
    end if;
    if source_force.owner is distinct from target_force.owner then raise exception 'Armies must belong to the same state' using errcode='22023'; end if;
    if source_force.is_militia is distinct from target_force.is_militia or source_force.is_mercenary or target_force.is_mercenary
       or source_force.is_retinue is distinct from target_force.is_retinue then
        raise exception 'Militia and mercenary contracts cannot be transferred between commands' using errcode='22023';
    end if;
    if exists(select 1 from public.military_battle_armies army join public.military_battles battle on battle.id=army.battle_id
        where army.persistent_force_id in (source_force.id,target_force.id) and battle.status='pending') then
        raise exception 'Armies in an unresolved battle cannot be reorganized' using errcode='55000';
    end if;
    if jsonb_typeof(p_path) is distinct from 'array' or jsonb_array_length(p_path)<1 or jsonb_array_length(p_path)>101 then
        raise exception 'A route from the source army to the target army is required' using errcode='22023';
    end if;
    if (p_path->0->>'x')::integer<>source_force.cell_x or (p_path->0->>'y')::integer<>source_force.cell_y
       or (p_path->(jsonb_array_length(p_path)-1)->>'x')::integer<>target_force.cell_x
       or (p_path->(jsonb_array_length(p_path)-1)->>'y')::integer<>target_force.cell_y then
        raise exception 'The route must begin and end at the selected armies' using errcode='22023';
    end if;
    if p_merge then
        if jsonb_typeof(source_force.unit_groups)<>'array' then raise exception 'Source composition is invalid'; end if;
        p_units:=source_force.unit_groups;
    elsif jsonb_typeof(p_units) is distinct from 'array' or jsonb_array_length(p_units)=0 then
        raise exception 'Select at least one troop group to transfer' using errcode='22023';
    end if;

    for group_row in select value from jsonb_array_elements(p_units) loop
        moved_type:=btrim(group_row->>'type');
        if moved_type is null or moved_type='' or jsonb_typeof(group_row->'count') is distinct from 'number'
           or (group_row->>'count')::numeric<=0 or (group_row->>'count')::numeric<>trunc((group_row->>'count')::numeric) then
            raise exception 'Troop transfer amounts must be positive whole numbers' using errcode='22023';
        end if;
        moved_count:=(group_row->>'count')::integer;
        if not exists(select 1 from jsonb_array_elements(source_force.unit_groups) group_item
            where group_item->>'type'=moved_type and (group_item->>'count')::integer>=moved_count) then
            raise exception 'The source army does not have enough %',moved_type using errcode='22023';
        end if;
        total_troops:=total_troops+moved_count;
        weighted_troops:=weighted_troops+moved_count*case moved_type
            when 'Конные копейщики' then 1.25 when 'Лёгкая конница' then 1.4 when 'Конные лучники' then 1.4 else 1 end;
    end loop;
    equipment_total:='{}'::jsonb;
    if p_merge then
        select coalesce(jsonb_object_agg(gear_keys.key,to_jsonb(coalesce((target_force.siege_equipment->>gear_keys.key)::numeric,0)
                    +coalesce((source_force.siege_equipment->>gear_keys.key)::numeric,0))),'{}'::jsonb)
          into equipment_total
          from (select key from jsonb_each(coalesce(target_force.siege_equipment,'{}'::jsonb))
                union select key from jsonb_each(coalesce(source_force.siege_equipment,'{}'::jsonb))) gear_keys;
    end if;
    if total_troops<=0 then raise exception 'There are no selected troops'; end if;
    size_factor:=greatest(0.7,1-0.05*floor(greatest(0,total_troops-500)/500));
    mobility:=greatest(0.5,least(1.4,(weighted_troops/total_troops)*size_factor));

    select grid.cell_x,grid.cell_y,grid.river_edges,case when grid.water_types<>0 then 'water' else coalesce(terrain.terrain,grid.base_terrain) end as terrain,
           (coalesce(terrain.bridge,false) or exists(select 1 from public.military_structures structure
                where structure.cell_x=grid.cell_x and structure.cell_y=grid.cell_y and structure.structure_type='bridge'
                  and structure.status='active' and structure.available_from_turn<=(select turn from public.game_calendar where singleton=true))) as bridge
      into previous_cell from public.military_grid_cells grid
      left join public.military_terrain_cells terrain on terrain.cell_x=grid.cell_x and terrain.cell_y=grid.cell_y
     where grid.cell_x=source_force.cell_x and grid.cell_y=source_force.cell_y;
    for route_row in select value,ordinality from jsonb_array_elements(p_path) with ordinality where ordinality>1 order by ordinality loop
        dx:=(route_row.value->>'x')::integer-previous_cell.cell_x;
        dy:=(route_row.value->>'y')::integer-previous_cell.cell_y;
        if greatest(abs(dx),abs(dy))<>1 then raise exception 'Each route step must use a neighboring cell'; end if;
        diagonal:=dx<>0 and dy<>0;
        diagonal:=dx<>0 and dy<>0;
        select grid.cell_x,grid.cell_y,grid.province_id,grid.river_edges,case when grid.water_types<>0 then 'water' else coalesce(terrain.terrain,grid.base_terrain) end as terrain,
               (coalesce(terrain.bridge,false) or exists(select 1 from public.military_structures structure
                    where structure.cell_x=grid.cell_x and structure.cell_y=grid.cell_y and structure.structure_type='bridge'
                      and structure.status='active' and structure.available_from_turn<=(select turn from public.game_calendar where singleton=true))) as bridge
          into next_cell from public.military_grid_cells grid
          left join public.military_terrain_cells terrain on terrain.cell_x=grid.cell_x and terrain.cell_y=grid.cell_y
         where grid.cell_x=(route_row.value->>'x')::integer and grid.cell_y=(route_row.value->>'y')::integer;
        if not found or next_cell.province_id is null and not next_cell.bridge then raise exception 'Route leaves the land map'; end if;
        if next_cell.terrain='water' and not next_cell.bridge then raise exception 'The transfer route crosses impassable water'; end if;
        if diagonal then
            select count(*) into blocked_corners
              from (values (previous_cell.cell_x+dx,previous_cell.cell_y), (previous_cell.cell_x,previous_cell.cell_y+dy)) corner(x,y)
              left join public.military_grid_cells cg on cg.cell_x=corner.x and cg.cell_y=corner.y
              left join public.military_terrain_cells ct on ct.cell_x=corner.x and ct.cell_y=corner.y
             where cg.cell_x is null or (cg.water_types<>0 or coalesce(ct.terrain,cg.base_terrain)='water') and not coalesce(ct.bridge,false);
            if blocked_corners=2 then raise exception 'Diagonal transfer cannot cut between two impassable cells'; end if;
        end if;
        if exists(select 1 from public.military_structures structure where structure.cell_x=next_cell.cell_x and structure.cell_y=next_cell.cell_y
              and structure.structure_type='palisade' and structure.status='active'
              and structure.available_from_turn<=(select turn from public.game_calendar where singleton=true)) then
            raise exception 'A palisade blocks the transfer route';
        end if;
        if exists(select 1 from public.military_forces other where other.force_kind='land_army' and other.status='active'
              and other.id not in (source_force.id,target_force.id) and other.cell_x=next_cell.cell_x and other.cell_y=next_cell.cell_y
              and other.owner<>source_force.owner) then
            raise exception 'The transfer route is blocked by another army';
        end if;
        bridge:=previous_cell.bridge or next_cell.bridge;
        major_river_crossing:=(((coalesce(previous_cell.river_edges,0)&case when dx=1 and dy=0 then 1 when dx=1 and dy=1 then 2 when dx=0 and dy=1 then 4 when dx=-1 and dy=1 then 8 when dx=-1 and dy=0 then 16 when dx=-1 and dy=-1 then 32 when dx=0 and dy=-1 then 64 else 128 end)<>0)
          or ((coalesce(next_cell.river_edges,0)&case when dx=1 and dy=0 then 16 when dx=1 and dy=1 then 32 when dx=0 and dy=1 then 64 when dx=-1 and dy=1 then 128 when dx=-1 and dy=0 then 1 when dx=-1 and dy=-1 then 2 when dx=0 and dy=-1 then 4 else 8 end)<>0));
        if major_river_crossing and not bridge then raise exception 'A land army cannot cross a river without a bridge'; end if;
        river_crossing:=false;
        base_cost:=case next_cell.terrain when 'hill' then case when diagonal then 21 else 15 end
            when 'forest' then case when diagonal then 21 else 15 end when 'marsh' then case when diagonal then 28 else 20 end
            else case when diagonal then 14 else 10 end end;
        movement_cost:=movement_cost+greatest(1,ceil(base_cost/mobility)::integer);
        previous_cell:=next_cell;
    end loop;
    if movement_cost>source_force.action_points then raise exception 'The selected troops cannot reach the target with their remaining action points'; end if;
    spent:=ceil(movement_cost/2)::integer+case when p_merge then 5 else 0 end;
    if spent>source_force.action_points then raise exception 'The reorganization order needs % action points',spent; end if;

    for group_row in select value from jsonb_array_elements(source_force.unit_groups) loop
        moved_count:=coalesce((select sum((item->>'count')::integer) from jsonb_array_elements(p_units) item where item->>'type'=group_row->>'type'),0)::integer;
        if (group_row->>'count')::integer>moved_count then
            source_next:=source_next||jsonb_build_array(jsonb_build_object('type',group_row->>'type','count',(group_row->>'count')::integer-moved_count));
        end if;
    end loop;
    -- Reaggregate both existing and transferred groups without duplicate unit names.
    select coalesce(jsonb_agg(jsonb_build_object('type',kind,'count',sum_count) order by kind),'[]'::jsonb) into target_next
      from (select item->>'type' as kind,sum((item->>'count')::integer) as sum_count
              from (select value as item from jsonb_array_elements(target_force.unit_groups)
                    union all select value as item from jsonb_array_elements(p_units)) all_groups
             group by item->>'type') grouped;
    update public.military_forces set unit_groups=source_next,action_points=action_points-spent,
        siege_equipment=case when p_merge then '{}'::jsonb else siege_equipment end,
        status=case when jsonb_array_length(source_next)=0 then 'disbanded' else status end,updated_at=now()
     where id=source_force.id;
    update public.military_forces set unit_groups=target_next,
        siege_equipment=case when p_merge then equipment_total else siege_equipment end,
        morale=case when p_merge then round((morale*greatest(1,(select coalesce(sum((item->>'count')::numeric),0) from jsonb_array_elements(target_force.unit_groups) item))
            + source_force.morale*total_troops) / greatest(1,(select coalesce(sum((item->>'count')::numeric),0) from jsonb_array_elements(target_force.unit_groups) item)+total_troops),2) else morale end,
        updated_at=now() where id=target_force.id;
    return jsonb_build_object('source_force_id',source_force.id,'target_force_id',target_force.id,'transferred',p_units,
        'merged',p_merge,'movement_cost',movement_cost,'spent_action_points',spent);
end;
$function$;



