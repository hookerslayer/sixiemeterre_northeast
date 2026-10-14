-- Bandit camps add one current crime point to their home state's crime rate.
create or replace function public.apply_bandit_camp_crime_delta()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
    previous_owner text;
    current_owner text;
begin
    if tg_op='INSERT' then
        if new.owner='Лагерь разбойников' and new.force_kind='land_army' and new.status='active' then
            select owner into current_owner from public."Provinces" where id=coalesce(new.npc_home_province_id,new.province_id);
        end if;
    elsif tg_op='DELETE' then
        if old.owner='Лагерь разбойников' and old.force_kind='land_army' and old.status='active' then
            select owner into previous_owner from public."Provinces" where id=coalesce(old.npc_home_province_id,old.province_id);
        end if;
    else
        if old.owner='Лагерь разбойников' and old.force_kind='land_army' and old.status='active' then
            select owner into previous_owner from public."Provinces" where id=coalesce(old.npc_home_province_id,old.province_id);
        end if;
        if new.owner='Лагерь разбойников' and new.force_kind='land_army' and new.status='active' then
            select owner into current_owner from public."Provinces" where id=coalesce(new.npc_home_province_id,new.province_id);
        end if;
    end if;
    if previous_owner is not null then
        update public.state_mechanics set settings=settings||jsonb_build_object(
            'crime_rate',greatest(0,least(100,coalesce((settings->>'crime_rate')::numeric,20)-1))
        ),updated_at=now() where owner=previous_owner;
    end if;
    if current_owner is not null then
        update public.state_mechanics set settings=settings||jsonb_build_object(
            'crime_rate',greatest(0,least(100,coalesce((settings->>'crime_rate')::numeric,20)+1))
        ),updated_at=now() where owner=current_owner;
    end if;
    if tg_op='DELETE' then return old; end if;
    return new;
end;
$function$;
revoke all on function public.apply_bandit_camp_crime_delta() from public,anon,authenticated;
drop trigger if exists apply_bandit_camp_crime_delta on public.military_forces;
create trigger apply_bandit_camp_crime_delta
after insert or update of owner,force_kind,status,province_id,npc_home_province_id or delete on public.military_forces
for each row execute function public.apply_bandit_camp_crime_delta();

-- If ownership changes while a camp remains in place, move its surcharge too.
create or replace function public.transfer_bandit_camp_crime_on_province_change()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare camp_count integer;
begin
    if old.owner is not distinct from new.owner then return new; end if;
    select count(*) into camp_count from public.military_forces force
     where force.owner='Лагерь разбойников' and force.force_kind='land_army' and force.status='active'
       and coalesce(force.npc_home_province_id,force.province_id)=new.id;
    if camp_count>0 then
        if old.owner is not null then
            update public.state_mechanics set settings=settings||jsonb_build_object(
                'crime_rate',greatest(0,least(100,coalesce((settings->>'crime_rate')::numeric,20)-camp_count))
            ),updated_at=now() where owner=old.owner;
        end if;
        if new.owner is not null then
            update public.state_mechanics set settings=settings||jsonb_build_object(
                'crime_rate',greatest(0,least(100,coalesce((settings->>'crime_rate')::numeric,20)+camp_count))
            ),updated_at=now() where owner=new.owner;
        end if;
    end if;
    return new;
end;
$function$;
revoke all on function public.transfer_bandit_camp_crime_on_province_change() from public,anon,authenticated;
drop trigger if exists transfer_bandit_camp_crime_on_province_change on public."Provinces";
create trigger transfer_bandit_camp_crime_on_province_change
after update of owner on public."Provinces"
for each row execute function public.transfer_bandit_camp_crime_on_province_change();
