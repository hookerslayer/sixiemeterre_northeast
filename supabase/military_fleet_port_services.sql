-- Repair, crew replenishment and one-time refit at a controlled friendly port.
create or replace function public.service_military_ship(
    p_fleet_id uuid,
    p_ship_index integer,
    p_action text,
    p_quantity integer default 0,
    p_weapon text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    profile public.profiles%rowtype;
    fleet public.military_fleets%rowtype;
    port public.military_ports%rowtype;
    marker public.markers%rowtype;
    calendar public.game_calendar%rowtype;
    ship jsonb;
    ships_json jsonb;
    type_name text;
    max_crew integer;
    max_hull integer;
    base_cost numeric;
    base_wood integer;
    base_tools integer;
    treasury_cost numeric:=0;
    wood_cost numeric:=0;
    tool_cost numeric:=0;
    arms_cost numeric:=0;
    cloth_cost numeric:=0;
    available_treasury numeric;
    available_wood numeric;
    available_tools numeric;
    available_arms numeric;
    available_cloth numeric;
    action_qty integer;
    used_repair_points integer;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role not in ('player','admin') then raise exception 'Authentication required' using errcode='42501'; end if;
    select * into fleet from public.military_fleets where id=p_fleet_id and status='active' for update;
    if not found or (profile.role<>'admin' and fleet.owner is distinct from profile.owner) then raise exception 'You do not command this fleet' using errcode='42501'; end if;
    if fleet.location_kind<>'port' then raise exception 'Ship services are available only in port' using errcode='55000'; end if;
    if exists(select 1 from public.military_battle_armies a join public.military_battles b on b.id=a.battle_id where a.persistent_fleet_id=fleet.id and b.status='pending') then raise exception 'A fleet in an unresolved battle cannot be edited' using errcode='55000'; end if;
    if p_ship_index<1 or p_ship_index>jsonb_array_length(fleet.ships) then raise exception 'Choose a valid ship' using errcode='22023'; end if;
    select * into port from public.military_ports where marker_id=fleet.port_marker_id and status='active';
    if not found or port.owner is distinct from fleet.owner then raise exception 'The fleet needs its own active port' using errcode='42501'; end if;
    select * into marker from public.markers where id=fleet.port_marker_id and owner=fleet.owner for update;
    if not found then raise exception 'The port settlement is no longer controlled by the fleet owner' using errcode='42501'; end if;
    select * into calendar from public.game_calendar where singleton=true;
    ships_json:=fleet.ships;
    ship:=ships_json->(p_ship_index-1);
    type_name:=ship->>'type';
    max_crew:=case type_name when 'Ушкуй' then 6 when 'Насад' then 12 when 'Ладья' then 20 when 'Когг' then 20 when 'Хольк' then 30 else 0 end;
    max_hull:=case type_name when 'Ушкуй' then 2 when 'Насад' then 4 when 'Ладья' then 3 when 'Когг' then 4 when 'Хольк' then 5 else 0 end;
    base_cost:=case type_name when 'Ушкуй' then 6 when 'Насад' then 10 when 'Ладья' then 18 when 'Когг' then 30 when 'Хольк' then 45 else 0 end;
    base_wood:=case type_name when 'Ушкуй' then 8 when 'Насад' then 15 when 'Ладья' then 24 when 'Когг' then 36 when 'Хольк' then 55 else 0 end;
    base_tools:=case type_name when 'Ушкуй' then 1 when 'Насад' then 2 when 'Ладья' then 3 when 'Когг' then 5 when 'Хольк' then 7 else 0 end;
    if max_crew=0 then raise exception 'Unknown ship type' using errcode='22023'; end if;
    if p_action='repair' then
        used_repair_points:=case when coalesce((ship->>'repair_turn')::integer,-1)=calendar.turn then coalesce((ship->>'repaired_points')::integer,0) else 0 end;
        action_qty:=least(greatest(0,4-used_repair_points),least(greatest(0,p_quantity),max_hull-coalesce((ship->>'hull')::integer,0)));
        if action_qty<=0 then raise exception 'The vessel is already repaired or the requested amount is invalid' using errcode='22023'; end if;
        treasury_cost:=action_qty; wood_cost:=action_qty; tool_cost:=action_qty*0.1;
        ship:=jsonb_set(ship,'{hull}',to_jsonb(least(max_hull,coalesce((ship->>'hull')::integer,0)+action_qty)),true);
        ship:=jsonb_set(ship,'{repair_turn}',to_jsonb(calendar.turn),true);
        ship:=jsonb_set(ship,'{repaired_points}',to_jsonb(action_qty+used_repair_points),true);
    elsif p_action='recruit' then
        action_qty:=least(greatest(0,p_quantity),max_crew-coalesce((ship->>'crew')::integer,0));
        if action_qty<=0 then raise exception 'The vessel already has full crew or the requested amount is invalid' using errcode='22023'; end if;
        treasury_cost:=action_qty*0.5; arms_cost:=action_qty*0.05; cloth_cost:=action_qty*0.025;
        ship:=jsonb_set(ship,'{crew}',to_jsonb(least(max_crew,coalesce((ship->>'crew')::integer,0)+action_qty)),true);
    elsif p_action='refit' then
        if coalesce((ship->>'refitted')::boolean,false) then raise exception 'A vessel can only be refitted once' using errcode='55000'; end if;
        if p_weapon not in ('deck','light_gun') then raise exception 'Choose a valid naval weapon profile' using errcode='22023'; end if;
        treasury_cost:=ceil(base_cost*0.2); wood_cost:=ceil(base_wood*0.2); tool_cost:=ceil(base_tools*0.2);
        ship:=jsonb_set(ship,'{weapon}',to_jsonb(p_weapon),true);
        ship:=jsonb_set(ship,'{refitted}',to_jsonb(true),true);
        ship:=jsonb_set(ship,'{refit_turn}',to_jsonb(calendar.turn),true);
    else
        raise exception 'Unknown ship service' using errcode='22023';
    end if;
    select coalesce((settings#>>'{economy,treasury}')::numeric,0) into available_treasury from public.state_mechanics where owner=fleet.owner for update;
    select coalesce(quantity,0) into available_wood from public.marker_inventories where marker_id=marker.id and item_type='resource' and item_name='Древесина' for update;
    select coalesce(quantity,0) into available_tools from public.marker_inventories where marker_id=marker.id and item_type='good' and item_name='Инструменты' for update;
    select coalesce(quantity,0) into available_arms from public.marker_inventories where marker_id=marker.id and item_type='good' and item_name='Оружие и Доспехи' for update;
    select coalesce(quantity,0) into available_cloth from public.marker_inventories where marker_id=marker.id and item_type='good' and item_name='Сукно и Одежда' for update;
    if coalesce(available_treasury,0)<treasury_cost or coalesce(available_wood,0)<wood_cost or coalesce(available_tools,0)<tool_cost or coalesce(available_arms,0)<arms_cost or coalesce(available_cloth,0)<cloth_cost then
        raise exception 'Not enough treasury or port supplies for this ship service' using errcode='23514';
    end if;
    update public.state_mechanics set settings=settings||jsonb_build_object('economy',coalesce(settings->'economy','{}'::jsonb)||jsonb_build_object('treasury',available_treasury-treasury_cost)),updated_at=now() where owner=fleet.owner;
    if wood_cost>0 then update public.marker_inventories set quantity=quantity-wood_cost where marker_id=marker.id and item_type='resource' and item_name='Древесина'; end if;
    if tool_cost>0 then update public.marker_inventories set quantity=quantity-tool_cost where marker_id=marker.id and item_type='good' and item_name='Инструменты'; end if;
    if arms_cost>0 then update public.marker_inventories set quantity=quantity-arms_cost where marker_id=marker.id and item_type='good' and item_name='Оружие и Доспехи'; end if;
    if cloth_cost>0 then update public.marker_inventories set quantity=quantity-cloth_cost where marker_id=marker.id and item_type='good' and item_name='Сукно и Одежда'; end if;
    ships_json:=jsonb_set(ships_json,array[(p_ship_index-1)::text],ship,true);
    update public.military_fleets set ships=ships_json,updated_at=now() where id=fleet.id;
    return jsonb_build_object('fleet_id',fleet.id,'ship_index',p_ship_index,'action',p_action,'quantity',action_qty,'weapon',p_weapon,'paid_z',treasury_cost,'wood',wood_cost,'tools',tool_cost,'arms',arms_cost,'cloth',cloth_cost,'vessel',ship);
end;
$function$;
revoke all on function public.service_military_ship(uuid,integer,text,integer,text) from public,anon;
grant execute on function public.service_military_ship(uuid,integer,text,integer,text) to authenticated;

-- A ship under repair or refit remains in port for that entire turn.
create or replace function public.guard_military_ship_port_service()
returns trigger language plpgsql set search_path = '' as $function$
declare calendar public.game_calendar%rowtype; ship jsonb;
begin
    if new.location_kind='water' and old.location_kind='port' then
        select * into calendar from public.game_calendar where singleton=true;
        for ship in select value from jsonb_array_elements(new.ships) loop
            if coalesce((ship->>'repair_turn')::integer,-1)=calendar.turn or coalesce((ship->>'refit_turn')::integer,-1)=calendar.turn then
                raise exception 'A ship under repair or refit cannot leave port this turn' using errcode='55000';
            end if;
        end loop;
    end if;
    return new;
end;
$function$;
revoke all on function public.guard_military_ship_port_service() from public,anon,authenticated;
drop trigger if exists guard_military_ship_port_service on public.military_fleets;
create trigger guard_military_ship_port_service before update of location_kind on public.military_fleets
for each row execute function public.guard_military_ship_port_service();
