-- Persistent sieges, hidden seasonal orders, and settlement military control.
alter table public.markers
    add column if not exists fortification_level integer not null default 0
        check (fortification_level between 0 and 3),
    add column if not exists military_controlled_by text;

create table if not exists public.military_sieges (
    id uuid primary key default gen_random_uuid(),
    marker_id bigint not null references public.markers(id) on delete cascade,
    attacker_owner text not null references public.state_mechanics(owner) on delete cascade,
    defender_owner text not null references public.state_mechanics(owner) on delete cascade,
    fortification_level integer not null check (fortification_level between 1 and 3),
    works integer not null default 0 check (works between 0 and 100),
    status text not null default 'active' check (status in ('active','battle_pending','captured','lifted')),
    attacker_force_ids uuid[] not null default '{}',
    attacker_order text not null default 'blockade' check (attacker_order in ('blockade','works','assault','lift')),
    defender_order text not null default 'defend' check (defender_order in ('defend','repair','sortie','surrender')),
    work_method text not null default 'bombardment' check (work_method in ('bombardment','sapping')),
    assault_route text not null default 'ladders' check (assault_route in ('ladders','tower','breach','ram')),
    attacker_orders_turn integer not null default 0,
    defender_orders_turn integer not null default 0,
    last_resolved_turn integer not null default 0,
    battle_id uuid references public.military_battles(id) on delete set null,
    updated_at timestamptz not null default now()
);
create unique index if not exists military_sieges_one_active_per_marker_idx on public.military_sieges(marker_id) where status in ('active','battle_pending');
create index if not exists military_sieges_status_idx on public.military_sieges(status, last_resolved_turn);
alter table public.military_sieges enable row level security;
revoke all on public.military_sieges from anon, authenticated;

