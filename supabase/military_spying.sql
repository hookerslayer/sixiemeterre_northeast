-- State espionage: agents, networks, seasonal operations, counterintelligence and intel.
create table if not exists public.military_spies (
    id uuid primary key default gen_random_uuid(),
    owner text not null references public.state_mechanics(owner) on delete cascade,
    name text not null check (length(btrim(name)) between 1 and 80),
    age integer not null check (age between 16 and 150),
    experience integer not null default 0 check (experience >= 0),
    level integer not null default 1 check (level between 1 and 5),
    status text not null default 'active' check (status in ('active','dead','dismissed')),
    counterintelligence boolean not null default false,
    last_action_turn integer,
    can_operate_turn integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create table if not exists public.military_spy_networks (
    id uuid primary key default gen_random_uuid(),
    spy_id uuid not null unique references public.military_spies(id) on delete cascade,
    owner text not null references public.state_mechanics(owner) on delete cascade,
    target_owner text not null references public.state_mechanics(owner) on delete cascade,
    strength integer not null default 0 check (strength between 0 and 100),
    created_turn integer not null default 0,
    updated_at timestamptz not null default now(),
    unique(owner,target_owner),
    check (owner <> target_owner)
);
create table if not exists public.military_spy_orders (
    id uuid primary key default gen_random_uuid(),
    spy_id uuid not null references public.military_spies(id) on delete cascade,
    owner text not null references public.state_mechanics(owner) on delete cascade,
    target_owner text not null references public.state_mechanics(owner) on delete cascade,
    operation text not null check (operation in ('garrison_intel','province_recon','network_detection','sabotage')),
    target_marker_id bigint references public.markers(id) on delete cascade,
    target_province_id bigint references public."Provinces"(id) on delete cascade,
    item_name text,
    network_cost integer not null check (network_cost in (10,20,25,30)),
    queued_turn integer not null,
    status text not null default 'pending' check (status in ('pending','resolved','cancelled')),
    result jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    check ((operation='garrison_intel' and target_marker_id is not null and target_province_id is null)
        or (operation='province_recon' and target_province_id is not null and target_marker_id is null)
        or (operation='network_detection' and target_marker_id is null and target_province_id is null)
        or (operation='sabotage' and target_marker_id is not null and target_province_id is null and nullif(btrim(item_name),'') is not null))
);
create unique index if not exists military_spy_one_pending_order_per_agent
    on public.military_spy_orders(spy_id) where status='pending';
create table if not exists public.military_spy_intel (
    id uuid primary key default gen_random_uuid(),
    owner text not null references public.state_mechanics(owner) on delete cascade,
    source_owner text not null references public.state_mechanics(owner) on delete cascade,
    intel_type text not null,
    target_label text not null,
    payload jsonb not null default '{}'::jsonb,
    created_turn integer not null,
    expires_turn integer not null,
    created_at timestamptz not null default now()
);
create table if not exists public.military_spy_alerts (
    id uuid primary key default gen_random_uuid(),
    owner text not null references public.state_mechanics(owner) on delete cascade,
    message text not null,
    details jsonb not null default '{}'::jsonb,
    created_turn integer not null,
    created_at timestamptz not null default now()
);
create table if not exists public.military_spy_sabotage_effects (
    id uuid primary key default gen_random_uuid(),
    owner text not null references public.state_mechanics(owner) on delete cascade,
    marker_id bigint not null references public.markers(id) on delete cascade,
    item_name text not null,
    reduction numeric not null default 0.25 check (reduction between 0 and 0.25),
    starts_turn integer not null,
    ends_turn integer not null,
    source_owner text not null references public.state_mechanics(owner) on delete cascade,
    created_at timestamptz not null default now(),
    check (ends_turn >= starts_turn)
);

alter table public.military_spies enable row level security;
alter table public.military_spy_networks enable row level security;
alter table public.military_spy_orders enable row level security;
alter table public.military_spy_intel enable row level security;
alter table public.military_spy_alerts enable row level security;
alter table public.military_spy_sabotage_effects enable row level security;
drop policy if exists "Read state spies" on public.military_spies;
create policy "Read state spies" on public.military_spies for select to authenticated using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and (p.role='admin' or p.owner=owner)));
drop policy if exists "Read state spy networks" on public.military_spy_networks;
create policy "Read state spy networks" on public.military_spy_networks for select to authenticated using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and (p.role='admin' or p.owner=owner)));
drop policy if exists "Read state spy orders" on public.military_spy_orders;
create policy "Read state spy orders" on public.military_spy_orders for select to authenticated using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and (p.role='admin' or p.owner=owner)));
drop policy if exists "Read state spy intel" on public.military_spy_intel;
create policy "Read state spy intel" on public.military_spy_intel for select to authenticated using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and (p.role='admin' or p.owner=owner)));
drop policy if exists "Read state spy alerts" on public.military_spy_alerts;
create policy "Read state spy alerts" on public.military_spy_alerts for select to authenticated using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and (p.role='admin' or p.owner=owner)));
drop policy if exists "Read active sabotage effects" on public.military_spy_sabotage_effects;
create policy "Read active sabotage effects" on public.military_spy_sabotage_effects for select to authenticated using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='admin'));
revoke all on public.military_spies,public.military_spy_networks,public.military_spy_orders,public.military_spy_intel,public.military_spy_alerts,public.military_spy_sabotage_effects from anon,authenticated;
grant select on public.military_spies,public.military_spy_networks,public.military_spy_orders,public.military_spy_intel,public.military_spy_alerts,public.military_spy_sabotage_effects to authenticated;

