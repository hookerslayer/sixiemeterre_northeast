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
        select grid.cell_x, grid.cell_y, coalesce(override.province_id, grid.province_id) as province_id,
               coalesce(override.terrain, grid.base_terrain) as terrain,
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
        select coalesce(override.terrain, grid.base_terrain),
               (coalesce(override.bridge, false) or exists(select 1 from public.military_structures structure
                  where structure.cell_x=grid.cell_x and structure.cell_y=grid.cell_y and structure.structure_type='bridge'
                    and structure.status='active' and structure.available_from_turn<=(select turn from public.game_calendar where singleton=true)))
          into v_terrain, v_bridge
          from public.military_grid_cells as grid
          left join public.military_terrain_cells as override on override.cell_x = grid.cell_x and override.cell_y = grid.cell_y
         where grid.cell_x = v_prev.x and grid.cell_y = v_prev.y;
        -- Water crossings are passable only where a bridge occupies one endpoint.
        if v_bridge or v_next.bridge then
            v_river_crossing := false;
        else
            v_river_crossing := ((coalesce(v_prev.river_edges, 0) & case when v_dx = 1 and v_dy = 0 then 1 when v_dx = 1 and v_dy = 1 then 2 when v_dx = 0 and v_dy = 1 then 4 when v_dx = -1 and v_dy = 1 then 8 when v_dx = -1 and v_dy = 0 then 16 when v_dx = -1 and v_dy = -1 then 32 when v_dx = 0 and v_dy = -1 then 64 else 128 end) <> 0)
                or ((coalesce(v_next.river_edges, 0) & case when v_dx = 1 and v_dy = 0 then 16 when v_dx = 1 and v_dy = 1 then 32 when v_dx = 0 and v_dy = 1 then 64 when v_dx = -1 and v_dy = 1 then 128 when v_dx = -1 and v_dy = 0 then 1 when v_dx = -1 and v_dy = -1 then 2 when v_dx = 0 and v_dy = -1 then 4 else 8 end) <> 0);
        end if;
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
