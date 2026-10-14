-- Ship construction in rule-compatible ports. Costs are paid when a keel is laid;
-- a completed vessel joins a persistent fleet that remains in the same port.
alter table public.military_fleets
    add column if not exists commander_name text not null default 'Не назначен',
    add column if not exists commander_age integer not null default 35 check (commander_age between 16 and 100),
    add column if not exists commander_skills jsonb not null default '{"management":0,"leadership":0,"tactics":0,"planning":0,"engineering":0}'::jsonb,
    add column if not exists commander_experience integer not null default 0 check (commander_experience >= 0);

create table if not exists public.military_ship_build_orders (
    id bigint generated always as identity primary key,
    owner text not null references public.state_mechanics(owner) on delete cascade,
    port_marker_id bigint not null references public.military_ports(marker_id) on delete cascade,
    source_marker_id bigint not null references public.markers(id) on delete restrict,
    fleet_id uuid not null references public.military_fleets(id) on delete cascade,
    ship_type text not null check (ship_type in ('Ушкуй','Насад','Ладья','Когг','Хольк')),
    submitted_turn integer not null,
    due_turn integer not null,
    ship_data jsonb not null,
    status text not null default 'building' check (status in ('building','completed','cancelled')),
    created_at timestamptz not null default now(),
    completed_at timestamptz
);
create index if not exists military_ship_build_orders_port_status_idx on public.military_ship_build_orders(port_marker_id,status,due_turn);
alter table public.military_ship_build_orders enable row level security;
drop policy if exists "Players can read their own ship construction orders" on public.military_ship_build_orders;
create policy "Players can read their own ship construction orders" on public.military_ship_build_orders
for select to authenticated using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and (p.role='admin' or p.owner=military_ship_build_orders.owner)));
revoke all on public.military_ship_build_orders from anon,authenticated;
grant select on public.military_ship_build_orders to authenticated;

create or replace function public.guard_empty_fleet_launch()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
    if new.location_kind='water' and jsonb_array_length(new.ships)=0 then
        raise exception 'A fleet without completed ships cannot leave port' using errcode='55000';
    end if;
    return new;
end;
$function$;
revoke all on function public.guard_empty_fleet_launch() from public,anon,authenticated;
drop trigger if exists guard_empty_fleet_launch on public.military_fleets;
create trigger guard_empty_fleet_launch before update of location_kind on public.military_fleets
for each row execute function public.guard_empty_fleet_launch();

