-- A single provincial levy order mobilizes every available estate quota.
create or replace function public.calculate_military_levy_groups(
    p_count integer,
    p_levy_kind text,
    p_culture text,
    p_season text
) returns jsonb
language sql
immutable
set search_path = ''
as $function$
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
        select type, case when type = 'Лучники' and lower(coalesce(p_culture,'')) ~ '(свей|эст)'
                    then weight / 2.0 else weight end as weight, ordering * 2 as ordering
          from selected
        union all
        select 'Арбалетчики', weight / 2.0, ordering * 2 + 1
          from selected where type = 'Лучники' and lower(coalesce(p_culture,'')) ~ '(свей|эст)'
    ),
    cavalry_share as (
        select coalesce(sum(weight),0) / 2.0 as weight from ranged_split
         where type in ('Конные копейщики','Лёгкая конница')
    ),
    horse_split as (
        select type, case when lower(coalesce(p_culture,'')) like '%казан%'
                    and type in ('Конные копейщики','Лёгкая конница') then weight / 2.0 else weight end as weight,
               ordering * 2 as ordering
          from ranged_split
        union all
        select 'Конные лучники', weight, 99 from cavalry_share
         where lower(coalesce(p_culture,'')) like '%казан%'
    ),
    winter_split as (
        select type,
               case when p_levy_kind <> 'aristocracy' and p_season = 'Зима'
                      and lower(coalesce(p_culture,'')) ~ '(коми|саам)' and type = 'Пешие ратники'
                    then weight - least(5.0, weight) else weight end as weight,
               ordering * 2 as ordering
          from horse_split
        union all
        select 'Лыжники-разведчики', least(5.0, weight), ordering * 2 + 1
          from horse_split
         where p_levy_kind <> 'aristocracy' and p_season = 'Зима'
           and lower(coalesce(p_culture,'')) ~ '(коми|саам)' and type = 'Пешие ратники'
    ),
    exact as (
        select type, ordering, greatest(0,p_count) * weight / 100.0 as exact_count,
               floor(greatest(0,p_count) * weight / 100.0)::integer as base_count
          from winter_split where weight > 0
    ),
    ranked as (
        select *, row_number() over (order by exact_count - base_count desc, ordering, type) as remainder_rank,
               greatest(0,p_count) - sum(base_count) over () as remainder_count
          from exact
    )
    select coalesce(jsonb_agg(jsonb_build_object('type',type,'count',base_count + case when remainder_rank <= remainder_count then 1 else 0 end)
                    order by ordering, type), '[]'::jsonb)
      from ranked
     where base_count + case when remainder_rank <= remainder_count then 1 else 0 end > 0;
$function$;
revoke all on function public.calculate_military_levy_groups(integer,text,text,text) from public, anon, authenticated;

