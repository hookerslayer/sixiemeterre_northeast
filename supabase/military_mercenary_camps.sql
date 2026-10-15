-- Mercenary groups return to the map as neutral camps when a contract expires.
alter table public.military_forces add column if not exists camp_culture text;

create or replace function public.keep_mercenary_camp_commanded()
returns trigger language plpgsql set search_path = '' as $function$
begin
    if old.owner='Лагерь наёмников' and old.force_kind='land_army' and new.force_kind='garrison'
       and new.commander_name is null then
        new.force_kind:='land_army'; new.province_id:=old.province_id; new.marker_id:=null;
        new.cell_x:=old.cell_x; new.cell_y:=old.cell_y; new.commander_name:='Новый предводитель';
        new.commander_age:=35; new.commander_skills:='{}'::jsonb; new.commander_experience:=0;
        new.action_points:=0; new.status:='active';
    end if;
    return new;
end;
$function$;
revoke all on function public.keep_mercenary_camp_commanded() from public,anon,authenticated;
drop trigger if exists keep_mercenary_camp_commanded on public.military_forces;
create trigger keep_mercenary_camp_commanded before update of force_kind on public.military_forces
for each row execute function public.keep_mercenary_camp_commanded();

create table if not exists public.military_mercenary_respawns (
    id uuid primary key default gen_random_uuid(),
    source_force_id uuid references public.military_forces(id) on delete set null,
    camp_culture text not null default '',
    province_id bigint references public."Provinces"(id) on delete set null,
    preferred_x integer not null,
    preferred_y integer not null,
    spawn_turn integer not null,
    status text not null default 'waiting' check (status in ('waiting','spawned')),
    created_at timestamptz not null default now(),
    unique(source_force_id)
);
alter table public.military_mercenary_respawns enable row level security;
revoke all on public.military_mercenary_respawns from anon,authenticated;

create or replace function public.return_expired_mercenary_to_camp(p_force_id uuid,p_turn integer)
returns void language plpgsql security definer set search_path = '' as $function$
declare
    force public.military_forces%rowtype; marker public.markers%rowtype; landing record;
    camp_x integer; camp_y integer; camp_province bigint; camp_culture_name text;
begin
    select * into force from public.military_forces where id=p_force_id and is_mercenary and status='active' for update;
    if not found then return; end if;
    camp_x:=force.cell_x; camp_y:=force.cell_y; camp_province:=force.province_id; camp_culture_name:=coalesce(force.camp_culture,'');
    if force.force_kind='garrison' then
        select * into marker from public.markers where id=force.marker_id;
        if found then
            camp_province:=marker.province_id;
            camp_x:=floor(marker.coord_1::numeric/24)::integer;
            camp_y:=floor(marker.coord_2::numeric/24)::integer;
            select grid.cell_x,grid.cell_y,grid.province_id into landing
              from public.military_grid_cells grid
             where greatest(abs(grid.cell_x-camp_x),abs(grid.cell_y-camp_y)) between 1 and 2
               and grid.water_types=0
               and not exists(select 1 from public.military_forces other where other.status='active' and other.force_kind='land_army' and other.cell_x=grid.cell_x and other.cell_y=grid.cell_y)
             order by greatest(abs(grid.cell_x-camp_x),abs(grid.cell_y-camp_y)),grid.cell_x,grid.cell_y limit 1;
            if found then camp_x:=landing.cell_x; camp_y:=landing.cell_y; camp_province:=landing.province_id;
            else camp_x:=null; camp_y:=null; camp_province:=null; end if;
        end if;
    end if;
    if camp_x is null or camp_y is null or camp_province is null then
        update public.military_forces set status='disbanded',is_mercenary=false,service_end_turn=null,updated_at=now() where id=force.id;
        return;
    end if;
    if camp_culture_name='' then
        select coalesce(province.main_culture,'') into camp_culture_name from public."Provinces" province where province.id=camp_province;
    end if;
    update public.military_forces set owner='Лагерь наёмников',name='Лагерь наёмников · '||coalesce(nullif(camp_culture_name,''),'местный отряд'),
        force_kind='land_army',marker_id=null,province_id=camp_province,cell_x=camp_x,cell_y=camp_y,
        is_mercenary=false,service_end_turn=null,underfunded_turns=0,maintenance_coverage=1,
        action_points=0,camp_culture=coalesce(camp_culture_name,''),updated_at=now()
     where id=force.id;
