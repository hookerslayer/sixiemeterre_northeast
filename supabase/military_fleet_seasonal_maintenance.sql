-- Apply seasonal ship, crew and fleet morale upkeep from the administrator's
-- turn report. Stocks are drawn by militaryEngine.js from the port warehouse
-- or the fleet's onboard cargo.
alter table public.military_fleets
    add column if not exists underfunded_turns integer not null default 0 check (underfunded_turns >= 0),
    add column if not exists maintenance_coverage numeric(5,4) not null default 1 check (maintenance_coverage between 0 and 1),
    add column if not exists last_maintenance_turn integer;

create or replace function public.apply_reported_military_fleet_maintenance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    caller_role text;
    fleet_update jsonb;
    ship jsonb;
    max_crew integer;
    max_hull integer;
begin
    select profile.role into caller_role
      from public.profiles profile
     where profile.id = (select auth.uid());
    if caller_role is distinct from 'admin' then
        raise exception 'Only an administrator can persist fleet turn results' using errcode='42501';
    end if;
    if jsonb_typeof(new.report#>'{military,fleet_updates}') is distinct from 'array' then
        return new;
    end if;
    for fleet_update in select value from jsonb_array_elements(new.report#>'{military,fleet_updates}') loop
        if jsonb_typeof(fleet_update) is distinct from 'object'
           or jsonb_typeof(fleet_update->'ships') is distinct from 'array'
           or jsonb_typeof(fleet_update->'morale') is distinct from 'number'
           or (fleet_update->>'morale')::numeric not between 0 and 100
           or jsonb_typeof(fleet_update->'underfunded_turns') is distinct from 'number'
           or (fleet_update->>'underfunded_turns')::integer < 0
           or jsonb_typeof(fleet_update->'maintenance_coverage') is distinct from 'number'
           or (fleet_update->>'maintenance_coverage')::numeric not between 0 and 1
           or fleet_update->>'status' not in ('active','disbanded') then
            raise exception 'Invalid seasonal fleet maintenance row' using errcode='22023';
        end if;
        for ship in select value from jsonb_array_elements(fleet_update->'ships') loop
            max_crew := case ship->>'type' when 'Ушкуй' then 6 when 'Насад' then 12 when 'Ладья' then 20 when 'Когг' then 20 when 'Хольк' then 30 else 0 end;
            max_hull := case ship->>'type' when 'Ушкуй' then 2 when 'Насад' then 4 when 'Ладья' then 3 when 'Когг' then 4 when 'Хольк' then 5 else 0 end;
            if max_crew=0
               or jsonb_typeof(ship->'crew') is distinct from 'number'
               or (ship->>'crew')::integer not between 0 and max_crew
               or jsonb_typeof(ship->'hull') is distinct from 'number'
               or (ship->>'hull')::numeric not between 0 and max_hull
               or jsonb_typeof(coalesce(ship->'cargo','{}'::jsonb)) is distinct from 'object' then
                raise exception 'Invalid ship state in seasonal fleet report' using errcode='22023';
            end if;
        end loop;
        update public.military_fleets fleet
           set ships=fleet_update->'ships',
               morale=(fleet_update->>'morale')::numeric,
               underfunded_turns=(fleet_update->>'underfunded_turns')::integer,
               maintenance_coverage=(fleet_update->>'maintenance_coverage')::numeric,
               last_maintenance_turn=new.turn,
               status=fleet_update->>'status',
               updated_at=now()
         where fleet.id=(fleet_update->>'id')::uuid
           and fleet.owner=new.owner
           and fleet.status='active';
        if not found then
            raise exception 'A fleet changed while the turn was being processed' using errcode='40001';
        end if;
    end loop;
    return new;
end;
$function$;

revoke all on function public.apply_reported_military_fleet_maintenance() from public,anon,authenticated;
drop trigger if exists apply_reported_military_fleet_maintenance on public.turn_economy_reports;
create trigger apply_reported_military_fleet_maintenance
    after insert or update of report on public.turn_economy_reports
    for each row
    when (new.report#>'{military,fleet_updates}' is not null)
    execute function public.apply_reported_military_fleet_maintenance();
