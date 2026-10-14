-- Optional troop escorts are committed to a colonization mission and add the rule's success bonus.
alter table public.military_colonization_missions
    add column if not exists force_id uuid references public.military_forces(id) on delete set null;
alter table public.military_colonization_missions drop constraint if exists military_colonization_missions_bonus_chance_check;
alter table public.military_colonization_missions add constraint military_colonization_missions_bonus_chance_check check (bonus_chance between 0 and 30);
alter table public.military_forces
    add column if not exists colonization_mission_id uuid references public.military_colonization_missions(id) on delete set null;
create index if not exists military_colonization_force_idx on public.military_colonization_missions(force_id) where status='active';

create or replace function public.guard_colonizing_force_update()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare caller_role text;
begin
    select role into caller_role from public.profiles where id=(select auth.uid());
    if caller_role='player' and old.colonization_mission_id is not null
       and new.colonization_mission_id is not distinct from old.colonization_mission_id
       and (new.force_kind is distinct from old.force_kind or new.province_id is distinct from old.province_id
         or new.marker_id is distinct from old.marker_id or new.cell_x is distinct from old.cell_x
         or new.cell_y is distinct from old.cell_y or new.unit_groups is distinct from old.unit_groups
         or new.status is distinct from old.status) then
        raise exception 'This army is committed to a colonization mission' using errcode='55000';
    end if;
    return new;
end;
$function$;
revoke all on function public.guard_colonizing_force_update() from public,anon,authenticated;
drop trigger if exists military_force_colonization_guard on public.military_forces;
create trigger military_force_colonization_guard before update on public.military_forces
for each row execute function public.guard_colonizing_force_update();

create or replace function public.release_military_colonization_assets()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
    if old.status='active' and new.status<>'active' then
        if new.force_id is not null then
            update public.military_forces set colonization_mission_id=null,updated_at=now()
             where id=new.force_id and colonization_mission_id=new.id;
        end if;
        if new.fleet_id is not null then
            update public.military_fleets set colonization_mission_id=null,updated_at=now()
             where id=new.fleet_id and colonization_mission_id=new.id;
        end if;
    end if;
    return new;
end;
$function$;
revoke all on function public.release_military_colonization_assets() from public,anon,authenticated;
drop trigger if exists release_military_colonization_assets on public.military_colonization_missions;
create trigger release_military_colonization_assets after update of status on public.military_colonization_missions
for each row execute function public.release_military_colonization_assets();

create or replace function public.link_persistent_force_to_battle_army()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_force_id uuid:=nullif(new.unit_data->>'persistent_force_id','')::uuid; v_force public.military_forces%rowtype;
begin
    if v_force_id is null then new.persistent_force_id:=null; return new; end if;
    select * into v_force from public.military_forces where id=v_force_id and force_kind='land_army' and status='active' for share;
    if not found or v_force.owner is distinct from new.owner then raise exception 'Selected persistent army is unavailable to this participant' using errcode='22023'; end if;
    if v_force.colonization_mission_id is not null then raise exception 'An army committed to colonization cannot enter battle' using errcode='55000'; end if;
    new.persistent_force_id:=v_force_id;
    return new;
end;
$function$;