end;
$function$;
revoke all on function public.return_expired_mercenary_to_camp(uuid,integer) from public,anon,authenticated;

create or replace function public.destroyed_military_mercenary_camp_respawn()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare current_turn integer;
begin
    if old.owner='Лагерь наёмников' and old.force_kind='land_army' and old.status='active' and new.status='active'
       and exists(select 1 from jsonb_array_elements(old.unit_groups) g where coalesce((g.value->>'count')::integer,0)>0)
       and not exists(select 1 from jsonb_array_elements(new.unit_groups) g where coalesce((g.value->>'count')::integer,0)>0) then
        select turn into current_turn from public.game_calendar where singleton=true;
        insert into public.military_mercenary_respawns(source_force_id,camp_culture,province_id,preferred_x,preferred_y,spawn_turn)
        values(old.id,coalesce(old.camp_culture,''),old.province_id,old.cell_x,old.cell_y,coalesce(current_turn,0)+2)
        on conflict(source_force_id) do nothing;
        update public.military_forces set status='disbanded',updated_at=now() where id=new.id and status='active';
    end if;
    return new;
end;
$function$;
revoke all on function public.destroyed_military_mercenary_camp_respawn() from public,anon,authenticated;
drop trigger if exists destroyed_military_mercenary_camp_respawn on public.military_forces;
create trigger destroyed_military_mercenary_camp_respawn after update of unit_groups on public.military_forces
for each row execute function public.destroyed_military_mercenary_camp_respawn();

create or replace function public.spawn_military_mercenary_respawns(p_turn integer)
returns void language plpgsql security definer set search_path = '' as $function$
declare respawn public.military_mercenary_respawns%rowtype; spot record; seed bigint; unit_name text; culture_lower text; candidates text[]; troop_count integer; commander_names text[]:=array['Данила','Микула','Ратибор','Ермолай','Василий','Семён','Гаврила','Сава','Игнат'];
begin
    for respawn in select * from public.military_mercenary_respawns where status='waiting' and spawn_turn<=p_turn for update loop
        select grid.cell_x,grid.cell_y,grid.province_id into spot from public.military_grid_cells grid
         join public."Provinces" province on province.id=grid.province_id
         where grid.water_types=0 and province.owner is null and province.occupied_by is null
           and greatest(abs(grid.cell_x-respawn.preferred_x),abs(grid.cell_y-respawn.preferred_y))<=2
           and not exists(select 1 from public.military_forces force where force.status='active' and force.force_kind='land_army' and force.cell_x=grid.cell_x and force.cell_y=grid.cell_y)
         order by greatest(abs(grid.cell_x-respawn.preferred_x),abs(grid.cell_y-respawn.preferred_y)),grid.cell_x,grid.cell_y limit 1;
        if not found then update public.military_mercenary_respawns set spawn_turn=p_turn+1 where id=respawn.id; continue; end if;
        seed:=abs(hashtextextended(respawn.id::text||':'||p_turn::text,0)); culture_lower:=lower(respawn.camp_culture);
        if culture_lower like '%свей%' or culture_lower like '%эст%' then candidates:=array['Пешие ратники','Копейщики','Лучники','Арбалетчики'];
        elsif culture_lower like '%казан%' then candidates:=array['Лучники','Лёгкая конница','Конные лучники'];
        elsif culture_lower like '%коми%' or culture_lower like '%саам%' then candidates:=array['Пешие ратники','Копейщики','Лучники','Лыжники-разведчики'];
        else candidates:=array['Пешие ратники','Копейщики','Лучники']; end if;
        unit_name:=candidates[mod(seed,cardinality(candidates))::integer+1]; troop_count:=100+mod(seed/97,201)::integer;
        insert into public.military_forces(owner,name,force_kind,province_id,cell_x,cell_y,commander_name,commander_age,unit_groups,morale,action_points,status,camp_culture)
        values('Лагерь наёмников','Лагерь наёмников · '||coalesce(nullif(respawn.camp_culture,''),'местный отряд'),'land_army',spot.province_id,spot.cell_x,spot.cell_y,
            commander_names[mod(seed/7919,cardinality(commander_names))::integer+1],25+mod(seed/15485863,26)::integer,
            jsonb_build_array(jsonb_build_object('type',unit_name,'count',troop_count,'serviceType','mercenary')),100,0,'active',respawn.camp_culture);
        update public.military_mercenary_respawns set status='spawned' where id=respawn.id;
    end loop;
