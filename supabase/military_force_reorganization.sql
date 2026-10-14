-- Transfer units between field armies, split an army into a new command, and
-- merge adjacent same-state armies with server-side route and AP validation.
create or replace function public.transfer_military_troops(
    p_source_force_id uuid,
    p_target_force_id uuid,
    p_units jsonb,
    p_path jsonb,
    p_merge boolean default false
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
    profile public.profiles%rowtype;
    source_force public.military_forces%rowtype;
    target_force public.military_forces%rowtype;
    route_row record;
    previous_cell record;
    next_cell record;
    group_row jsonb;
    moved_type text;
    moved_count integer;
    source_next jsonb:='[]'::jsonb;
    target_next jsonb;
    all_units jsonb:='[]'::jsonb;
    total_troops numeric:=0;
    weighted_troops numeric:=0;
    mobility numeric:=1;
    size_factor numeric:=1;
    movement_cost integer:=0;
    spent integer:=0;
    dx integer; dy integer; diagonal boolean; terrain_name text; base_cost integer;
    river_crossing boolean; bridge boolean;
    blocked_corners integer;
    equipment_total jsonb;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role not in ('player','admin') then raise exception 'Player authentication required' using errcode='42501'; end if;
    select * into source_force from public.military_forces where id=p_source_force_id and force_kind='land_army' and status='active' for update;
    if not found then raise exception 'Source army is not active' using errcode='22023'; end if;
    select * into target_force from public.military_forces where id=p_target_force_id and force_kind='land_army' and status='active' for update;
    if not found or p_source_force_id=p_target_force_id then raise exception 'Choose a different active target army' using errcode='22023'; end if;
    if profile.role<>'admin' and (source_force.owner is distinct from profile.owner or target_force.owner is distinct from profile.owner) then
        raise exception 'You may reorganize only your own armies' using errcode='42501';
    end if;
    if source_force.owner is distinct from target_force.owner then raise exception 'Armies must belong to the same state' using errcode='22023'; end if;
    if source_force.is_militia is distinct from target_force.is_militia or source_force.is_mercenary or target_force.is_mercenary then
        raise exception 'Militia and mercenary contracts cannot be transferred between commands' using errcode='22023';
    end if;
    if exists(select 1 from public.military_battle_armies army join public.military_battles battle on battle.id=army.battle_id
        where army.persistent_force_id in (source_force.id,target_force.id) and battle.status='pending') then
        raise exception 'Armies in an unresolved battle cannot be reorganized' using errcode='55000';
    end if;
    if jsonb_typeof(p_path) is distinct from 'array' or jsonb_array_length(p_path)<1 or jsonb_array_length(p_path)>101 then
        raise exception 'A route from the source army to the target army is required' using errcode='22023';
    end if;
    if (p_path->0->>'x')::integer<>source_force.cell_x or (p_path->0->>'y')::integer<>source_force.cell_y
       or (p_path->(jsonb_array_length(p_path)-1)->>'x')::integer<>target_force.cell_x
       or (p_path->(jsonb_array_length(p_path)-1)->>'y')::integer<>target_force.cell_y then
        raise exception 'The route must begin and end at the selected armies' using errcode='22023';
    end if;
    if p_merge then
        if jsonb_typeof(source_force.unit_groups)<>'array' then raise exception 'Source composition is invalid'; end if;
        p_units:=source_force.unit_groups;
    elsif jsonb_typeof(p_units) is distinct from 'array' or jsonb_array_length(p_units)=0 then
        raise exception 'Select at least one troop group to transfer' using errcode='22023';
    end if;

    for group_row in select value from jsonb_array_elements(p_units) loop
        moved_type:=btrim(group_row->>'type');
        if moved_type is null or moved_type='' or jsonb_typeof(group_row->'count') is distinct from 'number'
           or (group_row->>'count')::numeric<=0 or (group_row->>'count')::numeric<>trunc((group_row->>'count')::numeric) then
            raise exception 'Troop transfer amounts must be positive whole numbers' using errcode='22023';
        end if;
        moved_count:=(group_row->>'count')::integer;
        if not exists(select 1 from jsonb_array_elements(source_force.unit_groups) group_item
            where group_item->>'type'=moved_type and (group_item->>'count')::integer>=moved_count) then
            raise exception 'The source army does not have enough %',moved_type using errcode='22023';
        end if;
        total_troops:=total_troops+moved_count;
        weighted_troops:=weighted_troops+moved_count*case moved_type
            when 'Конные копейщики' then 1.25 when 'Лёгкая конница' then 1.4 when 'Конные лучники' then 1.4 else 1 end;
    end loop;
    equipment_total:='{}'::jsonb;
    if p_merge then
        select coalesce(jsonb_object_agg(gear_keys.key,to_jsonb(coalesce((target_force.siege_equipment->>gear_keys.key)::numeric,0)
                    +coalesce((source_force.siege_equipment->>gear_keys.key)::numeric,0))),'{}'::jsonb)
          into equipment_total
          from (select key from jsonb_each(coalesce(target_force.siege_equipment,'{}'::jsonb))
                union select key from jsonb_each(coalesce(source_force.siege_equipment,'{}'::jsonb))) gear_keys;
    end if;
    if total_troops<=0 then raise exception 'There are no selected troops'; end if;
    size_factor:=greatest(0.7,1-0.05*floor(greatest(0,total_troops-500)/500));
    mobility:=greatest(0.5,least(1.4,(weighted_troops/total_troops)*size_factor));

    select grid.cell_x,grid.cell_y,grid.river_edges,coalesce(terrain.terrain,grid.base_terrain) as terrain,
           (coalesce(terrain.bridge,false) or exists(select 1 from public.military_structures structure
                where structure.cell_x=grid.cell_x and structure.cell_y=grid.cell_y and structure.structure_type='bridge'
                  and structure.status='active' and structure.available_from_turn<=(select turn from public.game_calendar where singleton=true))) as bridge
      into previous_cell from public.military_grid_cells grid
      left join public.military_terrain_cells terrain on terrain.cell_x=grid.cell_x and terrain.cell_y=grid.cell_y
     where grid.cell_x=source_force.cell_x and grid.cell_y=source_force.cell_y;
    for route_row in select value,ordinality from jsonb_array_elements(p_path) with ordinality where ordinality>1 order by ordinality loop
        dx:=(route_row.value->>'x')::integer-previous_cell.cell_x;
        dy:=(route_row.value->>'y')::integer-previous_cell.cell_y;
        if greatest(abs(dx),abs(dy))<>1 then raise exception 'Each route step must use a neighboring cell'; end if;
        diagonal:=dx<>0 and dy<>0;
        diagonal:=dx<>0 and dy<>0;
        select grid.cell_x,grid.cell_y,grid.province_id,grid.river_edges,coalesce(terrain.terrain,grid.base_terrain) as terrain,
               (coalesce(terrain.bridge,false) or exists(select 1 from public.military_structures structure
                    where structure.cell_x=grid.cell_x and structure.cell_y=grid.cell_y and structure.structure_type='bridge'
                      and structure.status='active' and structure.available_from_turn<=(select turn from public.game_calendar where singleton=true))) as bridge
          into next_cell from public.military_grid_cells grid
          left join public.military_terrain_cells terrain on terrain.cell_x=grid.cell_x and terrain.cell_y=grid.cell_y
         where grid.cell_x=(route_row.value->>'x')::integer and grid.cell_y=(route_row.value->>'y')::integer;
        if not found or next_cell.province_id is null and not next_cell.bridge then raise exception 'Route leaves the land map'; end if;
        if next_cell.terrain='water' and not next_cell.bridge then raise exception 'The transfer route crosses impassable water'; end if;
        if diagonal then
            select count(*) into blocked_corners
              from (values (previous_cell.cell_x+dx,previous_cell.cell_y), (previous_cell.cell_x,previous_cell.cell_y+dy)) corner(x,y)
              left join public.military_grid_cells cg on cg.cell_x=corner.x and cg.cell_y=corner.y
              left join public.military_terrain_cells ct on ct.cell_x=corner.x and ct.cell_y=corner.y
             where cg.cell_x is null or coalesce(ct.terrain,cg.base_terrain)='water' and not coalesce(ct.bridge,false);
            if blocked_corners=2 then raise exception 'Diagonal transfer cannot cut between two impassable cells'; end if;
        end if;
        if exists(select 1 from public.military_structures structure where structure.cell_x=next_cell.cell_x and structure.cell_y=next_cell.cell_y
              and structure.structure_type='palisade' and structure.status='active'
              and structure.available_from_turn<=(select turn from public.game_calendar where singleton=true)) then
            raise exception 'A palisade blocks the transfer route';
        end if;
        if exists(select 1 from public.military_forces other where other.force_kind='land_army' and other.status='active'
              and other.id not in (source_force.id,target_force.id) and other.cell_x=next_cell.cell_x and other.cell_y=next_cell.cell_y
              and other.owner<>source_force.owner) then
            raise exception 'The transfer route is blocked by another army';
        end if;
        if next_cell.terrain='water' and next_cell.bridge then bridge:=true; else bridge:=previous_cell.bridge; end if;
        river_crossing:=not bridge and (((coalesce(previous_cell.river_edges,0)&case when dx=1 and dy=0 then 1 when dx=1 and dy=1 then 2 when dx=0 and dy=1 then 4 when dx=-1 and dy=1 then 8 when dx=-1 and dy=0 then 16 when dx=-1 and dy=-1 then 32 when dx=0 and dy=-1 then 64 else 128 end)<>0)
          or ((coalesce(next_cell.river_edges,0)&case when dx=1 and dy=0 then 16 when dx=1 and dy=1 then 32 when dx=0 and dy=1 then 64 when dx=-1 and dy=1 then 128 when dx=-1 and dy=0 then 1 when dx=-1 and dy=-1 then 2 when dx=0 and dy=-1 then 4 else 8 end)<>0));
        base_cost:=case next_cell.terrain when 'hill' then case when diagonal then 21 else 15 end
            when 'forest' then case when diagonal then 21 else 15 end when 'marsh' then case when diagonal then 28 else 20 end
            else case when diagonal then 14 else 10 end end;
        movement_cost:=movement_cost+greatest(1,ceil(base_cost/mobility)::integer)+case when river_crossing then 10 else 0 end;
        previous_cell:=next_cell;
    end loop;
    if movement_cost>source_force.action_points then raise exception 'The selected troops cannot reach the target with their remaining action points'; end if;
    spent:=ceil(movement_cost/2)::integer+case when p_merge then 5 else 0 end;
    if spent>source_force.action_points then raise exception 'The reorganization order needs % action points',spent; end if;

    for group_row in select value from jsonb_array_elements(source_force.unit_groups) loop
        moved_count:=coalesce((select sum((item->>'count')::integer) from jsonb_array_elements(p_units) item where item->>'type'=group_row->>'type'),0)::integer;
        if (group_row->>'count')::integer>moved_count then
            source_next:=source_next||jsonb_build_array(jsonb_build_object('type',group_row->>'type','count',(group_row->>'count')::integer-moved_count));
        end if;
    end loop;
    -- Reaggregate both existing and transferred groups without duplicate unit names.
    select coalesce(jsonb_agg(jsonb_build_object('type',kind,'count',sum_count) order by kind),'[]'::jsonb) into target_next
      from (select item->>'type' as kind,sum((item->>'count')::integer) as sum_count
              from (select value as item from jsonb_array_elements(target_force.unit_groups)
                    union all select value as item from jsonb_array_elements(p_units)) all_groups
             group by item->>'type') grouped;
    update public.military_forces set unit_groups=source_next,action_points=action_points-spent,
        siege_equipment=case when p_merge then '{}'::jsonb else siege_equipment end,
        status=case when jsonb_array_length(source_next)=0 then 'disbanded' else status end,updated_at=now()
     where id=source_force.id;
    update public.military_forces set unit_groups=target_next,
        siege_equipment=case when p_merge then equipment_total else siege_equipment end,
        morale=case when p_merge then round((morale*greatest(1,(select coalesce(sum((item->>'count')::numeric),0) from jsonb_array_elements(target_force.unit_groups) item))
            + source_force.morale*total_troops) / greatest(1,(select coalesce(sum((item->>'count')::numeric),0) from jsonb_array_elements(target_force.unit_groups) item)+total_troops),2) else morale end,
        updated_at=now() where id=target_force.id;
    return jsonb_build_object('source_force_id',source_force.id,'target_force_id',target_force.id,'transferred',p_units,
        'merged',p_merge,'movement_cost',movement_cost,'spent_action_points',spent);
end;
$function$;

create or replace function public.split_military_force(
    p_force_id uuid,p_units jsonb,p_name text,p_commander_name text,p_commander_age integer,p_cell_x integer,p_cell_y integer
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
    profile public.profiles%rowtype; source_force public.military_forces%rowtype;
    unit_row jsonb; group_row jsonb; moved_count integer; source_next jsonb:='[]'::jsonb; new_id uuid;
    destination public.military_grid_cells%rowtype; terrain_name text; occupied boolean;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role not in ('player','admin') then raise exception 'Player authentication required' using errcode='42501'; end if;
    select * into source_force from public.military_forces where id=p_force_id and force_kind='land_army' and status='active' for update;
    if not found or (profile.role<>'admin' and source_force.owner is distinct from profile.owner) then raise exception 'Choose your active field army' using errcode='42501'; end if;
    if source_force.is_mercenary or source_force.is_militia then raise exception 'Contracted and militia troops cannot be split into a new command'; end if;
    if source_force.action_points<10 then raise exception 'Splitting an army costs 10 action points'; end if;
    if jsonb_typeof(p_units) is distinct from 'array' or jsonb_array_length(p_units)=0 or length(btrim(p_name)) not between 1 and 80
       or length(btrim(p_commander_name)) not between 1 and 80 or p_commander_age not between 16 and 100 then raise exception 'Invalid split order'; end if;
    if exists(select 1 from public.military_battle_armies army join public.military_battles battle on battle.id=army.battle_id
        where army.persistent_force_id=source_force.id and battle.status='pending') then raise exception 'An army in an unresolved battle cannot split'; end if;
    select * into destination from public.military_grid_cells where cell_x=p_cell_x and cell_y=p_cell_y;
    if not found or destination.province_id is null or greatest(abs(p_cell_x-source_force.cell_x),abs(p_cell_y-source_force.cell_y))<>1 then
        raise exception 'The new army must be placed in a neighboring dry land cell';
    end if;
    select coalesce(terrain.terrain,destination.base_terrain) into terrain_name from public.military_terrain_cells terrain
     where terrain.cell_x=p_cell_x and terrain.cell_y=p_cell_y;
    terrain_name:=coalesce(terrain_name,destination.base_terrain);
    if terrain_name='water' or exists(select 1 from public.military_forces other where other.status='active' and other.force_kind='land_army'
        and other.cell_x=p_cell_x and other.cell_y=p_cell_y) then raise exception 'The selected cell is not available to the new army'; end if;
    for unit_row in select value from jsonb_array_elements(p_units) loop
        if jsonb_typeof(unit_row->'count') is distinct from 'number' or (unit_row->>'count')::numeric<=0
           or (unit_row->>'count')::numeric<>trunc((unit_row->>'count')::numeric) then raise exception 'Select a positive whole troop count'; end if;
        if not exists(select 1 from jsonb_array_elements(source_force.unit_groups) item where item->>'type'=unit_row->>'type'
            and (item->>'count')::integer >= (unit_row->>'count')::integer) then raise exception 'The source army does not have enough %',unit_row->>'type'; end if;
    end loop;
    for group_row in select value from jsonb_array_elements(source_force.unit_groups) loop
        moved_count:=coalesce((select sum((item->>'count')::integer) from jsonb_array_elements(p_units) item where item->>'type'=group_row->>'type'),0)::integer;
        if (group_row->>'count')::integer>moved_count then source_next:=source_next||jsonb_build_array(jsonb_build_object('type',group_row->>'type','count',(group_row->>'count')::integer-moved_count)); end if;
    end loop;
    update public.military_forces set unit_groups=source_next,action_points=action_points-10,
        status=case when jsonb_array_length(source_next)=0 then 'disbanded' else status end,updated_at=now() where id=source_force.id;
    insert into public.military_forces(owner,name,force_kind,province_id,cell_x,cell_y,commander_name,commander_age,
        commander_skills,unit_groups,siege_equipment,morale,action_points,status)
    values(source_force.owner,btrim(p_name),'land_army',destination.province_id,p_cell_x,p_cell_y,btrim(p_commander_name),p_commander_age,
        '{}'::jsonb,p_units,'{}'::jsonb,source_force.morale,0,'active') returning id into new_id;
    return new_id;
end;
$function$;

revoke all on function public.transfer_military_troops(uuid,uuid,jsonb,jsonb,boolean) from public,anon;
grant execute on function public.transfer_military_troops(uuid,uuid,jsonb,jsonb,boolean) to authenticated;
revoke all on function public.split_military_force(uuid,jsonb,text,text,integer,integer,integer) from public,anon;
grant execute on function public.split_military_force(uuid,jsonb,text,text,integer,integer,integer) to authenticated;
