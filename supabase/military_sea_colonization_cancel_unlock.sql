-- Return the fleet lock together with the regular colonization cancellation result.
create or replace function public.cancel_military_colonization(p_mission_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
    profile public.profiles%rowtype;
    mission public.military_colonization_missions%rowtype;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found then raise exception 'Authentication required' using errcode='42501'; end if;
    select * into mission from public.military_colonization_missions where id=p_mission_id and status='active' for update;
    if not found then raise exception 'Active colonization mission not found' using errcode='22023'; end if;
    if profile.role<>'admin' and (profile.role<>'player' or profile.owner is distinct from mission.owner) then raise exception 'Only the mission owner may cancel it' using errcode='42501'; end if;
    update public.markers set yards=yards+25 where id=mission.source_marker_id;
    update public.military_colonization_missions set status='cancelled',result=jsonb_build_object('roll',null,'returned_settlers',100,'lost_settlers',100),resolved_at=now() where id=mission.id;
    if mission.fleet_id is not null then
        update public.military_fleets set colonization_mission_id=null,updated_at=now()
        where id=mission.fleet_id and colonization_mission_id=mission.id;
    end if;
    return jsonb_build_object('mission_id',mission.id,'returned_yards',25,'refunded',0,'fleet_released',mission.fleet_id is not null);
end;
$function$;
revoke all on function public.cancel_military_colonization(uuid) from public,anon;
grant execute on function public.cancel_military_colonization(uuid) to authenticated;
