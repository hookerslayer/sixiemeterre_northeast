-- Owner-controlled conditional orders, evaluated after ordinary orders and AP refresh.
create table if not exists public.military_conditional_orders (
    force_id uuid primary key references public.military_forces(id) on delete cascade,
    owner text not null references public.state_mechanics(owner) on delete cascade,
    condition_x integer not null,
    condition_y integer not null,
    action text not null check (action in ('retreat','move','attack','join')),
    route jsonb not null default '[]'::jsonb check (jsonb_typeof(route)='array'),
    target_force_id uuid references public.military_forces(id) on delete set null,
    reserved_ap integer not null check (reserved_ap between 1 and 100),
    processed_turn integer,
    last_result text,
    updated_at timestamptz not null default now(),
    check ((action in ('attack','join')) = (target_force_id is not null))
);
alter table public.military_conditional_orders enable row level security;
drop policy if exists "Players read their conditional orders" on public.military_conditional_orders;
create policy "Players read their conditional orders" on public.military_conditional_orders for select to authenticated
using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and (p.role='admin' or p.owner=owner)));
revoke all on public.military_conditional_orders from anon,authenticated;
grant select on public.military_conditional_orders to authenticated;

create or replace function public.set_military_conditional_order(
    p_force_id uuid,p_condition_x integer,p_condition_y integer,p_action text,p_route jsonb,p_target_force_id uuid,p_reserved_ap integer
) returns jsonb language plpgsql security definer set search_path='' as $function$
declare profile public.profiles%rowtype; force public.military_forces%rowtype; target public.military_forces%rowtype;
    old_order public.military_conditional_orders%rowtype; old_reserved integer:=0; current_turn integer;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role<>'player' then raise exception 'Only a state player can set conditional orders' using errcode='42501'; end if;
    select * into force from public.military_forces where id=p_force_id and force_kind='land_army' and status='active' for update;
    if not found or force.owner is distinct from profile.owner then raise exception 'Choose your active field army' using errcode='42501'; end if;
    if force.is_militia or force.is_mercenary or force.cell_x is null or force.cell_y is null then raise exception 'This army cannot receive a conditional order'; end if;
    if exists(select 1 from public.military_battle_armies a join public.military_battles b on b.id=a.battle_id where a.persistent_force_id=force.id and b.status='pending') then raise exception 'An army in an unresolved battle cannot receive an order'; end if;
    if p_condition_x not between 0 and 10000 or p_condition_y not between 0 and 10000
       or not exists(select 1 from public.military_grid_cells where cell_x=p_condition_x and cell_y=p_condition_y)
       or p_action not in ('retreat','move','attack','join') or p_reserved_ap not between 1 and 100
       or jsonb_typeof(p_route) is distinct from 'array' then raise exception 'Invalid conditional order'; end if;
    if p_action in ('attack','join') then
        select * into target from public.military_forces where id=p_target_force_id and force_kind='land_army' and status='active';
        if not found or target.id=force.id then raise exception 'Choose a valid target army'; end if;
        if p_action='join' and target.owner is distinct from force.owner then raise exception 'Only allied armies can be joined'; end if;
        if p_action='attack' and target.owner=force.owner then raise exception 'Choose an enemy army to attack'; end if;
    elsif p_target_force_id is not null then raise exception 'This action does not accept a target army'; end if;
    if p_action in ('retreat','move','join') then
        if jsonb_array_length(p_route)<2 or jsonb_array_length(p_route)>101
           or (p_route->0->>'x')::integer<>force.cell_x or (p_route->0->>'y')::integer<>force.cell_y then raise exception 'The route must start at the army current position'; end if;
        if p_action='join' and ((p_route->(jsonb_array_length(p_route)-1)->>'x')::integer<>target.cell_x or (p_route->(jsonb_array_length(p_route)-1)->>'y')::integer<>target.cell_y) then raise exception 'The route must end at the allied army'; end if;
    elsif jsonb_array_length(p_route)<>0 then raise exception 'An attack order does not use a route'; end if;
    select * into old_order from public.military_conditional_orders where force_id=force.id for update;
    if found then old_reserved:=old_order.reserved_ap; end if;
    if force.action_points+old_reserved<p_reserved_ap then raise exception 'Not enough action points to reserve this order'; end if;
    update public.military_forces set action_points=least(100,action_points+old_reserved-p_reserved_ap),updated_at=now() where id=force.id;
    select turn into current_turn from public.game_calendar where singleton=true;
    insert into public.military_conditional_orders(force_id,owner,condition_x,condition_y,action,route,target_force_id,reserved_ap,processed_turn,last_result,updated_at)
    values(force.id,force.owner,p_condition_x,p_condition_y,p_action,p_route,p_target_force_id,p_reserved_ap,current_turn,null,now())
    on conflict(force_id) do update set owner=excluded.owner,condition_x=excluded.condition_x,condition_y=excluded.condition_y,
        action=excluded.action,route=excluded.route,target_force_id=excluded.target_force_id,reserved_ap=excluded.reserved_ap,
        processed_turn=excluded.processed_turn,last_result=null,updated_at=now();
    return jsonb_build_object('force_id',force.id,'reserved_ap',p_reserved_ap,'action',p_action);
