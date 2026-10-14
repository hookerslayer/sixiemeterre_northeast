create table if not exists public.military_commanders (
    id uuid primary key default gen_random_uuid(),
    owner text not null,
    name text not null check (length(btrim(name)) between 1 and 80),
    age integer not null check (age between 16 and 100),
    experience integer not null default 0 check (experience >= 0),
    skills jsonb not null default '{"management":0,"leadership":0,"tactics":0,"planning":0,"engineering":0}'::jsonb,
    status text not null default 'available' check (status in ('available','assigned','dead')),
    force_id uuid unique references public.military_forces(id) on delete set null,
    hired_turn integer not null default 0,
    created_at timestamptz not null default now()
);

alter table public.military_forces add column if not exists commander_id uuid references public.military_commanders(id) on delete set null;
create index if not exists military_commanders_owner_status_idx on public.military_commanders(owner,status);
alter table public.military_commanders enable row level security;
drop policy if exists military_commanders_read on public.military_commanders;
create policy military_commanders_read on public.military_commanders for select to authenticated using (
    exists (select 1 from public.profiles p where p.id=(select auth.uid()) and (p.role='admin' or p.owner=military_commanders.owner))
);
revoke all on public.military_commanders from anon,authenticated;
grant select on public.military_commanders to authenticated;

-- Import commanders already stored directly on army rows into the personnel registry.
insert into public.military_commanders(owner,name,age,experience,skills,status,force_id,hired_turn)
select f.owner,f.commander_name,f.commander_age,coalesce(f.commander_experience,0),f.commander_skills,
       case when f.status='active' and nullif(btrim(f.commander_name),'') is not null then 'assigned' else 'dead' end,
       f.id,coalesce((select turn from public.game_calendar limit 1),0)
from public.military_forces f
where f.commander_name is not null and nullif(btrim(f.commander_name),'') is not null
  and not exists(select 1 from public.military_commanders c where c.force_id=f.id);
update public.military_forces f set commander_id=c.id
from public.military_commanders c where c.force_id=f.id and f.commander_id is distinct from c.id;

create or replace function public.sync_military_commander_registry()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
    if new.commander_id is not null then
        update public.military_commanders set owner=new.owner,name=coalesce(nullif(btrim(new.commander_name),''),name),
            age=coalesce(new.commander_age,age),experience=coalesce(new.commander_experience,experience),
            skills=coalesce(new.commander_skills,skills),status=case when new.commander_name is null then 'dead' else 'assigned' end,
            force_id=case when new.commander_name is null then null else new.id end
        where id=new.commander_id;
    end if;
    return new;
end $function$;
drop trigger if exists sync_military_commander_registry on public.military_forces;
create trigger sync_military_commander_registry after insert or update of commander_id,commander_name,commander_age,commander_experience,commander_skills,owner on public.military_forces
for each row execute function public.sync_military_commander_registry();

create or replace function public.hire_military_commander(p_name text,p_age integer)
returns public.military_commanders language plpgsql security definer set search_path=''
as $function$
declare prof public.profiles%rowtype; created public.military_commanders%rowtype; prestige numeric; limit_count integer; current_count integer; turn_no integer;
begin
    select * into prof from public.profiles where id=(select auth.uid());
    if prof.role<>'player' or prof.owner is null then raise exception 'Only a state player can hire a commander'; end if;
    if length(btrim(coalesce(p_name,''))) not between 1 and 80 or p_age not between 16 and 100 then raise exception 'Invalid commander name or age'; end if;
    select coalesce((settings#>>'{economy,prestige}')::numeric,0) into prestige from public.state_mechanics where owner=prof.owner for update;
    if coalesce(prestige,0)<10 then raise exception 'Hiring a commander costs 10 prestige'; end if;
    select 1+coalesce(sum(case when m.type='large_city' then 2 when m.type in ('fortress','city','monastery') then 1 else 0 end),0)
      into limit_count from public.markers m where m.owner=prof.owner and m.type<>'ruins';
    select count(*) into current_count from public.military_commanders c where c.owner=prof.owner and c.status<>'dead';
    if current_count>=limit_count then raise exception 'Commander limit reached (%).',limit_count; end if;
    select turn into turn_no from public.game_calendar limit 1;
    update public.state_mechanics set settings=jsonb_set(settings,'{economy,prestige}',to_jsonb(prestige-10),true),updated_at=now() where owner=prof.owner;
    insert into public.military_commanders(owner,name,age,hired_turn) values(prof.owner,btrim(p_name),p_age,coalesce(turn_no,0)) returning * into created;
    return created;
end $function$;
revoke all on function public.hire_military_commander(text,integer) from public,anon;
grant execute on function public.hire_military_commander(text,integer) to authenticated;

create or replace function public.assign_military_commander(p_commander_id uuid,p_force_id uuid)
returns public.military_forces language plpgsql security definer set search_path=''
as $function$
declare prof public.profiles%rowtype; officer public.military_commanders%rowtype; force public.military_forces%rowtype; old_id uuid;
begin
    select * into prof from public.profiles where id=(select auth.uid());
    if prof.role<>'player' or prof.owner is null then raise exception 'Only a state player can assign a commander'; end if;
    select * into officer from public.military_commanders where id=p_commander_id and owner=prof.owner for update;
    if not found or (officer.status<>'available' and officer.force_id<>p_force_id) then raise exception 'Commander is unavailable'; end if;
    select * into force from public.military_forces where id=p_force_id and owner=prof.owner and status='active' and force_kind='land_army' for update;
    if not found then raise exception 'Army is unavailable'; end if;
    if exists(select 1 from public.military_battle_armies ba join public.military_battles b on b.id=ba.battle_id where ba.persistent_force_id=force.id and b.status='pending') then
        raise exception 'Cannot change commander during an unresolved battle';
    end if;
    old_id:=force.commander_id;
    if old_id is not null and old_id<>officer.id then update public.military_commanders set status='available',force_id=null where id=old_id; end if;
    update public.military_forces set commander_id=officer.id,commander_name=officer.name,commander_age=officer.age,
        commander_experience=officer.experience,commander_skills=officer.skills,updated_at=now() where id=force.id returning * into force;
    update public.military_commanders set force_id=force.id,status='assigned' where id=officer.id;
    return force;
end $function$;
revoke all on function public.assign_military_commander(uuid,uuid) from public,anon;
grant execute on function public.assign_military_commander(uuid,uuid) to authenticated;

create or replace function public.advance_unassigned_military_commanders()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare years_elapsed integer;
begin
    if new.turn<=old.turn or new.year<=old.year then return new; end if;
    years_elapsed:=new.year-old.year;
    update public.military_commanders c set age=least(100,c.age+years_elapsed),
      status=case when c.age+years_elapsed>=50 and mod(abs(hashtextextended(new.turn::text||':'||c.id::text,0)::numeric),1000000)/1000000.0 < least(1.0,0.005*power(2.0,(c.age+years_elapsed-50)/5.0)) then 'dead' else c.status end
    where c.status='available';
    return new;
end $function$;
drop trigger if exists advance_unassigned_military_commanders_on_turn on public.game_calendar;
create trigger advance_unassigned_military_commanders_on_turn after update of turn,year on public.game_calendar
for each row execute function public.advance_unassigned_military_commanders();
