-- Apply approved state modifiers to militia recruitment costs.
create or replace function public.place_military_levy_order(
    p_levy_kind text,
    p_destination_marker_id bigint,
    p_unit_type text,
    p_unit_count integer,
    p_emergency boolean default false
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
    v_source_kind text;
    v_source_id bigint;
    v_source_yards numeric;
    v_estate_ratio numeric;
    v_culture text;
    v_divisor integer;
    v_quota integer;
    v_used integer := 0;
    v_treasury numeric;
    v_treasury_cost numeric;
    v_arms_cost numeric;
    v_cloth_cost numeric;
    v_cost_factor numeric := 1;
    v_arms numeric;
    v_cloth numeric;
    v_order_id uuid;
begin
    select * into v_profile from public.profiles where id = (select auth.uid());
    if not found or coalesce(v_profile.role, '') <> 'player' or nullif(v_profile.owner, '') is null then
        raise exception 'Only a state player can order militia' using errcode = '42501';
    end if;
    if coalesce(p_levy_kind, '') not in ('aristocracy','burghers','peasants') or coalesce(p_unit_count, 0) < 1 or p_unit_count > 100000 then
        raise exception 'Invalid levy order' using errcode = '22023';
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

    v_source_kind := p_levy_kind;
    v_source_id := case when p_levy_kind = 'peasants' then v_province.id else v_marker.id end;
    v_culture := case when p_levy_kind = 'peasants' then coalesce(v_province.main_culture, v_marker.culture) else coalesce(v_marker.culture, v_province.main_culture) end;
    if p_levy_kind = 'peasants' then
        select coalesce(peasants, 0) into v_estate_ratio from public.settlement_estate_ratios where settlement_type = 'province';
        v_source_yards := greatest(0, coalesce(v_province.yards, 0)) * coalesce(v_estate_ratio, 0.95);
        v_divisor := 20;
    else
        select case p_levy_kind when 'aristocracy' then aristocracy else burghers end
          into v_estate_ratio from public.settlement_estate_ratios where settlement_type = v_marker.type;
        v_source_yards := greatest(0, coalesce(v_marker.yards, 0)) * coalesce(v_estate_ratio, 0);
        v_divisor := case p_levy_kind when 'aristocracy' then 2 else 10 end;
    end if;
    if p_emergency then v_divisor := v_divisor / 2; end if;
    v_quota := floor(v_source_yards / greatest(1, v_divisor));

    if p_unit_type is null then
        raise exception 'Choose a unit type' using errcode = '22023';
    elsif p_levy_kind = 'aristocracy' then
        if p_unit_type not in ('Конные копейщики','Лёгкая конница','Конные лучники') then raise exception 'Aristocratic levies must be cavalry' using errcode = '22023'; end if;
    elsif p_levy_kind = 'burghers' then
        if p_unit_type not in ('Пешие ратники','Копейщики','Лучники','Арбалетчики') then raise exception 'Invalid burgher levy unit' using errcode = '22023'; end if;
    elsif p_unit_type not in ('Пешие ратники','Копейщики','Лучники','Арбалетчики','Конные копейщики','Лёгкая конница','Конные лучники') then
        raise exception 'Invalid peasant levy unit' using errcode = '22023';
    end if;
    if p_unit_type = 'Арбалетчики' and lower(coalesce(v_culture,'')) not like '%све%' and lower(coalesce(v_culture,'')) not like '%эст%' then raise exception 'Crossbowmen are only available to Svei and Estonian cultures' using errcode = '22023'; end if;
    if p_unit_type = 'Конные лучники' and lower(coalesce(v_culture,'')) not like '%казан%' then raise exception 'Horse archers are only available to Kazanly culture' using errcode = '22023'; end if;

    select coalesce(sum((group_row.value->>'count')::integer), 0)::integer into v_used
      from public.military_forces force
      cross join lateral jsonb_array_elements(force.unit_groups) as group_row(value)
     where force.is_militia and force.status = 'active' and force.levy_source_kind = v_source_kind and force.levy_source_id = v_source_id;
    v_used := v_used + coalesce((select sum(order_row.unit_count)::integer from public.military_levy_orders order_row
        where order_row.status = 'training' and order_row.levy_kind = v_source_kind and order_row.source_id = v_source_id), 0);
    if p_unit_count > greatest(0, v_quota - v_used) then
        raise exception 'Requested count exceeds the remaining levy quota (% available)', greatest(0, v_quota - v_used) using errcode = '23514';
    end if;

    select * into v_state from public.state_mechanics where owner = v_profile.owner for update;
    if not found then raise exception 'State economy is unavailable' using errcode = '22023'; end if;
    select * into v_calendar from public.game_calendar where singleton = true for update;
    if not found then raise exception 'Game calendar is unavailable' using errcode = '22023'; end if;
    select greatest(0,1+coalesce(sum(value),0)/100) into v_cost_factor
      from public.state_modifiers
     where owner = v_profile.owner and effect_key = 'military_recruitment_cost_pct'
       and scope_type = 'state' and status = 'active'
       and starts_turn <= v_calendar.turn and (ends_turn is null or ends_turn >= v_calendar.turn);
    v_treasury := greatest(0, coalesce((v_state.settings #>> '{economy,treasury}')::numeric, 0));
    if p_unit_type in ('Конные копейщики','Лёгкая конница','Конные лучники') then
        v_treasury_cost := p_unit_count * 1 * case when p_emergency then 2 else 1 end;
        v_arms_cost := p_unit_count * 0.10;
        v_cloth_cost := p_unit_count * 0.05;
    else
        v_treasury_cost := p_unit_count * 0.5 * case when p_emergency then 2 else 1 end;
        v_arms_cost := p_unit_count * 0.05;
        v_cloth_cost := p_unit_count * 0.025;
    end if;
    v_treasury_cost := round(v_treasury_cost*v_cost_factor,2);
    v_arms_cost := round(v_arms_cost*v_cost_factor,2);
    v_cloth_cost := round(v_cloth_cost*v_cost_factor,2);
    if v_treasury < v_treasury_cost then raise exception 'Not enough treasury: need % z', v_treasury_cost using errcode = '23514'; end if;
    select coalesce(quantity,0) into v_arms from public.marker_inventories where marker_id = v_marker.id and item_type = 'good' and item_name = 'Оружие и Доспехи' for update;
    select coalesce(quantity,0) into v_cloth from public.marker_inventories where marker_id = v_marker.id and item_type = 'good' and item_name = 'Сукно и Одежда' for update;
    if coalesce(v_arms,0) < v_arms_cost then raise exception 'The settlement warehouse lacks Weapons and Armor (% required)', v_arms_cost using errcode = '23514'; end if;
    if coalesce(v_cloth,0) < v_cloth_cost then raise exception 'The settlement warehouse lacks Cloth and Clothing (% required)', v_cloth_cost using errcode = '23514'; end if;

    update public.state_mechanics
       set settings = coalesce(settings,'{}'::jsonb) || jsonb_build_object(
               'economy', coalesce(settings->'economy','{}'::jsonb) || jsonb_build_object('treasury',v_treasury-v_treasury_cost)
           ),
           updated_at = now()
     where owner = v_profile.owner;
    update public.marker_inventories set quantity = quantity - v_arms_cost
     where marker_id = v_marker.id and item_type = 'good' and item_name = 'Оружие и Доспехи';
    update public.marker_inventories set quantity = quantity - v_cloth_cost
     where marker_id = v_marker.id and item_type = 'good' and item_name = 'Сукно и Одежда';
    insert into public.military_levy_orders(owner, levy_kind, source_id, destination_marker_id, unit_type, unit_count, emergency,
        submitted_turn, due_turn, treasury_paid, arms_paid, cloth_paid)
    values(v_profile.owner, p_levy_kind, v_source_id, v_marker.id, p_unit_type, p_unit_count, coalesce(p_emergency,false),
        v_calendar.turn, v_calendar.turn + 1, v_treasury_cost, v_arms_cost, v_cloth_cost)
    returning id into v_order_id;
    return jsonb_build_object('id',v_order_id,'due_turn',v_calendar.turn+1,'unit_type',p_unit_type,'unit_count',p_unit_count,
        'treasury_paid',v_treasury_cost,'arms_paid',v_arms_cost,'cloth_paid',v_cloth_cost,'cost_modifier_pct',round((v_cost_factor-1)*100,2),'quota',v_quota,'quota_used',v_used);
end;
$function$;

revoke all on function public.place_military_levy_order(text,bigint,text,integer,boolean) from public, anon;
grant execute on function public.place_military_levy_order(text,bigint,text,integer,boolean) to authenticated;
