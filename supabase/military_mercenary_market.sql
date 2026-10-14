-- City mercenary offers and fixed two-season contracts.
alter table public.military_forces
    add column if not exists is_mercenary boolean not null default false;

create table if not exists public.military_mercenary_market (
    id uuid primary key default gen_random_uuid(),
    marker_id bigint not null references public.markers(id) on delete cascade,
    slot smallint not null check (slot between 1 and 2),
    culture text not null default '',
    commander_name text not null,
    commander_age integer not null check (commander_age between 16 and 100),
    unit_groups jsonb not null check (jsonb_typeof(unit_groups)='array'),
    available boolean not null default true,
    refresh_turn integer,
    hired_force_id uuid references public.military_forces(id) on delete set null,
    updated_at timestamptz not null default now(),
    unique(marker_id,slot)
);
alter table public.military_mercenary_market enable row level security;
drop policy if exists "Mercenary market offers are public to authenticated users" on public.military_mercenary_market;
create policy "Mercenary market offers are public to authenticated users" on public.military_mercenary_market
    for select to authenticated using (true);
revoke all on public.military_mercenary_market from anon,authenticated;
grant select on public.military_mercenary_market to authenticated;

create or replace function public.generate_military_mercenary_offer(p_marker_id bigint,p_slot smallint,p_turn integer)
returns void language plpgsql security definer set search_path = '' as $function$
declare
    marker public.markers%rowtype;
    culture_name text;
    candidates text[];
    unit_name text;
    troop_count integer;
    seed bigint;
    names text[]:=array['Данила','Микула','Ратибор','Ермолай','Василий','Семён','Гаврила','Сава','Игнат'];
    new_groups jsonb;
begin
    select * into marker from public.markers where id=p_marker_id and type in ('city','large_city');
    if not found or p_slot>(case marker.type when 'large_city' then 2 else 1 end) then return; end if;
    select coalesce(nullif(m.culture,''),province.main_culture,'') into culture_name
      from public.markers m left join public."Provinces" province on province.id=m.province_id where m.id=marker.id;
    seed:=abs(hashtextextended(marker.id::text||':'||p_slot::text||':'||p_turn::text,0));
    if lower(culture_name) like '%свей%' or lower(culture_name) like '%эст%' then
        candidates:=array['Пешие ратники','Копейщики','Лучники','Арбалетчики'];
    elsif lower(culture_name) like '%казан%' then
        candidates:=array['Лучники','Лёгкая конница','Конные лучники'];
    elsif lower(culture_name) like '%коми%' or lower(culture_name) like '%саам%' then
        candidates:=array['Пешие ратники','Копейщики','Лучники','Лыжники-разведчики'];
    else
        candidates:=array['Пешие ратники','Копейщики','Лучники'];
    end if;
    unit_name:=candidates[mod(seed,cardinality(candidates))::integer+1];
    troop_count:=100+mod(seed/97,201)::integer;
    new_groups:=jsonb_build_array(jsonb_build_object('type',unit_name,'count',troop_count,'serviceType','mercenary'));
    insert into public.military_mercenary_market(marker_id,slot,culture,commander_name,commander_age,unit_groups,available,refresh_turn,hired_force_id,updated_at)
    values(marker.id,p_slot,culture_name,names[mod(seed/7919,cardinality(names))::integer+1],25+mod(seed/15485863,26)::integer,new_groups,true,null,null,now())
    on conflict(marker_id,slot) do update set culture=excluded.culture,commander_name=excluded.commander_name,commander_age=excluded.commander_age,
       unit_groups=excluded.unit_groups,available=true,refresh_turn=null,hired_force_id=null,updated_at=now();
end;
$function$;
revoke all on function public.generate_military_mercenary_offer(bigint,smallint,integer) from public,anon,authenticated;

create or replace function public.refresh_military_mercenary_market()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare market_marker record; slot_number integer; slot_limit integer; market_offer public.military_mercenary_market%rowtype;
begin
    if new.turn<=old.turn then return new; end if;
    for market_marker in select id,type from public.markers where type in ('city','large_city') loop
        slot_limit:=case market_marker.type when 'large_city' then 2 else 1 end;
        for slot_number in 1..slot_limit loop
            select * into market_offer from public.military_mercenary_market where marker_id=market_marker.id and slot=slot_number for update;
            if not found then
                perform public.generate_military_mercenary_offer(market_marker.id,slot_number::smallint,new.turn);
            elsif not market_offer.available and coalesce(market_offer.refresh_turn,2147483647)<=new.turn then
                perform public.generate_military_mercenary_offer(market_marker.id,slot_number::smallint,new.turn);
            end if;
        end loop;
    end loop;
    update public.military_forces set status='disbanded',updated_at=now()
      where is_mercenary and status='active' and service_end_turn is not null and service_end_turn<=new.turn;
    return new;
