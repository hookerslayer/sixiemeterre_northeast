-- A confirmed battle is immutable through the application, so apply prizes
-- once on insertion and avoid duplicating them on any administrative update.
drop trigger if exists military_naval_capture_recovery on public.military_battle_admin_results;
create trigger military_naval_capture_recovery
    after insert on public.military_battle_admin_results
    for each row execute function public.recover_captured_military_ships();