end;$function$;

create or replace function public.cancel_military_conditional_order(p_force_id uuid)
returns integer language plpgsql security definer set search_path='' as $function$
declare profile public.profiles%rowtype; order_row public.military_conditional_orders%rowtype;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    select * into order_row from public.military_conditional_orders where force_id=p_force_id for update;
    if not found then return 0; end if;
    if profile.id is null or profile.role not in ('admin','player') then raise exception 'Authentication required' using errcode='42501'; end if;
    if profile.role<>'admin' and (profile.role<>'player' or profile.owner is distinct from order_row.owner) then raise exception 'You cannot cancel this order' using errcode='42501'; end if;
    update public.military_forces set action_points=least(100,action_points+order_row.reserved_ap),updated_at=now() where id=order_row.force_id;
    delete from public.military_conditional_orders where force_id=order_row.force_id;
    return order_row.reserved_ap;
end;$function$;

create or replace function public.military_conditional_order_condition(p_force_id uuid,p_cell_x integer,p_cell_y integer)
returns boolean language plpgsql security definer set search_path='' as $function$
declare owner_name text; enemy_found boolean;
begin
    select owner into owner_name from public.military_forces where id=p_force_id and status='active';
    if owner_name is null then return false; end if;
    select exists(select 1 from public.military_forces e where e.force_kind='land_army' and e.status='active'
        and e.owner is distinct from owner_name and e.cell_x=p_cell_x and e.cell_y=p_cell_y) into enemy_found;
    if not enemy_found then return false; end if;
    return exists(select 1 from public.military_grid_cells g left join public.military_terrain_cells t using(cell_x,cell_y)
        join public."Provinces" p on p.id=coalesce(t.province_id,g.province_id)
        where g.cell_x=p_cell_x and g.cell_y=p_cell_y and (p.owner=owner_name or p.occupied_by=owner_name))
      or exists(select 1 from public.military_forces observer where observer.owner=owner_name and observer.force_kind='land_army'
        and observer.status='active' and greatest(abs(observer.cell_x-p_cell_x),abs(observer.cell_y-p_cell_y))<=2
        and (coalesce((select t.terrain from public.military_terrain_cells t where t.cell_x=p_cell_x and t.cell_y=p_cell_y),
                      (select g.base_terrain from public.military_grid_cells g where g.cell_x=p_cell_x and g.cell_y=p_cell_y))<>'forest'
             or greatest(abs(observer.cell_x-p_cell_x),abs(observer.cell_y-p_cell_y))<=1));
end;$function$;