end;
$function$;
revoke all on function public.refresh_military_mercenary_market() from public,anon,authenticated;
drop trigger if exists refresh_military_mercenary_market_on_turn on public.game_calendar;
create trigger refresh_military_mercenary_market_on_turn after update of turn on public.game_calendar
for each row execute function public.refresh_military_mercenary_market();

create or replace function public.seed_military_mercenary_market()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare slot_number integer; current_turn integer;
begin
    if new.type not in ('city','large_city') then
        update public.military_mercenary_market set available=false,updated_at=now() where marker_id=new.id;
        return new;
    end if;
    select turn into current_turn from public.game_calendar where singleton=true;
    for slot_number in 1..(case new.type when 'large_city' then 2 else 1 end) loop
        perform public.generate_military_mercenary_offer(new.id,slot_number::smallint,coalesce(current_turn,1));
    end loop;
    return new;
end;
$function$;
revoke all on function public.seed_military_mercenary_market() from public,anon,authenticated;
drop trigger if exists seed_military_mercenary_market_on_marker on public.markers;
create trigger seed_military_mercenary_market_on_marker after insert or update of type on public.markers
for each row execute function public.seed_military_mercenary_market();

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
    values(profile.owner,offer.commander_name||' · наёмники','garrison',marker.id,offer.commander_name,offer.commander_age,offer.unit_groups,100,0,'active',true,cal.turn+2)
    returning id into force_id;
    update public.military_mercenary_market set available=false,refresh_turn=cal.turn+2,hired_force_id=force_id,updated_at=now() where id=offer.id;
    return jsonb_build_object('force_id',force_id,'commander',offer.commander_name,'troops',troop_total,'paid_z',contract_cost,'service_end_turn',cal.turn+2);
end;
$function$;
revoke all on function public.hire_military_mercenary(uuid) from public,anon;
grant execute on function public.hire_military_mercenary(uuid) to authenticated;

create or replace function public.renew_military_mercenary_contract(p_force_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare profile public.profiles%rowtype; force public.military_forces%rowtype; cal public.game_calendar%rowtype; settings_row public.state_mechanics%rowtype; contract_cost numeric;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role<>'player' or nullif(profile.owner,'') is null then raise exception 'Only a state player may renew a mercenary contract' using errcode='42501'; end if;
    select * into force from public.military_forces where id=p_force_id and owner=profile.owner and is_mercenary and status='active' for update;
    if not found then raise exception 'Active mercenary group not found' using errcode='22023'; end if;
    select * into cal from public.game_calendar where singleton=true;
    if force.service_end_turn is null or force.service_end_turn<=cal.turn or force.service_end_turn>cal.turn+1 then raise exception 'Renewal is available during the final season of the contract' using errcode='55000'; end if;
    select coalesce(sum((value->>'count')::integer),0)+1 into contract_cost from jsonb_array_elements(force.unit_groups);
    contract_cost:=contract_cost*2;
    select * into settings_row from public.state_mechanics where owner=profile.owner for update;
    if coalesce((settings_row.settings#>>'{economy,treasury}')::numeric,0)<contract_cost then raise exception 'Not enough treasury to renew this contract' using errcode='23514'; end if;
    update public.state_mechanics set settings=settings||jsonb_build_object('economy',coalesce(settings->'economy','{}'::jsonb)||jsonb_build_object('treasury',(settings_row.settings#>>'{economy,treasury}')::numeric-contract_cost)),updated_at=now() where owner=profile.owner;
    update public.military_forces set service_end_turn=service_end_turn+1,updated_at=now() where id=force.id returning * into force;
    return jsonb_build_object('force_id',force.id,'paid_z',contract_cost,'service_end_turn',force.service_end_turn);
end;
$function$;
revoke all on function public.renew_military_mercenary_contract(uuid) from public,anon;
grant execute on function public.renew_military_mercenary_contract(uuid) to authenticated;

-- Seed existing market cities with offers without resetting any existing slot.
do $seed$
declare market_marker record; slot_number integer; slot_limit integer; current_turn integer;
begin
    select turn into current_turn from public.game_calendar where singleton=true;
    for market_marker in select id,type from public.markers where type in ('city','large_city') loop
        slot_limit:=case market_marker.type when 'large_city' then 2 else 1 end;
        for slot_number in 1..slot_limit loop
            if not exists(select 1 from public.military_mercenary_market where marker_id=market_marker.id and slot=slot_number) then
                perform public.generate_military_mercenary_offer(market_marker.id,slot_number::smallint,coalesce(current_turn,1));
            end if;
        end loop;
    end loop;
end;
$seed$;
