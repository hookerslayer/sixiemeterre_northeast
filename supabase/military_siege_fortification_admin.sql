-- Administrators maintain settlement fortification levels used by siege rules.
create or replace function public.set_marker_fortification(p_marker_id bigint, p_level integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    profile public.profiles%rowtype;
    marker public.markers%rowtype;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role <> 'admin' then
        raise exception 'Only an administrator can change settlement fortifications' using errcode='42501';
    end if;
    if p_level not between 0 and 3 then
        raise exception 'Fortification level must be between 0 and 3' using errcode='22023';
    end if;
    select * into marker from public.markers where id=p_marker_id for update;
    if not found or marker.type='ruins' then
        raise exception 'Choose an existing non-ruined settlement' using errcode='22023';
    end if;
    if marker.type='fortress' and p_level=0 then
        raise exception 'An Ostrog always has fortification level I or higher' using errcode='22023';
    end if;
    update public.markers set fortification_level=p_level where id=marker.id returning * into marker;
    return jsonb_build_object('id',marker.id,'fortification_level',marker.fortification_level);
end;
$function$;

revoke all on function public.set_marker_fortification(bigint,integer) from public,anon;
grant execute on function public.set_marker_fortification(bigint,integer) to authenticated;