create or replace function public.process_military_conditional_orders()
returns trigger language plpgsql security definer set search_path='' as $function$
declare order_row record; snapshot jsonb; turn_no integer;
begin
    if new.turn<=old.turn then return new; end if;
    turn_no:=new.turn;
    -- Retreat orders resolve first. Remaining movement/join orders form the second phase;
    -- attacks are checked last against the updated positions and visibility.
    select coalesce(jsonb_agg(jsonb_build_object('force_id',o.force_id,'met',public.military_conditional_order_condition(o.force_id,o.condition_x,o.condition_y)) order by o.updated_at),'[]'::jsonb)
      into snapshot from public.military_conditional_orders o where o.action='retreat' and o.processed_turn is distinct from turn_no;
    for order_row in select value from jsonb_array_elements(snapshot) loop
        perform public.resolve_one_military_conditional_order((order_row.value->>'force_id')::uuid,turn_no,(order_row.value->>'met')::boolean);
    end loop;
    select coalesce(jsonb_agg(jsonb_build_object('force_id',o.force_id,'met',public.military_conditional_order_condition(o.force_id,o.condition_x,o.condition_y)) order by o.updated_at),'[]'::jsonb)
      into snapshot from public.military_conditional_orders o where o.action in ('move','join') and o.processed_turn is distinct from turn_no;
    for order_row in select value from jsonb_array_elements(snapshot) loop
        perform public.resolve_one_military_conditional_order((order_row.value->>'force_id')::uuid,turn_no,(order_row.value->>'met')::boolean);
    end loop;
    select coalesce(jsonb_agg(jsonb_build_object('force_id',o.force_id,'met',public.military_conditional_order_condition(o.force_id,o.condition_x,o.condition_y)) order by o.updated_at),'[]'::jsonb)
      into snapshot from public.military_conditional_orders o where o.action='attack' and o.processed_turn is distinct from turn_no;
    for order_row in select value from jsonb_array_elements(snapshot) loop
        perform public.resolve_one_military_conditional_order((order_row.value->>'force_id')::uuid,turn_no,(order_row.value->>'met')::boolean);
    end loop;
    return new;
end;$function$;

drop function if exists public.resolve_one_military_conditional_order(uuid,integer);
create or replace function public.resolve_one_military_conditional_order(p_force_id uuid,p_turn integer,p_condition_met boolean)
returns void language plpgsql security definer set search_path='' as $function$
declare ord public.military_conditional_orders%rowtype; force public.military_forces%rowtype; target public.military_forces%rowtype;
    visible boolean; current_ap integer; terrain_name text; province_id bigint; battle_id uuid;
