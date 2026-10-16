-- Map object interactions, neutral settlement sieges, river crossings and missions.

alter table public.military_sieges alter column defender_owner drop not null;
alter table public.military_sieges drop constraint if exists military_sieges_defender_owner_fkey;
alter table public.markers drop column if exists description;

create or replace function public.admin_build_military_port(p_marker_id bigint,p_port_type text,p_owner text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare marker public.markers%rowtype; current_turn integer;
begin
    if not exists(select 1 from public.profiles where id=(select auth.uid()) and role='admin') then
        raise exception 'Only an administrator can build ports for states' using errcode='42501';
    end if;
    if p_port_type not in ('port','river_port') then raise exception 'Invalid port type' using errcode='22023'; end if;
    select * into marker from public.markers where id=p_marker_id and type<>'ruins' for update;
    if not found then raise exception 'Choose an existing settlement' using errcode='22023'; end if;
    if not exists(select 1 from public.state_mechanics where owner=p_owner) then raise exception 'Choose an existing state' using errcode='22023'; end if;
    if exists(select 1 from public.military_ports where marker_id=p_marker_id and status in ('building','active')) then raise exception 'A port already exists here' using errcode='23505'; end if;
    select turn into current_turn from public.game_calendar where singleton=true;
    insert into public.military_ports(marker_id,owner,port_type,status,available_from_turn)
      values(p_marker_id,p_owner,p_port_type,'active',current_turn);
    return jsonb_build_object('marker_id',p_marker_id,'owner',p_owner,'port_type',p_port_type,'status','active','available_from_turn',current_turn);
end;
$function$;
revoke all on function public.admin_build_military_port(bigint,text,text) from public,anon;
grant execute on function public.admin_build_military_port(bigint,text,text) to authenticated;

create or replace function public.recruit_permanent_garrison(p_marker_id bigint,p_unit_type text,p_count integer)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare profile public.profiles%rowtype; marker public.markers%rowtype; force public.military_forces%rowtype; mechanics public.state_mechanics%rowtype;
    current_turn integer; cap integer; base_count integer; extra_count integer; total_count integer; treasury numeric;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role<>'player' or profile.owner is null then raise exception 'Only a state player can recruit garrison troops' using errcode='42501'; end if;
    if p_count is null or p_count<1 or p_count>500 or p_unit_type not in ('Пешие ратники','Копейщики','Лучники','Арбалетчики','Конные копейщики','Лёгкая конница','Конные лучники','Лыжники-разведчики','Ушкуйники') then raise exception 'Invalid garrison unit or quantity' using errcode='22023'; end if;
    select * into marker from public.markers where id=p_marker_id and owner=profile.owner and type<>'ruins' for update;
    if not found then raise exception 'Settlement is not controlled by your state' using errcode='42501'; end if;
    select * into force from public.military_forces where marker_id=marker.id and is_permanent_garrison and status='active' for update;
    if not found then raise exception 'This settlement has no permanent garrison' using errcode='22023'; end if;
    cap:=50*greatest(0,marker.fortification_level);
    base_count:=case marker.type when 'large_city' then 60 when 'city' then 30 when 'fortress' then 40 when 'monastery' then 15 else 0 end;
    total_count:=coalesce((select sum((unit->>'count')::integer) from jsonb_array_elements(force.unit_groups) unit),0);
    extra_count:=greatest(0,total_count-base_count);
    if extra_count+p_count>cap then raise exception 'Permanent garrison extra capacity is %; % places remain',cap,greatest(0,cap-extra_count) using errcode='22023'; end if;
    select turn into current_turn from public.game_calendar where singleton=true;
    select * into mechanics from public.state_mechanics where owner=profile.owner for update;
    treasury:=coalesce((mechanics.settings#>>'{economy,treasury}')::numeric,0);
    if coalesce(treasury,0)<p_count*2 then raise exception 'Garrison recruitment costs 2 z per soldier' using errcode='22023'; end if;
    update public.state_mechanics set settings=jsonb_set(settings,'{economy,treasury}',to_jsonb(treasury-p_count*2),true),updated_at=now() where owner=profile.owner;
    update public.military_forces set unit_groups=case when exists(select 1 from jsonb_array_elements(unit_groups) unit where unit->>'type'=p_unit_type)
        then (select jsonb_agg(case when unit->>'type'=p_unit_type then jsonb_set(unit,'{count}',to_jsonb((unit->>'count')::integer+p_count)) else unit end) from jsonb_array_elements(unit_groups) unit)
        else unit_groups||jsonb_build_array(jsonb_build_object('type',p_unit_type,'count',p_count)) end,updated_at=now()
      where id=force.id;
    return jsonb_build_object('marker_id',marker.id,'force_id',force.id,'unit_type',p_unit_type,'count',p_count,'extra_capacity',cap,'extra_used',extra_count+p_count,'paid_z',p_count*2,'turn',current_turn);
end;
$function$;
revoke all on function public.recruit_permanent_garrison(bigint,text,integer) from public,anon;
grant execute on function public.recruit_permanent_garrison(bigint,text,integer) to authenticated;

create or replace function public.set_military_river_crossing(p_cell_x integer,p_cell_y integer,p_mode text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_cell public.military_grid_cells%rowtype;
begin
    if not exists(select 1 from public.profiles where id=(select auth.uid()) and role='admin') then
        raise exception 'Only an administrator can edit river crossings' using errcode='42501';
    end if;
    if p_mode not in ('fordable','impassable') then raise exception 'Choose fordable or impassable river' using errcode='22023'; end if;
    select * into v_cell from public.military_grid_cells where cell_x=p_cell_x and cell_y=p_cell_y for update;
    if not found or (v_cell.water_types & 1)=0 or v_cell.river_edges=0 then raise exception 'The selected cell has no mapped river crossing' using errcode='22023'; end if;
    update public.military_grid_cells set ford_edges=case when p_mode='fordable' then river_edges else 0 end,updated_at=now()
     where cell_x=p_cell_x and cell_y=p_cell_y returning * into v_cell;
    return jsonb_build_object('cell_x',v_cell.cell_x,'cell_y',v_cell.cell_y,'river_edges',v_cell.river_edges,'ford_edges',v_cell.ford_edges);
end;
$function$;
revoke all on function public.set_military_river_crossing(integer,integer,text) from public,anon;
grant execute on function public.set_military_river_crossing(integer,integer,text) to authenticated;

create or replace function public.destroy_military_structure(p_structure_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
    profile public.profiles%rowtype;
    structure public.military_structures%rowtype;
    force public.military_forces%rowtype;
    province_owner text;
    cost integer := 30;
    free_destruction boolean := false;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role not in ('player','admin') then raise exception 'Authentication required' using errcode='42501'; end if;
    select * into structure from public.military_structures where id=p_structure_id and status='active' for update;
    if not found then raise exception 'Active structure not found' using errcode='22023'; end if;
    select province.owner into province_owner from public.military_grid_cells grid
      left join public.military_terrain_cells terrain using(cell_x,cell_y)
      left join public."Provinces" province on province.id=coalesce(terrain.province_id,grid.province_id)
     where grid.cell_x=structure.cell_x and grid.cell_y=structure.cell_y;
    free_destruction := profile.role='admin' or (profile.owner is not null and province_owner=profile.owner and structure.owner=profile.owner);
    if not free_destruction then
        select * into force from public.military_forces army where army.owner=profile.owner and army.force_kind='land_army'
          and army.status='active' and greatest(abs(army.cell_x-structure.cell_x),abs(army.cell_y-structure.cell_y))<=1
          order by army.id limit 1 for update;
        if not found then raise exception 'An army must be on an adjacent cell to destroy this object' using errcode='42501'; end if;
        if force.action_points<cost then raise exception 'Destroying an object costs 30 action points' using errcode='22023'; end if;
        update public.military_forces set action_points=action_points-cost,updated_at=now() where id=force.id;
    end if;
    update public.military_structures set status=case when structure.structure_type='bridge' then 'broken' else 'destroyed' end,updated_at=now() where id=structure.id;
    return jsonb_build_object('id',structure.id,'status',case when structure.structure_type='bridge' then 'broken' else 'destroyed' end,
      'spent_action_points',case when free_destruction then 0 else cost end,'force_id',case when free_destruction then null else force.id end);
end;
$function$;

create table if not exists public.religious_mission_attempts(
    owner text not null,
    target_type text not null check(target_type in ('province','marker')),
    target_id bigint not null,
    attempts integer not null default 0 check(attempts>=0),
    last_attempt_turn integer,
    primary key(owner,target_type,target_id)
);
create table if not exists public.religious_mission_events(
    id bigint generated by default as identity primary key,
    owner text not null,
    target_owner text,
    target_type text not null check(target_type in ('province','marker')),
    target_id bigint not null,
    target_name text not null,
    turn integer not null,
    attempt_no integer not null,
    success_chance integer not null,
    succeeded boolean not null,
    created_at timestamptz not null default now()
);
create index if not exists religious_mission_events_owner_turn_idx on public.religious_mission_events(owner,turn);
alter table public.religious_mission_attempts enable row level security;
alter table public.religious_mission_events enable row level security;
drop policy if exists religious_mission_events_read on public.religious_mission_events;
create policy religious_mission_events_read on public.religious_mission_events for select to authenticated
using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and (p.role='admin' or p.owner=owner or p.owner=target_owner)));
grant select on public.religious_mission_events to authenticated;

create or replace function public.get_religious_mission_events()
returns setof public.religious_mission_events language sql stable security definer set search_path = '' as $function$
    select event.* from public.religious_mission_events event
     where exists(select 1 from public.profiles p where p.id=(select auth.uid()) and (p.role='admin' or p.owner=event.owner or p.owner=event.target_owner))
     order by event.created_at desc limit 100;
$function$;

create or replace function public.attempt_religious_mission(p_target_type text,p_target_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
    profile public.profiles%rowtype;
    settings jsonb;
    mechanics public.state_mechanics%rowtype;
    target_owner text;
    target_religion text;
    target_name text;
    titular_religion text;
    current_turn integer;
    monastery_count integer;
    turn_attempts integer;
    previous_attempts integer := 0;
    attempt_no integer;
    chance integer;
    succeeded boolean;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role<>'player' or profile.owner is null then raise exception 'Only a state player can conduct a mission' using errcode='42501'; end if;
    select sm.settings into settings from public.state_mechanics sm where sm.owner=profile.owner;
    if settings->>'government_form'<>'Теократия' then raise exception 'Missionary conversion is only available to theocracies' using errcode='42501'; end if;
    titular_religion := settings->>'titular_religion';
    select turn into current_turn from public.game_calendar where singleton=true;
    if p_target_type='province' then
        select owner,main_religion,coalesce(province_name,'Провинция #'||id::text) into target_owner,target_religion,target_name from public."Provinces" where id=p_target_id;
    elsif p_target_type='marker' then
        select owner,religion,coalesce(name,'Поселение #'||id::text) into target_owner,target_religion,target_name from public.markers where id=p_target_id and type<>'ruins';
    else raise exception 'Target must be a province or settlement' using errcode='22023'; end if;
    if target_name is null then raise exception 'Target not found' using errcode='22023'; end if;
    if target_owner=profile.owner then raise exception 'Cannot target your own territory' using errcode='42501'; end if;
    if target_religion is not distinct from titular_religion then raise exception 'Target already follows the titular religion' using errcode='22023'; end if;
    select count(*) into monastery_count from public.markers where owner=profile.owner and type='monastery' and (military_controlled_by is null or military_controlled_by=profile.owner);
    select count(*) into turn_attempts from public.religious_mission_events where owner=profile.owner and turn=current_turn;
    if turn_attempts>=3+monastery_count then raise exception 'Missionary attempts for this turn are exhausted' using errcode='22023'; end if;
    insert into public.religious_mission_attempts(owner,target_type,target_id) values(profile.owner,p_target_type,p_target_id)
      on conflict(owner,target_type,target_id) do nothing;
    select attempts into previous_attempts from public.religious_mission_attempts where owner=profile.owner and target_type=p_target_type and target_id=p_target_id for update;
    if exists(select 1 from public.religious_mission_attempts where owner=profile.owner and target_type=p_target_type and target_id=p_target_id and last_attempt_turn=current_turn) then
       raise exception 'This territory can only be targeted once per turn' using errcode='23505'; end if;
    select * into mechanics from public.state_mechanics where owner=profile.owner for update;
    if not found or coalesce((mechanics.settings#>>'{economy,prestige}')::numeric,0)<5 then raise exception 'Missionary action costs 5 OP' using errcode='22023'; end if;
    attempt_no:=previous_attempts+1;
    chance:=least(75,5+(previous_attempts*5));
    succeeded:=floor(random()*100)<chance;
    update public.state_mechanics set settings=jsonb_set(settings,'{economy,prestige}',to_jsonb((settings#>>'{economy,prestige}')::numeric-5),true),updated_at=now() where owner=profile.owner;
    update public.religious_mission_attempts set attempts=attempt_no,last_attempt_turn=current_turn where owner=profile.owner and target_type=p_target_type and target_id=p_target_id;
    if succeeded then
      if p_target_type='province' then update public."Provinces" set main_religion=titular_religion,religion_assimilation_turns=null where id=p_target_id;
      else update public.markers set religion=titular_religion,religion_assimilation_turns=null where id=p_target_id; end if;
    end if;
    insert into public.religious_mission_events(owner,target_owner,target_type,target_id,target_name,turn,attempt_no,success_chance,succeeded)
      values(profile.owner,target_owner,p_target_type,p_target_id,target_name,current_turn,attempt_no,chance,succeeded);
    return jsonb_build_object('target_type',p_target_type,'target_id',p_target_id,'attempts',attempt_no,'success_chance',chance,'succeeded',succeeded,'prestige_spent',5);
end;
$function$;
revoke all on function public.attempt_religious_mission(text,bigint) from public,anon;
grant execute on function public.attempt_religious_mission(text,bigint) to authenticated;
grant execute on function public.get_religious_mission_events() to authenticated;

-- Preserve the existing siege implementation while accepting neutral settlements and raising local levy.
do $migration$
declare definition text;
begin
    select pg_get_functiondef('public.start_military_siege(uuid,bigint)'::regprocedure) into definition;
    definition := replace(definition,
      'if not found or target.owner is null or target.owner=profile.owner then raise exception ''The target must be a settlement controlled by another state'' using errcode=''22023''; end if;',
      'if not found or target.owner=profile.owner then raise exception ''The target must be a neutral or foreign settlement'' using errcode=''22023''; end if;');
    definition := replace(definition,
      'values(target.id,profile.owner,target.owner,v_level,array[p_force_id],cal.turn-1,cal.turn-1,cal.turn-1)',
      'values(target.id,profile.owner,target.owner,v_level,array[p_force_id],cal.turn-1,cal.turn-1,cal.turn-1)');
    definition := replace(definition,
      'update public.military_forces set action_points=action_points-20,updated_at=now() where id=force.id;',
      'if not exists(select 1 from public.military_forces levy where levy.marker_id=target.id and levy.is_militia and levy.status=''active'') then'||chr(10)||
      '        insert into public.military_forces(owner,name,force_kind,marker_id,unit_groups,is_militia,levy_source_kind,levy_source_id,morale,action_points,status)'||chr(10)||
      '        values(coalesce(target.owner,''Нейтральные земли''),''Ополчение поселения: ''||coalesce(target.name,''#''||target.id::text),''garrison'',target.id,'||chr(10)||
      '          jsonb_build_array(jsonb_build_object(''type'',''Копейщики'',''count'',least(100,greatest(5,ceil(coalesce(target.yards,0)::numeric/10)::integer))),jsonb_build_object(''type'',''Лучники'',''count'',least(50,greatest(0,ceil(coalesce(target.yards,0)::numeric/25)::integer)))),true,''marker'',target.id,100,0,''active'');'||chr(10)||
      '    end if;'||chr(10)||
      '    update public.military_forces set action_points=action_points-20,updated_at=now() where id=force.id;');
    execute definition;
end;
$migration$;

do $migration$
declare definition text;
begin
    select pg_get_functiondef('public.get_visible_military_forces()'::regprocedure) into definition;
    definition := replace(definition,'case when coalesce(terrain.terrain,grid.base_terrain)=''hill'' then 3 else 2 end as radius','1 as radius');
    execute definition;
    select pg_get_functiondef('public.sync_permanent_settlement_garrison()'::regprocedure) into definition;
    definition := replace(definition,'Постоянный гарнизон: ','Гарнизон: ');
    execute definition;
    update public.military_forces set name=replace(name,'Постоянный гарнизон: ','Гарнизон: ')
     where is_permanent_garrison and name like 'Постоянный гарнизон:%';
    select pg_get_functiondef('public.admin_create_state(text,text,text,text,integer,text,text,text,bigint[],bigint,text,text,bigint,bigint)'::regprocedure) into definition;
    definition := replace(definition,'coord_2,description,owner,yards','coord_2,owner,yards');
    definition := replace(definition,'p_city_x,p_city_y,null,btrim(p_owner),400','p_city_x,p_city_y,btrim(p_owner),400');
    execute definition;
end;
$migration$;

notify pgrst,'reload schema';
