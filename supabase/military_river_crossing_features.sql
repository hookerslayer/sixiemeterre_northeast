-- Store river fords independently from major river crossings; land terrain stays visible.
alter table public.military_forces add column if not exists is_retinue boolean not null default false;
alter table public.military_grid_cells
    add column if not exists ford_edges integer not null default 0 check (ford_edges between 0 and 255);

create or replace function public.sync_military_grid_cells(p_cells jsonb)
returns integer language plpgsql security definer set search_path = '' as $function$
declare v_count integer;
begin
    if not exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='admin') then
        raise exception 'Only an administrator can synchronize military grid geometry' using errcode='42501';
    end if;
    if jsonb_typeof(p_cells) is distinct from 'array' or jsonb_array_length(p_cells) not between 1 and 50000 then
        raise exception 'Provide between 1 and 50,000 grid cells' using errcode='22023';
    end if;
    if exists (
        select 1 from jsonb_to_recordset(p_cells) as cell(cell_x integer,cell_y integer,province_id bigint,base_terrain text,river_edges integer,ford_edges integer,water_coverage numeric,water_types integer)
        where cell.cell_x is null or cell.cell_y is null or cell.cell_x not between 0 and 10000 or cell.cell_y not between 0 and 10000
           or cell.base_terrain not in ('plain','water') or coalesce(cell.river_edges,0) not between 0 and 255
           or coalesce(cell.ford_edges,0) not between 0 and 255
           or coalesce(cell.water_coverage,0) not between 0 and 1 or coalesce(cell.water_types,0) not between 0 and 7
    ) then raise exception 'Grid geometry contains invalid coordinates or values' using errcode='22023'; end if;
    insert into public.military_grid_cells(cell_x,cell_y,province_id,base_terrain,river_edges,ford_edges,water_coverage,water_types,updated_at)
    select cell.cell_x,cell.cell_y,cell.province_id,cell.base_terrain,coalesce(cell.river_edges,0),coalesce(cell.ford_edges,0),coalesce(cell.water_coverage,0),coalesce(cell.water_types,0),now()
      from jsonb_to_recordset(p_cells) as cell(cell_x integer,cell_y integer,province_id bigint,base_terrain text,river_edges integer,ford_edges integer,water_coverage numeric,water_types integer)
    on conflict (cell_x,cell_y) do update set province_id=excluded.province_id,base_terrain=excluded.base_terrain,
        river_edges=excluded.river_edges,ford_edges=excluded.ford_edges,water_coverage=excluded.water_coverage,
        water_types=excluded.water_types,updated_at=excluded.updated_at;
    get diagnostics v_count=row_count;
    delete from public.military_grid_cells grid
     where not exists (select 1 from jsonb_to_recordset(p_cells) as cell(cell_x integer,cell_y integer)
                        where cell.cell_x=grid.cell_x and cell.cell_y=grid.cell_y);
    return v_count;
end;
$function$;
revoke all on function public.sync_military_grid_cells(jsonb) from public,anon;
grant execute on function public.sync_military_grid_cells(jsonb) to authenticated;