end;
$function$;
revoke all on function public.spawn_military_mercenary_respawns(integer) from public,anon,authenticated;

create or replace function public.move_military_mercenary_camps(p_turn integer)
returns void language plpgsql security definer set search_path = '' as $function$
declare camp public.military_forces%rowtype; destination record;
begin
    for camp in select * from public.military_forces where owner='Лагерь наёмников' and force_kind='land_army' and status='active' order by id for update loop
        select target.cell_x,target.cell_y,target.province_id into destination
          from public.military_grid_cells current
          join public.military_grid_cells target on greatest(abs(target.cell_x-current.cell_x),abs(target.cell_y-current.cell_y))=1
          join public."Provinces" province on province.id=target.province_id
         where current.cell_x=camp.cell_x and current.cell_y=camp.cell_y
           and target.water_types=0 and province.owner is null and province.occupied_by is null
           and not exists(select 1 from public.military_forces other where other.id<>camp.id and other.status='active' and other.force_kind='land_army' and other.cell_x=target.cell_x and other.cell_y=target.cell_y)
           and exists(select 1 from public.markers marker where marker.type in ('city','large_city')
               and greatest(abs(target.cell_x-floor(marker.coord_1::numeric/24)::integer),abs(target.cell_y-floor(marker.coord_2::numeric/24)::integer)) between 1 and 3)
         order by md5(p_turn::text||':'||camp.id::text||':'||target.cell_x::text||':'||target.cell_y::text) limit 1;
        if found then update public.military_forces set cell_x=destination.cell_x,cell_y=destination.cell_y,province_id=destination.province_id,action_points=0,updated_at=now() where id=camp.id; end if;
    end loop;
end;
$function$;
revoke all on function public.move_military_mercenary_camps(integer) from public,anon,authenticated;

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

-- Camps are independent NPC formations and do not draw a player's supply or treasury until hired.
create or replace function public.refresh_military_mercenary_market()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare market_marker record; slot_number integer; slot_limit integer; market_offer public.military_mercenary_market%rowtype; expired_force record;
begin
    if new.turn<=old.turn then return new; end if;
    for market_marker in select id,type from public.markers where type in ('city','large_city') loop
        slot_limit:=case market_marker.type when 'large_city' then 2 else 1 end;
        for slot_number in 1..slot_limit loop
            select * into market_offer from public.military_mercenary_market where marker_id=market_marker.id and slot=slot_number for update;
            if not found then perform public.generate_military_mercenary_offer(market_marker.id,slot_number::smallint,new.turn);
            elsif not market_offer.available and coalesce(market_offer.refresh_turn,2147483647)<=new.turn then perform public.generate_military_mercenary_offer(market_marker.id,slot_number::smallint,new.turn); end if;
        end loop;
    end loop;
    for expired_force in select id from public.military_forces where is_mercenary and status='active' and service_end_turn is not null and service_end_turn<=new.turn for update loop
        perform public.return_expired_mercenary_to_camp(expired_force.id,new.turn);
    end loop;
    perform public.spawn_military_mercenary_respawns(new.turn);
    perform public.move_military_mercenary_camps(new.turn);
    return new;
end;
$function$;
