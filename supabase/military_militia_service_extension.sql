-- Extend an active militia contract by one season for 2 z per fighter.
create or replace function public.extend_military_militia_service(p_force_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_profile public.profiles%rowtype;
    v_force public.military_forces%rowtype;
    v_state public.state_mechanics%rowtype;
    v_calendar public.game_calendar%rowtype;
    v_treasury numeric;
    v_unit_count integer;
    v_cost numeric;
begin
    select * into v_profile from public.profiles where id = (select auth.uid());
    if not found or coalesce(v_profile.role, '') <> 'player' or nullif(v_profile.owner, '') is null then
        raise exception 'Only a state player can extend militia service' using errcode = '42501';
    end if;
    select * into v_force from public.military_forces where id = p_force_id for update;
    if not found or v_force.owner is distinct from v_profile.owner or not v_force.is_militia or v_force.status <> 'active' then
        raise exception 'This state has no active militia with an extendable term' using errcode = '42501';
    end if;
    select * into v_calendar from public.game_calendar where singleton = true for update;
    if not found then raise exception 'Game calendar is unavailable' using errcode = '22023'; end if;
    if v_force.service_end_turn is null or v_force.service_end_turn <= v_calendar.turn then
        raise exception 'The militia service period has ended or is expiring this turn' using errcode = '23514';
    end if;
    select coalesce(sum((group_row.value->>'count')::integer), 0)::integer into v_unit_count
      from jsonb_array_elements(v_force.unit_groups) as group_row(value)
     where coalesce((group_row.value->>'count')::integer, 0) > 0;
    if v_unit_count < 1 then raise exception 'The militia has no serving troops' using errcode = '23514'; end if;
    v_cost := v_unit_count * 2;
    select * into v_state from public.state_mechanics where owner = v_profile.owner for update;
    if not found then raise exception 'State treasury is unavailable' using errcode = '22023'; end if;
    v_treasury := greatest(0, coalesce((v_state.settings #>> '{economy,treasury}')::numeric, 0));
    if v_treasury < v_cost then raise exception 'Not enough treasury: need % z', v_cost using errcode = '23514'; end if;

    update public.state_mechanics
       set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object(
               'economy', coalesce(settings->'economy', '{}'::jsonb) || jsonb_build_object('treasury', v_treasury-v_cost)
           ),
           updated_at = now()
     where owner = v_profile.owner;
    update public.military_forces
       set service_end_turn = service_end_turn + 1, updated_at = now()
     where id = v_force.id
     returning * into v_force;
    return jsonb_build_object('force',to_jsonb(v_force),'cost',v_cost,'new_end_turn',v_force.service_end_turn);
end;
$function$;

revoke all on function public.extend_military_militia_service(uuid) from public, anon;
grant execute on function public.extend_military_militia_service(uuid) to authenticated;
