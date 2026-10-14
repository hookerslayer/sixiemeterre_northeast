-- Water positions, ports, basing and server-validated naval movement.
alter table public.military_fleets
    add column if not exists location_kind text not null default 'unplaced'
        check (location_kind in ('unplaced','water','port')),
    add column if not exists cell_x integer,
    add column if not exists cell_y integer,
    add column if not exists port_marker_id bigint references public.markers(id) on delete set null;
alter table public.military_fleets drop constraint if exists military_fleets_location_check;
alter table public.military_fleets add constraint military_fleets_location_check check (
    (location_kind='unplaced' and cell_x is null and cell_y is null and port_marker_id is null)
    or (location_kind='water' and cell_x is not null and cell_y is not null and port_marker_id is null)
    or (location_kind='port' and cell_x is null and cell_y is null and port_marker_id is not null)
);
create unique index if not exists military_fleets_one_per_water_cell_idx
    on public.military_fleets(cell_x,cell_y) where location_kind='water' and status='active';

create table if not exists public.military_ports (
    id bigint generated always as identity primary key,
    marker_id bigint not null unique references public.markers(id) on delete cascade,
    owner text not null references public.state_mechanics(owner) on delete cascade,
    port_type text not null check (port_type in ('river_port','port')),
    status text not null default 'building' check (status in ('building','active','destroyed')),
    available_from_turn integer not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists military_ports_owner_status_idx on public.military_ports(owner,status,port_type);
alter table public.military_ports enable row level security;
drop policy if exists "Ports are visible to authenticated players" on public.military_ports;
create policy "Ports are visible to authenticated players" on public.military_ports for select to authenticated using (true);
revoke all on public.military_ports from anon,authenticated;
grant select on public.military_ports to authenticated;

create or replace function public.military_ship_compatible(p_ship_type text,p_water_types integer,p_season text default null)
returns boolean language sql immutable set search_path = '' as $function$
    select case p_ship_type
        when 'Ушкуй' then (p_water_types & 3)<>0
        when 'Насад' then (p_water_types & 3)<>0
        when 'Ладья' then (p_water_types & 7)<>0
        when 'Когг' then (p_water_types & 4)<>0
        when 'Хольк' then (p_water_types & 4)<>0
        else false end
       and not (p_season='Зима' and (p_water_types & 3)<>0 and (p_water_types & 4)=0);
$function$;
revoke all on function public.military_ship_compatible(text,integer,text) from public,anon,authenticated;

create or replace function public.build_military_port(p_marker_id bigint,p_port_type text,p_source_marker_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
    profile public.profiles%rowtype;
    settlement public.markers%rowtype;
    source public.markers%rowtype;
    calendar public.game_calendar%rowtype;
    treasury numeric;
    wood numeric;
    tools_amount numeric;
    port_row public.military_ports%rowtype;
    px integer;
    py integer;
    access_mask integer;
    cost_z numeric;
    cost_wood numeric;
    cost_tools numeric;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role<>'player' or nullif(profile.owner,'') is null then raise exception 'Only a state player can build a port' using errcode='42501'; end if;
    if p_port_type not in ('river_port','port') then raise exception 'Unknown port type' using errcode='22023'; end if;
    select * into settlement from public.markers where id=p_marker_id and owner=profile.owner and type<>'ruins'
      and (military_controlled_by is null or military_controlled_by=profile.owner) for update;
    if not found then raise exception 'Choose an unoccupied settlement controlled by your state' using errcode='22023'; end if;
    if exists(select 1 from public.military_ports where marker_id=settlement.id and status<>'destroyed') then raise exception 'This settlement already has a port' using errcode='23505'; end if;
    px:=floor(settlement.coord_1::numeric/24)::integer; py:=floor(settlement.coord_2::numeric/24)::integer;
    select coalesce(bit_or(grid.water_types),0) into access_mask from public.military_grid_cells grid
    where greatest(abs(grid.cell_x-px),abs(grid.cell_y-py))=1;
    if p_port_type='river_port' and (access_mask & 3)=0 then raise exception 'A river port needs direct access to a river or lake cell' using errcode='22023'; end if;
    if p_port_type='port' and (access_mask & 4)=0 then raise exception 'A sea port needs direct access to a sea cell' using errcode='22023'; end if;
    cost_z:=case p_port_type when 'river_port' then 2000 else 4000 end;
    cost_wood:=case p_port_type when 'river_port' then 150 else 300 end;
    cost_tools:=case p_port_type when 'river_port' then 30 else 60 end;
    select * into source from public.markers where id=p_source_marker_id and owner=profile.owner and type<>'ruins' for update;
    if not found then raise exception 'Choose your settlement warehouse for construction materials' using errcode='22023'; end if;
    select coalesce((settings#>>'{economy,treasury}')::numeric,0) into treasury from public.state_mechanics where owner=profile.owner for update;
    if coalesce(treasury,0)<cost_z then raise exception 'Not enough treasury to build this port' using errcode='22023'; end if;
    select coalesce(quantity,0) into wood from public.marker_inventories where marker_id=source.id and item_type='resource' and item_name='Древесина' for update;
    select coalesce(quantity,0) into tools_amount from public.marker_inventories where marker_id=source.id and item_type='good' and item_name='Инструменты' for update;
    if coalesce(wood,0)<cost_wood or coalesce(tools_amount,0)<cost_tools then raise exception 'The selected warehouse lacks wood or tools' using errcode='22023'; end if;
    update public.state_mechanics set settings=settings||jsonb_build_object('economy',coalesce(settings->'economy','{}'::jsonb)||jsonb_build_object('treasury',treasury-cost_z)),updated_at=now() where owner=profile.owner;
    update public.marker_inventories set quantity=quantity-cost_wood where marker_id=source.id and item_type='resource' and item_name='Древесина';
    update public.marker_inventories set quantity=quantity-cost_tools where marker_id=source.id and item_type='good' and item_name='Инструменты';
    select * into calendar from public.game_calendar where singleton=true;
    insert into public.military_ports(marker_id,owner,port_type,status,available_from_turn)
    values(settlement.id,profile.owner,p_port_type,'building',calendar.turn+1) returning * into port_row;
    return jsonb_build_object('id',port_row.id,'marker_id',settlement.id,'port_type',p_port_type,'available_from_turn',port_row.available_from_turn,'paid_z',cost_z,'wood',cost_wood,'tools',cost_tools);
end;
$function$;
revoke all on function public.build_military_port(bigint,text,bigint) from public,anon;
grant execute on function public.build_military_port(bigint,text,bigint) to authenticated;

create or replace function public.advance_military_ports_on_turn()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
    if new.turn<=old.turn then return new; end if;
    update public.military_ports set status='active',updated_at=now() where status='building' and available_from_turn<=new.turn;
    return new;
end;
$function$;
revoke all on function public.advance_military_ports_on_turn() from public,anon,authenticated;
drop trigger if exists advance_military_ports_on_turn on public.game_calendar;
create trigger advance_military_ports_on_turn after update of turn on public.game_calendar for each row execute function public.advance_military_ports_on_turn();

create or replace function public.sync_military_port_owner()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
    if new.owner is distinct from old.owner and new.owner is not null then
        update public.military_ports set owner=new.owner,updated_at=now() where marker_id=new.id and status<>'destroyed';
    end if;
    if new.type='ruins' then update public.military_ports set status='destroyed',updated_at=now() where marker_id=new.id; end if;
    return new;
end;
$function$;
revoke all on function public.sync_military_port_owner() from public,anon,authenticated;
drop trigger if exists sync_military_port_owner on public.markers;
create trigger sync_military_port_owner after update of owner,type on public.markers for each row execute function public.sync_military_port_owner();

create or replace function public.dock_military_fleet(p_fleet_id uuid,p_marker_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
    profile public.profiles%rowtype;
    fleet public.military_fleets%rowtype;
    port public.military_ports%rowtype;
    marker public.markers%rowtype;
    ship jsonb;
    px integer;
    py integer;
    berth_size integer:=0;
    berth_limit integer;
    used_berths integer;
    calendar public.game_calendar%rowtype;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role not in ('player','admin') then raise exception 'Authentication required' using errcode='42501'; end if;
    select * into fleet from public.military_fleets where id=p_fleet_id and status='active' for update;
    if not found or (profile.role<>'admin' and fleet.owner is distinct from profile.owner) then raise exception 'You do not command this fleet' using errcode='42501'; end if;
    if fleet.location_kind<>'water' then raise exception 'Only a fleet in water can enter a port' using errcode='55000'; end if;
    select * into port from public.military_ports where marker_id=p_marker_id and status='active' for update;
    if not found then raise exception 'Active port not found' using errcode='22023'; end if;
    if port.owner is distinct from fleet.owner then raise exception 'The fleet needs a friendly port' using errcode='42501'; end if;
    select * into marker from public.markers where id=port.marker_id;
    px:=floor(marker.coord_1::numeric/24)::integer; py:=floor(marker.coord_2::numeric/24)::integer;
    if greatest(abs(fleet.cell_x-px),abs(fleet.cell_y-py))<>1 then raise exception 'The fleet must be in a neighboring water cell' using errcode='22023'; end if;
    select * into calendar from public.game_calendar where singleton=true;
    berth_limit:=case port.port_type when 'river_port' then 6 else 12 end;
    for ship in select value from jsonb_array_elements(fleet.ships) loop
        if port.port_type='river_port' and ship->>'type' not in ('Ушкуй','Насад','Ладья') then raise exception 'This ship cannot use an inland water port' using errcode='22023'; end if;
        if port.port_type='port' and ship->>'type' not in ('Ладья','Когг','Хольк') then raise exception 'This ship is not compatible with a sea port' using errcode='22023'; end if;
        berth_size:=berth_size+case ship->>'type' when 'Ушкуй' then 1 when 'Насад' then 2 when 'Ладья' then 2 when 'Когг' then 3 when 'Хольк' then 4 else 99 end;
    end loop;
    select coalesce(sum(size),0) into used_berths from (
        select case ship->>'type' when 'Ушкуй' then 1 when 'Насад' then 2 when 'Ладья' then 2 when 'Когг' then 3 when 'Хольк' then 4 else 99 end as size
        from public.military_fleets other cross join lateral jsonb_array_elements(other.ships) ship
        where other.port_marker_id=port.marker_id and other.location_kind='port' and other.status='active'
    ) occupied;
    if berth_size+used_berths>berth_limit then raise exception 'Not enough free berths in this port' using errcode='55000'; end if;
    if port.port_type='river_port' and calendar.season='Зима' then raise exception 'River and lake ports are closed in winter' using errcode='55000'; end if;
    update public.military_fleets set location_kind='port',port_marker_id=port.marker_id,cell_x=null,cell_y=null,updated_at=now() where id=fleet.id;
    return jsonb_build_object('fleet_id',fleet.id,'port_marker_id',port.marker_id,'berths_used',berth_size,'berths_total',berth_limit);
end;
$function$;
revoke all on function public.dock_military_fleet(uuid,bigint) from public,anon;
grant execute on function public.dock_military_fleet(uuid,bigint) to authenticated;

create or replace function public.launch_military_fleet(p_fleet_id uuid,p_cell_x integer,p_cell_y integer)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
    profile public.profiles%rowtype;
    fleet public.military_fleets%rowtype;
    port public.military_ports%rowtype;
    marker public.markers%rowtype;
    grid public.military_grid_cells%rowtype;
    ship jsonb;
    px integer;
    py integer;
    calendar public.game_calendar%rowtype;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role not in ('player','admin') then raise exception 'Authentication required' using errcode='42501'; end if;
    select * into fleet from public.military_fleets where id=p_fleet_id and status='active' for update;
    if not found or (profile.role<>'admin' and fleet.owner is distinct from profile.owner) then raise exception 'You do not command this fleet' using errcode='42501'; end if;
    if fleet.location_kind<>'port' then raise exception 'Fleet is not based in a port' using errcode='55000'; end if;
    select * into port from public.military_ports where marker_id=fleet.port_marker_id and status='active';
    select * into marker from public.markers where id=fleet.port_marker_id;
    if port.owner is distinct from fleet.owner then raise exception 'The fleet no longer controls this port' using errcode='42501'; end if;
    px:=floor(marker.coord_1::numeric/24)::integer; py:=floor(marker.coord_2::numeric/24)::integer;
    if greatest(abs(p_cell_x-px),abs(p_cell_y-py))<>1 then raise exception 'Choose a neighboring water cell' using errcode='22023'; end if;
    select * into grid from public.military_grid_cells where cell_x=p_cell_x and cell_y=p_cell_y;
    if not found then raise exception 'Water cell is outside the mapped area' using errcode='22023'; end if;
    select * into calendar from public.game_calendar where singleton=true;
    for ship in select value from jsonb_array_elements(fleet.ships) loop
        if not public.military_ship_compatible(ship->>'type',grid.water_types,calendar.season) then raise exception 'This water cell or season is not navigable for every ship in the fleet' using errcode='22023'; end if;
    end loop;
    if exists(select 1 from public.military_fleets other where other.status='active' and other.location_kind='water' and other.cell_x=p_cell_x and other.cell_y=p_cell_y) then raise exception 'Water cell is occupied by another fleet' using errcode='55000'; end if;
    if port.port_type='river_port' and calendar.season='Зима' then raise exception 'River and lake ports are closed in winter' using errcode='55000'; end if;
    update public.military_fleets set location_kind='water',port_marker_id=null,cell_x=p_cell_x,cell_y=p_cell_y,updated_at=now() where id=fleet.id;
    return jsonb_build_object('fleet_id',fleet.id,'cell_x',p_cell_x,'cell_y',p_cell_y);
end;
$function$;
revoke all on function public.launch_military_fleet(uuid,integer,integer) from public,anon;
grant execute on function public.launch_military_fleet(uuid,integer,integer) to authenticated;

create or replace function public.move_military_fleet(p_fleet_id uuid,p_path jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
    profile public.profiles%rowtype;
    fleet public.military_fleets%rowtype;
    calendar public.game_calendar%rowtype;
    route_step record;
    previous_cell record;
    current_cell record;
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
    for ship in select value from jsonb_array_elements(fleet.ships) loop
        type_name:=ship->>'type';
        max_crew:=case type_name when 'Ушкуй' then 6 when 'Насад' then 12 when 'Ладья' then 20 when 'Когг' then 20 when 'Хольк' then 30 else 0 end;
        crew:=coalesce((ship->>'crew')::integer,0);
        if max_crew=0 or crew*100<max_crew*75 then raise exception 'Every ship needs at least 75%% of its regular crew to sail' using errcode='55000'; end if;
        if crew<max_crew then penalty:=true; end if;
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
        if exists(select 1 from public.military_fleets other where other.status='active' and other.location_kind='water' and other.cell_x=route_step.x and other.cell_y=route_step.y and other.id<>fleet.id and (idx=step_count-1 or other.owner<>fleet.owner)) then raise exception 'Route cell is occupied by another fleet' using errcode='55000'; end if;
        step_cost:=case when (current_cell.water_types & 1)<>0 and (current_cell.water_types & 6)=0 then case when dx<>0 and dy<>0 then 14 else 10 end else case when dx<>0 and dy<>0 then 14 else 10 end end;
        if penalty then step_cost:=step_cost+1; end if;
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
