-- Fleet action points refresh once per seasonal turn, like land armies.
create or replace function public.refresh_military_fleet_action_points()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
    if new.turn <= old.turn then return new; end if;
    update public.military_fleets
       set action_points=100, updated_at=now()
     where status='active';
    return new;
end;
$function$;

revoke all on function public.refresh_military_fleet_action_points() from public, anon, authenticated;
drop trigger if exists refresh_military_fleets_on_game_turn on public.game_calendar;
create trigger refresh_military_fleets_on_game_turn
    after update of turn on public.game_calendar
    for each row execute function public.refresh_military_fleet_action_points();
