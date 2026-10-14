create or replace function public.assign_military_commander(p_commander_id uuid,p_force_id uuid)
returns public.military_forces language plpgsql security definer set search_path=''
as $function$
declare prof public.profiles%rowtype; officer public.military_commanders%rowtype; force public.military_forces%rowtype; old_id uuid;
begin
    select * into prof from public.profiles where id=(select auth.uid());
    if prof.role<>'player' or prof.owner is null then raise exception 'Only a state player can assign a commander'; end if;
    select * into officer from public.military_commanders where id=p_commander_id and owner=prof.owner for update;
    if not found or officer.status='dead' then raise exception 'Commander is unavailable'; end if;
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
