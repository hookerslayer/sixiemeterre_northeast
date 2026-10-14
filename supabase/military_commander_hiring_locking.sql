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
