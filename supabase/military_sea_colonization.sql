-- Naval colonization missions: lock a fleet in a friendly port for the four-turn expedition.
alter table public.military_colonization_missions
    add column if not exists mission_type text not null default 'land'
        check (mission_type in ('land','sea')),
    add column if not exists fleet_id uuid references public.military_fleets(id) on delete set null;

alter table public.military_fleets
    add column if not exists colonization_mission_id uuid references public.military_colonization_missions(id) on delete set null;

create index if not exists military_colonization_fleet_idx
    on public.military_colonization_missions(fleet_id) where status='active';

create or replace function public.guard_colonizing_fleet_update()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare caller_role text;
begin
    select role into caller_role from public.profiles where id=(select auth.uid());
    if caller_role='player' and old.colonization_mission_id is not null
       and new.colonization_mission_id is not distinct from old.colonization_mission_id
       and (new.ships is distinct from old.ships
         or new.location_kind is distinct from old.location_kind
         or new.port_marker_id is distinct from old.port_marker_id
         or new.cell_x is distinct from old.cell_x
         or new.cell_y is distinct from old.cell_y
         or new.status is distinct from old.status) then
        raise exception 'This fleet is committed to a colonization mission' using errcode='55000';
    end if;
    return new;
end;
$function$;
revoke all on function public.guard_colonizing_fleet_update() from public,anon,authenticated;
drop trigger if exists military_fleet_colonization_guard on public.military_fleets;
create trigger military_fleet_colonization_guard before update on public.military_fleets
for each row execute function public.guard_colonizing_fleet_update();

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
    if port.port_type='river_port' and cal.season='Зима' then raise exception 'River and lake ports are closed in winter' using errcode='55000'; end if;
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
revoke all on function public.start_military_sea_colonization(bigint,bigint,uuid,integer) from public,anon;
grant execute on function public.start_military_sea_colonization(bigint,bigint,uuid,integer) to authenticated;

-- A committed fleet cannot enter a naval battle.
create or replace function public.link_persistent_fleet_to_battle_army()
returns trigger language plpgsql set search_path = '' as $function$
declare
    v_fleet_id uuid := nullif(new.unit_data->>'persistent_fleet_id', '')::uuid;
    v_fleet public.military_fleets%rowtype;
    v_battle_type text;
begin
    if v_fleet_id is null then new.persistent_fleet_id:=null; return new; end if;
    select battle_type into v_battle_type from public.military_battles where id=new.battle_id;
    if v_battle_type is distinct from 'naval' then raise exception 'A persistent fleet can only join a naval battle' using errcode='22023'; end if;
    select * into v_fleet from public.military_fleets where id=v_fleet_id and owner=new.owner and status='active' for update;
    if not found then raise exception 'Selected fleet is unavailable to this participant' using errcode='22023'; end if;
    if v_fleet.colonization_mission_id is not null then raise exception 'A fleet committed to colonization cannot enter battle' using errcode='55000'; end if;
    if exists(select 1 from public.military_battle_armies other_army join public.military_battles other_battle on other_battle.id=other_army.battle_id
        where other_army.persistent_fleet_id=v_fleet_id and other_battle.status='pending') then raise exception 'This fleet is already committed to another pending battle' using errcode='23505'; end if;
    new.persistent_fleet_id:=v_fleet_id; new.morale:=v_fleet.morale; new.unit_data:=jsonb_set(new.unit_data,'{ships}',v_fleet.ships,true); return new;
end;
$function$;

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
            select greatest(0,1+coalesce(sum(value),0)/100) into cost_factor
              from public.state_modifiers where owner=mission.owner and effect_key='colonization_cost_pct' and scope_type='state'
               and status='active' and starts_turn<=new.turn and (ends_turn is null or ends_turn>=new.turn);
            payment:=round(500*cost_factor,2);
            update public.state_mechanics sm set settings=sm.settings||jsonb_build_object('economy',coalesce(sm.settings->'economy','{}'::jsonb)||jsonb_build_object('treasury',greatest(0,coalesce((sm.settings#>>'{economy,treasury}')::numeric,0)-payment))),updated_at=now()
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
            update public."Provinces" set owner=mission.owner,yards=45,development=20,
              occupied_by=null,target_marker_id=null,stored_resource_qty=0 where id=province.id;
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