create or replace function public.hire_military_spy(p_name text,p_age integer)
returns uuid language plpgsql security definer set search_path='' as $function$
declare profile public.profiles%rowtype; settings_row public.state_mechanics%rowtype; active_count integer; spy_limit integer; new_id uuid;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role<>'player' or nullif(profile.owner,'') is null then raise exception 'Only a state player can hire a spy' using errcode='42501'; end if;
    if length(btrim(coalesce(p_name,''))) not between 1 and 80 or p_age not between 16 and 100 then raise exception 'Enter a valid spy name and age'; end if;
    select * into settings_row from public.state_mechanics where owner=profile.owner for update;
    if not found then raise exception 'State data is missing'; end if;
    select count(*) into active_count from public.military_spies where owner=profile.owner and status='active';
    select 1+count(*) into spy_limit from public.markers where owner=profile.owner and type='large_city';
    if active_count>=spy_limit+3 then raise exception 'Spy limit exceeded'; end if;
    if coalesce((settings_row.settings#>>'{economy,prestige}')::numeric,0)<10 then raise exception 'Hiring a spy costs 10 prestige'; end if;
    update public.state_mechanics set settings=jsonb_set(settings,'{economy,prestige}',to_jsonb(coalesce((settings#>>'{economy,prestige}')::numeric,0)-10),true),updated_at=now() where owner=profile.owner;
    insert into public.military_spies(owner,name,age) values(profile.owner,btrim(p_name),p_age) returning id into new_id;
    return new_id;
end;$function$;

create or replace function public.assign_military_spy_network(p_spy_id uuid,p_target_owner text)
returns uuid language plpgsql security definer set search_path='' as $function$
declare profile public.profiles%rowtype; spy public.military_spies%rowtype; network_id uuid; current_turn integer; prestige numeric;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role<>'player' then raise exception 'Only a state player can assign a spy' using errcode='42501'; end if;
    select * into spy from public.military_spies where id=p_spy_id and owner=profile.owner and status='active' for update;
    if not found or spy.counterintelligence then raise exception 'Choose an available spy'; end if;
    if p_target_owner is null or p_target_owner=profile.owner or not exists(select 1 from public.state_mechanics where owner=p_target_owner) then raise exception 'Choose another existing state'; end if;
    if exists(select 1 from public.military_spy_networks where owner=profile.owner and target_owner=p_target_owner and spy_id<>spy.id) then raise exception 'Your state already has a network in this country'; end if;
    select coalesce((settings#>>'{economy,prestige}')::numeric,0) into prestige from public.state_mechanics where owner=profile.owner for update;
    if prestige<2 then raise exception 'Creating a spy network costs 2 prestige'; end if;
    update public.state_mechanics set settings=jsonb_set(settings,'{economy,prestige}',to_jsonb(prestige-2),true),updated_at=now() where owner=profile.owner;
    delete from public.military_spy_networks where spy_id=spy.id;
    select turn into current_turn from public.game_calendar where singleton=true;
    insert into public.military_spy_networks(spy_id,owner,target_owner,strength,created_turn) values(spy.id,profile.owner,p_target_owner,0,current_turn) returning id into network_id;
    return network_id;
end;$function$;

create or replace function public.set_military_spy_counterintelligence(p_spy_id uuid,p_enabled boolean)
returns boolean language plpgsql security definer set search_path='' as $function$
declare profile public.profiles%rowtype; spy public.military_spies%rowtype;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role<>'player' then raise exception 'Only a state player can assign counterintelligence' using errcode='42501'; end if;
    select * into spy from public.military_spies where id=p_spy_id and owner=profile.owner and status='active' for update;
    if not found then raise exception 'Spy not found'; end if;
    if p_enabled and exists(select 1 from public.military_spies where owner=profile.owner and counterintelligence and status='active' and id<>spy.id) then raise exception 'Only one spy may serve in counterintelligence'; end if;
    if p_enabled then delete from public.military_spy_networks where spy_id=spy.id; end if;
    update public.military_spies set counterintelligence=p_enabled,updated_at=now() where id=spy.id;
    return p_enabled;
end;$function$;

create or replace function public.queue_military_spy_operation(p_spy_id uuid,p_operation text,p_marker_id bigint default null,p_province_id bigint default null,p_item_name text default null)
returns uuid language plpgsql security definer set search_path='' as $function$
declare profile public.profiles%rowtype; spy public.military_spies%rowtype; net public.military_spy_networks%rowtype; cost integer; turn_no integer; order_id uuid;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role<>'player' then raise exception 'Only a state player can order a spy operation' using errcode='42501'; end if;
    select * into spy from public.military_spies where id=p_spy_id and owner=profile.owner and status='active' and not counterintelligence for update;
    if not found then raise exception 'Choose an available spy'; end if;
    select * into net from public.military_spy_networks where spy_id=spy.id;
    if not found then raise exception 'This spy has no active network'; end if;
    cost:=case p_operation when 'garrison_intel' then 10 when 'province_recon' then 20 when 'network_detection' then 25 when 'sabotage' then 30 else null end;
    if cost is null or net.strength<cost then raise exception 'Invalid operation or insufficient network strength'; end if;
    if p_operation='garrison_intel' and not exists(select 1 from public.markers where id=p_marker_id and owner=net.target_owner and type<>'ruins') then raise exception 'Choose a settlement in the target state'; end if;
    if p_operation='province_recon' and not exists(select 1 from public."Provinces" where id=p_province_id and owner=net.target_owner) then raise exception 'Choose a province in the target state'; end if;
    if p_operation='sabotage' and (nullif(btrim(p_item_name),'') is null or not exists(select 1 from public.markers where id=p_marker_id and owner=net.target_owner and type in ('city','large_city'))) then raise exception 'Choose a good/resource and a city in the target state'; end if;
    select turn into turn_no from public.game_calendar where singleton=true;
    if spy.last_action_turn=turn_no then raise exception 'A spy can perform only one action per season'; end if;
    update public.military_spies set last_action_turn=turn_no,updated_at=now() where id=spy.id;
    insert into public.military_spy_orders(spy_id,owner,target_owner,operation,target_marker_id,target_province_id,item_name,network_cost,queued_turn)
    values(spy.id,profile.owner,net.target_owner,p_operation,p_marker_id,p_province_id,nullif(btrim(p_item_name),''),cost,turn_no) returning id into order_id;
    return order_id;
end;$function$;

create or replace function public.dismiss_military_spy(p_spy_id uuid)
returns boolean language plpgsql security definer set search_path='' as $function$
declare profile public.profiles%rowtype; spy public.military_spies%rowtype;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role<>'player' then raise exception 'Only a state player can dismiss a spy' using errcode='42501'; end if;
    update public.military_spies set status='dismissed',counterintelligence=false,updated_at=now() where id=p_spy_id and owner=profile.owner and status='active' returning * into spy;
    if not found then raise exception 'Spy not found'; end if;
    delete from public.military_spy_networks where spy_id=spy.id;
    update public.military_spy_orders set status='cancelled' where spy_id=spy.id and status='pending';
    return true;
end;$function$;

create or replace function public.process_military_spy_season()
returns trigger language plpgsql security definer set search_path='' as $function$
declare turn_no integer:=new.turn; order_row record; net public.military_spy_networks%rowtype; spy public.military_spies%rowtype; counter public.military_spies%rowtype;
    target_marker public.markers%rowtype; target_province public."Provinces"%rowtype; settings_row public.state_mechanics%rowtype;
    cost integer; success_chance numeric; reveal_chance numeric; counter_bonus numeric; success_roll numeric; reveal_roll numeric; counter_roll numeric;
    owner_modifier numeric; target_modifier numeric;
    outcome jsonb; target_label text; exposed boolean; succeeded boolean; limit_count integer; spy_index integer; prestige numeric; current_strength integer; next_level integer;
begin
    if new.turn<=old.turn then return new; end if;
    delete from public.military_spy_intel where expires_turn<turn_no;
    delete from public.military_spy_sabotage_effects where ends_turn<turn_no;

    if new.year>old.year then
        for spy in select * from public.military_spies where status='active' order by id for update loop
            if spy.age>=149 then update public.military_spies set status='dead',age=150,counterintelligence=false where id=spy.id;
            else
                if spy.age+1>=50 and mod(abs(hashtextextended(spy.id::text||':'||new.year::text,0)::numeric),1000000)/10000.0 < least(100,0.5*power(2.0,(spy.age+1-50)/5.0)) then
                    update public.military_spies set status='dead',age=spy.age+1,counterintelligence=false,updated_at=now() where id=spy.id;
                    delete from public.military_spy_networks where spy_id=spy.id;
                    insert into public.military_spy_alerts(owner,message,details,created_turn) values(spy.owner,'Шпион умер от старости или болезни.',jsonb_build_object('spy_name',spy.name),turn_no);
                else update public.military_spies set age=spy.age+1,updated_at=now() where id=spy.id; end if;
            end if;
        end loop;
    end if;

    -- Normal agents act for free; each agent above the state limit costs 2 prestige this season.
    for settings_row in select * from public.state_mechanics loop
        select 1+count(*) into limit_count from public.markers where owner=settings_row.owner and type='large_city';
        select coalesce((settings_row.settings#>>'{economy,prestige}')::numeric,0) into prestige;
        spy_index:=0;
        for spy in select * from public.military_spies where owner=settings_row.owner and status='active' order by created_at,id for update loop
            spy_index:=spy_index+1;
            if spy_index<=limit_count then update public.military_spies set can_operate_turn=turn_no where id=spy.id;
            elsif prestige>=2 then
                prestige:=prestige-2;
                update public.military_spies set can_operate_turn=turn_no where id=spy.id;
            else update public.military_spies set can_operate_turn=-turn_no where id=spy.id; end if;
        end loop;
        update public.state_mechanics set settings=jsonb_set(settings,'{economy,prestige}',to_jsonb(prestige),true),updated_at=now() where owner=settings_row.owner;
    end loop;
    update public.military_spy_networks n set strength=least(100,n.strength+round((5+2*greatest(0,s.level-1))*greatest(0,1+coalesce((
        select sum(m.value)/100 from public.state_modifiers m where m.owner=n.owner and m.effect_key='spy_network_growth_pct'
          and m.scope_type='state' and m.status='active' and m.starts_turn<=turn_no and (m.ends_turn is null or m.ends_turn>=turn_no)
    ),0)))::integer),updated_at=now()
      from public.military_spies s where s.id=n.spy_id and s.status='active';

    for order_row in select o.*,s.name as spy_name,s.level,s.experience,s.can_operate_turn,n.id as network_id,n.strength
        from public.military_spy_orders o join public.military_spies s on s.id=o.spy_id join public.military_spy_networks n on n.spy_id=s.id
        where o.status='pending' and o.queued_turn<turn_no and s.status='active' order by o.created_at for update of o,s,n loop
        cost:=order_row.network_cost; current_strength:=order_row.strength;
        if order_row.can_operate_turn<>turn_no then
            update public.military_spy_orders set status='resolved',result=jsonb_build_object('success',false,'exposed',false,'message','Операция отложена: шпион не получил содержание сверх лимита.') where id=order_row.id;
            continue;
        end if;
        select coalesce(10+3*greatest(0,max(level)-1),0) into counter_bonus from public.military_spies where owner=order_row.target_owner and counterintelligence and status='active';
        counter_bonus:=coalesce(counter_bonus,0);
        select coalesce(sum(value),0) into owner_modifier from public.state_modifiers where owner=order_row.owner and effect_key='spy_operation_success_pp' and scope_type='state' and status='active' and starts_turn<=turn_no and (ends_turn is null or ends_turn>=turn_no);
        select coalesce(sum(value),0) into target_modifier from public.state_modifiers where owner=order_row.target_owner and effect_key='spy_exposure_chance_pp' and scope_type='state' and status='active' and starts_turn<=turn_no and (ends_turn is null or ends_turn>=turn_no);
        success_chance:=greatest(5,least(95,(case order_row.operation when 'garrison_intel' then 80 when 'province_recon' then 70 when 'network_detection' then 55 else 55 end)+5*greatest(0,order_row.level-1)+owner_modifier));
        reveal_chance:=greatest(5,least(85,(case order_row.operation when 'garrison_intel' then 15 when 'province_recon' then 20 when 'network_detection' then 25 else 35 end)-3*greatest(0,order_row.level-1)-0.25*greatest(0,current_strength-cost)+0.5*greatest(0,cost-current_strength)+counter_bonus+target_modifier));
        success_roll:=mod(abs(hashtextextended(order_row.id::text||':success:'||turn_no,0)::numeric),10000)/100.0;
        reveal_roll:=mod(abs(hashtextextended(order_row.id::text||':reveal:'||turn_no,0)::numeric),10000)/100.0;
        succeeded:=success_roll<success_chance; exposed:=reveal_roll<reveal_chance;
        update public.military_spy_networks set strength=greatest(0,strength-cost),updated_at=now() where id=order_row.network_id;
        outcome:=jsonb_build_object('success',succeeded,'exposed',exposed,'success_chance',success_chance,'reveal_chance',reveal_chance,'success_roll',success_roll,'reveal_roll',reveal_roll);
        if exposed then
            delete from public.military_spy_networks where id=order_row.network_id;
            update public.military_spies set status='dead',counterintelligence=false,updated_at=now() where id=order_row.spy_id;
            update public.state_mechanics set settings=jsonb_set(settings,'{economy,prestige}',to_jsonb(coalesce((settings#>>'{economy,prestige}')::numeric,0)-5),true),updated_at=now() where owner=order_row.owner;
            insert into public.military_spy_alerts(owner,message,details,created_turn) values(order_row.target_owner,'Ваша служба раскрыла иностранного шпиона.',jsonb_build_object('spy_name',order_row.spy_name,'sender',order_row.owner),turn_no);
            insert into public.military_spy_alerts(owner,message,details,created_turn) values(order_row.owner,'Шпион раскрыт и погиб; государство узнало об отправителе. Потеряно 5 ОП.',jsonb_build_object('spy_name',order_row.spy_name,'target',order_row.target_owner),turn_no);
            outcome:=outcome||jsonb_build_object('message','Шпион раскрыт и погиб.');
        elsif succeeded then
            if order_row.operation='garrison_intel' then
                select * into target_marker from public.markers where id=order_row.target_marker_id;
                select coalesce(jsonb_agg(jsonb_build_object('name',f.name,'units',f.unit_groups,'commander',f.commander_name)), '[]'::jsonb) into outcome
                  from public.military_forces f where f.marker_id=target_marker.id and f.force_kind='garrison' and f.status='active';
                insert into public.military_spy_intel(owner,source_owner,intel_type,target_label,payload,created_turn,expires_turn) values(order_row.owner,order_row.target_owner,'garrison',target_marker.name,coalesce(outcome,'[]'::jsonb),turn_no,turn_no+1);
            elsif order_row.operation='province_recon' then
                select * into target_province from public."Provinces" where id=order_row.target_province_id;
                outcome:=jsonb_build_object('province_id',target_province.id,'name',target_province.province_name,'owner',target_province.owner,'development',target_province.development,'resource',target_province.resource,
                  'forces',(select coalesce(jsonb_agg(jsonb_build_object('name',f.name,'units',f.unit_groups,'cell_x',f.cell_x,'cell_y',f.cell_y)), '[]'::jsonb) from public.military_forces f where f.province_id=target_province.id and f.status='active'),
                  'terrain',(select coalesce(jsonb_agg(jsonb_build_object('cell_x',g.cell_x,'cell_y',g.cell_y,'terrain',coalesce(t.terrain,g.base_terrain),'bridge',coalesce(t.bridge,false))), '[]'::jsonb)
                      from public.military_grid_cells g left join public.military_terrain_cells t using(cell_x,cell_y)
                      where coalesce(t.province_id,g.province_id)=target_province.id));
                insert into public.military_spy_intel(owner,source_owner,intel_type,target_label,payload,created_turn,expires_turn) values(order_row.owner,order_row.target_owner,'province',target_province.province_name,outcome,turn_no,turn_no+1);
            elsif order_row.operation='network_detection' then
                outcome:=jsonb_build_object('networks',(select coalesce(jsonb_agg(jsonb_build_object('sender',n.owner,'strength',n.strength,'agent',s.name)), '[]'::jsonb) from public.military_spy_networks n join public.military_spies s on s.id=n.spy_id where n.target_owner=order_row.target_owner and n.owner<>order_row.owner));
                insert into public.military_spy_intel(owner,source_owner,intel_type,target_label,payload,created_turn,expires_turn) values(order_row.owner,order_row.target_owner,'networks',order_row.target_owner,outcome,turn_no,turn_no+1);
            else
                insert into public.military_spy_sabotage_effects(owner,marker_id,item_name,starts_turn,ends_turn,source_owner) values(order_row.target_owner,order_row.target_marker_id,order_row.item_name,turn_no,turn_no,order_row.owner);
                outcome:=jsonb_build_object('marker_id',order_row.target_marker_id,'item_name',order_row.item_name,'reduction',25,'expires_turn',turn_no);
            end if;
            update public.military_spies set experience=experience+10,level=case when experience+10>=500 then 5 when experience+10>=300 then 4 when experience+10>=150 then 3 when experience+10>=50 then 2 else 1 end,updated_at=now() where id=order_row.spy_id returning level into next_level;
            outcome:=outcome||jsonb_build_object('success',true,'exposed',false,'message','Операция успешна.','spy_level',next_level);
            insert into public.military_spy_alerts(owner,message,details,created_turn) values(order_row.owner,'Шпионская операция завершена успешно.',jsonb_build_object('operation',order_row.operation,'target',order_row.target_owner,'result',outcome),turn_no);
        else outcome:=outcome||jsonb_build_object('message','Операция провалилась; сеть ослаблена.');
            insert into public.military_spy_alerts(owner,message,details,created_turn) values(order_row.owner,'Шпионская операция не удалась.',jsonb_build_object('operation',order_row.operation,'target',order_row.target_owner),turn_no);
        end if;
        update public.military_spy_orders set status='resolved',result=outcome where id=order_row.id;
    end loop;

    -- A counterspy checks one foreign network each season; a discovery kills the agent and exposes its sender.
    for counter in select * from public.military_spies where status='active' and counterintelligence and can_operate_turn=turn_no order by id loop
        select n.* into net from public.military_spy_networks n join public.military_spies s on s.id=n.spy_id
          where n.target_owner=counter.owner and n.owner<>counter.owner order by md5(counter.id::text||':'||turn_no::text||':'||n.id::text) limit 1;
        if not found then continue; end if;
        select name into target_label from public.military_spies where id=net.spy_id;
        counter_roll:=mod(abs(hashtextextended(counter.id::text||':counter:'||turn_no,0)::numeric),10000)/100.0;
        select coalesce(sum(value),0) into target_modifier from public.state_modifiers where owner=counter.owner and effect_key='counterintelligence_success_pp' and scope_type='state' and status='active' and starts_turn<=turn_no and (ends_turn is null or ends_turn>=turn_no);
        success_chance:=greatest(0,least(100,least(35,5+2*counter.level+floor(net.strength/10.0))+target_modifier));
        if counter_roll<success_chance then
            update public.military_spies set status='dead',counterintelligence=false,updated_at=now() where id=net.spy_id;
            delete from public.military_spy_networks where id=net.id;
            update public.state_mechanics set settings=jsonb_set(settings,'{economy,prestige}',to_jsonb(coalesce((settings#>>'{economy,prestige}')::numeric,0)-5),true),updated_at=now() where owner=net.owner;
            insert into public.military_spy_alerts(owner,message,details,created_turn) values(counter.owner,'Контршпионаж обнаружил иностранного агента.',jsonb_build_object('sender',net.owner,'agent',target_label),turn_no);
            insert into public.military_spy_alerts(owner,message,details,created_turn) values(net.owner,'Шпион раскрыт контршпионажем и погиб; потеряно 5 ОП.',jsonb_build_object('target',counter.owner,'agent',target_label),turn_no);
        end if;
    end loop;
    return new;
end;$function$;

revoke all on function public.hire_military_spy(text,integer),public.assign_military_spy_network(uuid,text),public.set_military_spy_counterintelligence(uuid,boolean),public.queue_military_spy_operation(uuid,text,bigint,bigint,text),public.dismiss_military_spy(uuid) from public,anon;
grant execute on function public.hire_military_spy(text,integer),public.assign_military_spy_network(uuid,text),public.set_military_spy_counterintelligence(uuid,boolean),public.queue_military_spy_operation(uuid,text,bigint,bigint,text),public.dismiss_military_spy(uuid) to authenticated;
create or replace function public.get_military_spy_sabotage_effects()
returns jsonb language plpgsql security definer set search_path='' as $function$
declare profile public.profiles%rowtype; result jsonb;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role not in ('player','admin') then raise exception 'Authentication required' using errcode='42501'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('owner',e.owner,'marker_id',e.marker_id,'item_name',e.item_name,'reduction',e.reduction,'starts_turn',e.starts_turn,'ends_turn',e.ends_turn)), '[]'::jsonb)
      into result from public.military_spy_sabotage_effects e where (profile.role='admin' or e.owner=profile.owner)
      and e.starts_turn<=(select turn from public.game_calendar where singleton=true) and e.ends_turn>=(select turn from public.game_calendar where singleton=true);
    return result;
end;$function$;
revoke all on function public.get_military_spy_sabotage_effects() from public,anon;
grant execute on function public.get_military_spy_sabotage_effects() to authenticated;
revoke all on function public.process_military_spy_season() from public,anon,authenticated;
drop trigger if exists military_spy_season_resolution on public.game_calendar;
create trigger military_spy_season_resolution after update of turn on public.game_calendar for each row execute function public.process_military_spy_season();
