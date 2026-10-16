create or replace function public.recruit_permanent_garrison(p_marker_id bigint,p_unit_type text,p_count integer)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare profile public.profiles%rowtype; marker public.markers%rowtype; force public.military_forces%rowtype; mechanics public.state_mechanics%rowtype;
    current_turn integer; cap integer; base_count integer; extra_count integer; total_count integer; treasury numeric;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role<>'player' or profile.owner is null then raise exception 'Only a state player can recruit garrison troops' using errcode='42501'; end if;
    if p_count is null or p_count<1 or p_count>500 or p_unit_type not in ('Пешие ратники','Копейщики','Лучники','Арбалетчики','Конные копейщики','Лёгкая конница','Конные лучники','Лыжники-разведчики','Ушкуйники') then raise exception 'Invalid garrison unit or quantity' using errcode='22023'; end if;
    select * into marker from public.markers where id=p_marker_id and owner=profile.owner and type<>'ruins' for update;
    if not found then raise exception 'Settlement is not controlled by your state' using errcode='42501'; end if;
    select * into force from public.military_forces where marker_id=marker.id and is_permanent_garrison and status='active' for update;
    if not found then raise exception 'This settlement has no permanent garrison' using errcode='22023'; end if;
    cap:=50*greatest(0,marker.fortification_level);
    base_count:=case marker.type when 'large_city' then 60 when 'city' then 30 when 'fortress' then 40 when 'monastery' then 15 else 0 end;
    total_count:=coalesce((select sum((unit->>'count')::integer) from jsonb_array_elements(force.unit_groups) unit),0);
    extra_count:=greatest(0,total_count-base_count);
    if extra_count+p_count>cap then raise exception 'Permanent garrison extra capacity is %; % places remain',cap,greatest(0,cap-extra_count) using errcode='22023'; end if;
    select * into mechanics from public.state_mechanics where owner=profile.owner for update;
    treasury:=coalesce((mechanics.settings#>>'{economy,treasury}')::numeric,0);
    if treasury<p_count*2 then raise exception 'Garrison recruitment costs 2 z per soldier' using errcode='22023'; end if;
    update public.state_mechanics set settings=jsonb_set(settings,'{economy,treasury}',to_jsonb(treasury-p_count*2),true),updated_at=now() where owner=profile.owner;
    update public.military_forces set unit_groups=case when exists(select 1 from jsonb_array_elements(unit_groups) unit where unit->>'type'=p_unit_type)
        then (select jsonb_agg(case when unit->>'type'=p_unit_type then jsonb_set(unit,'{count}',to_jsonb((unit->>'count')::integer+p_count)) else unit end) from jsonb_array_elements(unit_groups) unit)
        else unit_groups||jsonb_build_array(jsonb_build_object('type',p_unit_type,'count',p_count)) end,updated_at=now()
      where id=force.id;
    select turn into current_turn from public.game_calendar where singleton=true;
    return jsonb_build_object('marker_id',marker.id,'force_id',force.id,'unit_type',p_unit_type,'count',p_count,'extra_capacity',cap,'extra_used',extra_count+p_count,'paid_z',p_count*2,'turn',current_turn);
end;
$function$;
