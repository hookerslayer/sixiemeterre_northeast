-- Player-facing fleet visibility and validated naval attack orders.
create or replace function public.get_visible_military_fleets()
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
    profile public.profiles%rowtype;
    vision jsonb;
    result jsonb;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role not in ('player','admin') then raise exception 'Authentication required' using errcode='42501'; end if;
    if profile.role='admin' then
        select coalesce(jsonb_agg(to_jsonb(fleet)||jsonb_build_object('in_pending_battle',exists(
            select 1 from public.military_battle_armies participant join public.military_battles battle on battle.id=participant.battle_id
            where participant.persistent_fleet_id=fleet.id and battle.status='pending')) order by fleet.owner,fleet.name),'[]'::jsonb) into result
          from public.military_fleets fleet where fleet.status='active';
        return result;
    end if;
    vision:=public.get_visible_military_forces();
    select coalesce(jsonb_agg(to_jsonb(fleet)||jsonb_build_object('in_pending_battle',exists(
        select 1 from public.military_battle_armies participant join public.military_battles battle on battle.id=participant.battle_id
        where participant.persistent_fleet_id=fleet.id and battle.status='pending')) order by fleet.owner,fleet.name),'[]'::jsonb) into result
      from public.military_fleets fleet
     where fleet.status='active' and (fleet.owner=profile.owner or exists(
        select 1 from jsonb_array_elements(coalesce(vision->'visible_cells','[]'::jsonb)) cell(value)
        where (cell.value->>'x')::integer=fleet.cell_x and (cell.value->>'y')::integer=fleet.cell_y
     ));
    return result;
end;
$function$;
revoke all on function public.get_visible_military_fleets() from public,anon;
grant execute on function public.get_visible_military_fleets() to authenticated;

create or replace function public.start_military_naval_battle(p_attacker_fleet_id uuid,p_defender_fleet_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
    profile public.profiles%rowtype;
    attacker public.military_fleets%rowtype;
    defender public.military_fleets%rowtype;
    attacker_cell public.military_grid_cells%rowtype;
    defender_cell public.military_grid_cells%rowtype;
    calendar public.game_calendar%rowtype;
    vision jsonb;
    battle_id uuid;
    ship jsonb;
    max_crew integer;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role<>'player' or nullif(profile.owner,'') is null then raise exception 'Only a state player can order a naval attack' using errcode='42501'; end if;
    if p_attacker_fleet_id=p_defender_fleet_id then raise exception 'A fleet cannot attack itself' using errcode='22023'; end if;
    select * into attacker from public.military_fleets where id=p_attacker_fleet_id and owner=profile.owner and status='active' and location_kind='water' for update;
    if not found then raise exception 'Attacking fleet is not under your command or is not at sea' using errcode='42501'; end if;
    select * into defender from public.military_fleets where id=p_defender_fleet_id and status='active' and location_kind='water' for update;
    if not found or defender.owner=profile.owner then raise exception 'Choose an enemy fleet at sea' using errcode='22023'; end if;
    if greatest(abs(attacker.cell_x-defender.cell_x),abs(attacker.cell_y-defender.cell_y))<>1 then raise exception 'The enemy fleet must be in a neighboring water cell' using errcode='22023'; end if;
    if attacker.action_points<10 then raise exception 'A naval attack costs 10 AP' using errcode='22023'; end if;
    if jsonb_array_length(attacker.ships)=0 or jsonb_array_length(defender.ships)=0 then raise exception 'Both fleets must contain at least one ship' using errcode='22023'; end if;
    select * into attacker_cell from public.military_grid_cells where cell_x=attacker.cell_x and cell_y=attacker.cell_y;
    select * into defender_cell from public.military_grid_cells where cell_x=defender.cell_x and cell_y=defender.cell_y;
    if attacker_cell.water_types=0 or defender_cell.water_types=0 then raise exception 'Both fleets must occupy navigable water cells' using errcode='22023'; end if;
    select * into calendar from public.game_calendar where singleton=true;
    if exists(select 1 from jsonb_array_elements(attacker.ships) item where not public.military_ship_compatible(item.value->>'type',attacker_cell.water_types,calendar.season))
       or exists(select 1 from jsonb_array_elements(defender.ships) item where not public.military_ship_compatible(item.value->>'type',defender_cell.water_types,calendar.season)) then
        raise exception 'At least one ship cannot operate in its current water or season' using errcode='22023';
    end if;
    for ship in select value from jsonb_array_elements(attacker.ships) loop
        max_crew:=case ship->>'type' when 'Ушкуй' then 6 when 'Насад' then 12 when 'Ладья' then 20 when 'Когг' then 20 when 'Хольк' then 30 else 0 end;
        if coalesce((ship->>'crew')::integer,0)*100<max_crew*75 then raise exception 'Every attacking ship requires at least 75%% of its regular crew' using errcode='55000'; end if;
    end loop;
    vision:=public.get_visible_military_forces();
    if not exists(select 1 from jsonb_array_elements(coalesce(vision->'visible_cells','[]'::jsonb)) cell(value)
        where (cell.value->>'x')::integer=defender.cell_x and (cell.value->>'y')::integer=defender.cell_y) then
        raise exception 'The enemy fleet is not currently visible' using errcode='42501';
    end if;
    if exists(select 1 from public.military_battle_armies participant join public.military_battles battle on battle.id=participant.battle_id
        where participant.persistent_fleet_id in (attacker.id,defender.id) and battle.status='pending') then
        raise exception 'One of the fleets already has an unresolved battle' using errcode='55000';
    end if;
    update public.military_fleets set action_points=action_points-10,updated_at=now() where id=attacker.id;
    insert into public.military_battles(battle_type,terrain,participant_owners,location,created_by)
    values('naval','sea',array[attacker.owner,defender.owner],jsonb_build_object('cell_x',defender.cell_x,'cell_y',defender.cell_y,'attacker_cell_x',attacker.cell_x,'attacker_cell_y',attacker.cell_y),profile.id)
    returning id into battle_id;
    insert into public.military_battle_armies(battle_id,owner,side,name,unit_data,morale,order_name,tactic,decision,withdrawal_route)
    values
      (battle_id,attacker.owner,'attacker',attacker.name,jsonb_build_object('ships',attacker.ships,'persistent_fleet_id',attacker.id,'commander_skills',attacker.commander_skills),attacker.morale,'обычный','none','fight',null),
      (battle_id,defender.owner,'defender',defender.name,jsonb_build_object('ships',defender.ships,'persistent_fleet_id',defender.id,'commander_skills',defender.commander_skills),defender.morale,'обычный','none','pending',null);
    return battle_id;
end;
$function$;
revoke all on function public.start_military_naval_battle(uuid,uuid) from public,anon;
grant execute on function public.start_military_naval_battle(uuid,uuid) to authenticated;
