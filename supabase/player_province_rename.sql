-- Allow a player to rename only provinces currently controlled by their state.
-- The SECURITY DEFINER function updates one column and checks the caller's
-- profile owner on every call; clients cannot use it to change other data.
create or replace function public.rename_owned_province(
    p_province_id bigint,
    p_province_name text
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
    caller_id uuid := auth.uid();
    caller_role text;
    caller_owner text;
    normalized_name text := btrim(coalesce(p_province_name, ''));
    changed_rows integer;
begin
    if caller_id is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;

    if normalized_name = '' or char_length(normalized_name) > 80 then
        raise exception 'Province name must contain 1 to 80 characters' using errcode = '22023';
    end if;

    select p.role, p.owner
      into caller_role, caller_owner
      from public.profiles as p
     where p.id = caller_id;

    if caller_role is null then
        raise exception 'Profile not found' using errcode = '42501';
    end if;

    update public."Provinces" as province
       set province_name = normalized_name
     where province.id = p_province_id
       and (
           caller_role = 'admin'
           or (caller_owner is not null and province.owner = caller_owner)
       );

    get diagnostics changed_rows = row_count;
    if changed_rows = 0 then
        raise exception 'Province not found or you do not control it' using errcode = '42501';
    end if;

    return normalized_name;
end;
$function$;

revoke all on function public.rename_owned_province(bigint, text) from public, anon;
grant execute on function public.rename_owned_province(bigint, text) to authenticated;
