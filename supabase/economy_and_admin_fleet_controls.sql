-- Narrow RPC for recording one-off economy rows without replacing protected state settings.
create or replace function public.save_state_one_off_operations(
    p_owner text,
    p_one_off_income_treasury jsonb,
    p_one_off_expenses_treasury jsonb,
    p_one_off_income_prestige jsonb,
    p_one_off_expenses_prestige jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare
    profile public.profiles%rowtype;
    result jsonb;
    operations jsonb[] := array[p_one_off_income_treasury,p_one_off_expenses_treasury,p_one_off_income_prestige,p_one_off_expenses_prestige];
    operation jsonb;
    item jsonb;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role not in ('player','admin') then raise exception 'Only a state player or administrator can change one-off operations' using errcode='42501'; end if;
    if profile.role<>'admin' and profile.owner is distinct from p_owner then raise exception 'Players can only change their own state' using errcode='42501'; end if;
    foreach operation in array operations loop
        if jsonb_typeof(operation)<>'array' or jsonb_array_length(operation)>100 then raise exception 'One-off operations must be arrays of at most 100 rows' using errcode='22023'; end if;
        for item in select value from jsonb_array_elements(operation) loop
            if nullif(btrim(item->>'reason'),'') is null or coalesce((item->>'amount')::numeric,-1)<0 then
                raise exception 'Every operation needs a reason and a non-negative amount' using errcode='22023';
            end if;
        end loop;
    end loop;
    update public.state_mechanics sm
       set settings=jsonb_set(coalesce(sm.settings,'{}'::jsonb),'{economy}',
           coalesce(sm.settings->'economy','{}'::jsonb)||jsonb_build_object(
               'one_off_income_treasury',p_one_off_income_treasury,
               'one_off_expenses_treasury',p_one_off_expenses_treasury,
               'one_off_income_prestige',p_one_off_income_prestige,
               'one_off_expenses_prestige',p_one_off_expenses_prestige,
               'income',coalesce(sm.settings#>'{economy,income}','{}'::jsonb)||jsonb_build_object('other_one_off',0),
               'expenses',coalesce(sm.settings#>'{economy,expenses}','{}'::jsonb)||jsonb_build_object('other_one_off',0)
           ),true), updated_at=now()
     where sm.owner=p_owner returning sm.settings into result;
    if not found then raise exception 'State settings were not found' using errcode='P0002'; end if;
    return result;
end;
$function$;
revoke all on function public.save_state_one_off_operations(text,jsonb,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.save_state_one_off_operations(text,jsonb,jsonb,jsonb,jsonb) to authenticated;

-- Keep fleet commanders in the shared officer roster so players can only reuse officers in reserve.
alter table public.military_fleets add column if not exists commander_id uuid;
alter table public.military_commanders add column if not exists fleet_id uuid;
do $constraints$
begin
    if not exists(select 1 from pg_constraint where conname='military_fleets_commander_id_fkey') then
        alter table public.military_fleets add constraint military_fleets_commander_id_fkey foreign key(commander_id) references public.military_commanders(id) on delete set null;
    end if;
    if not exists(select 1 from pg_constraint where conname='military_commanders_fleet_id_fkey') then
        alter table public.military_commanders add constraint military_commanders_fleet_id_fkey foreign key(fleet_id) references public.military_fleets(id) on delete set null;
    end if;
end;
$constraints$;
create unique index if not exists military_commanders_one_fleet_idx on public.military_commanders(fleet_id) where fleet_id is not null;

create or replace function public.assign_military_fleet_commander(p_fleet_id uuid,p_commander_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
    profile public.profiles%rowtype;
    fleet public.military_fleets%rowtype;
    officer public.military_commanders%rowtype;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role not in ('player','admin') then raise exception 'Only a state player or administrator can assign a fleet commander' using errcode='42501'; end if;
    select * into fleet from public.military_fleets where id=p_fleet_id for update;
    if not found or (profile.role<>'admin' and fleet.owner is distinct from profile.owner) then raise exception 'Fleet not found or not controlled by this player' using errcode='42501'; end if;
    select * into officer from public.military_commanders where id=p_commander_id and owner=fleet.owner for update;
    if not found or officer.status not in ('available','assigned') or (officer.status='assigned' and officer.fleet_id is distinct from fleet.id) or (officer.force_id is not null) then
        raise exception 'Choose an available commander of this state' using errcode='22023';
    end if;
    if fleet.commander_id is not null and fleet.commander_id<>officer.id then
        update public.military_commanders set fleet_id=null,force_id=null,status='available' where id=fleet.commander_id;
    end if;
    update public.military_fleets set commander_id=officer.id,commander_name=officer.name,commander_age=officer.age,
        commander_skills=officer.skills,commander_experience=officer.experience,updated_at=now() where id=fleet.id;
    update public.military_commanders set fleet_id=fleet.id,force_id=null,status='assigned' where id=officer.id;
    return jsonb_build_object('fleet_id',fleet.id,'commander_id',officer.id,'commander_name',officer.name);
end;
$function$;
revoke all on function public.assign_military_fleet_commander(uuid,uuid) from public,anon;
grant execute on function public.assign_military_fleet_commander(uuid,uuid) to authenticated;

create or replace function public.start_military_ship_build_with_commander(
    p_port_marker_id bigint,p_source_marker_id bigint,p_ship_type text,p_fleet_name text,p_commander_id uuid,p_fleet_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
    profile public.profiles%rowtype;
    officer public.military_commanders%rowtype;
    result jsonb;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role<>'player' then raise exception 'Only a state player can build a ship' using errcode='42501'; end if;
    if p_source_marker_id is distinct from p_port_marker_id then raise exception 'Shipbuilding materials must come from the port settlement warehouse' using errcode='22023'; end if;
    if p_fleet_id is null then
        select * into officer from public.military_commanders where id=p_commander_id and owner=profile.owner and status='available' and force_id is null and fleet_id is null for update;
        if not found then raise exception 'Choose an available commander from your roster' using errcode='22023'; end if;
    end if;
    result:=public.start_military_ship_build(p_port_marker_id,p_source_marker_id,p_ship_type,p_fleet_name,
        coalesce(officer.name,'Не назначен'),coalesce(officer.age,35),p_fleet_id);
    if p_fleet_id is null then perform public.assign_military_fleet_commander((result->>'fleet_id')::uuid,officer.id); end if;
    return result;
end;
$function$;
revoke all on function public.start_military_ship_build_with_commander(bigint,bigint,text,text,uuid,uuid) from public,anon;
grant execute on function public.start_military_ship_build_with_commander(bigint,bigint,text,text,uuid,uuid) to authenticated;

create or replace function public.admin_create_military_fleet(
    p_owner text,p_name text,p_port_marker_id bigint,p_commander_id uuid,p_ships jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
    profile public.profiles%rowtype;
    port public.military_ports%rowtype;
    officer public.military_commanders%rowtype;
    fleet public.military_fleets%rowtype;
    normalized_ships jsonb;
    ship_count integer;
    berth_count integer;
    allowed_types text[];
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role<>'admin' then raise exception 'Only an administrator can create a fleet' using errcode='42501'; end if;
    if nullif(btrim(p_name),'') is null or length(btrim(p_name))>80 then raise exception 'Fleet name must contain 1 to 80 characters' using errcode='22023'; end if;
    select * into port from public.military_ports where marker_id=p_port_marker_id and owner=p_owner and status='active' for update;
    if not found then raise exception 'Choose an active port belonging to the selected state' using errcode='22023'; end if;
    select * into officer from public.military_commanders where id=p_commander_id and owner=p_owner and status='available' and force_id is null and fleet_id is null for update;
    if not found then raise exception 'Choose an available commander belonging to the selected state' using errcode='22023'; end if;
    if jsonb_typeof(p_ships)<>'array' then raise exception 'Ship roster must be an array' using errcode='22023'; end if;
    ship_count:=jsonb_array_length(p_ships);
    if ship_count<1 or ship_count>12 then raise exception 'A fleet must contain between 1 and 12 ships' using errcode='22023'; end if;
    allowed_types:=case when port.port_type='river_port' then array['Ушкуй','Насад','Ладья'] else array['Ладья','Когг','Хольк'] end;
    if exists(select 1 from jsonb_array_elements(p_ships) s where (s->>'type') is null or not ((s->>'type')=any(allowed_types))) then
        raise exception 'One or more ships are incompatible with this port' using errcode='22023';
    end if;
    berth_count:=0;
    select coalesce(sum(case s->>'type' when 'Ушкуй' then 1 when 'Насад' then 2 when 'Ладья' then 2 when 'Когг' then 3 else 4 end),0)::integer
      into berth_count from jsonb_array_elements(p_ships) s;
    if berth_count>(case port.port_type when 'river_port' then 6 else 12 end) then raise exception 'Fleet exceeds the selected port berth capacity' using errcode='23514'; end if;
    select jsonb_agg(jsonb_build_object('type',s->>'type','crew',case s->>'type' when 'Ушкуй' then 6 when 'Насад' then 12 when 'Ладья' then 20 when 'Когг' then 20 else 30 end,
        'hull',case s->>'type' when 'Ушкуй' then 2 when 'Насад' then 4 when 'Ладья' then 3 when 'Когг' then 4 else 5 end,'boarding_troops',0,'cargo','{}'::jsonb))
      into normalized_ships from jsonb_array_elements(p_ships) s;
    insert into public.military_fleets(owner,name,ships,morale,status,location_kind,port_marker_id,commander_id,commander_name,commander_age,commander_skills,commander_experience)
    values(p_owner,btrim(p_name),normalized_ships,100,'active','port',port.marker_id,officer.id,officer.name,officer.age,officer.skills,officer.experience) returning * into fleet;
    update public.military_commanders set fleet_id=fleet.id,force_id=null,status='assigned' where id=officer.id;
    return jsonb_build_object('id',fleet.id,'owner',fleet.owner,'name',fleet.name,'port_marker_id',fleet.port_marker_id,'ships',fleet.ships,'commander_id',officer.id);
end;
$function$;
revoke all on function public.admin_create_military_fleet(text,text,bigint,uuid,jsonb) from public,anon;
grant execute on function public.admin_create_military_fleet(text,text,bigint,uuid,jsonb) to authenticated;

create or replace function public.guard_ship_build_warehouse_matches_port()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
    if new.source_marker_id is distinct from new.port_marker_id then
        raise exception 'Shipbuilding materials must come from the port settlement warehouse' using errcode='22023';
    end if;
    return new;
end;
$function$;
revoke all on function public.guard_ship_build_warehouse_matches_port() from public,anon,authenticated;
drop trigger if exists guard_ship_build_warehouse_matches_port on public.military_ship_build_orders;
create trigger guard_ship_build_warehouse_matches_port before insert or update of source_marker_id,port_marker_id on public.military_ship_build_orders
for each row execute function public.guard_ship_build_warehouse_matches_port();
