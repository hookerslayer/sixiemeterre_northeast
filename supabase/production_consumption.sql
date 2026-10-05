-- Historical initial seasonal production, storage, conversion and consumption.
-- Apply economy_feedback_and_transport.sql after this script for the current RPC.
-- The browser computes a deterministic preview; this RPC applies the complete
-- result and advances the calendar atomically after verifying administrator access.

alter table public.markers
    add column if not exists production_directive text not null default 'civilian'
        check (production_directive in ('civilian', 'military', 'market')),
    add column if not exists state_order_good text,
    add column if not exists state_order_qty numeric(12,2) not null default 0
        check (state_order_qty >= 0);

alter table public."Provinces"
    add column if not exists target_marker_id bigint references public.markers(id) on delete set null,
    add column if not exists stored_resource_qty numeric(12,2) not null default 0
        check (stored_resource_qty >= 0);

create table if not exists public.marker_inventories (
    marker_id bigint not null references public.markers(id) on delete cascade,
    item_type text not null check (item_type in ('resource', 'good')),
    item_name text not null,
    quantity numeric(12,2) not null default 0 check (quantity >= 0),
    primary key (marker_id, item_type, item_name)
);
alter table public.marker_inventories enable row level security;
drop policy if exists "Inventories are publicly readable" on public.marker_inventories;
create policy "Inventories are publicly readable" on public.marker_inventories
    for select to anon, authenticated using (true);
revoke all on public.marker_inventories from anon, authenticated;
grant select on public.marker_inventories to anon, authenticated;

create table if not exists public.turn_economy_reports (
    owner text not null,
    turn integer not null,
    season text not null,
    year integer not null,
    report jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    primary key (owner, turn, season, year)
);
alter table public.turn_economy_reports enable row level security;
drop policy if exists "Economy reports are publicly readable" on public.turn_economy_reports;
create policy "Economy reports are publicly readable" on public.turn_economy_reports
    for select to anon, authenticated using (true);
revoke all on public.turn_economy_reports from anon, authenticated;
grant select on public.turn_economy_reports to anon, authenticated;

