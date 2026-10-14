-- Four-turn overland colonization missions.
create table if not exists public.military_colonization_missions (
    id uuid primary key default gen_random_uuid(),
    owner text not null references public.state_mechanics(owner) on delete cascade,
    source_marker_id bigint not null references public.markers(id) on delete restrict,
    target_province_id bigint not null references public."Provinces"(id) on delete restrict,
    started_turn integer not null,
    starts_per_turn smallint not null default 1,
    investment numeric not null default 1000 check (investment>=1000),
    bonus_chance integer not null default 0 check (bonus_chance between 0 and 10),
    success_chance integer not null default 50 check (success_chance between 50 and 80),
    status text not null default 'active' check (status in ('active','succeeded','failed','cancelled')),
    result jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    resolved_at timestamptz
);
alter table public.military_colonization_missions
    drop constraint if exists military_colonization_missions_success_chance_check;
alter table public.military_colonization_missions
    add constraint military_colonization_missions_success_chance_check check (success_chance between 50 and 80);
create unique index if not exists military_colonization_one_active_target_idx on public.military_colonization_missions(target_province_id) where status='active';
create index if not exists military_colonization_owner_status_idx on public.military_colonization_missions(owner,status,started_turn desc);
alter table public.military_colonization_missions enable row level security;
drop policy if exists "Colonization missions visible to involved states" on public.military_colonization_missions;
create policy "Colonization missions visible to involved states" on public.military_colonization_missions for select to authenticated
using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and (p.role='admin' or p.owner=owner)));
revoke all on public.military_colonization_missions from anon,authenticated;
grant select on public.military_colonization_missions to authenticated;

