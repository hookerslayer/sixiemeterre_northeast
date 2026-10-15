-- Store visually selected trigger areas for delayed military orders.
alter table public.military_conditional_orders
    add column if not exists condition_mode text not null default 'cell'
        check (condition_mode in ('cell','radius','reachable')),
    add column if not exists condition_cells jsonb not null default '[]'::jsonb
        check (jsonb_typeof(condition_cells) = 'array');

update public.military_conditional_orders
   set condition_cells = jsonb_build_array(jsonb_build_object('x',condition_x,'y',condition_y))
 where jsonb_array_length(condition_cells)=0;

create or replace function public.set_military_conditional_order_zone(
    p_force_id uuid,
    p_condition_mode text,
    p_condition_cells jsonb,
    p_condition_x integer,
    p_condition_y integer,
    p_action text,
    p_route jsonb,
    p_target_force_id uuid,
    p_reserved_ap integer
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
    profile public.profiles%rowtype;
    force public.military_forces%rowtype;
    target public.military_forces%rowtype;
    old_order public.military_conditional_orders%rowtype;
    old_reserved integer := 0;
    current_turn integer;
    cell_count integer;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role<>'player' then raise exception 'Only a state player can set conditional orders' using errcode='42501'; end if;
    select * into force from public.military_forces where id=p_force_id and force_kind='land_army' and status='active' for update;
    if not found or force.owner is distinct from profile.owner then raise exception 'Choose your active field army' using errcode='42501'; end if;
    if force.is_militia or force.is_mercenary or force.cell_x is null or force.cell_y is null then raise exception 'This army cannot receive a conditional order'; end if;
    if exists(select 1 from public.military_battle_armies a join public.military_battles b on b.id=a.battle_id where a.persistent_force_id=force.id and b.status='pending') then raise exception 'An army in an unresolved battle cannot receive an order'; end if;
    cell_count := case when jsonb_typeof(p_condition_cells)='array' then jsonb_array_length(p_condition_cells) else 0 end;
    if p_condition_mode not in ('cell','radius','reachable') or cell_count<1 or cell_count>2000
       or p_condition_mode='cell' and cell_count<>1
       or p_condition_x not between 0 and 10000 or p_condition_y not between 0 and 10000
       or not exists(select 1 from public.military_grid_cells where cell_x=p_condition_x and cell_y=p_condition_y)
       or exists(select 1 from jsonb_to_recordset(p_condition_cells) as c(x integer,y integer)
           where c.x is null or c.y is null or c.x not between 0 and 10000 or c.y not between 0 and 10000
              or not exists(select 1 from public.military_grid_cells g where g.cell_x=c.x and g.cell_y=c.y))
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
    insert into public.military_conditional_orders(force_id,owner,condition_x,condition_y,condition_mode,condition_cells,action,route,target_force_id,reserved_ap,processed_turn,last_result,updated_at)
    values(force.id,force.owner,p_condition_x,p_condition_y,p_condition_mode,p_condition_cells,p_action,p_route,p_target_force_id,p_reserved_ap,current_turn,null,now())
    on conflict(force_id) do update set owner=excluded.owner,condition_x=excluded.condition_x,condition_y=excluded.condition_y,
        condition_mode=excluded.condition_mode,condition_cells=excluded.condition_cells,
        action=excluded.action,route=excluded.route,target_force_id=excluded.target_force_id,reserved_ap=excluded.reserved_ap,
        processed_turn=excluded.processed_turn,last_result=null,updated_at=now();
    return jsonb_build_object('force_id',force.id,'reserved_ap',p_reserved_ap,'action',p_action,'condition_mode',p_condition_mode,'cells',cell_count);
end;
$function$;

create or replace function public.military_conditional_order_condition(p_force_id uuid,p_cell_x integer,p_cell_y integer)
returns boolean language plpgsql security definer set search_path='' as $function$
declare
    owner_name text;
    trigger_cells jsonb;
    target_id uuid;
    action_name text;
begin
    select owner into owner_name from public.military_forces where id=p_force_id and status='active';
    if owner_name is null then return false; end if;
    select condition_cells,target_force_id,action into trigger_cells,target_id,action_name
      from public.military_conditional_orders where force_id=p_force_id;
    if trigger_cells is null then trigger_cells:=jsonb_build_array(jsonb_build_object('x',p_cell_x,'y',p_cell_y)); end if;
    return exists(
        select 1
          from public.military_forces e
          join jsonb_to_recordset(trigger_cells) as c(x integer,y integer) on c.x=e.cell_x and c.y=e.cell_y
         where e.force_kind='land_army' and e.status='active' and e.owner is distinct from owner_name
           and (action_name<>'attack' or e.id=target_id)
           and (
               exists(select 1 from public.military_grid_cells g left join public.military_terrain_cells t using(cell_x,cell_y)
                 join public."Provinces" p on p.id=coalesce(t.province_id,g.province_id)
                 where g.cell_x=e.cell_x and g.cell_y=e.cell_y and (p.owner=owner_name or p.occupied_by=owner_name))
               or exists(select 1 from public.military_forces observer where observer.owner=owner_name and observer.force_kind='land_army'
                 and observer.status='active' and greatest(abs(observer.cell_x-e.cell_x),abs(observer.cell_y-e.cell_y))<=2
                 and (coalesce((select t.terrain from public.military_terrain_cells t where t.cell_x=e.cell_x and t.cell_y=e.cell_y),
                               (select g.base_terrain from public.military_grid_cells g where g.cell_x=e.cell_x and g.cell_y=e.cell_y))<>'forest'
                      or greatest(abs(observer.cell_x-e.cell_x),abs(observer.cell_y-e.cell_y))<=1))
           )
    );
end;
$function$;

create or replace function public.resolve_one_military_conditional_order(p_force_id uuid,p_turn integer,p_condition_met boolean)
returns void language plpgsql security definer set search_path='' as $function$
declare
    ord public.military_conditional_orders%rowtype;
    force public.military_forces%rowtype;
    target public.military_forces%rowtype;
    current_ap integer;
    terrain_name text;
    province_id bigint;
    battle_id uuid;
begin
    select * into ord from public.military_conditional_orders where force_id=p_force_id and processed_turn is distinct from p_turn for update;
    if not found then return; end if;
    select * into force from public.military_forces where id=ord.force_id and force_kind='land_army' and status='active' for update;
    if not found or force.cell_x is null or force.cell_y is null or exists(select 1 from public.military_battle_armies a join public.military_battles b on b.id=a.battle_id where a.persistent_force_id=force.id and b.status='pending') then
        update public.military_forces set action_points=greatest(0,100-ord.reserved_ap),updated_at=now() where id=p_force_id and status='active';
        update public.military_conditional_orders set processed_turn=p_turn,last_result='Отложен: армия недоступна; резерв сохранён',updated_at=now() where force_id=p_force_id; return;
    end if;
    if not coalesce(p_condition_met,false) then
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
            if not found or target.owner=force.owner or greatest(abs(force.cell_x-target.cell_x),abs(force.cell_y-target.cell_y))<>1 or ord.reserved_ap<10 then raise exception 'Attack target is no longer adjacent'; end if;
            if not exists(select 1 from jsonb_to_recordset(ord.condition_cells) as c(x integer,y integer) where c.x=target.cell_x and c.y=target.cell_y)
               or not public.military_conditional_order_condition(force.id,target.cell_x,target.cell_y) then
                raise exception 'Attack target is no longer visible in the selected trigger zone';
            end if;
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
end;
$function$;

revoke all on function public.set_military_conditional_order_zone(uuid,text,jsonb,integer,integer,text,jsonb,uuid,integer) from public,anon;
grant execute on function public.set_military_conditional_order_zone(uuid,text,jsonb,integer,integer,text,jsonb,uuid,integer) to authenticated;
