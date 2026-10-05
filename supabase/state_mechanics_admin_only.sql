-- Protect settings that the application exposes as administrator-only.
create or replace function public.guard_state_mechanics_admin_settings()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
    caller_role text;
    setting_key text;
    protected_keys text[] := array[
        'crime_rate', 'corruption_rate', 'government_form',
        'titular_culture', 'titular_religion',
        'estate_loyalty', 'culture_loyalty', 'religion_loyalty'
    ];
begin
    select p.role into caller_role from public.profiles p where p.id=(select auth.uid());
    if caller_role='admin' then return new; end if;
    foreach setting_key in array protected_keys loop
        if tg_op='INSERT' then
            if new.settings ? setting_key then
                raise exception 'Only an administrator can change %', setting_key using errcode='42501';
            end if;
        elsif new.settings->setting_key is distinct from old.settings->setting_key then
            raise exception 'Only an administrator can change %', setting_key using errcode='42501';
        end if;
    end loop;
    return new;
end;
$function$;
revoke all on function public.guard_state_mechanics_admin_settings() from public, anon, authenticated;

drop trigger if exists state_mechanics_admin_settings_guard on public.state_mechanics;
create trigger state_mechanics_admin_settings_guard
    before insert or update on public.state_mechanics
    for each row execute function public.guard_state_mechanics_admin_settings();
