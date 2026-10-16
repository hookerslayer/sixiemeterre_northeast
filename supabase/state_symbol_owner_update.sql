create or replace function public.save_state_symbol(p_owner text, p_path text, p_url text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    caller public.profiles%rowtype;
    updated_settings jsonb;
    expected_path text;
begin
    select * into caller from public.profiles where id = (select auth.uid());
    if caller.id is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    if caller.role <> 'admin' and caller.owner is distinct from p_owner then
        raise exception 'You can only change your own state symbol' using errcode = '42501';
    end if;

    expected_path := encode(convert_to(p_owner, 'UTF8'), 'hex') || '/symbol';
    if (p_path is null) <> (p_url is null) then
        raise exception 'Symbol path and URL must both be set or cleared' using errcode = '22023';
    end if;
    if p_path is not null and (
        p_path <> expected_path
        or p_url not like '%/storage/v1/object/public/state-symbols/' || p_path || '%'
    ) then
        raise exception 'Invalid state symbol location' using errcode = '22023';
    end if;

    update public.state_mechanics
    set settings = case
            when p_path is null then settings - 'state_symbol_path' - 'state_symbol_url'
            else jsonb_set(jsonb_set(settings, '{state_symbol_path}', to_jsonb(p_path), true), '{state_symbol_url}', to_jsonb(p_url), true)
        end,
        updated_at = now()
    where owner = p_owner
    returning settings into updated_settings;

    if updated_settings is null then
        raise exception 'State not found' using errcode = 'P0002';
    end if;
    return updated_settings;
end;
$function$;

revoke all on function public.save_state_symbol(text, text, text) from public, anon;
grant execute on function public.save_state_symbol(text, text, text) to authenticated;