create or replace function public.start_military_siege(p_force_id uuid, p_marker_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
    profile public.profiles%rowtype;
    force public.military_forces%rowtype;
    target public.markers%rowtype;
    province public."Provinces"%rowtype;
    cal public.game_calendar%rowtype;
    v_x integer;
    v_y integer;
    v_level integer;
    siege public.military_sieges%rowtype;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role <> 'player' or nullif(profile.owner,'') is null then
        raise exception 'Only a state player can begin a siege' using errcode='42501';
    end if;
    select * into force from public.military_forces where id=p_force_id and force_kind='land_army' and status='active' for update;
    if not found or force.owner is distinct from profile.owner then raise exception 'Choose your active field army' using errcode='42501'; end if;
    select * into target from public.markers where id=p_marker_id and type <> 'ruins' for update;
    if not found or target.owner is null or target.owner=profile.owner then raise exception 'The target must be a settlement controlled by another state' using errcode='22023'; end if;
    select * into province from public."Provinces" where id=target.province_id;
    v_level := greatest(target.fortification_level, case when target.type='fortress' then 1 else 0 end);
    if v_level < 1 then raise exception 'Only a fortress or fortified settlement can be besieged' using errcode='22023'; end if;
    v_x := floor(target.coord_1::numeric/24)::integer;
    v_y := floor(target.coord_2::numeric/24)::integer;
    if greatest(abs(force.cell_x-v_x),abs(force.cell_y-v_y)) <> 1 then raise exception 'The army must occupy a neighboring cell' using errcode='22023'; end if;
    if force.action_points < 20 then raise exception 'Beginning a siege costs 20 action points' using errcode='22023'; end if;
    select * into cal from public.game_calendar where singleton=true;
    select * into siege from public.military_sieges where marker_id=target.id and status in ('active','battle_pending') for update;
    if found then
        if siege.attacker_owner is distinct from profile.owner or siege.status <> 'active' then raise exception 'This settlement is already under siege' using errcode='23505'; end if;
        if p_force_id=any(siege.attacker_force_ids) then raise exception 'This army already participates in the siege' using errcode='23505'; end if;
        update public.military_sieges set attacker_force_ids=array_append(attacker_force_ids,p_force_id),updated_at=now() where id=siege.id returning * into siege;
    else
        insert into public.military_sieges(marker_id,attacker_owner,defender_owner,fortification_level,attacker_force_ids,attacker_orders_turn,defender_orders_turn,last_resolved_turn)
        values(target.id,profile.owner,target.owner,v_level,array[p_force_id],cal.turn-1,cal.turn-1,cal.turn-1) returning * into siege;
    end if;
    update public.military_forces set action_points=action_points-20,updated_at=now() where id=force.id;
    return jsonb_build_object('id',siege.id,'marker_id',siege.marker_id,'status',siege.status,'works',siege.works,'fortification_level',siege.fortification_level,'spent_action_points',20,'province_id',province.id);
end;
$function$;

create or replace function public.set_military_siege_order(p_siege_id uuid,p_action text,p_force_id uuid default null,p_work_method text default 'bombardment',p_assault_route text default 'ladders')
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
    profile public.profiles%rowtype;
    siege public.military_sieges%rowtype;
    force public.military_forces%rowtype;
    cal public.game_calendar%rowtype;
    ap_cost integer := 0;
    breach_threshold integer;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role not in ('player','admin') then raise exception 'Authentication required' using errcode='42501'; end if;
    select * into siege from public.military_sieges where id=p_siege_id and status='active' for update;
    if not found then raise exception 'Active siege not found' using errcode='22023'; end if;
    select * into cal from public.game_calendar where singleton=true;
    if p_action in ('blockade','works','assault','lift') then
        if profile.role <> 'admin' and profile.owner is distinct from siege.attacker_owner then raise exception 'Only the besieging state may issue this order' using errcode='42501'; end if;
        if siege.attacker_orders_turn >= cal.turn then raise exception 'Your order for this season has already been submitted' using errcode='55000'; end if;
        if p_action in ('works','assault') then
            select * into force from public.military_forces where id=p_force_id and p_force_id=any(siege.attacker_force_ids) and owner=siege.attacker_owner and force_kind='land_army' and status='active' for update;
            if not found then raise exception 'Choose an active army participating in this siege' using errcode='22023'; end if;
            ap_cost := case p_action when 'works' then 30 else 50 end;
            if force.action_points < ap_cost then raise exception 'This order costs % action points',ap_cost using errcode='22023'; end if;
            update public.military_forces set action_points=action_points-ap_cost,updated_at=now() where id=force.id;
        end if;
        if p_work_method not in ('bombardment','sapping') then raise exception 'Invalid siege work method' using errcode='22023'; end if;
        if p_assault_route not in ('ladders','tower','breach','ram') then raise exception 'Invalid assault route' using errcode='22023'; end if;
        breach_threshold := case siege.fortification_level when 1 then 40 when 2 then 70 else 100 end;
        if p_action='assault' and p_assault_route='breach' and siege.works < breach_threshold then
            raise exception 'A breach requires enough siege work to open the wall' using errcode='22023';
        end if;
        if p_action='assault' and p_assault_route in ('tower','ram') then
            if p_assault_route='tower' and coalesce((force.siege_equipment->>'Осадная башня')::integer,0)<1 then raise exception 'An assembled siege tower is required' using errcode='22023'; end if;
            if p_assault_route='ram' and coalesce((force.siege_equipment->>'Таран')::integer,0)<1 then raise exception 'An assembled battering ram is required' using errcode='22023'; end if;
        end if;
        update public.military_sieges set attacker_order=p_action,work_method=p_work_method,assault_route=p_assault_route,attacker_orders_turn=cal.turn,updated_at=now() where id=siege.id;
    elsif p_action in ('defend','repair','sortie','surrender') then
        if profile.role <> 'admin' and profile.owner is distinct from siege.defender_owner then raise exception 'Only the settlement owner may issue this order' using errcode='42501'; end if;
        if siege.defender_orders_turn >= cal.turn then raise exception 'Your order for this season has already been submitted' using errcode='55000'; end if;
        update public.military_sieges set defender_order=p_action,defender_orders_turn=cal.turn,updated_at=now() where id=siege.id;
    else raise exception 'Unknown siege order' using errcode='22023'; end if;
    return jsonb_build_object('id',siege.id,'submitted',true,'turn',cal.turn,'spent_action_points',ap_cost);
end;
$function$;

create or replace function public.get_military_sieges()
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
    profile public.profiles%rowtype;
    result jsonb;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role not in ('player','admin') then raise exception 'Authentication required' using errcode='42501'; end if;
    select coalesce(jsonb_agg(jsonb_build_object(
        'id',siege.id,'marker_id',siege.marker_id,'marker_name',marker.name,'attacker_owner',siege.attacker_owner,'defender_owner',siege.defender_owner,
        'fortification_level',siege.fortification_level,'works',siege.works,'status',siege.status,
        'attacker_force_ids',case when profile.role='admin' or profile.owner=siege.attacker_owner then to_jsonb(siege.attacker_force_ids) else '[]'::jsonb end,
        'attacker_order',case when profile.role='admin' or profile.owner=siege.attacker_owner then siege.attacker_order else null end,
        'defender_order',case when profile.role='admin' or profile.owner=siege.defender_owner then siege.defender_order else null end,
        'work_method',case when profile.role='admin' or profile.owner=siege.attacker_owner then siege.work_method else null end,
        'assault_route',case when profile.role='admin' or profile.owner=siege.attacker_owner then siege.assault_route else null end,
        'battle_id',siege.battle_id,'orders_turn',greatest(siege.attacker_orders_turn,siege.defender_orders_turn),
        'attacker_orders_turn',siege.attacker_orders_turn,'defender_orders_turn',siege.defender_orders_turn,'last_resolved_turn',siege.last_resolved_turn
    ) order by siege.updated_at desc),'[]'::jsonb) into result
      from public.military_sieges siege join public.markers marker on marker.id=siege.marker_id
     where profile.role='admin' or profile.owner in (siege.attacker_owner,siege.defender_owner);
    return result;
end;
$function$;

create or replace function public.resolve_military_sieges_on_turn()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
    siege public.military_sieges%rowtype;
    target public.markers%rowtype;
    primary_force public.military_forces%rowtype;
    participant public.military_forces%rowtype;
    participant_id uuid;
    battle_id uuid;
    terrain_name text;
    target_x integer;
    target_y integer;
    gain numeric;
    work_modifier numeric;
    rank integer;
    unit_count integer;
    equipment_count integer;
    fully_supplied boolean;
    units_json jsonb;
    attacker_count integer;
    defender_count integer;
    stock_wood numeric;
    stock_tools numeric;
    next_progress integer;
    weakened_threshold integer;
    breach_threshold integer;
begin
    if new.turn<=old.turn then return new; end if;
    for siege in select * from public.military_sieges where status='active' and last_resolved_turn<old.turn loop
        select * into target from public.markers where id=siege.marker_id for update;
        if not found then update public.military_sieges set status='lifted',last_resolved_turn=old.turn where id=siege.id; continue; end if;
        target_x:=floor(target.coord_1::numeric/24)::integer;
        target_y:=floor(target.coord_2::numeric/24)::integer;
        update public.military_sieges set last_resolved_turn=old.turn where id=siege.id;
        if siege.attacker_order='lift' then update public.military_sieges set status='lifted' where id=siege.id; continue; end if;
        if siege.defender_order='surrender' then
            select * into primary_force from public.military_forces where id=any(siege.attacker_force_ids) and status='active' and force_kind='land_army' order by id limit 1 for update;
            if found then update public.military_forces set cell_x=target_x,cell_y=target_y,province_id=target.province_id,updated_at=now() where id=primary_force.id; end if;
            update public.markers set military_controlled_by=siege.attacker_owner where id=siege.marker_id;
            update public.military_sieges set status='captured' where id=siege.id;
            continue;
        end if;
        if siege.defender_order='repair' then
            select coalesce((select quantity from public.marker_inventories where marker_id=target.id and item_type='resource' and item_name='Древесина'),0),
                   coalesce((select quantity from public.marker_inventories where marker_id=target.id and item_type='good' and item_name='Инструменты'),0)
              into stock_wood,stock_tools;
            if stock_wood>=2 and stock_tools>=1 then
                update public.marker_inventories set quantity=quantity-2 where marker_id=target.id and item_type='resource' and item_name='Древесина';
                update public.marker_inventories set quantity=quantity-1 where marker_id=target.id and item_type='good' and item_name='Инструменты';
                next_progress:=greatest(0,siege.works-20);
                weakened_threshold:=case siege.fortification_level when 1 then 20 when 2 then 35 else 50 end;
                breach_threshold:=case siege.fortification_level when 1 then 40 when 2 then 70 else 100 end;
                if siege.works>=weakened_threshold and next_progress<weakened_threshold then
                    next_progress:=least(next_progress,weakened_threshold-1);
                elsif siege.works>=breach_threshold and next_progress<breach_threshold then
                    next_progress:=least(next_progress,breach_threshold-1);
                end if;
                update public.military_sieges set works=next_progress where id=siege.id;
            end if;
        end if;
        if siege.attacker_order='works' then
            select coalesce(bool_and(force.maintenance_coverage>=1),false) into fully_supplied
              from public.military_forces force where force.id=any(siege.attacker_force_ids) and force.owner=siege.attacker_owner
                and force.status='active' and force.force_kind='land_army';
            if fully_supplied then
                select greatest(0,least(5,coalesce(max((force.commander_skills->>'engineering')::integer),0))),
                       coalesce(sum(case item.key when 'Малая пушка / пищаль' then 8 when 'Требюше' then 12 when 'Бомбарда' then 16 else 0 end*greatest(0,item.value::integer)),0),
                       coalesce(sum(case item.key when 'Малая пушка / пищаль' then 4 when 'Требюше' then 20 when 'Бомбарда' then 30 else 0 end*greatest(0,item.value::integer)),0)
                  into rank,gain,equipment_count
                  from public.military_forces force
                  left join lateral jsonb_each_text(force.siege_equipment) item on true
                 where force.id=any(siege.attacker_force_ids) and force.owner=siege.attacker_owner and force.status='active' and force.force_kind='land_army';
                select coalesce(sum(greatest(0,(group_row.value->>'count')::integer)),0) into unit_count
                  from public.military_forces force cross join lateral jsonb_array_elements(force.unit_groups) group_row(value)
                 where force.id=any(siege.attacker_force_ids) and force.owner=siege.attacker_owner and force.status='active' and force.force_kind='land_army'
                   and group_row.value->>'type' in ('Пешие ратники','Копейщики','Лучники','Арбалетчики','Лыжники-разведчики');
                if siege.work_method='sapping' then
                    if rank>=2 and unit_count>=20 and exists(select 1 from public.military_grid_cells grid left join public.military_terrain_cells override on override.cell_x=grid.cell_x and override.cell_y=grid.cell_y
                        where grid.cell_x=target_x and grid.cell_y=target_y and coalesce(override.terrain,grid.base_terrain) in ('plain','hill')) then gain:=10; else gain:=0; end if;
                elsif equipment_count=0 or unit_count<equipment_count then gain:=0; end if;
                gain:=least(30,gain*(1+0.1*rank));
                select coalesce(sum(m.value),0) into work_modifier from public.state_modifiers m
                 where m.owner=siege.attacker_owner and m.effect_key='siege_work_gain_pct' and m.status='active'
                   and m.starts_turn<=new.turn and (m.ends_turn is null or m.ends_turn>=new.turn)
                   and (m.scope_type='state' or (m.scope_type='army' and m.scope_value in (select unnest(siege.attacker_force_ids)::text)));
                gain:=least(30,gain*greatest(0,1+coalesce(work_modifier,0)/100));
                update public.military_sieges set works=least(100,works+floor(gain)::integer) where id=siege.id;
            end if;
        end if;
        if siege.attacker_order='assault' or siege.defender_order='sortie' then
            target_x:=floor(target.coord_1::numeric/24)::integer; target_y:=floor(target.coord_2::numeric/24)::integer;
            select coalesce(override.terrain,grid.base_terrain,'plain') into terrain_name from public.military_grid_cells grid
              left join public.military_terrain_cells override on override.cell_x=grid.cell_x and override.cell_y=grid.cell_y
             where grid.cell_x=target_x and grid.cell_y=target_y;
            terrain_name:=case when terrain_name='water' then 'plain' else coalesce(terrain_name,'plain') end;
            select count(*) into attacker_count from public.military_forces where id=any(siege.attacker_force_ids) and status='active' and force_kind='land_army';
            select count(*) into defender_count from public.military_forces where marker_id=target.id and status='active' and force_kind='garrison';
            if attacker_count=0 then update public.military_sieges set status='lifted' where id=siege.id; continue; end if;
            if defender_count=0 then
                select * into primary_force from public.military_forces where id=any(siege.attacker_force_ids) and status='active' and force_kind='land_army' order by id limit 1 for update;
                if found then update public.military_forces set cell_x=target_x,cell_y=target_y,province_id=target.province_id,updated_at=now() where id=primary_force.id; end if;
                update public.markers set military_controlled_by=siege.attacker_owner where id=target.id;
                update public.military_sieges set status='captured' where id=siege.id; continue;
            end if;
            insert into public.military_battles(battle_type,terrain,participant_owners,location,created_by)
            values('land',terrain_name,array[siege.attacker_owner,siege.defender_owner],jsonb_build_object(
                'source','siege','siege_action',case when siege.defender_order='sortie' then 'sortie' else 'assault' end,
                'siege_id',siege.id,'marker_id',target.id,'cell_x',target_x,'cell_y',target_y,'province_id',target.province_id,
                'siege',case when siege.defender_order<>'sortie' and siege.attacker_order='assault'
                    then jsonb_build_object('level',siege.fortification_level,'works',coalesce((select works from public.military_sieges where id=siege.id),siege.works),'route',siege.assault_route) else null end
            ),(select auth.uid())) returning id into battle_id;
            for participant in select * from public.military_forces where id=any(siege.attacker_force_ids) and status='active' and force_kind='land_army' loop
                units_json:=coalesce((select jsonb_agg(jsonb_build_object('type',g->>'type','count',(g->>'count')::integer)) from jsonb_array_elements(participant.unit_groups) g),'[]'::jsonb);
                insert into public.military_battle_armies(battle_id,owner,side,name,unit_data,morale,order_name,tactic,decision)
                values(battle_id,participant.owner,'attacker',participant.name,jsonb_build_object('units',units_json,'skills',participant.commander_skills,'persistent_force_id',participant.id),participant.morale,participant.order_name,participant.tactic,'pending');
            end loop;
            for participant in select * from public.military_forces where marker_id=target.id and status='active' and force_kind='garrison' loop
                units_json:=coalesce((select jsonb_agg(jsonb_build_object('type',g->>'type','count',(g->>'count')::integer)) from jsonb_array_elements(participant.unit_groups) g),'[]'::jsonb);
                insert into public.military_battle_armies(battle_id,owner,side,name,unit_data,morale,order_name,tactic,decision)
                values(battle_id,participant.owner,'defender',participant.name,jsonb_build_object('units',units_json,'skills','{}'::jsonb),participant.morale,'осторожный','none','pending') returning id into participant_id;
                update public.military_battle_armies set persistent_force_id=participant.id where id=participant_id;
            end loop;
            update public.military_sieges set status='battle_pending',battle_id=battle_id where id=siege.id;
        end if;
        update public.military_sieges set attacker_order='blockade',defender_order='defend' where id=siege.id and status='active';
    end loop;
    return new;
end;
$function$;
revoke all on function public.resolve_military_sieges_on_turn() from public,anon,authenticated;
drop trigger if exists resolve_military_sieges_on_turn on public.game_calendar;
create trigger resolve_military_sieges_on_turn after update of turn on public.game_calendar for each row execute function public.resolve_military_sieges_on_turn();

create or replace function public.resolve_military_siege_battle()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
    battle_location jsonb;
    siege_id uuid;
    siege public.military_sieges%rowtype;
begin
    if tg_op='UPDATE' and old.report is not distinct from new.report then return new; end if;
    select battle.location into battle_location from public.military_battles battle where battle.id=new.battle_id;
    if battle_location->>'source' is distinct from 'siege' then return new; end if;
    siege_id:=(battle_location->>'siege_id')::uuid;
    select * into siege from public.military_sieges where id=siege_id for update;
    if not found then return new; end if;
    if battle_location->>'siege_action'='sortie' then
        if new.report->>'outcome'='defender' then
            update public.military_sieges set status='lifted',battle_id=null where id=siege.id;
        else
            update public.military_sieges set status='active',battle_id=null,attacker_order='blockade',defender_order='defend' where id=siege.id;
        end if;
    elsif new.report->>'outcome'='attacker' or coalesce((new.report->>'noBattle')::boolean,false) then
        if coalesce((new.report->>'noBattle')::boolean,false) then
            update public.military_forces as force
               set cell_x=floor(marker.coord_1::numeric/24)::integer,cell_y=floor(marker.coord_2::numeric/24)::integer,province_id=marker.province_id,updated_at=now()
              from public.markers marker
             where marker.id=siege.marker_id and force.id=any(siege.attacker_force_ids)
               and force.status='active' and force.force_kind='land_army'
               and not exists(select 1 from public.military_forces occupying where occupying.status='active' and occupying.force_kind='land_army'
                 and occupying.cell_x=floor(marker.coord_1::numeric/24)::integer and occupying.cell_y=floor(marker.coord_2::numeric/24)::integer);
        end if;
        update public.markers set military_controlled_by=siege.attacker_owner where id=siege.marker_id;
        update public.military_sieges set status='captured',battle_id=null where id=siege.id;
    else
        update public.military_sieges set status='active',battle_id=null,attacker_order='blockade',defender_order='defend' where id=siege.id;
    end if;
    return new;
end;
$function$;
revoke all on function public.resolve_military_siege_battle() from public,anon,authenticated;
drop trigger if exists military_siege_battle_resolution on public.military_battle_admin_results;
create trigger military_siege_battle_resolution after insert or update on public.military_battle_admin_results for each row execute function public.resolve_military_siege_battle();

create or replace function public.clear_settlement_military_control()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
    marker_row record;
begin
    if old.force_kind='garrison' and old.marker_id is not null then
        update public.markers marker set military_controlled_by=null
         where marker.id=old.marker_id and marker.military_controlled_by=old.owner
           and not exists(select 1 from public.military_forces force where force.id<>old.id and force.status='active' and force.owner=old.owner and force.force_kind='garrison' and force.marker_id=old.marker_id)
           and not exists(select 1 from public.military_forces force where force.id<>old.id and force.status='active' and force.owner=old.owner and force.force_kind='land_army'
              and force.cell_x=floor(marker.coord_1::numeric/24)::integer and force.cell_y=floor(marker.coord_2::numeric/24)::integer);
    elsif old.force_kind='land_army' and (new.cell_x is distinct from old.cell_x or new.cell_y is distinct from old.cell_y or new.status<>'active') then
        for marker_row in select marker.id from public.markers marker where marker.military_controlled_by=old.owner
           and greatest(abs(old.cell_x-floor(marker.coord_1::numeric/24)::integer),abs(old.cell_y-floor(marker.coord_2::numeric/24)::integer))=0 loop
            update public.markers marker set military_controlled_by=null where marker.id=marker_row.id
             and not exists(select 1 from public.military_forces force where force.id<>old.id and force.status='active' and force.owner=old.owner
               and ((force.force_kind='garrison' and force.marker_id=marker.id) or (force.force_kind='land_army' and force.cell_x=floor(marker.coord_1::numeric/24)::integer and force.cell_y=floor(marker.coord_2::numeric/24)::integer)));
        end loop;
    end if;
    return new;
end;
$function$;
revoke all on function public.clear_settlement_military_control() from public,anon,authenticated;
drop trigger if exists clear_settlement_military_control on public.military_forces;
create trigger clear_settlement_military_control after update of cell_x,cell_y,force_kind,marker_id,status on public.military_forces for each row execute function public.clear_settlement_military_control();

create or replace function public.guard_military_settlement_entry()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
    target public.markers%rowtype;
    siege_battle boolean;
begin
    if old.force_kind<>'land_army' or new.force_kind<>'land_army' or new.status<>'active'
       or (new.cell_x=old.cell_x and new.cell_y=old.cell_y) then return new; end if;
    for target in select * from public.markers marker where marker.type<>'ruins'
        and floor(marker.coord_1::numeric/24)::integer=new.cell_x and floor(marker.coord_2::numeric/24)::integer=new.cell_y loop
        if target.owner is null or target.owner=new.owner then continue; end if;
        select exists(select 1 from public.military_sieges siege where siege.marker_id=target.id and siege.status='battle_pending'
            and siege.attacker_owner=new.owner) into siege_battle;
        if not siege_battle then
            select exists(select 1 from public.military_sieges siege where siege.marker_id=target.id and siege.status='active'
                and siege.attacker_owner=new.owner and new.id=any(siege.attacker_force_ids)
                and (siege.defender_order='surrender' or not exists(select 1 from public.military_forces garrison where garrison.marker_id=target.id
                    and garrison.force_kind='garrison' and garrison.status='active'
                    and exists(select 1 from jsonb_array_elements(garrison.unit_groups) group_row(value) where coalesce((group_row.value->>'count')::integer,0)>0)))) into siege_battle;
        end if;
        if siege_battle then continue; end if;
        if target.type='fortress' or target.fortification_level>0 then
            raise exception 'Fortified settlements must be taken through a siege' using errcode='55000';
        end if;
        if exists(select 1 from public.military_forces garrison where garrison.marker_id=target.id and garrison.force_kind='garrison' and garrison.status='active'
            and exists(select 1 from jsonb_array_elements(garrison.unit_groups) group_row(value) where coalesce((group_row.value->>'count')::integer,0)>0)) then
            raise exception 'A defended settlement must be attacked before entering' using errcode='55000';
        end if;
    end loop;
    return new;
end;
$function$;
revoke all on function public.guard_military_settlement_entry() from public,anon,authenticated;
drop trigger if exists guard_military_settlement_entry on public.military_forces;
create trigger guard_military_settlement_entry before update of cell_x,cell_y on public.military_forces for each row execute function public.guard_military_settlement_entry();

create or replace function public.sync_military_settlement_occupation()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
    target public.markers%rowtype;
    siege public.military_sieges%rowtype;
begin
    if old.force_kind='land_army' and new.force_kind='land_army' and new.status='active'
       and (new.cell_x is distinct from old.cell_x or new.cell_y is distinct from old.cell_y) then
        for target in select * from public.markers marker where marker.type<>'ruins'
            and floor(marker.coord_1::numeric/24)::integer=new.cell_x and floor(marker.coord_2::numeric/24)::integer=new.cell_y
            and marker.owner is not null and marker.owner<>new.owner loop
            update public.markers set military_controlled_by=new.owner where id=target.id;
        end loop;
    end if;
    if old.force_kind='land_army' and old.status='active' and (new.cell_x is distinct from old.cell_x or new.cell_y is distinct from old.cell_y or new.status<>'active') then
        for siege in select * from public.military_sieges active_siege where active_siege.status='active' and old.id=any(active_siege.attacker_force_ids) loop
            if greatest(abs(coalesce(new.cell_x,old.cell_x)-floor((select marker.coord_1 from public.markers marker where marker.id=siege.marker_id)::numeric/24)::integer),
                        abs(coalesce(new.cell_y,old.cell_y)-floor((select marker.coord_2 from public.markers marker where marker.id=siege.marker_id)::numeric/24)::integer))<>1
               or new.status<>'active' then
                update public.military_sieges set attacker_force_ids=array_remove(attacker_force_ids,old.id),updated_at=now() where id=siege.id;
                if cardinality(array_remove(siege.attacker_force_ids,old.id))=0 then update public.military_sieges set status='lifted' where id=siege.id; end if;
            end if;
        end loop;
    end if;
    return new;
end;
$function$;
revoke all on function public.sync_military_settlement_occupation() from public,anon,authenticated;
drop trigger if exists sync_military_settlement_occupation on public.military_forces;
create trigger sync_military_settlement_occupation after update of cell_x,cell_y,force_kind,status on public.military_forces for each row execute function public.sync_military_settlement_occupation();

revoke all on function public.start_military_siege(uuid,bigint) from public,anon;
revoke all on function public.set_military_siege_order(uuid,text,uuid,text,text) from public,anon;
revoke all on function public.get_military_sieges() from public,anon;
grant execute on function public.start_military_siege(uuid,bigint) to authenticated;
grant execute on function public.set_military_siege_order(uuid,text,uuid,text,text) to authenticated;
grant execute on function public.get_military_sieges() to authenticated;
