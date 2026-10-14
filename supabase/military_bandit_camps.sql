-- Spawn one persistent bandit force per camp and seasonally move it toward
-- culturally different state provinces. All placement remains on the military grid.
alter table public.military_forces
    add column if not exists npc_target_province_id bigint references public."Provinces"(id) on delete set null,
    add column if not exists npc_home_cell_x integer,
    add column if not exists npc_home_cell_y integer,
    add column if not exists npc_home_province_id bigint references public."Provinces"(id) on delete set null,
    add column if not exists npc_next_raid_turn integer;

-- NPC factions are represented by ordinary military owner strings, not by
-- state_mechanics rows (which are reserved for playable states and guarded
-- by economic validation triggers). Remove only the three owner foreign keys
-- that otherwise prevent NPC battle/raid records.
alter table public.military_battle_armies
    drop constraint if exists military_battle_armies_owner_fkey;
alter table public.military_battle_reports
    drop constraint if exists military_battle_reports_owner_fkey;
alter table public.military_raids
    drop constraint if exists military_raids_attacker_owner_fkey;

create unique index if not exists military_one_bandit_camp_per_province_idx
    on public.military_forces(province_id)
    where owner='Лагерь разбойников' and force_kind='land_army' and status='active';

create or replace function public.keep_bandit_camp_commanded()
returns trigger language plpgsql set search_path = '' as $function$
begin
    if old.owner='Лагерь разбойников' and old.force_kind='land_army' and new.force_kind='garrison'
       and new.commander_name is null then
        new.force_kind:='land_army'; new.province_id:=old.province_id; new.marker_id:=null;
        new.cell_x:=old.cell_x; new.cell_y:=old.cell_y; new.commander_name:='Новый атаман';
        new.commander_age:=35; new.commander_skills:='{}'::jsonb; new.commander_experience:=0;
        new.action_points:=0; new.status:='active';
    end if;
    return new;
end;
$function$;
revoke all on function public.keep_bandit_camp_commanded() from public,anon,authenticated;
drop trigger if exists keep_bandit_camp_commanded on public.military_forces;
create trigger keep_bandit_camp_commanded before update of force_kind on public.military_forces
for each row execute function public.keep_bandit_camp_commanded();

create or replace function public.process_military_bandit_camps()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
    province_row record;
    camp public.military_forces%rowtype;
    target_id bigint;
    home_x integer;
    home_y integer;
    home_province bigint;
    destination record;
    seed numeric;
    crime numeric;
    chance_threshold integer;
    unit_name text;
    unit_candidates text[];
    troop_count integer;
    commander_names text[]:=array['Кузьма','Трофим','Савва','Еремей','Лука','Илья','Фома','Микула','Гаврила'];
