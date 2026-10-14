-- Admin map tools: roads are free and usable immediately. The public view exposes
-- only the active colony owner and target, not investment or success calculations.
create or replace function public.admin_build_military_road_segment(
    p_province_a bigint,
    p_province_b bigint,
    p_owner text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_profile public.profiles%rowtype;
    v_calendar public.game_calendar%rowtype;
    v_low bigint;
    v_high bigint;
    v_road_id bigint;
begin
    select * into v_profile from public.profiles where id=(select auth.uid());
    if not found or v_profile.role <> 'admin' then
        raise exception 'Only an administrator can build free roads' using errcode='42501';
    end if;
    if p_province_a is null or p_province_b is null or p_province_a=p_province_b then
        raise exception 'Choose two different provinces' using errcode='22023';
    end if;
    if not exists(select 1 from public.state_mechanics where owner=p_owner) then
        raise exception 'Choose an existing state for the road' using errcode='22023';
    end if;
    v_low := least(p_province_a,p_province_b);
    v_high := greatest(p_province_a,p_province_b);
    if not exists(select 1 from public."Provinces" where id=v_low)
       or not exists(select 1 from public."Provinces" where id=v_high) then
        raise exception 'A selected province does not exist' using errcode='22023';
    end if;
    if not exists (
        select 1 from public.military_grid_cells a
        join public.military_grid_cells b on abs(a.cell_x-b.cell_x)+abs(a.cell_y-b.cell_y)=1
        where a.province_id=v_low and b.province_id=v_high
    ) then
        raise exception 'The selected provinces are not adjacent on the military map' using errcode='22023';
    end if;
    if exists(select 1 from public.military_roads where owner=p_owner and province_a=v_low and province_b=v_high) then
        raise exception 'A road already exists on this border' using errcode='23505';
    end if;
    select * into v_calendar from public.game_calendar where singleton=true;
    insert into public.military_roads(owner,province_a,province_b,available_from_turn)
    values(p_owner,v_low,v_high,v_calendar.turn)
    returning id into v_road_id;
    return jsonb_build_object('id',v_road_id,'owner',p_owner,'province_a',v_low,'province_b',v_high,
        'available_from_turn',v_calendar.turn,'paid_treasury',0,'paid_wood',0,'paid_tools',0);
end;
$function$;
revoke all on function public.admin_build_military_road_segment(bigint,bigint,text) from public,anon;
grant execute on function public.admin_build_military_road_segment(bigint,bigint,text) to authenticated;

create or replace view public.military_active_colonization_map
with (security_barrier=true)
as
select id, owner, target_province_id
from public.military_colonization_missions
where status='active';
revoke all on public.military_active_colonization_map from public;
grant select on public.military_active_colonization_map to anon, authenticated;
