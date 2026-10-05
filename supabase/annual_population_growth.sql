-- Annual state-wide population growth, applied when the game year advances.
-- Growth is 2% at full food coverage and average estate loyalty; food coverage
-- scales it from 0% to 100%, while loyalty changes it modestly from 0.75x to 1.25x.

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

        -- Missing seasonal history is treated as neutral (100%) food coverage.
        average_food_coverage := greatest(0, least(1, (coverage_sum + (4 - coverage_count)) / 4.0));
        average_loyalty := (
            greatest(0, least(100, coalesce((state_row.settings#>>'{estate_loyalty,aristocracy}')::numeric, 100))) +
            greatest(0, least(100, coalesce((state_row.settings#>>'{estate_loyalty,clergy}')::numeric, 100))) +
            greatest(0, least(100, coalesce((state_row.settings#>>'{estate_loyalty,burghers}')::numeric, 100))) +
            greatest(0, least(100, coalesce((state_row.settings#>>'{estate_loyalty,peasants}')::numeric, 100)))
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

drop trigger if exists advance_population_growth_after_year_change on public.game_calendar;
create trigger advance_population_growth_after_year_change
after update of year on public.game_calendar
for each row execute function public.advance_annual_population_growth();

revoke all on function public.advance_annual_population_growth() from public, anon, authenticated;
