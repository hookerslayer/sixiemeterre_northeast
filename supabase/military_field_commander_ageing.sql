-- Apply annual ageing and old-age death checks to active land commanders.
-- Embarked commanders are handled by military_embarked_commander_ageing.sql.
create or replace function public.advance_field_military_commanders()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    years_elapsed integer;
    army record;
    destination_marker bigint;
    destination_province bigint;
    next_age integer;
    death_probability numeric;
    death_roll numeric;
begin
    if new.year <= old.year then return new; end if;
    years_elapsed := greatest(0, new.year - old.year);
    for army in
        select force.id, force.owner, force.commander_age
          from public.military_forces force
         where force.force_kind = 'land_army'
           and force.status = 'active'
           and force.commander_name is not null
           and force.commander_age is not null
           and force.cell_x is not null and force.cell_y is not null
           and not exists (
               select 1 from public.military_battle_armies participant
               join public.military_battles battle on battle.id = participant.battle_id
               where participant.persistent_force_id = force.id and battle.status = 'pending'
           )
    loop
        next_age := army.commander_age + years_elapsed;
        death_probability := case when next_age >= 50
            then least(1.0, 0.005 * power(2.0, (next_age - 50) / 5.0)) else 0 end;
        death_roll := mod(abs(hashtextextended(new.year::text || ':' || army.id::text, 0)::numeric), 1000000) / 1000000.0;
        if death_roll < death_probability then
            destination_marker := null;
            destination_province := null;
            select marker.id into destination_marker
              from public.markers marker
             where marker.owner = army.owner and marker.type <> 'ruins'
             order by md5(new.year::text || ':' || army.id::text || ':' || marker.id::text)
             limit 1;
            if destination_marker is null then
                select province.id into destination_province
                  from public."Provinces" province
                 where province.owner = army.owner
                 order by md5(new.year::text || ':' || army.id::text || ':' || province.id::text)
                 limit 1;
            end if;
            if destination_marker is null and destination_province is null then
                update public.military_forces
                   set status = 'disbanded', unit_groups = '[]'::jsonb, cell_x = null, cell_y = null,
                       commander_name = null, commander_age = null, commander_skills = '{}'::jsonb,
                       action_points = 0, updated_at = now()
                 where id = army.id;
            else
                update public.military_forces
                   set force_kind = 'garrison',
                       province_id = case when destination_marker is null then destination_province else null end,
                       marker_id = destination_marker, cell_x = null, cell_y = null,
                       commander_name = null, commander_age = null, commander_skills = '{}'::jsonb,
                       action_points = 0, order_name = 'осторожный', tactic = 'none',
                       status = 'active', updated_at = now()
                 where id = army.id;
            end if;
        else
            update public.military_forces set commander_age = next_age, updated_at = now() where id = army.id;
        end if;
    end loop;
    -- Armies still attached to a pending battle age normally; the death roll is
    -- deferred until they are back under ordinary command.
    update public.military_forces force
       set commander_age = force.commander_age + years_elapsed, updated_at = now()
     where force.force_kind = 'land_army' and force.status = 'active'
       and force.commander_name is not null and force.commander_age is not null
       and force.cell_x is not null and force.cell_y is not null
       and exists (
           select 1 from public.military_battle_armies participant
           join public.military_battles battle on battle.id = participant.battle_id
           where participant.persistent_force_id = force.id and battle.status = 'pending'
       );
    return new;
end;
$function$;

revoke all on function public.advance_field_military_commanders() from public, anon, authenticated;
drop trigger if exists advance_field_military_commanders_on_turn on public.game_calendar;
create trigger advance_field_military_commanders_on_turn
    after update of year on public.game_calendar
    for each row execute function public.advance_field_military_commanders();