begin
    if new.turn<=old.turn then return new; end if;

    -- Attempt camp generation separately in every eligible province.
    for province_row in
        select province.id,province.owner,province.main_culture,
               coalesce((mechanics.settings->>'crime_rate')::numeric,20) as crime_rate
          from public."Provinces" province
          left join public.state_mechanics mechanics on mechanics.owner=province.owner
         where not exists(select 1 from public.military_forces camp
             where camp.owner='Лагерь разбойников' and camp.status='active' and camp.province_id=province.id)
           and not exists(select 1 from public.military_forces army
             where army.status='active' and army.force_kind='land_army' and army.province_id=province.id)
    loop
        crime:=case when province_row.owner is null then 20 else greatest(20,least(100,province_row.crime_rate)) end;
        chance_threshold:=least(50,10+floor(greatest(0,crime-20)*0.5)::integer); -- 0.1% base, +0.005 p.p. per crime point.
        seed:=mod(abs(hashtextextended(new.turn::text||':'||province_row.id::text||':bandit',0)::numeric),10000);
        if seed>=chance_threshold then continue; end if;

        select cell.cell_x,cell.cell_y into destination
          from public.military_grid_cells cell
          left join public.military_terrain_cells terrain on terrain.cell_x=cell.cell_x and terrain.cell_y=cell.cell_y
         where cell.province_id=province_row.id and cell.base_terrain='plain'
           and coalesce(terrain.terrain,'plain')<>'water'
           and not exists(select 1 from public.military_forces other where other.status='active' and other.force_kind='land_army'
               and other.cell_x=cell.cell_x and other.cell_y=cell.cell_y)
         order by md5(new.turn::text||':'||province_row.id::text||':'||cell.cell_x::text||':'||cell.cell_y::text)
         limit 1;
        if not found then continue; end if;

        seed:=abs(hashtextextended(new.turn::text||':'||province_row.id::text||':bandit-roster',0)::numeric);
        if lower(coalesce(province_row.main_culture,'')) like '%свей%' or lower(coalesce(province_row.main_culture,'')) like '%эст%' then
            unit_candidates:=array['Пешие ратники','Копейщики','Лучники','Арбалетчики'];
        elsif lower(coalesce(province_row.main_culture,'')) like '%казан%' then
            unit_candidates:=array['Лучники','Лёгкая конница','Конные лучники'];
        elsif lower(coalesce(province_row.main_culture,'')) like '%коми%' or lower(coalesce(province_row.main_culture,'')) like '%саам%' then
            unit_candidates:=array['Пешие ратники','Копейщики','Лучники','Лыжники-разведчики'];
        else unit_candidates:=array['Пешие ратники','Копейщики','Лучники']; end if;
        unit_name:=unit_candidates[mod(seed,cardinality(unit_candidates))::integer+1];
        troop_count:=100+mod(seed/97,201)::integer;
        insert into public.military_forces(owner,name,force_kind,province_id,cell_x,cell_y,commander_name,commander_age,
            unit_groups,morale,action_points,status,camp_culture,npc_home_cell_x,npc_home_cell_y,npc_home_province_id,npc_next_raid_turn)
        values('Лагерь разбойников','Лагерь разбойников · '||coalesce(nullif(province_row.main_culture,''),'местный отряд'),
            'land_army',province_row.id,destination.cell_x,destination.cell_y,
            commander_names[mod(seed/7919,cardinality(commander_names))::integer+1],25+mod(seed/15485863,26)::integer,
            jsonb_build_array(jsonb_build_object('type',unit_name,'count',troop_count)),100,0,'active',province_row.main_culture,
            destination.cell_x,destination.cell_y,province_row.id,new.turn+4);
    end loop;

    -- Camps choose a different-culture state province within three province
    -- transitions, then move one dry grid cell per season. A raid begins only
    -- after the force physically reaches its target.
    for camp in select * from public.military_forces where owner='Лагерь разбойников'
        and force_kind='land_army' and status='active' order by id for update loop
        if exists(select 1 from public.military_raids raid where raid.force_id=camp.id and raid.status='active') then
            continue;
        end if;
        if camp.npc_target_province_id is not null and exists(select 1 from public.military_raids raid
            where raid.force_id=camp.id and raid.status in ('completed','failed')) then
            update public.military_forces set npc_target_province_id=null,updated_at=now() where id=camp.id;
            camp.npc_target_province_id:=null;
        end if;

        if camp.npc_target_province_id is null and new.turn>=coalesce(camp.npc_next_raid_turn,0) then
            seed:=mod(abs(hashtextextended(new.turn::text||':'||camp.id::text||':raid-choice',0)::numeric),100);
            if seed<10 then
                with recursive province_edges as (
                    select distinct left_cell.province_id as from_id,right_cell.province_id as to_id
                      from public.military_grid_cells left_cell
                      join public.military_grid_cells right_cell
                        on greatest(abs(left_cell.cell_x-right_cell.cell_x),abs(left_cell.cell_y-right_cell.cell_y))=1
                     where left_cell.province_id is not null and right_cell.province_id is not null
                       and left_cell.province_id<>right_cell.province_id
                       and left_cell.base_terrain='plain' and right_cell.base_terrain='plain'
                ), reachable(province_id,depth,visited) as (
                    select camp.province_id,0,array[camp.province_id]
                    union all
                    select edges.to_id,reachable.depth+1,reachable.visited||edges.to_id
                      from reachable join province_edges edges on edges.from_id=reachable.province_id
                     where reachable.depth<3 and not edges.to_id=any(reachable.visited)
                )
                select province.id into target_id
                  from reachable join public."Provinces" province on province.id=reachable.province_id
                 where reachable.depth between 1 and 3 and province.owner is not null
                   and province.main_culture is distinct from camp.camp_culture
                   and province.occupied_by is null
                   and not exists(select 1 from public.military_forces defender where defender.status='active'
                       and defender.force_kind='land_army' and defender.owner=province.owner and defender.province_id=province.id)
                 order by reachable.depth,md5(camp.id::text||':'||province.id::text||':'||new.turn::text)
                 limit 1;
                if target_id is not null then
                    update public.military_forces set npc_target_province_id=target_id,updated_at=now() where id=camp.id;
                    camp.npc_target_province_id:=target_id;
                end if;
            end if;
        end if;

        if camp.npc_target_province_id is not null then
            if camp.province_id=camp.npc_target_province_id then
                insert into public.military_raids(force_id,attacker_owner,province_id,target_owner,started_turn,success_scale)
                select camp.id,camp.owner,province.id,province.owner,new.turn,
                       least(1,coalesce((select sum((group_row->>'count')::numeric) from jsonb_array_elements(camp.unit_groups) group_row),0)/500)
                  from public."Provinces" province where province.id=camp.npc_target_province_id and province.owner is not null
                    and province.main_culture is distinct from camp.camp_culture and province.occupied_by is null
                    and not exists(select 1 from public.military_raids existing where existing.force_id=camp.id and existing.status='active')
                on conflict do nothing;
                if found then
                    update public.military_forces set action_points=0,npc_next_raid_turn=new.turn+4,updated_at=now() where id=camp.id;
                else
                    update public.military_forces set npc_target_province_id=null,updated_at=now() where id=camp.id;
                end if;
                continue;
            end if;
            select target_cell.cell_x,target_cell.cell_y,target_cell.province_id into destination
              from public.military_grid_cells current_cell
              join public.military_grid_cells target_cell
                on greatest(abs(target_cell.cell_x-current_cell.cell_x),abs(target_cell.cell_y-current_cell.cell_y))=1
              join public.military_grid_cells goal_cell on goal_cell.province_id=camp.npc_target_province_id
             where current_cell.cell_x=camp.cell_x and current_cell.cell_y=camp.cell_y
               and target_cell.base_terrain='plain'
               and coalesce((select terrain.terrain from public.military_terrain_cells terrain
                   where terrain.cell_x=target_cell.cell_x and terrain.cell_y=target_cell.cell_y),'plain')<>'water'
               and greatest(abs(target_cell.cell_x-goal_cell.cell_x),abs(target_cell.cell_y-goal_cell.cell_y))
                   < greatest(abs(current_cell.cell_x-goal_cell.cell_x),abs(current_cell.cell_y-goal_cell.cell_y))
               and not exists(select 1 from public.military_forces other where other.id<>camp.id and other.status='active'
                   and other.force_kind='land_army' and other.cell_x=target_cell.cell_x and other.cell_y=target_cell.cell_y)
             order by greatest(abs(target_cell.cell_x-goal_cell.cell_x),abs(target_cell.cell_y-goal_cell.cell_y)),
                 target_cell.cell_y,target_cell.cell_x limit 1;
            if found then
                update public.military_forces set cell_x=destination.cell_x,cell_y=destination.cell_y,
                    province_id=destination.province_id,action_points=0,updated_at=now() where id=camp.id;
            end if;
        elsif camp.npc_home_cell_x is not null and (camp.cell_x<>camp.npc_home_cell_x or camp.cell_y<>camp.npc_home_cell_y) then
            select target_cell.cell_x,target_cell.cell_y,target_cell.province_id into destination
              from public.military_grid_cells current_cell
              join public.military_grid_cells target_cell
                on greatest(abs(target_cell.cell_x-current_cell.cell_x),abs(target_cell.cell_y-current_cell.cell_y))=1
             where current_cell.cell_x=camp.cell_x and current_cell.cell_y=camp.cell_y
               and target_cell.base_terrain='plain'
               and greatest(abs(target_cell.cell_x-camp.npc_home_cell_x),abs(target_cell.cell_y-camp.npc_home_cell_y))
                   < greatest(abs(current_cell.cell_x-camp.npc_home_cell_x),abs(current_cell.cell_y-camp.npc_home_cell_y))
               and not exists(select 1 from public.military_forces other where other.id<>camp.id and other.status='active'
                   and other.force_kind='land_army' and other.cell_x=target_cell.cell_x and other.cell_y=target_cell.cell_y)
             order by greatest(abs(target_cell.cell_x-camp.npc_home_cell_x),abs(target_cell.cell_y-camp.npc_home_cell_y)),
                 target_cell.cell_y,target_cell.cell_x limit 1;
            if found then
                update public.military_forces set cell_x=destination.cell_x,cell_y=destination.cell_y,
                    province_id=destination.province_id,action_points=0,updated_at=now() where id=camp.id;
            end if;
        end if;
    end loop;
    return new;