create or replace function public.start_military_land_colonization_with_escort(
    p_source_marker_id bigint,p_target_province_id bigint,p_extra_investment integer default 0,p_force_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
    profile public.profiles%rowtype; source public.markers%rowtype; escort public.military_forces%rowtype;
    result jsonb; mission_id uuid; troop_total integer; troop_bonus integer;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role<>'player' or nullif(profile.owner,'') is null then raise exception 'Only a state player can start colonization' using errcode='42501'; end if;
    if p_force_id is not null then
        select * into source from public.markers where id=p_source_marker_id and owner=profile.owner and type<>'ruins' for update;
        if not found or source.province_id is null then raise exception 'Choose a valid settlement as source' using errcode='22023'; end if;
        select * into escort from public.military_forces where id=p_force_id and owner=profile.owner and force_kind='land_army' and status='active' for update;
        if not found or escort.province_id is distinct from source.province_id or escort.colonization_mission_id is not null then raise exception 'Escort army must be available in the source settlement province' using errcode='22023'; end if;
        if exists(select 1 from public.military_battle_armies a join public.military_battles b on b.id=a.battle_id where a.persistent_force_id=escort.id and b.status='pending') then raise exception 'An army committed to a battle cannot escort colonists' using errcode='55000'; end if;
    end if;
    result:=public.start_military_colonization(p_source_marker_id,p_target_province_id,p_extra_investment);
    if p_force_id is not null then
        select coalesce(sum((value->>'count')::integer),0)::integer into troop_total from jsonb_array_elements(escort.unit_groups);
        troop_bonus:=least(20,(troop_total/100)*5);
        mission_id:=(result->>'mission_id')::uuid;
        update public.military_colonization_missions set force_id=escort.id,bonus_chance=least(30,bonus_chance+troop_bonus),
            success_chance=least(80,success_chance+troop_bonus) where id=mission_id;
        update public.military_forces set colonization_mission_id=mission_id,updated_at=now() where id=escort.id;
        result:=result||jsonb_build_object('escort_force_id',escort.id,'escort_troops',troop_total,'escort_bonus',troop_bonus);
    end if;
    return result;
end;
$function$;
revoke all on function public.start_military_land_colonization_with_escort(bigint,bigint,integer,uuid) from public,anon;
grant execute on function public.start_military_land_colonization_with_escort(bigint,bigint,integer,uuid) to authenticated;

create or replace function public.start_military_sea_colonization_with_escort(
    p_source_marker_id bigint,p_target_province_id bigint,p_fleet_id uuid,p_extra_investment integer default 0,p_force_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
    profile public.profiles%rowtype; source public.markers%rowtype; escort public.military_forces%rowtype;
    result jsonb; mission_id uuid; troop_total integer; troop_bonus integer;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role<>'player' or nullif(profile.owner,'') is null then raise exception 'Only a state player can start colonization' using errcode='42501'; end if;
    if p_force_id is not null then
        select * into source from public.markers where id=p_source_marker_id and owner=profile.owner and type<>'ruins' for update;
        if not found or source.province_id is null then raise exception 'Choose a valid settlement as source' using errcode='22023'; end if;
        select * into escort from public.military_forces where id=p_force_id and owner=profile.owner and force_kind='land_army' and status='active' for update;
        if not found or escort.province_id is distinct from source.province_id or escort.colonization_mission_id is not null then raise exception 'Escort army must be available in the source settlement province' using errcode='22023'; end if;
        if exists(select 1 from public.military_battle_armies a join public.military_battles b on b.id=a.battle_id where a.persistent_force_id=escort.id and b.status='pending') then raise exception 'An army committed to a battle cannot escort colonists' using errcode='55000'; end if;
    end if;
    result:=public.start_military_sea_colonization(p_source_marker_id,p_target_province_id,p_fleet_id,p_extra_investment);
    if p_force_id is not null then
        select coalesce(sum((value->>'count')::integer),0)::integer into troop_total from jsonb_array_elements(escort.unit_groups);
        troop_bonus:=least(20,(troop_total/100)*5);
        mission_id:=(result->>'mission_id')::uuid;
        update public.military_colonization_missions set force_id=escort.id,bonus_chance=least(30,bonus_chance+troop_bonus),
            success_chance=least(80,success_chance+troop_bonus) where id=mission_id;
        update public.military_forces set colonization_mission_id=mission_id,updated_at=now() where id=escort.id;
        result:=result||jsonb_build_object('escort_force_id',escort.id,'escort_troops',troop_total,'escort_bonus',troop_bonus);
    end if;
    return result;
end;
$function$;
revoke all on function public.start_military_sea_colonization_with_escort(bigint,bigint,uuid,integer,uuid) from public,anon;
grant execute on function public.start_military_sea_colonization_with_escort(bigint,bigint,uuid,integer,uuid) to authenticated;
