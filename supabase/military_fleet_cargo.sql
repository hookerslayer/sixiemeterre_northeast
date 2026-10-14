-- Load or unload provisions and goods while a fleet is based in its own port.
create or replace function public.transfer_military_fleet_cargo(
    p_fleet_id uuid,
    p_ship_index integer,
    p_item_type text,
    p_item_name text,
    p_quantity numeric,
    p_unload boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    profile public.profiles%rowtype;
    fleet public.military_fleets%rowtype;
    marker public.markers%rowtype;
    ship jsonb;
    cargo jsonb;
    capacity integer;
    boarding integer;
    used numeric;
    current_qty numeric;
    source_qty numeric;
    cargo_key text;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role not in ('player','admin') then raise exception 'Authentication required' using errcode='42501'; end if;
    select * into fleet from public.military_fleets where id=p_fleet_id and status='active' for update;
    if not found or (profile.role<>'admin' and fleet.owner is distinct from profile.owner) then raise exception 'You do not command this fleet' using errcode='42501'; end if;
    if fleet.location_kind<>'port' then raise exception 'Cargo can only be transferred in port' using errcode='55000'; end if;
    if exists(select 1 from public.military_battle_armies a join public.military_battles b on b.id=a.battle_id where a.persistent_fleet_id=fleet.id and b.status='pending') then raise exception 'A fleet in an unresolved battle cannot be edited' using errcode='55000'; end if;
    if p_ship_index<1 or p_ship_index>jsonb_array_length(fleet.ships) or p_quantity<=0 or p_quantity>10000 then raise exception 'Choose a valid ship and positive quantity' using errcode='22023'; end if;
    if p_item_type not in ('resource','good') then raise exception 'Unknown cargo category' using errcode='22023'; end if;
    if (p_item_type='resource' and p_item_name not in ('Зерно','Древесина','Железная руда','Скот','Камень','Соль','Пушнина','Бивни','Ворвань','Самоцветы','Мёд и Воск','Лён','Морепродукты'))
       or (p_item_type='good' and p_item_name not in ('Топливо','Сукно и Одежда','Инструменты','Оружие и Доспехи','Обработанный камень','Оловина','Бумага')) then
        raise exception 'Unknown cargo item' using errcode='22023';
    end if;
    select * into marker from public.markers where id=fleet.port_marker_id and owner=fleet.owner for update;
    if not found then raise exception 'Fleet port is no longer controlled by its owner' using errcode='42501'; end if;
    ship:=fleet.ships->(p_ship_index-1);
    capacity:=case ship->>'type' when 'Ушкуй' then 18 when 'Насад' then 36 when 'Ладья' then 25 when 'Когг' then 50 when 'Хольк' then 70 else 0 end;
    if capacity=0 then raise exception 'Unknown ship type' using errcode='22023'; end if;
    cargo:=coalesce(ship->'cargo','{}'::jsonb);
    cargo_key:=p_item_type||':'||p_item_name;
    current_qty:=coalesce((cargo->>cargo_key)::numeric,0);
    select coalesce(quantity,0) into source_qty from public.marker_inventories
     where marker_id=fleet.port_marker_id and item_type=p_item_type and item_name=p_item_name for update;
    source_qty:=coalesce(source_qty,0);
    if p_unload then
        if current_qty<p_quantity then raise exception 'Not enough of this cargo is aboard' using errcode='22023'; end if;
        cargo:=jsonb_set(cargo,array[cargo_key],to_jsonb(current_qty-p_quantity),true);
        insert into public.marker_inventories(marker_id,item_type,item_name,quantity)
        values(fleet.port_marker_id,p_item_type,p_item_name,p_quantity)
        on conflict(marker_id,item_type,item_name) do update set quantity=public.marker_inventories.quantity+excluded.quantity;
    else
        if source_qty<p_quantity then raise exception 'The port warehouse lacks this amount' using errcode='22023'; end if;
        used:=coalesce((select sum((entry.value)::numeric) from jsonb_each_text(cargo) entry),0);
        boarding:=coalesce((ship->>'boarding_troops')::integer,0);
        if used+p_quantity+boarding>capacity then raise exception 'The ship does not have enough free cargo places' using errcode='22023'; end if;
        cargo:=jsonb_set(cargo,array[cargo_key],to_jsonb(current_qty+p_quantity),true);
        update public.marker_inventories set quantity=quantity-p_quantity
         where marker_id=fleet.port_marker_id and item_type=p_item_type and item_name=p_item_name;
    end if;
    ship:=jsonb_set(ship,'{cargo}',cargo,true);
    ship:=jsonb_set(ship,'{cargoPlaces}',to_jsonb(coalesce((select sum((entry.value)::numeric) from jsonb_each_text(cargo) entry),0)),true);
    update public.military_fleets set ships=jsonb_set(ships,array[(p_ship_index-1)::text],ship,true),updated_at=now() where id=fleet.id;
    return jsonb_build_object('fleet_id',fleet.id,'ship_index',p_ship_index,'cargo',cargo,'unloaded',p_unload,'quantity',p_quantity);
end;
$function$;

revoke all on function public.transfer_military_fleet_cargo(uuid,integer,text,text,numeric,boolean) from public,anon;
grant execute on function public.transfer_military_fleet_cargo(uuid,integer,text,text,numeric,boolean) to authenticated;