drop function if exists public.place_military_levy_order(text,bigint);
drop function if exists public.place_military_levy_order(bigint,bigint);
create function public.place_military_levy_order(
    p_province_id bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_profile public.profiles%rowtype;
    v_province public."Provinces"%rowtype;
    v_marker public.markers%rowtype;
    v_source record;
    v_state public.state_mechanics%rowtype;
    v_calendar public.game_calendar%rowtype;
    v_source_yards numeric;
    v_estate_ratio numeric;
    v_quota integer;
    v_used integer;
    v_count integer;
    v_groups jsonb;
    v_plans jsonb := '[]'::jsonb;
    v_total_groups jsonb := '[]'::jsonb;
    v_total_count integer := 0;
    v_treasury numeric;
    v_treasury_cost numeric := 0;
    v_arms_cost numeric := 0;
    v_cloth_cost numeric := 0;
    v_roster_treasury numeric;
    v_roster_arms numeric;
    v_roster_cloth numeric;
    v_cost_factor numeric := 1;
    v_arms numeric;
    v_cloth numeric;
    v_due_turn integer;
    v_order_id uuid;
    v_order_ids jsonb := '[]'::jsonb;
    v_center_x numeric;
    v_center_y numeric;
    v_season text;
begin
    select * into v_profile from public.profiles where id = (select auth.uid());
    if not found or coalesce(v_profile.role, '') <> 'player' or nullif(v_profile.owner, '') is null then
        raise exception 'Only a state player can order militia' using errcode = '42501';
    end if;
    select * into v_province from public."Provinces" where id = p_province_id for update;
    if not found or v_province.owner is distinct from v_profile.owner or v_province.occupied_by is not null then
        raise exception 'Choose an uncontested province controlled by your state' using errcode = '22023';
    end if;

    -- The province center is derived from its military grid cells. Place the
    -- arriving contingent in the nearest non-ruined settlement the player owns.
    select avg(cell_x), avg(cell_y) into v_center_x, v_center_y
      from public.military_grid_cells where province_id = v_province.id;
    if v_center_x is null or v_center_y is null then
        raise exception 'Military grid data is unavailable for this province' using errcode = '22023';
    end if;
    select * into v_marker
      from public.markers marker
     where marker.owner = v_profile.owner and marker.type <> 'ruins'
       and marker.province_id is not null
       and not exists (select 1 from public."Provinces" occupied
                        where occupied.id = marker.province_id and occupied.occupied_by is not null)
     order by power(floor(marker.coord_1::numeric/24)::numeric-v_center_x,2)
            + power(floor(marker.coord_2::numeric/24)::numeric-v_center_y,2), marker.id
     limit 1 for update;
    if not found then raise exception 'Your state has no controlled settlement to receive the militia' using errcode = '23514'; end if;

    select * into v_calendar from public.game_calendar where singleton = true for update;
    if not found then raise exception 'Game calendar is unavailable' using errcode = '22023'; end if;
    v_season := v_calendar.season;
    select greatest(0,1+coalesce(sum(value),0)/100) into v_cost_factor
      from public.state_modifiers
     where owner = v_profile.owner and effect_key = 'military_recruitment_cost_pct'
       and scope_type = 'state' and status = 'active'
       and starts_turn <= v_calendar.turn and (ends_turn is null or ends_turn >= v_calendar.turn);

    for v_source in
        select 'peasants'::text as kind, v_province.id as source_id,
               greatest(0,coalesce(v_province.yards,0))*coalesce(r.peasants,0.95) as yards,
               coalesce(v_province.main_culture,'') as culture, 0 as sort_order
          from public.settlement_estate_ratios r where r.settlement_type='province'
        union all
        select source.kind, source.id, greatest(0,coalesce(source.yards,0))*coalesce(source.ratio,0),
               coalesce(source.culture,v_province.main_culture,''), source.sort_order
          from (
            select marker.id, marker.yards, marker.culture, ratio.aristocracy as ratio,
                   'aristocracy'::text as kind, 1 as sort_order
              from public.markers marker join public.settlement_estate_ratios ratio on ratio.settlement_type=marker.type
             where marker.province_id=v_province.id and marker.owner=v_profile.owner and marker.type<>'ruins'
            union all
            select marker.id, marker.yards, marker.culture, ratio.burghers as ratio,
                   'burghers'::text as kind, 2 as sort_order
              from public.markers marker join public.settlement_estate_ratios ratio on ratio.settlement_type=marker.type
             where marker.province_id=v_province.id and marker.owner=v_profile.owner
               and marker.type in ('city','large_city')
          ) source
        order by sort_order, source_id, kind
    loop
        v_quota := floor(v_source.yards / case v_source.kind when 'peasants' then 20 when 'aristocracy' then 2 else 10 end);
        select coalesce(sum((group_row.value->>'count')::integer),0)::integer into v_used
          from public.military_forces force
          cross join lateral jsonb_array_elements(force.unit_groups) as group_row(value)
         where force.is_militia and force.status='active'
           and force.levy_source_kind=v_source.kind and force.levy_source_id=v_source.source_id;
        v_used := v_used + coalesce((select sum(order_row.unit_count)::integer
            from public.military_levy_orders order_row
            where order_row.status='training' and order_row.levy_kind=v_source.kind and order_row.source_id=v_source.source_id),0);
        v_count := greatest(0,v_quota-v_used);
        if v_count > 0 then
            v_groups := public.calculate_military_levy_groups(v_count,v_source.kind,v_source.culture,v_season);
            select coalesce(sum((unit.value->>'count')::numeric * case
                       when unit.value->>'type' in ('Конные копейщики','Лёгкая конница','Конные лучники') then 1 else 0.5 end),0),
                   coalesce(sum((unit.value->>'count')::numeric * case
                       when unit.value->>'type' in ('Конные копейщики','Лёгкая конница','Конные лучники') then 0.10 else 0.05 end),0),
                   coalesce(sum((unit.value->>'count')::numeric * case
                       when unit.value->>'type' in ('Конные копейщики','Лёгкая конница','Конные лучники') then 0.05 else 0.025 end),0)
              into v_roster_treasury,v_roster_arms,v_roster_cloth
              from jsonb_array_elements(v_groups) unit(value);
            v_roster_treasury := round(v_roster_treasury*v_cost_factor,2);
            v_roster_arms := round(v_roster_arms*v_cost_factor,2);
            v_roster_cloth := round(v_roster_cloth*v_cost_factor,2);
            v_treasury_cost := v_treasury_cost+v_roster_treasury;
            v_arms_cost := v_arms_cost+v_roster_arms;
            v_cloth_cost := v_cloth_cost+v_roster_cloth;
            v_plans := v_plans || jsonb_build_array(jsonb_build_object(
                'kind',v_source.kind,'source_id',v_source.source_id,'count',v_count,'groups',v_groups,
                'treasury_paid',v_roster_treasury,'arms_paid',v_roster_arms,'cloth_paid',v_roster_cloth));
            v_total_count := v_total_count+v_count;
            select coalesce(jsonb_agg(jsonb_build_object('type',unit_type,'count',unit_count) order by unit_type),'[]'::jsonb)
              into v_groups
              from (select all_groups.value->>'type' as unit_type,sum((all_groups.value->>'count')::integer)::integer as unit_count
                      from jsonb_array_elements(v_total_groups || v_groups) as all_groups(value)
                     group by all_groups.value->>'type') combined;
            v_total_groups := v_groups;
        end if;
    end loop;
    if v_total_count < 1 then raise exception 'No uncommitted levy quota remains in this province' using errcode = '23514'; end if;

    select * into v_state from public.state_mechanics where owner=v_profile.owner for update;
    if not found then raise exception 'State economy is unavailable' using errcode = '22023'; end if;
    v_treasury := greatest(0,coalesce((v_state.settings #>> '{economy,treasury}')::numeric,0));
    if v_treasury < v_treasury_cost then raise exception 'Not enough treasury: need % z',v_treasury_cost using errcode = '23514'; end if;
    select coalesce(quantity,0) into v_arms from public.marker_inventories
     where marker_id=v_marker.id and item_type='good' and item_name='Оружие и Доспехи' for update;
    select coalesce(quantity,0) into v_cloth from public.marker_inventories
     where marker_id=v_marker.id and item_type='good' and item_name='Сукно и Одежда' for update;
    if coalesce(v_arms,0)<v_arms_cost then raise exception 'The settlement warehouse lacks Weapons and Armor (% required)',v_arms_cost using errcode='23514'; end if;
    if coalesce(v_cloth,0)<v_cloth_cost then raise exception 'The settlement warehouse lacks Cloth and Clothing (% required)',v_cloth_cost using errcode='23514'; end if;

    update public.state_mechanics set settings=coalesce(settings,'{}'::jsonb) || jsonb_build_object(
        'economy',coalesce(settings->'economy','{}'::jsonb) || jsonb_build_object('treasury',v_treasury-v_treasury_cost)
    ),updated_at=now() where owner=v_profile.owner;
    update public.marker_inventories set quantity=quantity-v_arms_cost
     where marker_id=v_marker.id and item_type='good' and item_name='Оружие и Доспехи';
    update public.marker_inventories set quantity=quantity-v_cloth_cost
     where marker_id=v_marker.id and item_type='good' and item_name='Сукно и Одежда';
    for v_source in select value as plan from jsonb_array_elements(v_plans)
    loop
        insert into public.military_levy_orders(owner,levy_kind,source_id,destination_marker_id,unit_type,unit_count,unit_groups,emergency,
            submitted_turn,due_turn,treasury_paid,arms_paid,cloth_paid)
        values(v_profile.owner,v_source.plan->>'kind',(v_source.plan->>'source_id')::bigint,v_marker.id,'Ополчение',
            (v_source.plan->>'count')::integer,v_source.plan->'groups',false,v_calendar.turn,v_calendar.turn+1,
            (v_source.plan->>'treasury_paid')::numeric,(v_source.plan->>'arms_paid')::numeric,(v_source.plan->>'cloth_paid')::numeric)
        returning id into v_order_id;
        v_order_ids := v_order_ids || jsonb_build_array(v_order_id);
    end loop;
    v_due_turn := v_calendar.turn+1;
    return jsonb_build_object('ids',v_order_ids,'due_turn',v_due_turn,'unit_count',v_total_count,'unit_groups',v_total_groups,
        'treasury_paid',v_treasury_cost,'arms_paid',v_arms_cost,'cloth_paid',v_cloth_cost,'destination_marker_id',v_marker.id,
        'source_plans',v_plans,'cost_modifier_pct',round((v_cost_factor-1)*100,2));
end;
$function$;
revoke all on function public.place_military_levy_order(bigint) from public,anon;
grant execute on function public.place_military_levy_order(bigint) to authenticated;