-- Server-validated seasonal movement with constructed bridges and palisades.
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
    v_major_river_crossing boolean;
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
    select grid.cell_x, grid.cell_y, coalesce(override.province_id, grid.province_id) as province_id,
           coalesce(override.terrain, grid.base_terrain) as terrain,
           (coalesce(override.bridge, false) or exists(select 1 from public.military_structures structure
              where structure.cell_x=grid.cell_x and structure.cell_y=grid.cell_y and structure.structure_type='bridge'
                and structure.status='active' and structure.available_from_turn<=(select turn from public.game_calendar where singleton=true))) as bridge,
           grid.river_edges, grid.ford_edges
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
        select grid.cell_x, grid.cell_y, coalesce(override.province_id, grid.province_id) as province_id,
               coalesce(override.terrain, grid.base_terrain) as terrain,
               (coalesce(override.bridge, false) or exists(select 1 from public.military_structures structure
                  where structure.cell_x=grid.cell_x and structure.cell_y=grid.cell_y and structure.structure_type='bridge'
                    and structure.status='active' and structure.available_from_turn<=(select turn from public.game_calendar where singleton=true))) as bridge,
               grid.river_edges, grid.ford_edges
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
        select coalesce(override.terrain, grid.base_terrain),
               (coalesce(override.bridge, false) or exists(select 1 from public.military_structures structure
                  where structure.cell_x=grid.cell_x and structure.cell_y=grid.cell_y and structure.structure_type='bridge'
                    and structure.status='active' and structure.available_from_turn<=(select turn from public.game_calendar where singleton=true)))
          into v_terrain, v_bridge
          from public.military_grid_cells as grid
          left join public.military_terrain_cells as override on override.cell_x = grid.cell_x and override.cell_y = grid.cell_y
         where grid.cell_x = v_prev.x and grid.cell_y = v_prev.y;
        v_major_river_crossing := ((coalesce(v_prev.river_edges, 0) & case when v_dx = 1 and v_dy = 0 then 1 when v_dx = 1 and v_dy = 1 then 2 when v_dx = 0 and v_dy = 1 then 4 when v_dx = -1 and v_dy = 1 then 8 when v_dx = -1 and v_dy = 0 then 16 when v_dx = -1 and v_dy = -1 then 32 when v_dx = 0 and v_dy = -1 then 64 else 128 end) <> 0)
            or ((coalesce(v_next.river_edges, 0) & case when v_dx = 1 and v_dy = 0 then 16 when v_dx = 1 and v_dy = 1 then 32 when v_dx = 0 and v_dy = 1 then 64 when v_dx = -1 and v_dy = 1 then 128 when v_dx = -1 and v_dy = 0 then 1 when v_dx = -1 and v_dy = -1 then 2 when v_dx = 0 and v_dy = -1 then 4 else 8 end) <> 0);
        v_river_crossing := ((coalesce(v_prev.ford_edges, 0) & case when v_dx = 1 and v_dy = 0 then 1 when v_dx = 1 and v_dy = 1 then 2 when v_dx = 0 and v_dy = 1 then 4 when v_dx = -1 and v_dy = 1 then 8 when v_dx = -1 and v_dy = 0 then 16 when v_dx = -1 and v_dy = -1 then 32 when v_dx = 0 and v_dy = -1 then 64 else 128 end) <> 0)
            or ((coalesce(v_next.ford_edges, 0) & case when v_dx = 1 and v_dy = 0 then 16 when v_dx = 1 and v_dy = 1 then 32 when v_dx = 0 and v_dy = 1 then 64 when v_dx = -1 and v_dy = 1 then 128 when v_dx = -1 and v_dy = 0 then 1 when v_dx = -1 and v_dy = -1 then 2 when v_dx = 0 and v_dy = -1 then 4 else 8 end) <> 0);
        if v_major_river_crossing and not v_bridge and not v_next.bridge then
            raise exception 'A major river can only be crossed at a bridge' using errcode='22023';
        end if;
        if v_bridge or v_next.bridge then v_river_crossing := false; end if;
        v_base_cost := case v_next.terrain when 'hill' then case when v_diagonal then 21 else 15 end
                            when 'forest' then case when v_diagonal then 21 else 15 end
                            when 'marsh' then case when v_diagonal then 28 else 20 end
                            when 'water' then case when v_diagonal then 14 else 10 end
                            else case when v_diagonal then 14 else 10 end end;
        v_step_cost := greatest(1, ceil(v_base_cost / v_mobility)::integer) + case when v_river_crossing then 10 else 0 end;
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

revoke all on function public.move_military_force(uuid, jsonb) from public, anon;
grant execute on function public.move_military_force(uuid, jsonb) to authenticated;


