-- Restrict direct ruler identity and age edits to administrators while keeping
-- player heir nominations available through their dedicated RPC functions.
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
    if (tg_op='INSERT' and (
        new.settings #>> '{ruler,name}' is not null or
        new.settings #>> '{ruler,title}' is not null or
        new.settings #>> '{ruler,age}' is not null
    )) or (tg_op='UPDATE' and (
        new.settings #>> '{ruler,name}' is distinct from old.settings #>> '{ruler,name}' or
        new.settings #>> '{ruler,title}' is distinct from old.settings #>> '{ruler,title}' or
        new.settings #>> '{ruler,age}' is distinct from old.settings #>> '{ruler,age}'
    )) then
        raise exception 'Only an administrator can change ruler identity or age' using errcode='42501';
    end if;
    return new;
end;
$function$;
