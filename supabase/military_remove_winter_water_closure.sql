-- Winter does not universally freeze all routes in the game region; keep water access seasonal only when explicitly modeled.
create or replace function public.military_ship_compatible(p_ship_type text,p_water_types integer,p_season text default null)
returns boolean language sql immutable set search_path = '' as $function$
    select case p_ship_type
        when 'Ушкуй' then (p_water_types & 3)<>0
        when 'Насад' then (p_water_types & 3)<>0
        when 'Ладья' then (p_water_types & 7)<>0
        when 'Когг' then (p_water_types & 4)<>0
        when 'Хольк' then (p_water_types & 4)<>0
        else false end;
$function$;
revoke all on function public.military_ship_compatible(text,integer,text) from public,anon,authenticated;
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
    update public.military_fleets set location_kind='water',port_marker_id=null,cell_x=p_cell_x,cell_y=p_cell_y,updated_at=now() where id=fleet.id;
    return jsonb_build_object('fleet_id',fleet.id,'cell_x',p_cell_x,'cell_y',p_cell_y);
end;
$function$;
create or replace function public.start_military_sea_colonization(
    p_source_marker_id bigint,
    p_target_province_id bigint,
    p_fleet_id uuid,
    p_extra_investment integer default 0
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
    profile public.profiles%rowtype;
    source public.markers%rowtype;
    target public."Provinces"%rowtype;
    fleet public.military_fleets%rowtype;
    port public.military_ports%rowtype;
    cal public.game_calendar%rowtype;
    owner_settings jsonb;
    treasury numeric;
    investment numeric;
    bonus integer;
    cost_factor numeric := 1;
    source_x integer;
    source_y integer;
    target_has_route boolean;
    mission public.military_colonization_missions%rowtype;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role<>'player' or nullif(profile.owner,'') is null then
        raise exception 'Only a state player can start colonization' using errcode='42501';
    end if;
    if p_extra_investment not in (0,1000,2000) then raise exception 'Additional investment must be 0, 1,000 or 2,000 z' using errcode='22023'; end if;
    select * into cal from public.game_calendar where singleton=true;
    select greatest(0,1+coalesce(sum(value),0)/100) into cost_factor
      from public.state_modifiers where owner=profile.owner and effect_key='colonization_cost_pct' and scope_type='state'
       and status='active' and starts_turn<=cal.turn and (ends_turn is null or ends_turn>=cal.turn);
    if (select count(*) from public.military_colonization_missions where owner=profile.owner and status='active')>=2 then raise exception 'A state may run at most two missions at once' using errcode='55000'; end if;
    if exists(select 1 from public.military_colonization_missions where owner=profile.owner and started_turn=cal.turn) then raise exception 'Only one new mission may begin in a season' using errcode='55000'; end if;
    select * into source from public.markers where id=p_source_marker_id and owner=profile.owner and type<>'ruins' and yards>=50 for update;
    if not found then raise exception 'Choose your settlement with at least 50 yards of population' using errcode='22023'; end if;
    select * into target from public."Provinces" where id=p_target_province_id and owner is null for update;
    if not found then raise exception 'The target must be a neutral province' using errcode='22023'; end if;
    if exists(select 1 from public.military_colonization_missions where target_province_id=target.id and status='active') then raise exception 'Another mission is already headed to this province' using errcode='55000'; end if;
    if exists(select 1 from public.military_forces force where force.force_kind='land_army' and force.status='active' and force.province_id=target.id)
       or exists(select 1 from public.military_raids raid where raid.province_id=target.id and raid.status='active') then
        raise exception 'A military force or hostile operation occupies the target province' using errcode='55000';
    end if;
    select * into port from public.military_ports where marker_id=p_source_marker_id and owner=profile.owner and status='active' for update;
    if not found then raise exception 'A sea mission must depart from an active friendly port' using errcode='22023'; end if;
    select * into fleet from public.military_fleets where id=p_fleet_id and owner=profile.owner and status='active'
        and location_kind='port' and port_marker_id=p_source_marker_id for update;
    if not found or fleet.colonization_mission_id is not null then raise exception 'Choose an available fleet based in the source port' using errcode='22023'; end if;
    if exists(select 1 from public.military_battle_armies a join public.military_battles b on b.id=a.battle_id where a.persistent_fleet_id=fleet.id and b.status='pending') then
        raise exception 'A fleet in an unresolved battle cannot begin colonization' using errcode='55000';
    end if;
    source_x:=floor(source.coord_1::numeric/24)::integer;
    source_y:=floor(source.coord_2::numeric/24)::integer;
    if not exists(select 1 from jsonb_array_elements(fleet.ships) s where coalesce((s.value->>'crew')::integer,0)>=
        case s.value->>'type' when 'Ушкуй' then 5 when 'Насад' then 9 when 'Ладья' then 15 when 'Когг' then 15 when 'Хольк' then 23 else 999 end) then
        raise exception 'At least one ship must have 75%% of its regular crew' using errcode='22023';
    end if;
    -- Find a water route from an adjacent source-port cell to a cell adjacent to the target.
    -- Every selected ship must be able to navigate every route cell in the current season.
    with recursive compatible_cells as (
        select g.cell_x,g.cell_y,g.water_types
        from public.military_grid_cells g
        where g.water_types<>0
          and greatest(abs(g.cell_x-source_x),abs(g.cell_y-source_y))=1
          and exists(select 1 from jsonb_array_elements(fleet.ships) s
             where public.military_ship_compatible(s.value->>'type',g.water_types,cal.season))
          and not exists(select 1 from jsonb_array_elements(fleet.ships) s
             where not public.military_ship_compatible(s.value->>'type',g.water_types,cal.season))
    ), target_edges as (
        select distinct g.cell_x,g.cell_y from public.military_grid_cells g
        join public."Provinces" p on p.id=g.province_id where p.id=target.id
    ), walk(cell_x,cell_y) as (
        select c.cell_x,c.cell_y from compatible_cells c
        union
        select n.cell_x,n.cell_y
        from walk w join compatible_cells n on greatest(abs(n.cell_x-w.cell_x),abs(n.cell_y-w.cell_y))=1
    ) select exists(select 1 from walk w join target_edges t on greatest(abs(t.cell_x-w.cell_x),abs(t.cell_y-w.cell_y))=1) into target_has_route;
    if not coalesce(target_has_route,false) then raise exception 'No navigable sea route connects the source port to the target province for this fleet' using errcode='22023'; end if;
    investment:=round((1000+p_extra_investment)*cost_factor,2);
    bonus:=least(10,(p_extra_investment/1000)*5);
    select settings into owner_settings from public.state_mechanics where owner=profile.owner for update;
    treasury:=coalesce((owner_settings#>>'{economy,treasury}')::numeric,0);
    if treasury<investment then raise exception 'Not enough treasury for colonization' using errcode='22023'; end if;
    update public.state_mechanics set settings=settings||jsonb_build_object('economy',coalesce(settings->'economy','{}'::jsonb)||jsonb_build_object('treasury',treasury-investment)),updated_at=now() where owner=profile.owner;
    update public.markers set yards=yards-50 where id=source.id;
    insert into public.military_colonization_missions(owner,source_marker_id,target_province_id,started_turn,investment,bonus_chance,success_chance,mission_type,fleet_id)
    values(profile.owner,source.id,target.id,cal.turn,investment,bonus,least(80,50+bonus),'sea',fleet.id) returning * into mission;
    update public.military_fleets set colonization_mission_id=mission.id,updated_at=now() where id=fleet.id;
    return jsonb_build_object('mission_id',mission.id,'target_province_id',target.id,'started_turn',cal.turn,'success_chance',mission.success_chance,'next_payment',500,'settlers',200,'fleet_id',fleet.id);
end;
$function$;

