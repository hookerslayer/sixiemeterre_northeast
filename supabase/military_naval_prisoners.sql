-- Keep captured troops as prisoners instead of losing their unit records.
create table if not exists public.military_prisoners (
    id uuid primary key default gen_random_uuid(),
    battle_id uuid not null references public.military_battles(id) on delete cascade,
    source_force_id uuid references public.military_forces(id) on delete set null,
    captor_owner text not null references public.state_mechanics(owner) on delete restrict,
    original_owner text not null references public.state_mechanics(owner) on delete restrict,
    force_name text not null,
    commander_name text,
    commander_age integer,
    unit_groups jsonb not null default '[]'::jsonb check(jsonb_typeof(unit_groups)='array'),
    siege_equipment jsonb not null default '{}'::jsonb check(jsonb_typeof(siege_equipment)='object'),
    captured_turn integer not null,
    status text not null default 'held' check(status in ('held','released','ransomed','escaped')),
    created_at timestamptz not null default now(),
    unique(battle_id,source_force_id,captor_owner)
);
alter table public.military_prisoners enable row level security;
drop policy if exists "Owners and admins can read military prisoners" on public.military_prisoners;
create policy "Owners and admins can read military prisoners" on public.military_prisoners for select to authenticated
    using(exists(select 1 from public.profiles p where p.id=(select auth.uid())
        and (p.role='admin' or p.owner=military_prisoners.captor_owner or p.owner=military_prisoners.original_owner)));
revoke all on public.military_prisoners from anon,authenticated;
grant select on public.military_prisoners to authenticated;

create or replace function public.record_naval_passengers_as_prisoners()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    battle public.military_battles%rowtype;
    passenger record;
    captor_side text;
    captor text;
    groups jsonb;
    equipment jsonb;
    turn_no integer;
begin
    select * into battle from public.military_battles where id=new.battle_id;
    if not found or battle.battle_type<>'naval' then return new; end if;
    select turn into turn_no from public.game_calendar where singleton=true;
    for passenger in
        select distinct (p.value->>'force_id')::uuid as force_id,p.value->>'owner' as owner,p.value->>'name' as name,
               p.value->>'commander_name' as commander_name,nullif(p.value->>'commander_age','')::integer as commander_age,
               case when coalesce((ship.value->>'captured')::boolean,false)
                    then coalesce(nullif(ship.value->>'capturedBy',''),nullif(ship.value->>'captured_by',''))
                    else nullif(p.value->>'captured_by','') end as captured_by
          from jsonb_each(coalesce(new.report->'fleets','{}'::jsonb)) side(key,value)
          cross join lateral jsonb_array_elements(coalesce(side.value->'ships','[]'::jsonb)) ship(value)
          cross join lateral jsonb_array_elements(coalesce(ship.value->'passengers','[]'::jsonb)) p(value)
         where nullif(p.value->>'force_id','') is not null
           and (nullif(p.value->>'captured_by','') is not null
             or (coalesce((ship.value->>'captured')::boolean,false) and nullif(ship.value->>'capturedBy','') is not null)
             or (coalesce((ship.value->>'captured')::boolean,false) and nullif(ship.value->>'captured_by','') is not null))
    loop
        captor_side:=passenger.captured_by;
        select owner into captor from public.military_battle_armies
         where battle_id=new.battle_id and side=captor_side limit 1;
        if captor is null or captor=passenger.owner then continue; end if;
        select coalesce(jsonb_agg(jsonb_build_object('type',unit_type,'count',unit_count) order by unit_type),'[]'::jsonb)
          into groups
          from (select u.value->>'type' as unit_type,sum(coalesce((u.value->>'count')::integer,0))::integer as unit_count
                  from jsonb_each(coalesce(new.report->'fleets','{}'::jsonb)) side(key,value)
                  cross join lateral jsonb_array_elements(coalesce(side.value->'ships','[]'::jsonb)) ship(value)
                  cross join lateral jsonb_array_elements(coalesce(ship.value->'passengers','[]'::jsonb)) p(value)
                  cross join lateral jsonb_array_elements(coalesce(p.value->'unit_groups','[]'::jsonb)) u(value)
                 where p.value->>'force_id'=passenger.force_id::text
                   and (p.value->>'captured_by'=captor_side
                     or (coalesce((ship.value->>'captured')::boolean,false)
                         and coalesce(ship.value->>'capturedBy',ship.value->>'captured_by')=captor_side))
                 group by u.value->>'type') captured_groups;
        if jsonb_array_length(groups)=0 then continue; end if;
        select coalesce(jsonb_object_agg(item.key,item.amount),'{}'::jsonb) into equipment
          from (select e.key,sum((e.value)::numeric)::integer as amount
                  from jsonb_each(coalesce(new.report->'fleets','{}'::jsonb)) side(key,value)
                  cross join lateral jsonb_array_elements(coalesce(side.value->'ships','[]'::jsonb)) ship(value)
                  cross join lateral jsonb_array_elements(coalesce(ship.value->'passengers','[]'::jsonb)) p(value)
                  cross join lateral jsonb_each(coalesce(p.value->'siege_equipment','{}'::jsonb)) e(key,value)
                 where p.value->>'force_id'=passenger.force_id::text
                 group by e.key) item;
        insert into public.military_prisoners(battle_id,source_force_id,captor_owner,original_owner,force_name,commander_name,commander_age,unit_groups,siege_equipment,captured_turn)
        values(new.battle_id,passenger.force_id,captor,passenger.owner,coalesce(passenger.name,'Перевозимый отряд'),passenger.commander_name,passenger.commander_age,groups,equipment,coalesce(turn_no,0))
        on conflict(battle_id,source_force_id,captor_owner) do update set unit_groups=excluded.unit_groups,siege_equipment=excluded.siege_equipment;
    end loop;
    return new;
end;
$function$;
revoke all on function public.record_naval_passengers_as_prisoners() from public,anon,authenticated;
drop trigger if exists military_naval_prisoners_record on public.military_battle_admin_results;
create trigger military_naval_prisoners_record after insert on public.military_battle_admin_results
    for each row execute function public.record_naval_passengers_as_prisoners();
