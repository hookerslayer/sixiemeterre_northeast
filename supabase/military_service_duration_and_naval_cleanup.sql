-- Longer militia and mercenary service, extended-service loyalty effects, and public map access.
alter table public.military_forces add column if not exists militia_base_end_turn integer;
update public.military_forces set militia_base_end_turn=service_end_turn+2, service_end_turn=service_end_turn+2 where is_militia and status='active' and service_end_turn is not null and militia_base_end_turn is null;
update public.military_forces set militia_base_end_turn=service_end_turn where is_militia and status='active' and service_end_turn is not null and militia_base_end_turn is null;

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
revoke all on function public.process_military_levy_orders() from public,anon,authenticated;

create or replace function public.extend_military_militia_service(p_force_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_profile public.profiles%rowtype;
    v_force public.military_forces%rowtype;
    v_state public.state_mechanics%rowtype;
    v_calendar public.game_calendar%rowtype;
    v_treasury numeric;
    v_unit_count integer;
    v_cost numeric;
begin
    select * into v_profile from public.profiles where id = (select auth.uid());
    if not found or coalesce(v_profile.role, '') <> 'player' or nullif(v_profile.owner, '') is null then
        raise exception 'Only a state player can extend militia service' using errcode = '42501';
    end if;
    select * into v_force from public.military_forces where id = p_force_id for update;
    if not found or v_force.owner is distinct from v_profile.owner or not v_force.is_militia or v_force.status <> 'active' then
        raise exception 'This state has no active militia with an extendable term' using errcode = '42501';
    end if;
    select * into v_calendar from public.game_calendar where singleton = true for update;
    if not found then raise exception 'Game calendar is unavailable' using errcode = '22023'; end if;
    if v_force.service_end_turn is null or v_force.service_end_turn <= v_calendar.turn then
        raise exception 'The militia service period has ended or is expiring this turn' using errcode = '23514';
    end if;
    select coalesce(sum((group_row.value->>'count')::integer), 0)::integer into v_unit_count
      from jsonb_array_elements(v_force.unit_groups) as group_row(value)
     where coalesce((group_row.value->>'count')::integer, 0) > 0;
    if v_unit_count < 1 then raise exception 'The militia has no serving troops' using errcode = '23514'; end if;
    v_cost := v_unit_count * 2;
    select * into v_state from public.state_mechanics where owner = v_profile.owner for update;
    if not found then raise exception 'State treasury is unavailable' using errcode = '22023'; end if;
    v_treasury := greatest(0, coalesce((v_state.settings #>> '{economy,treasury}')::numeric, 0));
    if v_treasury < v_cost then raise exception 'Not enough treasury: need % z', v_cost using errcode = '23514'; end if;

    update public.state_mechanics
       set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object(
               'economy', coalesce(settings->'economy', '{}'::jsonb) || jsonb_build_object('treasury', v_treasury-v_cost)
           ),
           updated_at = now()
     where owner = v_profile.owner;
    update public.military_forces
       set service_end_turn = service_end_turn + 1, updated_at = now()
     where id = v_force.id
     returning * into v_force;
    return jsonb_build_object('force',to_jsonb(v_force),'cost',v_cost,'new_end_turn',v_force.service_end_turn);
end;
$function$;
revoke all on function public.extend_military_militia_service(uuid) from public,anon;
grant execute on function public.extend_military_militia_service(uuid) to authenticated;

create or replace function public.hire_military_mercenary(p_offer_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
    profile public.profiles%rowtype; offer public.military_mercenary_market%rowtype; marker public.markers%rowtype;
    province public."Provinces"%rowtype; cal public.game_calendar%rowtype; settings_row public.state_mechanics%rowtype;
    troop_total integer; contract_cost numeric; force_id uuid;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role<>'player' or nullif(profile.owner,'') is null then raise exception 'Only a state player may hire mercenaries' using errcode='42501'; end if;
    select * into offer from public.military_mercenary_market where id=p_offer_id and available for update;
    if not found then raise exception 'This mercenary offer is no longer available' using errcode='55000'; end if;
    select * into marker from public.markers where id=offer.marker_id for update;
    if not found or marker.owner is distinct from profile.owner or marker.type not in ('city','large_city') or marker.type='ruins'
       or (marker.military_controlled_by is not null and marker.military_controlled_by is distinct from profile.owner) then
        raise exception 'Hire only from a city you currently control' using errcode='42501';
    end if;
    select * into province from public."Provinces" where id=marker.province_id for update;
    if not found or province.owner is distinct from profile.owner or province.occupied_by is not null then raise exception 'The city is not under uncontested control' using errcode='55000'; end if;
    if exists(select 1 from public.military_sieges where marker_id=marker.id and status in ('active','battle_pending')) then raise exception 'A besieged city cannot hire mercenaries' using errcode='55000'; end if;
    select * into cal from public.game_calendar where singleton=true;
    select * into settings_row from public.state_mechanics where owner=profile.owner for update;
    select coalesce(sum((value->>'count')::integer),0)::integer into troop_total from jsonb_array_elements(offer.unit_groups);
    contract_cost:=2*(troop_total+1);
    if coalesce((settings_row.settings#>>'{economy,treasury}')::numeric,0)<contract_cost then raise exception 'Not enough treasury for the first season of the contract (% z)',contract_cost using errcode='23514'; end if;
    update public.state_mechanics set settings=settings||jsonb_build_object('economy',coalesce(settings->'economy','{}'::jsonb)||jsonb_build_object('treasury',(settings_row.settings#>>'{economy,treasury}')::numeric-contract_cost)),updated_at=now() where owner=profile.owner;
    insert into public.military_forces(owner,name,force_kind,marker_id,commander_name,commander_age,unit_groups,morale,action_points,status,is_mercenary,service_end_turn)
    values(profile.owner,offer.commander_name||' · наёмники','garrison',marker.id,offer.commander_name,offer.commander_age,offer.unit_groups,100,0,'active',true,cal.turn+8)
    returning id into force_id;
    update public.military_mercenary_market set available=false,refresh_turn=cal.turn+2,hired_force_id=force_id,updated_at=now() where id=offer.id;
    return jsonb_build_object('force_id',force_id,'commander',offer.commander_name,'troops',troop_total,'paid_z',contract_cost,'service_end_turn',cal.turn+8);
end;
$function$;
revoke all on function public.hire_military_mercenary(uuid) from public,anon;
grant execute on function public.hire_military_mercenary(uuid) to authenticated;

create or replace function public.hire_military_mercenary_camp(p_force_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare profile public.profiles%rowtype; camp public.military_forces%rowtype; province public."Provinces"%rowtype; calendar public.game_calendar%rowtype; state_row public.state_mechanics%rowtype; soldiers integer; cost numeric;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role<>'player' or nullif(profile.owner,'') is null then raise exception 'Only a state player may hire a mercenary camp' using errcode='42501'; end if;
    select * into camp from public.military_forces where id=p_force_id and owner='Лагерь наёмников' and force_kind='land_army' and status='active' for update;
    if not found then raise exception 'Mercenary camp is no longer available' using errcode='55000'; end if;
    select * into province from public."Provinces" where id=camp.province_id;
    if not found or (province.owner is distinct from profile.owner and province.occupied_by is distinct from profile.owner) then raise exception 'Control the camp province or secure access before hiring' using errcode='42501'; end if;
    if exists(select 1 from public.military_battle_armies a join public.military_battles b on b.id=a.battle_id where a.persistent_force_id=camp.id and b.status='pending') then raise exception 'A camp involved in an unresolved battle cannot be hired' using errcode='55000'; end if;
    select * into calendar from public.game_calendar where singleton=true;
    select * into state_row from public.state_mechanics where owner=profile.owner for update;
    select coalesce(sum((value->>'count')::integer),0)::integer into soldiers from jsonb_array_elements(camp.unit_groups);
    cost:=(soldiers+1)*2;
    if coalesce((state_row.settings#>>'{economy,treasury}')::numeric,0)<cost then raise exception 'Not enough treasury for the first season of the contract' using errcode='23514'; end if;
    update public.state_mechanics set settings=settings||jsonb_build_object('economy',coalesce(settings->'economy','{}'::jsonb)||jsonb_build_object('treasury',(state_row.settings#>>'{economy,treasury}')::numeric-cost)),updated_at=now() where owner=profile.owner;
    update public.military_forces set owner=profile.owner,is_mercenary=true,service_end_turn=calendar.turn+8,action_points=0,underfunded_turns=0,updated_at=now()
      where id=camp.id returning * into camp;
    return jsonb_build_object('force_id',camp.id,'troops',soldiers,'paid_z',cost,'service_end_turn',camp.service_end_turn,'hired_from_camp',true);
end;
$function$;
revoke all on function public.hire_military_mercenary_camp(uuid) from public,anon;
grant execute on function public.hire_military_mercenary_camp(uuid) to authenticated;

create or replace function public.apply_extended_militia_loyalty_penalty() returns trigger language plpgsql security definer set search_path='' as $function$
declare affected record; loyalty jsonb;
begin
 if new.turn<=old.turn then return new; end if;
 for affected in select distinct owner from public.military_forces where is_militia and status='active' and militia_base_end_turn is not null and new.turn>militia_base_end_turn and service_end_turn>new.turn loop
   update public.state_mechanics set settings=jsonb_set(coalesce(settings,'{}'::jsonb),'{estate_loyalty}',jsonb_build_object(
     'aristocracy',greatest(0,coalesce((settings#>>'{estate_loyalty,aristocracy}')::numeric,50)-3),
     'clergy',greatest(0,coalesce((settings#>>'{estate_loyalty,clergy}')::numeric,50)-3),
     'burghers',greatest(0,coalesce((settings#>>'{estate_loyalty,burghers}')::numeric,50)-3),
     'peasants',greatest(0,coalesce((settings#>>'{estate_loyalty,peasants}')::numeric,50)-3)),true),updated_at=now() where owner=affected.owner;
 end loop;
 return new;
end;$function$;
revoke all on function public.apply_extended_militia_loyalty_penalty() from public,anon,authenticated;
drop trigger if exists zzz_extended_militia_loyalty_penalty on public.game_calendar;
create trigger zzz_extended_militia_loyalty_penalty after update of turn on public.game_calendar for each row execute function public.apply_extended_militia_loyalty_penalty();

grant select (id,owner,target_province_id,status) on public.military_colonization_missions to authenticated;

-- Remove legacy weapon/service metadata from ships and close the manual service RPC.
update public.military_fleets fleet set ships=coalesce((select jsonb_agg(ship.value-'weapon'-'volleys'-'repair_turn'-'refit_turn'-'fire' order by ship.ordinality) from jsonb_array_elements(fleet.ships) with ordinality as ship(value,ordinality)),'[]'::jsonb);
drop trigger if exists guard_military_ship_port_service on public.military_fleets;
drop function if exists public.guard_military_ship_port_service();
drop function if exists public.service_military_ship(uuid,integer,text,integer,text);

-- Allow Ushkuyniki to be recruited into land retinues by Novgorod and Vyatich cultures.
create or replace function public.place_military_retinue_order(
    p_marker_id bigint,p_unit_type text,p_unit_count integer
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
    v_profile public.profiles%rowtype;
    v_marker public.markers%rowtype;
    v_province public."Provinces"%rowtype;
    v_state public.state_mechanics%rowtype;
    v_calendar public.game_calendar%rowtype;
    v_treasury numeric;
    v_arms numeric;
    v_cloth numeric;
    v_cost_factor numeric:=1;
    v_yards numeric:=0;
    v_limit integer;
    v_committed integer;
    v_treasury_cost numeric;
    v_arms_cost numeric;
    v_cloth_cost numeric;
    v_unit_class text;
    v_order_id uuid;
begin
    select * into v_profile from public.profiles where id=(select auth.uid());
    if not found or v_profile.role<>'player' or nullif(v_profile.owner,'') is null then
        raise exception 'Only a state player can recruit a retinue' using errcode='42501';
    end if;
    if p_unit_count is null or p_unit_count<1 or p_unit_count>5000 then
        raise exception 'Recruitment count must be between 1 and 5000' using errcode='22023';
    end if;
    if p_unit_type not in ('Пешие ратники','Копейщики','Лучники','Арбалетчики','Конные копейщики','Лёгкая конница','Конные лучники','Лыжники-разведчики','Ушкуйники') then
        raise exception 'This unit type cannot be recruited into a retinue' using errcode='22023';
    end if;
    select * into v_marker from public.markers where id=p_marker_id for update;
    if not found or v_marker.owner is distinct from v_profile.owner or v_marker.type='ruins' or v_marker.province_id is null then
        raise exception 'Choose one of your settlements' using errcode='22023';
    end if;
    select * into v_province from public."Provinces" where id=v_marker.province_id for update;
    if not found or v_province.owner is distinct from v_profile.owner or v_province.occupied_by is not null then
        raise exception 'The settlement is not in an uncontested province under your control' using errcode='23514';
    end if;
    if (p_unit_type='Арбалетчики' and lower(coalesce(nullif(v_marker.culture,''),v_province.main_culture,'')) !~ '(свей|эст)')
       or (p_unit_type='Конные лучники' and lower(coalesce(nullif(v_marker.culture,''),v_province.main_culture,'')) not like '%казан%')
       or (p_unit_type='Лыжники-разведчики' and lower(coalesce(nullif(v_marker.culture,''),v_province.main_culture,'')) !~ '(коми|саам)')
       or (p_unit_type='Ушкуйники' and lower(coalesce(nullif(v_marker.culture,''),v_province.main_culture,'')) !~ '(новгород|вятич)') then
        raise exception 'This culture cannot recruit the selected unit type' using errcode='23514';
    end if;
    select * into v_calendar from public.game_calendar where singleton=true for update;
    if p_unit_type='Лыжники-разведчики' and v_calendar.season<>'Зима' then
        raise exception 'Ski scouts can only be recruited in winter' using errcode='23514';
    end if;
    select * into v_state from public.state_mechanics where owner=v_profile.owner for update;
    if not found then raise exception 'State economy is unavailable' using errcode='22023'; end if;

    -- Province yards and settlement yards are separate population pools in the levy model.
    select coalesce(sum(greatest(0,coalesce(province.yards,0))),0)
         + coalesce((select sum(greatest(0,coalesce(marker.yards,0))) from public.markers marker
                      join public."Provinces" province on province.id=marker.province_id
                     where marker.owner=v_profile.owner and marker.type<>'ruins'
                       and province.owner=v_profile.owner and province.occupied_by is null),0)
      into v_yards
      from public."Provinces" province
     where province.owner=v_profile.owner and province.occupied_by is null;
    v_limit:=50+floor(v_yards/50)::integer;
    select coalesce(sum(force_count),0)::integer into v_committed from (
        select coalesce(sum((unit.value->>'count')::integer),0) as force_count
          from public.military_forces force cross join lateral jsonb_array_elements(force.unit_groups) unit(value)
         where force.owner=v_profile.owner and force.is_retinue and force.status<>'disbanded'
        union all
        select coalesce(sum(order_row.unit_count),0)
          from public.military_retinue_orders order_row where order_row.owner=v_profile.owner and order_row.status='training'
    ) committed;
    if v_committed+p_unit_count>v_limit then
        raise exception 'The retinue limit is %; % are already serving or training',v_limit,v_committed using errcode='23514';
    end if;
    v_unit_class:=case when p_unit_type in ('Конные копейщики','Лёгкая конница','Конные лучники') then 'cavalry' else 'foot' end;
    select greatest(0,1+coalesce(sum(value),0)/100) into v_cost_factor
      from public.state_modifiers where owner=v_profile.owner and effect_key='military_recruitment_cost_pct'
        and scope_type='state' and status='active' and starts_turn<=v_calendar.turn and (ends_turn is null or ends_turn>=v_calendar.turn);
    v_treasury_cost:=round(p_unit_count*case v_unit_class when 'cavalry' then 1 else 0.5 end*v_cost_factor,2);
    v_arms_cost:=round(p_unit_count*case v_unit_class when 'cavalry' then 0.1 else 0.05 end*v_cost_factor,3);
    v_cloth_cost:=round(p_unit_count*case v_unit_class when 'cavalry' then 0.05 else 0.025 end*v_cost_factor,3);
    v_treasury:=greatest(0,coalesce((v_state.settings #>> '{economy,treasury}')::numeric,0));
    if v_treasury<v_treasury_cost then raise exception 'Not enough treasury: need % z',v_treasury_cost using errcode='23514'; end if;
    select coalesce(quantity,0) into v_arms from public.marker_inventories where marker_id=v_marker.id and item_type='good' and item_name='Оружие и Доспехи' for update;
    select coalesce(quantity,0) into v_cloth from public.marker_inventories where marker_id=v_marker.id and item_type='good' and item_name='Сукно и Одежда' for update;
    if coalesce(v_arms,0)<v_arms_cost then raise exception 'The settlement warehouse lacks Weapons and Armor (% required)',v_arms_cost using errcode='23514'; end if;
    if coalesce(v_cloth,0)<v_cloth_cost then raise exception 'The settlement warehouse lacks Cloth and Clothing (% required)',v_cloth_cost using errcode='23514'; end if;
    update public.state_mechanics set settings=coalesce(settings,'{}'::jsonb)||jsonb_build_object('economy',coalesce(settings->'economy','{}'::jsonb)||jsonb_build_object('treasury',v_treasury-v_treasury_cost)),updated_at=now() where owner=v_profile.owner;
    update public.marker_inventories set quantity=quantity-v_arms_cost where marker_id=v_marker.id and item_type='good' and item_name='Оружие и Доспехи';
    update public.marker_inventories set quantity=quantity-v_cloth_cost where marker_id=v_marker.id and item_type='good' and item_name='Сукно и Одежда';
    insert into public.military_retinue_orders(owner,destination_marker_id,unit_type,unit_count,submitted_turn,due_turn,treasury_paid,arms_paid,cloth_paid)
    values(v_profile.owner,v_marker.id,p_unit_type,p_unit_count,v_calendar.turn,v_calendar.turn+1,v_treasury_cost,v_arms_cost,v_cloth_cost)
    returning id into v_order_id;
    return jsonb_build_object('id',v_order_id,'due_turn',v_calendar.turn+1,'unit_type',p_unit_type,'unit_count',p_unit_count,
        'limit',v_limit,'serving',v_committed,'treasury_paid',v_treasury_cost,'arms_paid',v_arms_cost,'cloth_paid',v_cloth_cost);
end;
$function$;
revoke all on function public.place_military_retinue_order(bigint,text,integer) from public,anon;
grant execute on function public.place_military_retinue_order(bigint,text,integer) to authenticated;
