-- Age embarked army commanders yearly and apply the normal death consequence.
create or replace function public.advance_embarked_military_commanders()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    years_elapsed integer;
    army record;
    fleet record;
    destination_marker bigint;
    destination_province bigint;
    next_age integer;
    death_probability numeric;
    death_roll numeric;
begin
    if new.turn<=old.turn then return new; end if;
    years_elapsed:=greatest(0,new.year-old.year);
    if years_elapsed=0 then return new; end if;
    for army in select id,owner,commander_age from public.military_forces
        where force_kind='land_army' and status='embarked' and commander_age is not null
    loop
        next_age:=army.commander_age+years_elapsed;
        death_probability:=case when next_age>=50 then least(1.0,0.005*power(2.0,(next_age-50)/5.0)) else 0 end;
        death_roll:=mod(abs(hashtextextended(new.turn::text||':'||army.id::text,0)::numeric),1000000)/1000000.0;
        if death_roll<death_probability then
            destination_marker:=null;
            destination_province:=null;
            select marker.id into destination_marker from public.markers marker
             where marker.owner=army.owner and marker.type<>'ruins'
             order by md5(new.turn::text||':'||army.id::text||':'||marker.id::text) limit 1;
            if destination_marker is null then
                select province.id into destination_province from public."Provinces" province
                 where province.owner=army.owner
                 order by md5(new.turn::text||':'||army.id::text||':'||province.id::text) limit 1;
            end if;
            if destination_marker is null and destination_province is null then
                update public.military_forces set status='disbanded',unit_groups='[]'::jsonb,updated_at=now() where id=army.id;
            else
                update public.military_forces set force_kind='garrison',
                    province_id=case when destination_marker is null then destination_province else null end,
                    marker_id=destination_marker,cell_x=null,cell_y=null,commander_name=null,commander_age=null,
                    commander_skills='{}'::jsonb,action_points=0,order_name='осторожный',tactic='none',
                    status='active',embarked_turn=null,updated_at=now()
                 where id=army.id;
            end if;
            for fleet in select id,ships from public.military_fleets
                where exists(select 1 from jsonb_array_elements(ships) s(value)
                    cross join lateral jsonb_array_elements(coalesce(s.value->'passengers','[]'::jsonb)) p(value)
                    where p.value->>'force_id'=army.id::text)
            loop
                update public.military_fleets set ships=(
                    select coalesce(jsonb_agg(jsonb_set(s.value,'{passengers}',coalesce((
                        select jsonb_agg(p.value) from jsonb_array_elements(coalesce(s.value->'passengers','[]'::jsonb)) p(value)
                         where p.value->>'force_id'<>army.id::text
                    ),'[]'::jsonb),true) order by s.ordinality),'[]'::jsonb)
                      from jsonb_array_elements(fleet.ships) with ordinality s(value,ordinality)
                ),updated_at=now() where id=fleet.id;
            end loop;
        else
            update public.military_forces set commander_age=next_age,updated_at=now() where id=army.id;
        end if;
    end loop;
    return new;
end;
$function$;
revoke all on function public.advance_embarked_military_commanders() from public,anon,authenticated;
drop trigger if exists advance_embarked_military_commanders_on_turn on public.game_calendar;
create trigger advance_embarked_military_commanders_on_turn
    after update of turn,year on public.game_calendar
    for each row execute function public.advance_embarked_military_commanders();