create or replace function public.save_production_directive(
    p_marker_id bigint, p_directive text, p_order_good text, p_order_qty numeric
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $function$
declare caller public.profiles%rowtype; target public.markers%rowtype; province_owner text;
begin
    select * into caller from public.profiles where id = (select auth.uid());
    if caller.id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
    if p_directive not in ('civilian','military','market') then raise exception 'Invalid production directive'; end if;
    if coalesce(p_order_qty,0) < 0 then raise exception 'Order quantity cannot be negative'; end if;
    if p_order_good is not null and p_order_good not in ('Топливо','Сукно и Одежда','Инструменты','Оружие и Доспехи','Обработанный камень','Оловина','Бумага') then
        raise exception 'Invalid state order good';
    end if;
    select * into target from public.markers where id = p_marker_id for update;
    if target.id is null or target.type not in ('city','large_city') then raise exception 'Production orders require a city'; end if;
    select owner into province_owner from public."Provinces" where id = target.province_id;
    if caller.role <> 'admin' and (caller.owner is null or caller.owner <> province_owner or target.owner is distinct from province_owner) then
        raise exception 'You cannot edit this settlement production' using errcode = '42501';
    end if;
    update public.markers set production_directive=p_directive, state_order_good=p_order_good,
        state_order_qty=coalesce(p_order_qty,0) where id=p_marker_id;
    return jsonb_build_object('marker_id',p_marker_id,'production_directive',p_directive,'state_order_good',p_order_good,'state_order_qty',coalesce(p_order_qty,0));
end;
$function$;
revoke all on function public.save_production_directive(bigint,text,text,numeric) from public, anon;
grant execute on function public.save_production_directive(bigint,text,text,numeric) to authenticated;

create or replace function public.apply_economy_turn(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $function$
declare caller_role text; cal public.game_calendar%rowtype; row_data jsonb; owner_name text; report_data jsonb;
begin
    select role into caller_role from public.profiles where id=(select auth.uid());
    if caller_role is distinct from 'admin' then raise exception 'Only an administrator can advance the game turn' using errcode = '42501'; end if;
    select * into cal from public.game_calendar where singleton=true for update;
    if p_payload->'processed_calendar'->>'turn' is distinct from cal.turn::text
       or p_payload->'processed_calendar'->>'season' is distinct from cal.season
       or p_payload->'processed_calendar'->>'year' is distinct from cal.year::text then
        raise exception 'Calendar changed; reload and recalculate the turn' using errcode = '40001';
    end if;
    if jsonb_typeof(p_payload->'inventoryUpdates') <> 'array'
       or jsonb_typeof(p_payload->'provinceUpdates') <> 'array'
       or jsonb_array_length(p_payload->'inventoryUpdates') > 20000
       or jsonb_array_length(p_payload->'provinceUpdates') > 1000 then raise exception 'Invalid economy payload'; end if;

    delete from public.marker_inventories;
    for row_data in select value from jsonb_array_elements(p_payload->'inventoryUpdates') loop
        if (row_data->>'quantity')::numeric < 0 or row_data->>'item_type' not in ('resource','good') then raise exception 'Invalid inventory row'; end if;
        insert into public.marker_inventories(marker_id,item_type,item_name,quantity)
        values ((row_data->>'marker_id')::bigint,row_data->>'item_type',row_data->>'item_name',(row_data->>'quantity')::numeric)
        on conflict (marker_id,item_type,item_name) do update set quantity=excluded.quantity;
    end loop;
    for row_data in select value from jsonb_array_elements(p_payload->'provinceUpdates') loop
        update public."Provinces" set target_marker_id=nullif(row_data->>'target_marker_id','')::bigint,
            stored_resource_qty=(row_data->>'stored_resource_qty')::numeric
        where id=(row_data->>'id')::bigint;
    end loop;

    for owner_name, report_data in select key, value from jsonb_each(p_payload->'ownerReports') loop
        insert into public.turn_economy_reports(owner,turn,season,year,report)
        values(owner_name,cal.turn,cal.season,cal.year,report_data)
        on conflict(owner,turn,season,year) do update set report=excluded.report,created_at=now();
    end loop;

    for owner_name, report_data in select key, value from jsonb_each(p_payload->'mechanicsUpdates') loop
        update public.state_mechanics set settings=report_data, updated_at=now() where owner=owner_name;
    end loop;

    update public.game_calendar set turn=cal.turn+1,
        year=cal.year+case when cal.season='Осень' then 1 else 0 end,
        season=case cal.season when 'Осень' then 'Зима' when 'Зима' then 'Весна' when 'Весна' then 'Лето' else 'Осень' end,
        updated_at=now() where singleton=true returning * into cal;

    if cal.year > (p_payload->'processed_calendar'->>'year')::integer then
        update public.state_mechanics sm set settings=jsonb_set(sm.settings,'{ruler,age}',
            to_jsonb(least(150,coalesce((sm.settings#>>'{ruler,age}')::integer,0)+1)),true),
            updated_at=now()
        where sm.settings ? 'ruler' and sm.settings#>'{ruler}' is not null;
    end if;
    return jsonb_build_object('turn',cal.turn,'season',cal.season,'year',cal.year);
end;
$function$;
revoke all on function public.apply_economy_turn(jsonb) from public, anon;
grant execute on function public.apply_economy_turn(jsonb) to authenticated;

-- Calendar changes now require the full economy transaction.
create or replace function public.advance_game_turn()
returns table (turn integer, season text, year integer)
language plpgsql security definer set search_path = public, pg_temp
as $function$
begin
    raise exception 'Use apply_economy_turn to advance the calendar' using errcode = '55000';
end;
$function$;
revoke all on function public.advance_game_turn() from public, anon;
grant execute on function public.advance_game_turn() to authenticated;
