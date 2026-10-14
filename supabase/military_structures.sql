-- Persistent field structures: bridges, camps, watchtowers, palisades and portages.
create table if not exists public.military_structures (
    id bigint generated always as identity primary key,
    owner text not null references public.state_mechanics(owner) on delete cascade,
    structure_type text not null check (structure_type in ('bridge','camp','watchtower','palisade','ferry')),
    cell_x integer not null check (cell_x between 0 and 10000),
    cell_y integer not null check (cell_y between 0 and 10000),
    province_id bigint references public."Provinces"(id) on delete set null,
    status text not null default 'building' check (status in ('building','active','broken','destroyed')),
    available_from_turn integer not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create unique index if not exists military_structures_occupied_cell_idx
    on public.military_structures(cell_x,cell_y) where status in ('building','active','broken');
create index if not exists military_structures_owner_status_idx on public.military_structures(owner,status);

alter table public.military_structures enable row level security;
drop policy if exists "Military structures readable to authenticated players" on public.military_structures;
create policy "Military structures readable to authenticated players" on public.military_structures
    for select to authenticated using (true);
revoke all on public.military_structures from anon,authenticated;
grant select on public.military_structures to authenticated;

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
        if coalesce(override.terrain,grid.base_terrain) <> 'water'
           or not (exists(select 1 from public.military_grid_cells a where a.cell_x=p_cell_x-1 and a.cell_y=p_cell_y and a.base_terrain='plain'
                          and exists(select 1 from public.military_grid_cells b where b.cell_x=p_cell_x+1 and b.cell_y=p_cell_y and b.base_terrain='plain'))
                   or exists(select 1 from public.military_grid_cells a where a.cell_x=p_cell_x and a.cell_y=p_cell_y-1 and a.base_terrain='plain'
                          and exists(select 1 from public.military_grid_cells b where b.cell_x=p_cell_x and b.cell_y=p_cell_y+1 and b.base_terrain='plain'))) then
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

create or replace function public.destroy_military_structure(p_structure_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
    profile public.profiles%rowtype;
    structure public.military_structures%rowtype;
    force public.military_forces%rowtype;
    cost integer;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role not in ('player','admin') then raise exception 'Authentication required' using errcode='42501'; end if;
    select * into structure from public.military_structures where id=p_structure_id and status='active' for update;
    if not found then raise exception 'Active structure not found' using errcode='22023'; end if;
    if profile.role <> 'admin' and structure.owner=profile.owner then raise exception 'You cannot destroy your own structure' using errcode='42501'; end if;
    select * into force from public.military_forces army where (profile.role='admin' or army.owner=profile.owner) and army.force_kind='land_army' and army.status='active'
        and greatest(abs(army.cell_x-structure.cell_x),abs(army.cell_y-structure.cell_y))<=1 order by army.id limit 1 for update;
    if not found then raise exception 'A field army must be on an adjacent cell' using errcode='42501'; end if;
    cost := case structure.structure_type when 'palisade' then 10 else 20 end;
    if force.action_points<cost then raise exception 'Not enough action points' using errcode='22023'; end if;
    update public.military_forces set action_points=action_points-cost,updated_at=now() where id=force.id;
    update public.military_structures set status=case when structure.structure_type='bridge' then 'broken' else 'destroyed' end,updated_at=now() where id=structure.id;
    return jsonb_build_object('id',structure.id,'status',case when structure.structure_type='bridge' then 'broken' else 'destroyed' end,'spent_action_points',cost,'force_id',force.id);
end;
$function$;

create or replace function public.activate_military_structures_on_turn()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
    if new.turn > old.turn then
        update public.military_structures set status='active',updated_at=now() where status='building' and available_from_turn<=new.turn;
    end if;
    return new;
end;
$function$;

revoke all on function public.build_military_structure(text,integer,integer,bigint) from public,anon;
grant execute on function public.build_military_structure(text,integer,integer,bigint) to authenticated;
revoke all on function public.destroy_military_structure(bigint) from public,anon;
grant execute on function public.destroy_military_structure(bigint) to authenticated;
revoke all on function public.activate_military_structures_on_turn() from public,anon,authenticated;
drop trigger if exists activate_military_structures_on_game_turn on public.game_calendar;
create trigger activate_military_structures_on_game_turn after update of turn on public.game_calendar
    for each row execute function public.activate_military_structures_on_turn();
