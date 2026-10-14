-- Let a player order an attack only against a visible adjacent persistent army.
create or replace function public.start_military_battle(p_attacker_force_id uuid, p_defender_force_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_profile public.profiles%rowtype;
    v_attacker public.military_forces%rowtype;
    v_defender public.military_forces%rowtype;
    v_visibility jsonb;
    v_battle_id uuid;
    v_terrain text;
    v_province_id bigint;
begin
    select * into v_profile from public.profiles where id = (select auth.uid());
    if not found or v_profile.role <> 'player' or nullif(v_profile.owner,'') is null then
        raise exception 'Only a state player can order an attack' using errcode = '42501';
    end if;
    if p_attacker_force_id = p_defender_force_id then raise exception 'An army cannot attack itself' using errcode = '22023'; end if;
    select * into v_attacker from public.military_forces where id=p_attacker_force_id and force_kind='land_army' and status='active' for update;
    if not found or v_attacker.owner is distinct from v_profile.owner then raise exception 'Attacking army is not under your command' using errcode = '42501'; end if;
    select * into v_defender from public.military_forces where id=p_defender_force_id and force_kind='land_army' and status='active' for update;
    if not found or v_defender.owner = v_profile.owner then raise exception 'Choose an enemy field army' using errcode = '22023'; end if;
    if greatest(abs(v_attacker.cell_x-v_defender.cell_x),abs(v_attacker.cell_y-v_defender.cell_y)) <> 1 then
        raise exception 'The enemy army must be in a neighboring cell' using errcode = '22023';
    end if;
    if v_attacker.action_points < 10 then raise exception 'An attack costs 10 AP' using errcode = '22023'; end if;
    if exists (
        select 1 from public.military_battle_armies participant
        join public.military_battles battle on battle.id=participant.battle_id
        where participant.persistent_force_id in (p_attacker_force_id,p_defender_force_id) and battle.status='pending'
    ) then raise exception 'One of the armies already has an unresolved battle' using errcode = '55000'; end if;
    v_visibility := public.get_visible_military_forces();
    if not exists (select 1 from jsonb_array_elements(v_visibility->'forces') visible where visible.value->>'id'=p_defender_force_id::text) then
        raise exception 'The enemy army is not currently visible' using errcode = '42501';
    end if;
    select coalesce(terrain.terrain,grid.base_terrain), coalesce(terrain.province_id,grid.province_id)
      into v_terrain,v_province_id
      from public.military_grid_cells grid
      left join public.military_terrain_cells terrain on terrain.cell_x=grid.cell_x and terrain.cell_y=grid.cell_y
     where grid.cell_x=v_defender.cell_x and grid.cell_y=v_defender.cell_y;
    if not found then raise exception 'Battle cell is missing from military geometry' using errcode = '55000'; end if;
    insert into public.military_battles(battle_type,terrain,participant_owners,location,created_by)
    values('land',case when v_terrain in ('plain','hill','forest','marsh','bridge') then v_terrain else 'plain' end,
           array[v_attacker.owner,v_defender.owner],jsonb_build_object('cell_x',v_defender.cell_x,'cell_y',v_defender.cell_y,'province_id',v_province_id,'attacker_force_id',v_attacker.id),v_profile.id)
    returning id into v_battle_id;
    insert into public.military_battle_armies(battle_id,owner,side,name,unit_data,morale,order_name,tactic,decision,withdrawal_route)
    values
      (v_battle_id,v_attacker.owner,'attacker',v_attacker.name,
       jsonb_build_object('units',v_attacker.unit_groups,'skills',v_attacker.commander_skills,'persistent_force_id',v_attacker.id,'conditions',jsonb_build_object('terrain',v_terrain)),
       v_attacker.morale,v_attacker.order_name,v_attacker.tactic,'fight',null),
      (v_battle_id,v_defender.owner,'defender',v_defender.name,
       jsonb_build_object('units',v_defender.unit_groups,'skills',v_defender.commander_skills,'persistent_force_id',v_defender.id,'conditions',jsonb_build_object('terrain',v_terrain)),
       v_defender.morale,v_defender.order_name,v_defender.tactic,'pending',null);
    update public.military_forces set action_points=action_points-10, updated_at=now() where id=p_attacker_force_id;
    return v_battle_id;
end;
$function$;

revoke all on function public.start_military_battle(uuid,uuid) from public, anon;
grant execute on function public.start_military_battle(uuid,uuid) to authenticated;