-- Construction and reorganization must use the same river crossing rules as movement.
create or replace function public.build_military_structure(p_type text,p_cell_x integer,p_cell_y integer,p_source_marker_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
    profile public.profiles%rowtype;
    calendar public.game_calendar%rowtype;
    grid public.military_grid_cells%rowtype;
    override public.military_terrain_cells%rowtype;
    marker public.markers%rowtype;
    province public."Provinces"%rowtype;
    treasury numeric;
    wood numeric;
    tools numeric;
    cost_treasury numeric;
    cost_wood numeric;
    cost_tools numeric;
    existing public.military_structures%rowtype;
    repaired boolean := false;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role <> 'player' or nullif(profile.owner,'') is null then
        raise exception 'Only a state player can construct field structures' using errcode='42501';
    end if;
    if p_type is null or p_type not in ('bridge','camp','watchtower','palisade','ferry') then raise exception 'Unknown structure type' using errcode='22023'; end if;
    select * into grid from public.military_grid_cells where cell_x=p_cell_x and cell_y=p_cell_y;
    if not found then raise exception 'Synchronize the military grid before building' using errcode='55000'; end if;
    select * into override from public.military_terrain_cells where cell_x=p_cell_x and cell_y=p_cell_y;
    select * into province from public."Provinces" where id=coalesce(override.province_id,grid.province_id);
    if p_type <> 'bridge' and (province.id is null or province.owner is distinct from profile.owner or province.occupied_by is not null) then
        raise exception 'Build only in an uncontested province under your control' using errcode='42501';
    end if;
    if p_type='bridge' then
        if (coalesce(override.terrain,grid.base_terrain) <> 'water' and coalesce(grid.river_edges,0)=0)
           or (coalesce(grid.river_edges,0)=0 and not (exists(select 1 from public.military_grid_cells a where a.cell_x=p_cell_x-1 and a.cell_y=p_cell_y and a.base_terrain='plain'
                          and exists(select 1 from public.military_grid_cells b where b.cell_x=p_cell_x+1 and b.cell_y=p_cell_y and b.base_terrain='plain'))
                   or exists(select 1 from public.military_grid_cells a where a.cell_x=p_cell_x and a.cell_y=p_cell_y-1 and a.base_terrain='plain'
                          and exists(select 1 from public.military_grid_cells b where b.cell_x=p_cell_x and b.cell_y=p_cell_y+1 and b.base_terrain='plain')))) then
            raise exception 'A bridge needs a marked water crossing between opposite land cells' using errcode='22023';
        end if;
        if not exists (
            select 1 from public.military_grid_cells land
            join public."Provinces" controlled on controlled.id=land.province_id
            where controlled.owner=profile.owner and controlled.occupied_by is null
              and ((land.cell_x=p_cell_x-1 and land.cell_y=p_cell_y and exists(select 1 from public.military_grid_cells opposite where opposite.cell_x=p_cell_x+1 and opposite.cell_y=p_cell_y and opposite.province_id is not null))
                or (land.cell_x=p_cell_x+1 and land.cell_y=p_cell_y and exists(select 1 from public.military_grid_cells opposite where opposite.cell_x=p_cell_x-1 and opposite.cell_y=p_cell_y and opposite.province_id is not null))
                or (land.cell_x=p_cell_x and land.cell_y=p_cell_y-1 and exists(select 1 from public.military_grid_cells opposite where opposite.cell_x=p_cell_x and opposite.cell_y=p_cell_y+1 and opposite.province_id is not null))
                or (land.cell_x=p_cell_x and land.cell_y=p_cell_y+1 and exists(select 1 from public.military_grid_cells opposite where opposite.cell_x=p_cell_x and opposite.cell_y=p_cell_y-1 and opposite.province_id is not null)))
        ) then raise exception 'At least one bridge bank must be in your uncontested territory' using errcode='42501'; end if;
    elsif coalesce(override.terrain,grid.base_terrain)='water' then
        raise exception 'This structure must be built on land' using errcode='22023';
    end if;
    if exists(select 1 from public.military_structures where cell_x=p_cell_x and cell_y=p_cell_y and status in ('building','active')) then
        raise exception 'This cell already contains a structure' using errcode='23505';
    end if;
    select * into marker from public.markers where id=p_source_marker_id for update;
    if not found or marker.owner is distinct from profile.owner or marker.type='ruins' then
        raise exception 'Choose a working settlement under your control as the supply source' using errcode='42501';
    end if;
    select * into calendar from public.game_calendar where singleton=true;
    cost_treasury := case p_type when 'bridge' then 1800 when 'camp' then 100 when 'watchtower' then 160 when 'palisade' then 100 else 1200 end;
    cost_wood := case p_type when 'bridge' then 140 when 'camp' then 40 when 'watchtower' then 60 when 'palisade' then 40 else 80 end;
    cost_tools := case p_type when 'bridge' then 30 when 'camp' then 10 when 'watchtower' then 10 when 'palisade' then 10 else 20 end;
    select * into existing from public.military_structures where cell_x=p_cell_x and cell_y=p_cell_y and status='broken' for update;
    if p_type='bridge' and found then
        repaired := true; cost_treasury:=900; cost_wood:=70; cost_tools:=15;
    elsif found then raise exception 'Only a broken bridge may be rebuilt in place' using errcode='23505'; end if;
    select coalesce((settings#>>'{economy,treasury}')::numeric,0) into treasury from public.state_mechanics where owner=profile.owner for update;
    select coalesce(quantity,0) into wood from public.marker_inventories where marker_id=p_source_marker_id and item_type='resource' and item_name='Древесина' for update;
    select coalesce(quantity,0) into tools from public.marker_inventories where marker_id=p_source_marker_id and item_type='good' and item_name='Инструменты' for update;
    if coalesce(treasury,0)<cost_treasury or coalesce(wood,0)<cost_wood or coalesce(tools,0)<cost_tools then
        raise exception 'Insufficient funds or materials: requires % z, % Wood and % Tools',cost_treasury,cost_wood,cost_tools using errcode='22023';
    end if;
    update public.state_mechanics set settings=jsonb_set(settings,'{economy,treasury}',to_jsonb(treasury-cost_treasury),true),updated_at=now() where owner=profile.owner;
    update public.marker_inventories set quantity=quantity-cost_wood where marker_id=p_source_marker_id and item_type='resource' and item_name='Древесина';
    update public.marker_inventories set quantity=quantity-cost_tools where marker_id=p_source_marker_id and item_type='good' and item_name='Инструменты';
    if repaired then
        update public.military_structures set status='building',available_from_turn=calendar.turn+1,updated_at=now() where id=existing.id returning * into existing;
    else
        insert into public.military_structures(owner,structure_type,cell_x,cell_y,province_id,status,available_from_turn)
        values(profile.owner,p_type,p_cell_x,p_cell_y,coalesce(override.province_id,grid.province_id),'building',calendar.turn+1)
        returning * into existing;
    end if;
    return jsonb_build_object('id',existing.id,'owner',existing.owner,'structure_type',existing.structure_type,'cell_x',existing.cell_x,'cell_y',existing.cell_y,'status',existing.status,'available_from_turn',existing.available_from_turn,'paid_treasury',cost_treasury,'paid_wood',cost_wood,'paid_tools',cost_tools);
end;
$function$;

create or replace function public.admin_build_military_structure(p_type text,p_cell_x integer,p_cell_y integer,p_owner text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare
    profile public.profiles%rowtype;
    grid public.military_grid_cells%rowtype;
    terrain text;
    province_id bigint;
    current_turn integer;
    structure_id bigint;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role<>'admin' then raise exception 'Only an administrator can instantly place structures' using errcode='42501'; end if;
    if p_type not in ('bridge','camp','watchtower','palisade','ferry') then raise exception 'Unknown structure type' using errcode='22023'; end if;
    if not exists(select 1 from public.state_mechanics where owner=p_owner) then raise exception 'Choose an existing state' using errcode='22023'; end if;
    select * into grid from public.military_grid_cells where cell_x=p_cell_x and cell_y=p_cell_y;
    if not found then raise exception 'Synchronize the military grid before building' using errcode='55000'; end if;
    select coalesce(t.terrain,grid.base_terrain),coalesce(t.province_id,grid.province_id) into terrain,province_id
    from public.military_grid_cells g left join public.military_terrain_cells t on t.cell_x=g.cell_x and t.cell_y=g.cell_y
    where g.cell_x=p_cell_x and g.cell_y=p_cell_y;
    if p_type='bridge' and terrain<>'water' and coalesce(grid.river_edges,0)=0 then raise exception 'A bridge must be placed on a river crossing cell' using errcode='22023'; end if;
    if p_type<>'bridge' and terrain='water' then raise exception 'This structure must be built on land' using errcode='22023'; end if;
    if exists(select 1 from public.military_structures where cell_x=p_cell_x and cell_y=p_cell_y and status in ('building','active','broken')) then raise exception 'This cell already contains a structure' using errcode='23505'; end if;
    select turn into current_turn from public.game_calendar where singleton=true;
    insert into public.military_structures(owner,structure_type,cell_x,cell_y,province_id,status,available_from_turn)
    values(p_owner,p_type,p_cell_x,p_cell_y,province_id,'active',current_turn) returning id into structure_id;
    return jsonb_build_object('id',structure_id,'owner',p_owner,'structure_type',p_type,'cell_x',p_cell_x,'cell_y',p_cell_y,'status','active','available_from_turn',current_turn,'paid_treasury',0,'paid_wood',0,'paid_tools',0);
end;
$function$;

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

    select grid.cell_x,grid.cell_y,grid.river_edges,grid.ford_edges,coalesce(terrain.terrain,grid.base_terrain) as terrain,
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
        select grid.cell_x,grid.cell_y,grid.province_id,grid.river_edges,grid.ford_edges,coalesce(terrain.terrain,grid.base_terrain) as terrain,
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
             where cg.cell_x is null or coalesce(ct.terrain,cg.base_terrain)='water' and not coalesce(ct.bridge,false);
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
        river_crossing:=not bridge and (((coalesce(previous_cell.ford_edges,0)&case when dx=1 and dy=0 then 1 when dx=1 and dy=1 then 2 when dx=0 and dy=1 then 4 when dx=-1 and dy=1 then 8 when dx=-1 and dy=0 then 16 when dx=-1 and dy=-1 then 32 when dx=0 and dy=-1 then 64 else 128 end)<>0)
          or ((coalesce(next_cell.ford_edges,0)&case when dx=1 and dy=0 then 16 when dx=1 and dy=1 then 32 when dx=0 and dy=1 then 64 when dx=-1 and dy=1 then 128 when dx=-1 and dy=0 then 1 when dx=-1 and dy=-1 then 2 when dx=0 and dy=-1 then 4 else 8 end)<>0));
        if major_river_crossing and not bridge and not next_cell.bridge then raise exception 'A major river can only be crossed at a bridge'; end if;
        if bridge or next_cell.bridge then river_crossing:=false; end if;
        base_cost:=case next_cell.terrain when 'hill' then case when diagonal then 21 else 15 end
            when 'forest' then case when diagonal then 21 else 15 end when 'marsh' then case when diagonal then 28 else 20 end
            else case when diagonal then 14 else 10 end end;
        movement_cost:=movement_cost+greatest(1,ceil(base_cost/mobility)::integer)+case when river_crossing then 10 else 0 end;
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

create or replace function public.split_military_force(
    p_force_id uuid,p_units jsonb,p_name text,p_commander_name text,p_commander_age integer,p_cell_x integer,p_cell_y integer
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
    profile public.profiles%rowtype; source_force public.military_forces%rowtype;
    unit_row jsonb; group_row jsonb; moved_count integer; source_next jsonb:='[]'::jsonb; new_id uuid;
    destination public.military_grid_cells%rowtype; source_cell public.military_grid_cells%rowtype; terrain_name text; occupied boolean; direction_bit integer; opposite_bit integer;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role not in ('player','admin') then raise exception 'Player authentication required' using errcode='42501'; end if;
    select * into source_force from public.military_forces where id=p_force_id and force_kind='land_army' and status='active' for update;
    if not found or (profile.role<>'admin' and source_force.owner is distinct from profile.owner) then raise exception 'Choose your active field army' using errcode='42501'; end if;
    if source_force.is_mercenary or source_force.is_militia then raise exception 'Contracted and militia troops cannot be split into a new command'; end if;
    if source_force.action_points<10 then raise exception 'Splitting an army costs 10 action points'; end if;
    if jsonb_typeof(p_units) is distinct from 'array' or jsonb_array_length(p_units)=0 or length(btrim(p_name)) not between 1 and 80
       or length(btrim(p_commander_name)) not between 1 and 80 or p_commander_age not between 16 and 100 then raise exception 'Invalid split order'; end if;
    if exists(select 1 from public.military_battle_armies army join public.military_battles battle on battle.id=army.battle_id
        where army.persistent_force_id=source_force.id and battle.status='pending') then raise exception 'An army in an unresolved battle cannot split'; end if;
    select * into destination from public.military_grid_cells where cell_x=p_cell_x and cell_y=p_cell_y;
    if not found or destination.province_id is null or greatest(abs(p_cell_x-source_force.cell_x),abs(p_cell_y-source_force.cell_y))<>1 then
        raise exception 'The new army must be placed in a neighboring dry land cell';
    end if;
    select coalesce(terrain.terrain,destination.base_terrain) into terrain_name from public.military_terrain_cells terrain
     where terrain.cell_x=p_cell_x and terrain.cell_y=p_cell_y;
    terrain_name:=coalesce(terrain_name,destination.base_terrain);
    if terrain_name='water' or exists(select 1 from public.military_forces other where other.status='active' and other.force_kind='land_army'
        and other.cell_x=p_cell_x and other.cell_y=p_cell_y) then raise exception 'The selected cell is not available to the new army'; end if;
    select * into source_cell from public.military_grid_cells where cell_x=source_force.cell_x and cell_y=source_force.cell_y;
    direction_bit:=case when p_cell_x-source_force.cell_x=1 and p_cell_y-source_force.cell_y=0 then 1 when p_cell_x-source_force.cell_x=1 and p_cell_y-source_force.cell_y=1 then 2 when p_cell_x-source_force.cell_x=0 and p_cell_y-source_force.cell_y=1 then 4 when p_cell_x-source_force.cell_x=-1 and p_cell_y-source_force.cell_y=1 then 8 when p_cell_x-source_force.cell_x=-1 and p_cell_y-source_force.cell_y=0 then 16 when p_cell_x-source_force.cell_x=-1 and p_cell_y-source_force.cell_y=-1 then 32 when p_cell_x-source_force.cell_x=0 and p_cell_y-source_force.cell_y=-1 then 64 else 128 end;
    opposite_bit:=case direction_bit when 1 then 16 when 2 then 32 when 4 then 64 when 8 then 128 when 16 then 1 when 32 then 2 when 64 then 4 else 8 end;
    if ((coalesce(source_cell.river_edges,0)&direction_bit)<>0 or (coalesce(destination.river_edges,0)&opposite_bit)<>0)
       and not exists(select 1 from public.military_structures bridge where bridge.structure_type='bridge' and bridge.status='active'
          and bridge.available_from_turn<=(select turn from public.game_calendar where singleton=true)
          and ((bridge.cell_x=source_force.cell_x and bridge.cell_y=source_force.cell_y) or (bridge.cell_x=p_cell_x and bridge.cell_y=p_cell_y))) then
        raise exception 'A new army cannot be placed across a major river without a bridge';
    end if;
    for unit_row in select value from jsonb_array_elements(p_units) loop
        if jsonb_typeof(unit_row->'count') is distinct from 'number' or (unit_row->>'count')::numeric<=0
           or (unit_row->>'count')::numeric<>trunc((unit_row->>'count')::numeric) then raise exception 'Select a positive whole troop count'; end if;
        if not exists(select 1 from jsonb_array_elements(source_force.unit_groups) item where item->>'type'=unit_row->>'type'
            and (item->>'count')::integer >= (unit_row->>'count')::integer) then raise exception 'The source army does not have enough %',unit_row->>'type'; end if;
    end loop;
    for group_row in select value from jsonb_array_elements(source_force.unit_groups) loop
        moved_count:=coalesce((select sum((item->>'count')::integer) from jsonb_array_elements(p_units) item where item->>'type'=group_row->>'type'),0)::integer;
        if (group_row->>'count')::integer>moved_count then source_next:=source_next||jsonb_build_array(jsonb_build_object('type',group_row->>'type','count',(group_row->>'count')::integer-moved_count)); end if;
    end loop;
    update public.military_forces set unit_groups=source_next,action_points=action_points-10,
        status=case when jsonb_array_length(source_next)=0 then 'disbanded' else status end,updated_at=now() where id=source_force.id;
    insert into public.military_forces(owner,name,force_kind,province_id,cell_x,cell_y,commander_name,commander_age,
        commander_skills,unit_groups,siege_equipment,morale,action_points,status,is_retinue)
    values(source_force.owner,btrim(p_name),'land_army',destination.province_id,p_cell_x,p_cell_y,btrim(p_commander_name),p_commander_age,
        '{}'::jsonb,p_units,'{}'::jsonb,source_force.morale,0,'active',source_force.is_retinue) returning id into new_id;
    return new_id;
end;
$function$;
