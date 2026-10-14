-- Manually mapped river flow direction. Kept separate from synchronized cell
-- geometry so refreshing map masks cannot erase administrator annotations.
create table if not exists public.military_water_currents (
    cell_x integer not null,
    cell_y integer not null,
    flow_dx smallint not null check (flow_dx between -1 and 1),
    flow_dy smallint not null check (flow_dy between -1 and 1),
    updated_at timestamptz not null default now(),
    primary key(cell_x,cell_y),
    check(flow_dx<>0 or flow_dy<>0)
);
alter table public.military_water_currents enable row level security;
drop policy if exists "Water current directions are readable" on public.military_water_currents;
create policy "Water current directions are readable" on public.military_water_currents for select to anon,authenticated using (true);
revoke all on public.military_water_currents from anon,authenticated;
grant select on public.military_water_currents to anon,authenticated;

create or replace function public.set_military_water_current(p_cell_x integer,p_cell_y integer,p_flow_dx smallint,p_flow_dy smallint)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare caller_role text; cell public.military_grid_cells%rowtype;
begin
    select role into caller_role from public.profiles where id=(select auth.uid());
    if caller_role is distinct from 'admin' then raise exception 'Only an administrator can edit river flow directions' using errcode='42501'; end if;
    if p_flow_dx not between -1 and 1 or p_flow_dy not between -1 and 1 or (p_flow_dx=0 and p_flow_dy=0) then raise exception 'Choose one of eight flow directions' using errcode='22023'; end if;
    select * into cell from public.military_grid_cells where cell_x=p_cell_x and cell_y=p_cell_y for update;
    if not found or (cell.water_types & 1)=0 then raise exception 'Choose a mapped river cell' using errcode='22023'; end if;
    insert into public.military_water_currents(cell_x,cell_y,flow_dx,flow_dy,updated_at)
    values(p_cell_x,p_cell_y,p_flow_dx,p_flow_dy,now())
    on conflict(cell_x,cell_y) do update set flow_dx=excluded.flow_dx,flow_dy=excluded.flow_dy,updated_at=now();
    return jsonb_build_object('cell_x',p_cell_x,'cell_y',p_cell_y,'flow_dx',p_flow_dx,'flow_dy',p_flow_dy);
end;
$function$;
revoke all on function public.set_military_water_current(integer,integer,smallint,smallint) from public,anon;
grant execute on function public.set_military_water_current(integer,integer,smallint,smallint) to authenticated;

-- Reuse the existing authoritative movement validation and substitute the
-- rule's downstream/upstream AP costs on river-to-river steps.
create or replace function public.move_military_fleet(p_fleet_id uuid,p_path jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
    profile public.profiles%rowtype; fleet public.military_fleets%rowtype; calendar public.game_calendar%rowtype;
    route_step record; previous_cell record; current_cell record; side_cell_a record; side_cell_b record;
    flow public.military_water_currents%rowtype; ship jsonb; max_crew integer; crew integer; type_name text;
    penalty boolean:=false; dx integer; dy integer; step_cost integer; total_cost integer:=0;
    step_count integer; idx integer:=0; slowest_maneuver integer:=5; maneuver integer; base_cost integer;
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
        base_cost:=case when dx<>0 and dy<>0 then 14 else 10 end;
        if (previous_cell.water_types & 1)<>0 and (current_cell.water_types & 1)<>0 then
            select * into flow from public.military_water_currents where cell_x=current_cell.cell_x and cell_y=current_cell.cell_y;
            if not found then select * into flow from public.military_water_currents where cell_x=previous_cell.cell_x and cell_y=previous_cell.cell_y; end if;
            if found then
                if flow.flow_dx=dx and flow.flow_dy=dy then base_cost:=case when dx<>0 and dy<>0 then 12 else 8 end;
                elsif flow.flow_dx=-dx and flow.flow_dy=-dy then base_cost:=case when dx<>0 and dy<>0 then 16 else 12 end;
                end if;
            end if;
        end if;
        step_cost:=greatest(1,base_cost+(3-slowest_maneuver)+case when penalty then 1 else 0 end);
        total_cost:=total_cost+step_cost;
        if total_cost>fleet.action_points then raise exception 'The route costs % AP but the fleet has % AP',total_cost,fleet.action_points using errcode='22023'; end if;
        previous_cell:=current_cell;
    end loop;
    update public.military_fleets set cell_x=previous_cell.cell_x,cell_y=previous_cell.cell_y,action_points=action_points-total_cost,updated_at=now() where id=fleet.id returning * into fleet;
    return jsonb_build_object('fleet',to_jsonb(fleet),'cost',total_cost,'remaining',fleet.action_points);
end;
$function$;
revoke all on function public.move_military_fleet(uuid,jsonb) from public,anon;
grant execute on function public.move_military_fleet(uuid,jsonb) to authenticated;
