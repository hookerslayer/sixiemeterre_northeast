-- Replace automatic production directives and single state orders with
-- persistent, prioritized per-settlement production orders.

alter table public.markers
    add column if not exists production_orders jsonb not null default '[]'::jsonb;

do $migration$
begin
    if not exists (
        select 1 from pg_constraint
        where conname='markers_production_orders_array'
          and conrelid='public.markers'::regclass
    ) then
        alter table public.markers
            add constraint markers_production_orders_array
            check (jsonb_typeof(production_orders)='array');
    end if;
end;
$migration$;

update public.markers
   set production_orders=jsonb_build_array(jsonb_build_object('good',state_order_good,'quantity',state_order_qty))
 where state_order_good is not null and state_order_qty>0 and production_orders='[]'::jsonb;

create or replace function public.clear_settlement_production_orders_on_owner_change()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
    if new.owner is distinct from old.owner then
        new.production_orders := '[]'::jsonb;
    end if;
    return new;
end;
$function$;
revoke all on function public.clear_settlement_production_orders_on_owner_change() from public, anon, authenticated;

drop trigger if exists markers_clear_production_orders_on_owner_change on public.markers;
create trigger markers_clear_production_orders_on_owner_change
    before update of owner on public.markers
    for each row execute function public.clear_settlement_production_orders_on_owner_change();

create or replace function public.save_production_orders(p_marker_id bigint,p_orders jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    caller public.profiles%rowtype;
    target public.markers%rowtype;
    province_owner text;
    allowed_goods text[] := array['Топливо','Сукно и Одежда','Инструменты','Оружие и Доспехи','Обработанный камень','Оловина','Бумага'];
begin
    select * into caller from public.profiles where id=(select auth.uid());
    if caller.id is null then raise exception 'Authentication required' using errcode='42501'; end if;
    if p_orders is null or jsonb_typeof(p_orders)<>'array' or jsonb_array_length(p_orders)>7 then
        raise exception 'Provide a list of up to seven production orders' using errcode='22023';
    end if;
    if exists(
        select 1 from jsonb_array_elements(p_orders) as entry(value)
        where jsonb_typeof(entry.value)<>'object'
           or coalesce(entry.value->>'good','')<>all(allowed_goods)
           or case when jsonb_typeof(entry.value->'quantity')='number'
                   then (entry.value->>'quantity')::numeric<0 or (entry.value->>'quantity')::numeric>1000000
                   else true end
    ) then raise exception 'One or more production orders are invalid' using errcode='22023'; end if;
    if exists(select 1 from jsonb_array_elements(p_orders) as entry(value) group by entry.value->>'good' having count(*)>1) then
        raise exception 'Each good can have only one order per settlement' using errcode='22023';
    end if;

    select * into target from public.markers where id=p_marker_id for update;
    if target.id is null or target.type not in ('city','large_city') then
        raise exception 'Production orders require a city or large city' using errcode='22023';
    end if;
    select owner into province_owner from public."Provinces" where id=target.province_id;
    if caller.role<>'admin' and (caller.owner is null or caller.owner is distinct from province_owner or target.owner is distinct from province_owner) then
        raise exception 'You cannot edit this settlement production' using errcode='42501';
    end if;

    update public.markers set production_orders=p_orders where id=p_marker_id;
    return jsonb_build_object('marker_id',p_marker_id,'production_orders',p_orders);
end;
$function$;
revoke all on function public.save_production_orders(bigint,jsonb) from public,anon;
grant execute on function public.save_production_orders(bigint,jsonb) to authenticated;
