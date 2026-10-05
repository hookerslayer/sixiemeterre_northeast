-- Set starting loyalty to 50 for all estates and currently present cultures/religions.
-- The protected settings trigger is removed and restored in this same migration transaction.
drop trigger if exists state_mechanics_admin_settings_guard on public.state_mechanics;

update public.state_mechanics sm
   set settings = jsonb_set(
       jsonb_set(
           jsonb_set(
               sm.settings,
               '{estate_loyalty}',
               '{"aristocracy":50,"clergy":50,"burghers":50,"peasants":50}'::jsonb,
               true
           ),
           '{culture_loyalty}',
           coalesce((
               select jsonb_object_agg(culture_name, to_jsonb(50))
                 from (
                     select key as culture_name from jsonb_each(coalesce(sm.settings->'culture_loyalty', '{}'::jsonb))
                     union
                     select p.main_culture from public."Provinces" p where p.owner = sm.owner and p.main_culture is not null
                     union
                     select m.culture from public.markers m where m.owner = sm.owner and m.type <> 'ruins' and m.culture is not null
                 ) cultures
           ), '{}'::jsonb),
           true
       ),
       '{religion_loyalty}',
       coalesce((
           select jsonb_object_agg(religion_name, to_jsonb(50))
             from (
                 select key as religion_name from jsonb_each(coalesce(sm.settings->'religion_loyalty', '{}'::jsonb))
                 union
                 select p.main_religion from public."Provinces" p where p.owner = sm.owner and p.main_religion is not null
                 union
                 select m.religion from public.markers m where m.owner = sm.owner and m.type <> 'ruins' and m.religion is not null
             ) religions
       ), '{}'::jsonb),
       true
   ),
       updated_at = now();

create trigger state_mechanics_admin_settings_guard
    before insert or update on public.state_mechanics
    for each row execute function public.guard_state_mechanics_admin_settings();

-- Missing loyalty values use the same 50-point base in annual population growth.
create or replace function public.advance_annual_population_growth()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
    state_row record;
    coverage_sum numeric;
    coverage_count integer;
    average_food_coverage numeric;
    average_loyalty numeric;
    growth_rate numeric;
begin
    if new.year <= old.year then
        return new;
    end if;

    for state_row in select owner, settings from public.state_mechanics loop
        select coalesce(sum(recent.food_coverage), 0), count(*)
          into coverage_sum, coverage_count
          from (
              select coalesce((report#>>'{state_effects,food_coverage}')::numeric, 1) as food_coverage
                from public.turn_economy_reports
               where owner = state_row.owner
               order by year desc, turn desc
               limit 4
          ) recent;

        average_food_coverage := greatest(0, least(1, (coverage_sum + (4 - coverage_count)) / 4.0));
        average_loyalty := (
            greatest(0, least(100, coalesce((state_row.settings#>>'{estate_loyalty,aristocracy}')::numeric, 50))) +
            greatest(0, least(100, coalesce((state_row.settings#>>'{estate_loyalty,clergy}')::numeric, 50))) +
            greatest(0, least(100, coalesce((state_row.settings#>>'{estate_loyalty,burghers}')::numeric, 50))) +
            greatest(0, least(100, coalesce((state_row.settings#>>'{estate_loyalty,peasants}')::numeric, 50)))
        ) / 4.0;
        growth_rate := 0.02 * average_food_coverage * (0.75 + 0.5 * average_loyalty / 100.0);

        update public."Provinces"
           set yards = coalesce(yards, 0) + round(coalesce(yards, 0) * growth_rate)::bigint
         where owner = state_row.owner and coalesce(yards, 0) > 0;

        update public.markers
           set yards = coalesce(yards, 0) + round(coalesce(yards, 0) * growth_rate)::bigint
         where owner = state_row.owner and type <> 'ruins' and coalesce(yards, 0) > 0;
    end loop;

    return new;
end;
$function$;