create or replace function public.start_military_ship_build(
    p_port_marker_id bigint,p_source_marker_id bigint,p_ship_type text,p_fleet_name text,
    p_commander_name text,p_commander_age integer,p_fleet_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
    profile public.profiles%rowtype;
    port public.military_ports%rowtype;
    source public.markers%rowtype;
    calendar public.game_calendar%rowtype;
    fleet public.military_fleets%rowtype;
    treasury numeric;
    wood numeric;
    tools_amount numeric;
    arms numeric;
    cloth numeric;
    ship_count integer;
    used_berths integer;
    build_seasons integer;
    port_build_cost numeric;
    wood_cost numeric;
    tool_cost numeric;
    crew_count integer;
    total_cost numeric;
    arms_cost numeric;
    cloth_cost numeric;
    due integer;
    order_id bigint;
    ship jsonb;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role<>'player' or nullif(profile.owner,'') is null then raise exception 'Only a state player can build a ship' using errcode='42501'; end if;
    if p_ship_type not in ('Ушкуй','Насад','Ладья','Когг','Хольк') then raise exception 'Unknown ship type' using errcode='22023'; end if;
    select * into port from public.military_ports where marker_id=p_port_marker_id and owner=profile.owner and status='active' for update;
    if not found then raise exception 'Choose an active friendly port' using errcode='22023'; end if;
    if not exists(select 1 from public.markers m where m.id=port.marker_id and m.owner=profile.owner and (m.military_controlled_by is null or m.military_controlled_by=profile.owner)) then raise exception 'The port settlement must remain under uncontested friendly control' using errcode='22023'; end if;
    if port.port_type='river_port' and p_ship_type not in ('Ушкуй','Насад','Ладья') then raise exception 'This ship cannot be built in a river port' using errcode='22023'; end if;
    if port.port_type='port' and p_ship_type not in ('Ладья','Когг','Хольк') then raise exception 'This ship requires a river port' using errcode='22023'; end if;
    if exists(select 1 from public.military_ship_build_orders where port_marker_id=port.marker_id and status='building') then raise exception 'This port already has a ship under construction' using errcode='55000'; end if;
    select * into source from public.markers where id=p_source_marker_id and owner=profile.owner and type<>'ruins' and (military_controlled_by is null or military_controlled_by=profile.owner) for update;
    if not found then raise exception 'Choose an unoccupied friendly warehouse' using errcode='22023'; end if;
    select * into calendar from public.game_calendar where singleton=true for update;
    build_seasons:=case when p_ship_type in ('Когг','Хольк') then 2 else 1 end;
    crew_count:=case p_ship_type when 'Ушкуй' then 6 when 'Насад' then 12 when 'Ладья' then 20 when 'Когг' then 20 when 'Хольк' then 30 end;
    port_build_cost:=case p_ship_type when 'Ушкуй' then 6 when 'Насад' then 10 when 'Ладья' then 18 when 'Когг' then 30 else 45 end;
    wood_cost:=case p_ship_type when 'Ушкуй' then 8 when 'Насад' then 15 when 'Ладья' then 24 when 'Когг' then 36 else 55 end;
    tool_cost:=case p_ship_type when 'Ушкуй' then 1 when 'Насад' then 2 when 'Ладья' then 3 when 'Когг' then 5 else 7 end;
    total_cost:=port_build_cost+crew_count*0.5;
    arms_cost:=crew_count*0.05; cloth_cost:=crew_count*0.025;
    select coalesce((settings#>>'{economy,treasury}')::numeric,0) into treasury from public.state_mechanics where owner=profile.owner for update;
    if coalesce(treasury,0)<total_cost then raise exception 'Not enough treasury to build and crew this ship (% z required)',total_cost using errcode='23514'; end if;
    select coalesce(quantity,0) into wood from public.marker_inventories where marker_id=source.id and item_type='resource' and item_name='Древесина' for update;
    select coalesce(quantity,0) into tools_amount from public.marker_inventories where marker_id=source.id and item_type='good' and item_name='Инструменты' for update;
    select coalesce(quantity,0) into arms from public.marker_inventories where marker_id=source.id and item_type='good' and item_name='Оружие и Доспехи' for update;
    select coalesce(quantity,0) into cloth from public.marker_inventories where marker_id=source.id and item_type='good' and item_name='Сукно и Одежда' for update;
    if coalesce(wood,0)<wood_cost or coalesce(tools_amount,0)<tool_cost or coalesce(arms,0)<arms_cost or coalesce(cloth,0)<cloth_cost then raise exception 'The warehouse lacks shipbuilding or crew equipment materials' using errcode='23514'; end if;
    if p_fleet_id is null then
        if nullif(btrim(p_fleet_name),'') is null or nullif(btrim(p_commander_name),'') is null or p_commander_age not between 16 and 100 then raise exception 'Fleet name, commander name and a valid age are required' using errcode='22023'; end if;
        insert into public.military_fleets(owner,name,ships,morale,status,location_kind,port_marker_id,commander_name,commander_age)
        values(profile.owner,btrim(p_fleet_name),'[]'::jsonb,100,'active','port',port.marker_id,btrim(p_commander_name),p_commander_age) returning * into fleet;
    else
        select * into fleet from public.military_fleets where id=p_fleet_id and owner=profile.owner and status='active' and location_kind='port' and port_marker_id=port.marker_id for update;
        if not found then raise exception 'Choose your fleet based in this port' using errcode='22023'; end if;
        if jsonb_array_length(fleet.ships)>=12 then raise exception 'A fleet can contain no more than twelve ships' using errcode='23514'; end if;
        if exists(select 1 from jsonb_array_elements(fleet.ships) item where (item.value->>'type') not in
            (case when port.port_type='river_port' then 'Ушкуй' else 'Когг' end, case when port.port_type='river_port' then 'Насад' else 'Хольк' end, 'Ладья')) then
            raise exception 'The fleet has a vessel incompatible with this port' using errcode='22023';
        end if;
    end if;
    ship:=jsonb_build_object('type',p_ship_type,'crew',crew_count,'hull',case p_ship_type when 'Ушкуй' then 2 when 'Насад' then 4 when 'Ладья' then 3 when 'Когг' then 4 else 5 end,'weapon','none','boarding_troops',0,'cargo',jsonb_build_object());
    select coalesce(sum(case item.value->>'type' when 'Ушкуй' then 1 when 'Насад' then 2 when 'Ладья' then 2 when 'Когг' then 3 when 'Хольк' then 4 else 99 end),0)::integer
      into used_berths from public.military_fleets existing cross join lateral jsonb_array_elements(existing.ships) item
     where existing.port_marker_id=port.marker_id and existing.location_kind='port' and existing.status='active';
    select coalesce(sum(case order_row.ship_type when 'Ушкуй' then 1 when 'Насад' then 2 when 'Ладья' then 2 when 'Когг' then 3 else 4 end),0)::integer
      into ship_count from public.military_ship_build_orders order_row where order_row.port_marker_id=port.marker_id and order_row.status='building';
    used_berths:=used_berths+ship_count;
    used_berths:=used_berths+case p_ship_type when 'Ушкуй' then 1 when 'Насад' then 2 when 'Ладья' then 2 when 'Когг' then 3 else 4 end;
    if used_berths>(case port.port_type when 'river_port' then 6 else 12 end) then raise exception 'Not enough free berths in the port for this ship' using errcode='55000'; end if;
    update public.state_mechanics set settings=settings||jsonb_build_object('economy',coalesce(settings->'economy','{}'::jsonb)||jsonb_build_object('treasury',treasury-total_cost)),updated_at=now() where owner=profile.owner;
    update public.marker_inventories set quantity=quantity-wood_cost where marker_id=source.id and item_type='resource' and item_name='Древесина';
    update public.marker_inventories set quantity=quantity-tool_cost where marker_id=source.id and item_type='good' and item_name='Инструменты';
    update public.marker_inventories set quantity=quantity-arms_cost where marker_id=source.id and item_type='good' and item_name='Оружие и Доспехи';
    update public.marker_inventories set quantity=quantity-cloth_cost where marker_id=source.id and item_type='good' and item_name='Сукно и Одежда';
    due:=calendar.turn+build_seasons;
    insert into public.military_ship_build_orders(owner,port_marker_id,source_marker_id,fleet_id,ship_type,submitted_turn,due_turn,ship_data)
    values(profile.owner,port.marker_id,source.id,fleet.id,p_ship_type,calendar.turn,due,ship) returning id into order_id;
    return jsonb_build_object('order_id',order_id,'fleet_id',fleet.id,'ship_type',p_ship_type,'due_turn',due,'crew',crew_count,'paid_z',total_cost,'wood',wood_cost,'tools',tool_cost,'arms',arms_cost,'cloth',cloth_cost);
end;
$function$;
revoke all on function public.start_military_ship_build(bigint,bigint,text,text,text,integer,uuid) from public,anon;
grant execute on function public.start_military_ship_build(bigint,bigint,text,text,text,integer,uuid) to authenticated;

create or replace function public.complete_military_ship_builds()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare order_row public.military_ship_build_orders%rowtype;
begin
    if new.turn<=old.turn then return new; end if;
    for order_row in select * from public.military_ship_build_orders where status='building' and due_turn<=new.turn order by id for update loop
        update public.military_fleets set ships=ships||jsonb_build_array(order_row.ship_data),updated_at=now()
          where id=order_row.fleet_id and status='active' and location_kind='port' and port_marker_id=order_row.port_marker_id;
        if found then
            update public.military_ship_build_orders set status='completed',completed_at=now() where id=order_row.id;
        else
            update public.military_ship_build_orders set status='cancelled' where id=order_row.id;
        end if;
    end loop;
    return new;
end;
$function$;
revoke all on function public.complete_military_ship_builds() from public,anon,authenticated;
drop trigger if exists complete_military_ship_builds_on_turn on public.game_calendar;
create trigger complete_military_ship_builds_on_turn after update of turn on public.game_calendar for each row execute function public.complete_military_ship_builds();