begin
    select * into ord from public.military_conditional_orders where force_id=p_force_id and processed_turn is distinct from p_turn for update;
    if not found then return; end if;
    select * into force from public.military_forces where id=ord.force_id and force_kind='land_army' and status='active' for update;
    if not found or force.cell_x is null or force.cell_y is null or exists(select 1 from public.military_battle_armies a join public.military_battles b on b.id=a.battle_id where a.persistent_force_id=force.id and b.status='pending') then
        update public.military_forces set action_points=greatest(0,100-ord.reserved_ap),updated_at=now() where id=p_force_id and status='active';
        update public.military_conditional_orders set processed_turn=p_turn,last_result='Отложен: армия недоступна; резерв сохранён',updated_at=now() where force_id=p_force_id; return;
    end if;
    visible:=coalesce(p_condition_met,false);
    if not visible then
        update public.military_forces set action_points=greatest(0,100-ord.reserved_ap),updated_at=now() where id=force.id;
        update public.military_conditional_orders set processed_turn=p_turn,last_result='Условие не сработало; резерв сохранён на следующий ход',updated_at=now() where force_id=force.id; return;
    end if;
    update public.military_forces set action_points=ord.reserved_ap where id=force.id;
    begin
        if ord.action in ('retreat','move') then
            perform public.move_military_force(force.id,ord.route);
        elsif ord.action='join' then
            select * into target from public.military_forces where id=ord.target_force_id and status='active' and owner=force.owner for update;
            if not found then raise exception 'Allied army is unavailable'; end if;
            perform public.transfer_military_troops(force.id,target.id,force.unit_groups,ord.route,true);
        else
            select * into target from public.military_forces where id=ord.target_force_id and status='active' and force_kind='land_army' for update;
            if not found or target.owner=force.owner or target.cell_x<>ord.condition_x or target.cell_y<>ord.condition_y
               or greatest(abs(force.cell_x-target.cell_x),abs(force.cell_y-target.cell_y))<>1 or ord.reserved_ap<10 then raise exception 'Attack target is no longer adjacent'; end if;
            if not exists(select 1 from public.military_forces observer where observer.owner=force.owner and observer.force_kind='land_army' and observer.status='active' and greatest(abs(observer.cell_x-target.cell_x),abs(observer.cell_y-target.cell_y))<=2) then raise exception 'Attack target is no longer visible'; end if;
            select coalesce(t.terrain,g.base_terrain),coalesce(t.province_id,g.province_id) into terrain_name,province_id from public.military_grid_cells g left join public.military_terrain_cells t using(cell_x,cell_y) where g.cell_x=target.cell_x and g.cell_y=target.cell_y;
            insert into public.military_battles(battle_type,terrain,participant_owners,location,created_by)
            values('land',case when terrain_name in ('plain','hill','forest','marsh','bridge') then terrain_name else 'plain' end,array[force.owner,target.owner],jsonb_build_object('cell_x',target.cell_x,'cell_y',target.cell_y,'province_id',province_id,'attacker_force_id',force.id),(select auth.uid())) returning id into battle_id;
            insert into public.military_battle_armies(battle_id,owner,side,name,unit_data,morale,order_name,tactic,decision)
            values (battle_id,force.owner,'attacker',force.name,jsonb_build_object('units',force.unit_groups,'skills',force.commander_skills,'persistent_force_id',force.id,'conditions',jsonb_build_object('terrain',terrain_name)),force.morale,force.order_name,force.tactic,'fight'),
                   (battle_id,target.owner,'defender',target.name,jsonb_build_object('units',target.unit_groups,'skills',target.commander_skills,'persistent_force_id',target.id,'conditions',jsonb_build_object('terrain',terrain_name)),target.morale,target.order_name,target.tactic,'pending');
            update public.military_forces set action_points=action_points-10,updated_at=now() where id=force.id;
        end if;
        select action_points into current_ap from public.military_forces where id=force.id and status='active';
        if found then update public.military_forces set action_points=least(100,greatest(0,current_ap+100-ord.reserved_ap)),updated_at=now() where id=force.id; end if;
        delete from public.military_conditional_orders where force_id=force.id;
    exception when others then
        update public.military_forces set action_points=greatest(0,100-ord.reserved_ap),updated_at=now() where id=force.id and status='active';
        update public.military_conditional_orders set processed_turn=p_turn,last_result='Приказ не выполнен; ОД не потрачены',updated_at=now() where force_id=force.id;
    end;
end;$function$;

revoke all on function public.set_military_conditional_order(uuid,integer,integer,text,jsonb,uuid,integer) from public,anon;
grant execute on function public.set_military_conditional_order(uuid,integer,integer,text,jsonb,uuid,integer) to authenticated;
revoke all on function public.cancel_military_conditional_order(uuid) from public,anon;
grant execute on function public.cancel_military_conditional_order(uuid) to authenticated;
revoke all on function public.process_military_conditional_orders() from public,anon,authenticated;
revoke all on function public.military_conditional_order_condition(uuid,integer,integer) from public,anon,authenticated;
revoke all on function public.resolve_one_military_conditional_order(uuid,integer,boolean) from public,anon,authenticated;
drop trigger if exists zzzz_process_military_conditional_orders on public.game_calendar;
drop trigger if exists zzzy_process_military_conditional_orders on public.game_calendar;
create trigger zzzy_process_military_conditional_orders after update of turn on public.game_calendar for each row execute function public.process_military_conditional_orders();
