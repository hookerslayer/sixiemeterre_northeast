-- Persist seasonal army upkeep and attrition in the same transaction as the
-- administrator's economy turn. The inputs are produced by militaryEngine.js.
alter table public.military_forces
    add column if not exists underfunded_turns integer not null default 0 check (underfunded_turns >= 0),
    add column if not exists deserter_carry numeric(8,7) not null default 0 check (deserter_carry >= 0 and deserter_carry < 1),
    add column if not exists maintenance_coverage numeric(5,4) not null default 1 check (maintenance_coverage between 0 and 1),
    add column if not exists last_maintenance_turn integer;
alter table public.military_forces
    add column if not exists noncombat_carry numeric(8,7) not null default 0 check (noncombat_carry >= 0 and noncombat_carry < 1);

create or replace function public.apply_reported_military_maintenance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    caller_role text;
    force_update jsonb;
begin
    select profile.role into caller_role from public.profiles profile where profile.id = (select auth.uid());
    if caller_role is distinct from 'admin' then
        raise exception 'Only an administrator can persist military turn results' using errcode='42501';
    end if;
    for force_update in
        select value from jsonb_array_elements(coalesce(new.report#>'{military,force_updates}','[]'::jsonb))
    loop
        if jsonb_typeof(force_update) is distinct from 'object'
           or jsonb_typeof(force_update->'unit_groups') is distinct from 'array'
           or jsonb_typeof(force_update->'morale') is distinct from 'number'
           or (force_update->>'morale')::numeric not between 0 and 100
           or jsonb_typeof(force_update->'underfunded_turns') is distinct from 'number'
           or (force_update->>'underfunded_turns')::integer < 0
           or jsonb_typeof(force_update->'deserter_carry') is distinct from 'number'
           or (force_update->>'deserter_carry')::numeric not between 0 and 0.9999999
           or jsonb_typeof(force_update->'maintenance_coverage') is distinct from 'number'
           or (force_update->>'maintenance_coverage')::numeric not between 0 and 1
           or jsonb_typeof(force_update->'noncombat_carry') is distinct from 'number'
           or (force_update->>'noncombat_carry')::numeric not between 0 and 0.9999999
           or force_update->>'status' not in ('active','disbanded') then
            raise exception 'Invalid seasonal military maintenance row' using errcode='22023';
        end if;
        update public.military_forces force
           set unit_groups=force_update->'unit_groups',
               morale=(force_update->>'morale')::numeric,
               underfunded_turns=(force_update->>'underfunded_turns')::integer,
               deserter_carry=(force_update->>'deserter_carry')::numeric,
               maintenance_coverage=(force_update->>'maintenance_coverage')::numeric,
               noncombat_carry=(force_update->>'noncombat_carry')::numeric,
               last_maintenance_turn=new.turn,
               status=force_update->>'status',
               updated_at=now()
         where force.id=(force_update->>'id')::uuid
           and force.owner=new.owner
           and force.status='active';
        if not found then raise exception 'A military force changed while the turn was being processed' using errcode='40001'; end if;
    end loop;
    return new;
end;
$function$;

revoke all on function public.apply_reported_military_maintenance() from public, anon, authenticated;
drop trigger if exists apply_reported_military_maintenance on public.turn_economy_reports;
create trigger apply_reported_military_maintenance
    after insert or update of report on public.turn_economy_reports
    for each row
    when (new.report ? 'military')
    execute function public.apply_reported_military_maintenance();