end;
$function$;
revoke all on function public.process_military_bandit_camps() from public,anon,authenticated;
drop trigger if exists zzzz_process_military_bandit_camps on public.game_calendar;
create trigger zzzz_process_military_bandit_camps after update of turn on public.game_calendar
for each row execute function public.process_military_bandit_camps();

create or replace function public.apply_bandit_raid_crime_penalty()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare settings_row jsonb;
begin
    if old.status is distinct from 'completed' and new.status='completed' and new.attacker_owner='Лагерь разбойников' then
        update public.state_mechanics set settings=settings||jsonb_build_object(
            'crime_rate',least(100,coalesce((settings->>'crime_rate')::numeric,20)+2),
            'bandit_crime_penalty',least(100,coalesce((settings->>'bandit_crime_penalty')::numeric,0)+2),
            'bandit_crime_added_turn',(select turn from public.game_calendar where singleton=true)
        ),updated_at=now() where owner=new.target_owner;
        update public.state_mechanics set settings=settings||jsonb_build_object(
            'economy',coalesce(settings->'economy','{}'::jsonb)||jsonb_build_object('prestige',coalesce((settings#>>'{economy,prestige}')::numeric,0)-2)
        ),updated_at=now() where owner='Лагерь разбойников';
    end if;
    return new;
end;
$function$;
revoke all on function public.apply_bandit_raid_crime_penalty() from public,anon,authenticated;
drop trigger if exists apply_bandit_raid_crime_penalty on public.military_raids;
create trigger apply_bandit_raid_crime_penalty after update of status on public.military_raids
for each row execute function public.apply_bandit_raid_crime_penalty();

create or replace function public.decay_bandit_raid_crime_penalties()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
    if new.turn<=old.turn then return new; end if;
    update public.state_mechanics set settings=settings||jsonb_build_object(
        'crime_rate',greatest(0,coalesce((settings->>'crime_rate')::numeric,20)-least(1,coalesce((settings->>'bandit_crime_penalty')::numeric,0))),
        'bandit_crime_penalty',greatest(0,coalesce((settings->>'bandit_crime_penalty')::numeric,0)-1),
        'bandit_crime_added_turn',new.turn
    ),updated_at=now()
    where coalesce((settings->>'bandit_crime_penalty')::numeric,0)>0
      and coalesce((settings->>'bandit_crime_added_turn')::integer,0)<new.turn;
    return new;
end;
$function$;
revoke all on function public.decay_bandit_raid_crime_penalties() from public,anon,authenticated;
drop trigger if exists zzzy_decay_bandit_raid_crime_penalties on public.game_calendar;
create trigger zzzy_decay_bandit_raid_crime_penalties after update of turn on public.game_calendar
for each row execute function public.decay_bandit_raid_crime_penalties();

create or replace function public.set_military_npc_battle_decision()
returns trigger language plpgsql set search_path = '' as $function$
begin
    if new.owner in ('Лагерь разбойников','Буйствующие') then
        new.decision:='fight'; new.order_name:='решительный'; new.tactic:='focused_strike'; new.withdrawal_route:=null;
    end if;
    return new;
end;
$function$;
revoke all on function public.set_military_npc_battle_decision() from public,anon,authenticated;
drop trigger if exists military_npc_battle_decision_insert on public.military_battle_armies;
drop trigger if exists military_npc_battle_decision_update on public.military_battle_armies;
create trigger military_npc_battle_decision_insert before insert on public.military_battle_armies
for each row execute function public.set_military_npc_battle_decision();
create trigger military_npc_battle_decision_update before update of decision,owner on public.military_battle_armies
for each row execute function public.set_military_npc_battle_decision();