create or replace function public.start_military_colonization(p_source_marker_id bigint,p_target_province_id bigint,p_extra_investment integer default 0)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
    profile public.profiles%rowtype;
    source public.markers%rowtype;
    target public."Provinces"%rowtype;
    calendar public.game_calendar%rowtype;
    owner_settings jsonb;
    investment numeric;
    bonus integer;
    cost_factor numeric := 1;
    mission public.military_colonization_missions%rowtype;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role<>'player' or nullif(profile.owner,'') is null then raise exception 'Only a state player can start colonization' using errcode='42501'; end if;
    if p_extra_investment not in (0,1000,2000) then raise exception 'Additional investment must be 0, 1,000 or 2,000 z' using errcode='22023'; end if;
    select * into calendar from public.game_calendar where singleton=true;
    select greatest(0,1+coalesce(sum(value),0)/100) into cost_factor
      from public.state_modifiers where owner=profile.owner and effect_key='colonization_cost_pct' and scope_type='state'
       and status='active' and starts_turn<=calendar.turn and (ends_turn is null or ends_turn>=calendar.turn);
    if (select count(*) from public.military_colonization_missions where owner=profile.owner and status='active')>=2 then raise exception 'A state may run at most two missions at once' using errcode='55000'; end if;
    if exists(select 1 from public.military_colonization_missions where owner=profile.owner and started_turn=calendar.turn) then raise exception 'Only one new mission may begin in a season' using errcode='55000'; end if;
    select * into source from public.markers where id=p_source_marker_id and owner=profile.owner and type<>'ruins' for update;
    if not found or source.yards<50 then raise exception 'Choose your settlement with at least 50 yards of population' using errcode='22023'; end if;
    select * into target from public."Provinces" where id=p_target_province_id and owner is null for update;
    if not found then raise exception 'The target must be a neutral province' using errcode='22023'; end if;
    if exists(select 1 from public.military_colonization_missions where target_province_id=target.id and status='active') then raise exception 'Another mission is already headed to this province' using errcode='55000'; end if;
    if exists(select 1 from public.military_forces force where force.force_kind='land_army' and force.status='active' and force.province_id=target.id) then raise exception 'A military force occupies the target province' using errcode='55000'; end if;
    if not exists(
        select 1 from public.military_grid_cells target_cell
        join public.military_grid_cells own_cell on greatest(abs(target_cell.cell_x-own_cell.cell_x),abs(target_cell.cell_y-own_cell.cell_y))=1
        join public."Provinces" own_province on own_province.id=own_cell.province_id and own_province.owner=profile.owner and own_province.occupied_by is null
        where target_cell.province_id=target.id
    ) then raise exception 'A land mission target must neighbor an owned, non-occupied province' using errcode='22023'; end if;
    investment:=round((1000+p_extra_investment)*cost_factor,2);
    bonus:=least(10,(p_extra_investment/1000)*5);
    select settings into owner_settings from public.state_mechanics where owner=profile.owner for update;
    if coalesce((owner_settings#>>'{economy,treasury}')::numeric,0)<investment then raise exception 'Not enough treasury for colonization' using errcode='22023'; end if;
    update public.state_mechanics set settings=settings||jsonb_build_object('economy',coalesce(settings->'economy','{}'::jsonb)||jsonb_build_object('treasury',(owner_settings#>>'{economy,treasury}')::numeric-investment)),updated_at=now() where owner=profile.owner;
    update public.markers set yards=yards-50 where id=source.id;
    insert into public.military_colonization_missions(owner,source_marker_id,target_province_id,started_turn,investment,bonus_chance,success_chance)
    values(profile.owner,source.id,target.id,calendar.turn,investment,bonus,least(80,50+bonus)) returning * into mission;
    return jsonb_build_object('mission_id',mission.id,'target_province_id',target.id,'started_turn',calendar.turn,'success_chance',mission.success_chance,'next_payment',500,'settlers',200);
end;
$function$;
revoke all on function public.start_military_colonization(bigint,bigint,integer) from public,anon;
grant execute on function public.start_military_colonization(bigint,bigint,integer) to authenticated;

create or replace function public.cancel_military_colonization(p_mission_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
    profile public.profiles%rowtype;
    mission public.military_colonization_missions%rowtype;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found then raise exception 'Authentication required' using errcode='42501'; end if;
    select * into mission from public.military_colonization_missions where id=p_mission_id and status='active' for update;
    if not found then raise exception 'Active colonization mission not found' using errcode='22023'; end if;
    if profile.role<>'admin' and (profile.role<>'player' or profile.owner is distinct from mission.owner) then raise exception 'Only the mission owner may cancel it' using errcode='42501'; end if;
    update public.markers set yards=yards+25 where id=mission.source_marker_id;
    update public.military_colonization_missions set status='cancelled',result=jsonb_build_object('roll',null,'returned_settlers',100,'lost_settlers',100),resolved_at=now() where id=mission.id;
    return jsonb_build_object('mission_id',mission.id,'returned_yards',25,'refunded',0);
end;
$function$;
revoke all on function public.cancel_military_colonization(uuid) from public,anon;
grant execute on function public.cancel_military_colonization(uuid) to authenticated;

create or replace function public.resolve_military_colonization_on_turn()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
    mission public.military_colonization_missions%rowtype;
    province public."Provinces"%rowtype;
    roll integer;
    paid boolean;
    cost_factor numeric;
    payment numeric;
begin
    if new.turn<=old.turn then return new; end if;
    for mission in select * from public.military_colonization_missions where status='active' and started_turn<new.turn for update loop
        paid:=true;
        if new.turn<=mission.started_turn+3 then
            select greatest(0,1+coalesce(sum(value),0)/100) into cost_factor
              from public.state_modifiers where owner=mission.owner and effect_key='colonization_cost_pct' and scope_type='state'
               and status='active' and starts_turn<=new.turn and (ends_turn is null or ends_turn>=new.turn);
            payment:=round(500*cost_factor,2);
            update public.state_mechanics sm set settings=sm.settings||jsonb_build_object('economy',coalesce(sm.settings->'economy','{}'::jsonb)||jsonb_build_object('treasury',greatest(0,coalesce((sm.settings#>>'{economy,treasury}')::numeric,0)-payment))),updated_at=now()
            where sm.owner=mission.owner and coalesce((sm.settings#>>'{economy,treasury}')::numeric,0)>=payment;
            paid:=found;
        end if;
        if not paid then
            update public.markers set yards=yards+25 where id=mission.source_marker_id;
            update public.military_colonization_missions set status='failed',result=jsonb_build_object('reason','payment_failed','returned_settlers',100,'lost_settlers',100),resolved_at=now() where id=mission.id;
            continue;
        end if;
        if new.turn<mission.started_turn+4 then continue; end if;
        select * into province from public."Provinces" where id=mission.target_province_id for update;
        if not found or province.owner is not null then
            update public.markers set yards=yards+25 where id=mission.source_marker_id;
            update public.military_colonization_missions set status='failed',result=jsonb_build_object('reason','target_no_longer_neutral','returned_settlers',100,'lost_settlers',100),resolved_at=now() where id=mission.id;
            continue;
        end if;
        roll:=mod(abs(hashtextextended(mission.id::text||':'||mission.started_turn::text,0)::numeric),100)::integer+1;
        if roll<=mission.success_chance then
            update public."Provinces" set owner=mission.owner,yards=45,development=20,
              occupied_by=null,target_marker_id=null,stored_resource_qty=0 where id=province.id;
            update public.military_colonization_missions set status='succeeded',result=jsonb_build_object('roll',roll,'success_chance',mission.success_chance,'settlers_lost',20,'settlers_established',180),resolved_at=now() where id=mission.id;
        else
            update public.markers set yards=yards+25 where id=mission.source_marker_id;
            update public.military_colonization_missions set status='failed',result=jsonb_build_object('roll',roll,'success_chance',mission.success_chance,'settlers_lost',100,'settlers_returned',100),resolved_at=now() where id=mission.id;
        end if;
    end loop;
    return new;
end;
$function$;
revoke all on function public.resolve_military_colonization_on_turn() from public,anon,authenticated;
drop trigger if exists resolve_military_colonization_on_turn on public.game_calendar;
create trigger resolve_military_colonization_on_turn after update of turn on public.game_calendar
for each row execute function public.resolve_military_colonization_on_turn();
