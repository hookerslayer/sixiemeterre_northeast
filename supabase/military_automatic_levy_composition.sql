-- Automatic militia composition and removal of extraordinary levy orders.
alter table public.military_levy_orders
    add column if not exists unit_groups jsonb not null default '[]'::jsonb;

alter table public.military_levy_orders
    drop constraint if exists military_levy_orders_unit_groups_array;
alter table public.military_levy_orders
    add constraint military_levy_orders_unit_groups_array
    check (jsonb_typeof(unit_groups) = 'array');

drop function if exists public.place_military_levy_order(text,bigint,text,integer,boolean);
drop function if exists public.place_military_levy_order(text,bigint,text,integer);

create or replace function public.place_military_levy_order(
    p_levy_kind text,
    p_destination_marker_id bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_profile public.profiles%rowtype;
    v_marker public.markers%rowtype;
    v_province public."Provinces"%rowtype;
    v_state public.state_mechanics%rowtype;
    v_calendar public.game_calendar%rowtype;
    v_source_id bigint;
    v_source_yards numeric;
    v_estate_ratio numeric;
    v_culture text;
    v_divisor integer;
    v_quota integer;
    v_used integer := 0;
    v_count integer := 0;
    v_unit_groups jsonb := '[]'::jsonb;
    v_treasury numeric;
    v_treasury_cost numeric := 0;
    v_arms_cost numeric := 0;
    v_cloth_cost numeric := 0;
    v_cost_factor numeric := 1;
    v_arms numeric;
    v_cloth numeric;
    v_order_id uuid;
begin
    select * into v_profile from public.profiles where id = (select auth.uid());
    if not found or coalesce(v_profile.role, '') <> 'player' or nullif(v_profile.owner, '') is null then
        raise exception 'Only a state player can order militia' using errcode = '42501';
    end if;
    if coalesce(p_levy_kind, '') not in ('aristocracy','burghers','peasants') then
        raise exception 'Invalid levy source' using errcode = '22023';
    end if;
    select * into v_marker from public.markers where id = p_destination_marker_id for update;
    if not found or v_marker.owner is distinct from v_profile.owner or v_marker.type = 'ruins' then
        raise exception 'Choose a non-ruined settlement controlled by your state' using errcode = '22023';
    end if;
    if v_marker.province_id is null then
        raise exception 'The chosen settlement is not assigned to a province' using errcode = '22023';
    end if;
    select * into v_province from public."Provinces" where id = v_marker.province_id for update;
    if not found or v_province.owner is distinct from v_profile.owner or v_province.occupied_by is not null then
        raise exception 'The settlement province is not under uncontested control' using errcode = '22023';
    end if;
    if p_levy_kind = 'burghers' and v_marker.type not in ('city','large_city') then
        raise exception 'Burgher levies can only be gathered in a city or large city' using errcode = '22023';
    end if;

    v_source_id := case when p_levy_kind = 'peasants' then v_province.id else v_marker.id end;
    v_culture := case when p_levy_kind = 'peasants'
        then coalesce(v_province.main_culture, v_marker.culture)
        else coalesce(v_marker.culture, v_province.main_culture) end;
    if p_levy_kind = 'peasants' then
        select coalesce(peasants, 0) into v_estate_ratio
          from public.settlement_estate_ratios where settlement_type = 'province';
        v_source_yards := greatest(0, coalesce(v_province.yards, 0)) * coalesce(v_estate_ratio, 0.95);
        v_divisor := 20;
    else
        select case p_levy_kind when 'aristocracy' then aristocracy else burghers end
          into v_estate_ratio from public.settlement_estate_ratios where settlement_type = v_marker.type;
        v_source_yards := greatest(0, coalesce(v_marker.yards, 0)) * coalesce(v_estate_ratio, 0);
        v_divisor := case p_levy_kind when 'aristocracy' then 2 else 10 end;
    end if;
    v_quota := floor(v_source_yards / v_divisor);

    select coalesce(sum((group_row.value->>'count')::integer), 0)::integer into v_used
      from public.military_forces force
      cross join lateral jsonb_array_elements(force.unit_groups) as group_row(value)
     where force.is_militia and force.status = 'active'
       and force.levy_source_kind = p_levy_kind and force.levy_source_id = v_source_id;
    v_used := v_used + coalesce((select sum(order_row.unit_count)::integer
        from public.military_levy_orders order_row
        where order_row.status = 'training' and order_row.levy_kind = p_levy_kind and order_row.source_id = v_source_id), 0);
    v_count := greatest(0, v_quota - v_used);
    if v_count < 1 then
        raise exception 'No uncommitted levy quota remains at this source' using errcode = '23514';
    end if;

    select * into v_calendar from public.game_calendar where singleton = true for update;
    if not found then raise exception 'Game calendar is unavailable' using errcode = '22023'; end if;

    with base(type, weight, ordering) as (
        values
          ('Конные копейщики',70,1),('Лёгкая конница',30,2),
          ('Копейщики',45,1),('Пешие ратники',35,2),('Лучники',20,3),
          ('Пешие ратники',40,1),('Копейщики',35,2),('Лучники',20,3),('Лёгкая конница',5,4)
    ),
    selected as (
        select * from base where
          (p_levy_kind = 'aristocracy' and ordering <= 2 and type in ('Конные копейщики','Лёгкая конница')) or
          (p_levy_kind = 'burghers' and ordering <= 3 and type in ('Копейщики','Пешие ратники','Лучники')) or
          (p_levy_kind = 'peasants' and ordering <= 4 and type in ('Пешие ратники','Копейщики','Лучники','Лёгкая конница'))
    ),
    ranged_split as (
        select type, case when type = 'Лучники' and lower(coalesce(v_culture,'')) ~ '(свей|эст)'
                    then weight / 2.0 else weight end as weight, ordering * 2 as ordering
          from selected
        union all
        select 'Арбалетчики', weight / 2.0, ordering * 2 + 1
          from selected where type = 'Лучники' and lower(coalesce(v_culture,'')) ~ '(свей|эст)'
    ),
    cavalry_share as (
        select coalesce(sum(weight),0) / 2.0 as weight from ranged_split
         where type in ('Конные копейщики','Лёгкая конница')
    ),
    horse_split as (
        select type, case when lower(coalesce(v_culture,'')) like '%казан%'
                    and type in ('Конные копейщики','Лёгкая конница') then weight / 2.0 else weight end as weight,
               ordering * 2 as ordering
          from ranged_split
        union all
        select 'Конные лучники', weight, 99 from cavalry_share
         where lower(coalesce(v_culture,'')) like '%казан%'
    ),
    winter_split as (
        select type,
               case when p_levy_kind <> 'aristocracy' and v_calendar.season = 'Зима'
                      and lower(coalesce(v_culture,'')) ~ '(коми|саам)' and type = 'Пешие ратники'
                    then weight - least(5.0, weight) else weight end as weight,
               ordering * 2 as ordering
          from horse_split
        union all
        select 'Лыжники-разведчики', least(5.0, weight), ordering * 2 + 1
          from horse_split
         where p_levy_kind <> 'aristocracy' and v_calendar.season = 'Зима'
           and lower(coalesce(v_culture,'')) ~ '(коми|саам)' and type = 'Пешие ратники'
    ),
    exact as (
        select type, ordering, v_count * weight / 100.0 as exact_count,
               floor(v_count * weight / 100.0)::integer as base_count
          from winter_split where weight > 0
    ),
    ranked as (
        select *, row_number() over (order by exact_count - base_count desc, ordering, type) as remainder_rank,
               v_count - sum(base_count) over () as remainder_count
          from exact
    )
    select coalesce(jsonb_agg(jsonb_build_object('type',type,'count',base_count + case when remainder_rank <= remainder_count then 1 else 0 end)
                    order by ordering, type), '[]'::jsonb)
      into v_unit_groups from ranked
     where base_count + case when remainder_rank <= remainder_count then 1 else 0 end > 0;

    select coalesce(sum((group_row.value->>'count')::integer),0)::integer,
           coalesce(sum((group_row.value->>'count')::numeric * case
             when group_row.value->>'type' in ('Конные копейщики','Лёгкая конница','Конные лучники') then 1 else 0.5 end),0),
           coalesce(sum((group_row.value->>'count')::numeric * case
             when group_row.value->>'type' in ('Конные копейщики','Лёгкая конница','Конные лучники') then 0.10 else 0.05 end),0),
           coalesce(sum((group_row.value->>'count')::numeric * case
             when group_row.value->>'type' in ('Конные копейщики','Лёгкая конница','Конные лучники') then 0.05 else 0.025 end),0)
      into v_count, v_treasury_cost, v_arms_cost, v_cloth_cost
      from jsonb_array_elements(v_unit_groups) as group_row(value);

    select greatest(0,1+coalesce(sum(value),0)/100) into v_cost_factor
      from public.state_modifiers
     where owner = v_profile.owner and effect_key = 'military_recruitment_cost_pct'
       and scope_type = 'state' and status = 'active'
       and starts_turn <= v_calendar.turn and (ends_turn is null or ends_turn >= v_calendar.turn);
    v_treasury_cost := round(v_treasury_cost*v_cost_factor,2);
    v_arms_cost := round(v_arms_cost*v_cost_factor,2);
    v_cloth_cost := round(v_cloth_cost*v_cost_factor,2);
    select * into v_state from public.state_mechanics where owner = v_profile.owner for update;
    if not found then raise exception 'State economy is unavailable' using errcode = '22023'; end if;
    v_treasury := greatest(0, coalesce((v_state.settings #>> '{economy,treasury}')::numeric, 0));
    if v_treasury < v_treasury_cost then raise exception 'Not enough treasury: need % z', v_treasury_cost using errcode = '23514'; end if;
    select coalesce(quantity,0) into v_arms from public.marker_inventories
      where marker_id = v_marker.id and item_type = 'good' and item_name = 'Оружие и Доспехи' for update;
    select coalesce(quantity,0) into v_cloth from public.marker_inventories
      where marker_id = v_marker.id and item_type = 'good' and item_name = 'Сукно и Одежда' for update;
    if coalesce(v_arms,0) < v_arms_cost then raise exception 'The settlement warehouse lacks Weapons and Armor (% required)', v_arms_cost using errcode = '23514'; end if;
    if coalesce(v_cloth,0) < v_cloth_cost then raise exception 'The settlement warehouse lacks Cloth and Clothing (% required)', v_cloth_cost using errcode = '23514'; end if;

    update public.state_mechanics
       set settings = coalesce(settings,'{}'::jsonb) || jsonb_build_object(
               'economy', coalesce(settings->'economy','{}'::jsonb) || jsonb_build_object('treasury',v_treasury-v_treasury_cost)
           ), updated_at = now()
     where owner = v_profile.owner;
    update public.marker_inventories set quantity = quantity - v_arms_cost
     where marker_id = v_marker.id and item_type = 'good' and item_name = 'Оружие и Доспехи';
    update public.marker_inventories set quantity = quantity - v_cloth_cost
     where marker_id = v_marker.id and item_type = 'good' and item_name = 'Сукно и Одежда';
    insert into public.military_levy_orders(owner, levy_kind, source_id, destination_marker_id, unit_type, unit_count, unit_groups, emergency,
        submitted_turn, due_turn, treasury_paid, arms_paid, cloth_paid)
    values(v_profile.owner, p_levy_kind, v_source_id, v_marker.id, 'Ополчение', v_count, v_unit_groups, false,
        v_calendar.turn, v_calendar.turn + 1, v_treasury_cost, v_arms_cost, v_cloth_cost)
    returning id into v_order_id;
    return jsonb_build_object('id',v_order_id,'due_turn',v_calendar.turn+1,'unit_type','Ополчение','unit_count',v_count,
        'unit_groups',v_unit_groups,'treasury_paid',v_treasury_cost,'arms_paid',v_arms_cost,'cloth_paid',v_cloth_cost,
        'cost_modifier_pct',round((v_cost_factor-1)*100,2),'quota',v_quota,'quota_used',v_used);
end;
$function$;

revoke all on function public.place_military_levy_order(text,bigint) from public, anon;
grant execute on function public.place_military_levy_order(text,bigint) to authenticated;

create or replace function public.process_military_levy_orders()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_order public.military_levy_orders%rowtype;
    v_force_id uuid;
    v_groups jsonb;
begin
    if new.turn <= old.turn then return new; end if;
    update public.military_forces
       set status = 'disbanded', updated_at = now()
     where is_militia and status = 'active' and service_end_turn is not null and service_end_turn <= new.turn;
    for v_order in
        select * from public.military_levy_orders
         where status = 'training' and due_turn <= new.turn
         order by created_at, id
         for update
    loop
        v_groups := case when jsonb_array_length(coalesce(v_order.unit_groups,'[]'::jsonb)) > 0
            then v_order.unit_groups
            else jsonb_build_array(jsonb_build_object('type',v_order.unit_type,'count',v_order.unit_count)) end;
        insert into public.military_forces(owner, name, force_kind, marker_id, unit_groups, morale, action_points,
            status, is_militia, levy_source_kind, levy_source_id, service_end_turn, militia_base_end_turn)
        values(v_order.owner, 'Ополчение · ' || v_order.levy_kind, 'garrison', v_order.destination_marker_id, v_groups, 100, 0,
            'active', true, v_order.levy_kind, v_order.source_id, new.turn + 4, new.turn + 4)
        returning id into v_force_id;
        update public.military_levy_orders set status = 'raised', force_id = v_force_id where id = v_order.id;
    end loop;
    return new;
end;
$function$;
revoke all on function public.process_military_levy_orders() from public, anon, authenticated;
drop trigger if exists process_military_levy_orders_on_turn on public.game_calendar;
create trigger process_military_levy_orders_on_turn
    after update of turn on public.game_calendar
    for each row execute function public.process_military_levy_orders();
