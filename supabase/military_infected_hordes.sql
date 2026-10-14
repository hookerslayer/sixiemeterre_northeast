-- Seasonal infected hordes: southern-border spawning, one-province advances,
-- automatic encounter creation, settlement assault, and autumn dissolution.
alter table public.military_forces
    add column if not exists npc_last_moved_turn integer;

create or replace function public.ruin_marker_after_infected_assault(p_marker_id bigint)
returns boolean language plpgsql security definer set search_path = '' as $function$
declare
    target public.markers%rowtype;
    recipients bigint[];
    recipient_id bigint;
    transfer_yards bigint;
    transfer_item record;
    recipient_count integer;
begin
    select * into target from public.markers where id=p_marker_id for update;
    if not found or target.type='ruins' then return false; end if;

    -- Evacuate at most half to safe settlements of the same state within two
    -- dry-land province transitions. Divide evenly among the nearest eligible.
    if target.owner is not null then
        with recursive edges as (
            select distinct a.province_id as source_id,b.province_id as target_id
              from public.military_grid_cells a
              join public.military_grid_cells b
                on greatest(abs(a.cell_x-b.cell_x),abs(a.cell_y-b.cell_y))=1
              left join public.military_terrain_cells ta on ta.cell_x=a.cell_x and ta.cell_y=a.cell_y
              left join public.military_terrain_cells tb on tb.cell_x=b.cell_x and tb.cell_y=b.cell_y
             where a.province_id is not null and b.province_id is not null and a.province_id<>b.province_id
               and a.base_terrain='plain' and b.base_terrain='plain'
               and coalesce(ta.terrain,'plain')<>'water' and coalesce(tb.terrain,'plain')<>'water'
        ), reachable(province_id,depth,visited) as (
            select target.province_id,0,array[target.province_id]
            union all
            select edge.target_id,reachable.depth+1,reachable.visited||edge.target_id
              from reachable join edges edge on edge.source_id=reachable.province_id
             where reachable.depth<2 and not edge.target_id=any(reachable.visited)
        ), safe_markers as (
            select marker.id,min(reachable.depth) as depth
              from reachable join public.markers marker on marker.province_id=reachable.province_id
             where reachable.depth<=2 and marker.id<>target.id and marker.owner=target.owner and marker.type<>'ruins'
               and coalesce(marker.military_controlled_by,marker.owner)=target.owner
               and not exists(select 1 from public.military_forces force where force.status='active'
                    and (force.marker_id=marker.id or (force.force_kind='land_army'
                         and force.cell_x=floor(marker.coord_1::numeric/24)::integer
                         and force.cell_y=floor(marker.coord_2::numeric/24)::integer)))
               and not exists(select 1 from public.military_sieges siege where siege.marker_id=marker.id and siege.status in ('active','battle_pending'))
               and not exists(select 1 from public.military_battles battle where battle.status='pending'
                    and (battle.location->>'marker_id')::bigint=marker.id)
             group by marker.id
        )
        select array_agg(id order by id) into recipients from safe_markers
         where depth=(select min(depth) from safe_markers);

        recipient_count:=coalesce(cardinality(recipients),0);
        if recipient_count>0 and coalesce(target.yards,0)>0 then
            transfer_yards:=floor(target.yards*0.5)::bigint/recipient_count;
            if transfer_yards>0 then
                foreach recipient_id in array recipients loop
                    update public.markers set yards=yards+transfer_yards where id=recipient_id;
                end loop;
            end if;
        end if;
        if recipient_count>0 then
            for transfer_item in select item_type,item_name,quantity from public.marker_inventories
                 where marker_id=target.id and quantity>0 loop
                foreach recipient_id in array recipients loop
                    insert into public.marker_inventories(marker_id,item_type,item_name,quantity)
                    values(recipient_id,transfer_item.item_type,transfer_item.item_name,
                        floor(transfer_item.quantity*50/recipient_count)/100)
                    on conflict(marker_id,item_type,item_name) do update
                        set quantity=public.marker_inventories.quantity+excluded.quantity;
                end loop;
            end loop;
        end if;
    end if;
    delete from public.marker_inventories where marker_id=target.id;
    update public.markers set type='ruins',yards=0,military_controlled_by=null where id=target.id;
    return true;
end;
$function$;
revoke all on function public.ruin_marker_after_infected_assault(bigint) from public,anon,authenticated;

create or replace function public.open_military_infected_battle(p_infected_id uuid,p_defender_force_id uuid default null,p_marker_id bigint default null)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
    infected public.military_forces%rowtype;
    defender public.military_forces%rowtype;
    marker public.markers%rowtype;
    participant public.military_forces%rowtype;
    battle_id uuid;
    terrain_name text;
    marker_x integer;
    marker_y integer;
    admin_id uuid;
begin
    select * into infected from public.military_forces where id=p_infected_id and owner='Буйствующие'
        and status='active' and force_kind='land_army' for update;
    if not found then return null; end if;
    if exists(select 1 from public.military_battle_armies army join public.military_battles battle on battle.id=army.battle_id
        where army.persistent_force_id=infected.id and battle.status='pending') then return null; end if;
    if p_defender_force_id is not null then
        select * into defender from public.military_forces where id=p_defender_force_id and status='active'
            and force_kind='land_army' and owner<>'Буйствующие' for update;
        if not found or defender.owner=infected.owner then return null; end if;
        if exists(select 1 from public.military_battle_armies army join public.military_battles battle on battle.id=army.battle_id
            where army.persistent_force_id=defender.id and battle.status='pending') then return null; end if;
        select coalesce(terrain.terrain,grid.base_terrain,'plain') into terrain_name
          from public.military_grid_cells grid left join public.military_terrain_cells terrain
            on terrain.cell_x=grid.cell_x and terrain.cell_y=grid.cell_y
         where grid.cell_x=defender.cell_x and grid.cell_y=defender.cell_y;
    elsif p_marker_id is not null then
        select * into marker from public.markers where id=p_marker_id and type<>'ruins' for update;
        if not found then return null; end if;
        marker_x:=floor(marker.coord_1::numeric/24)::integer;
        marker_y:=floor(marker.coord_2::numeric/24)::integer;
        if not exists(select 1 from public.military_forces where marker_id=marker.id and status='active' and force_kind='garrison') then
            perform public.ruin_marker_after_infected_assault(marker.id);
            if not exists(select 1 from public.military_forces force where force.id<>infected.id and force.status='active'
                and force.force_kind='land_army' and force.cell_x=marker_x and force.cell_y=marker_y) then
                update public.military_forces set cell_x=marker_x,cell_y=marker_y,province_id=marker.province_id,npc_last_moved_turn=
                    (select turn from public.game_calendar where singleton=true),updated_at=now() where id=infected.id;
            end if;
            return null;
        end if;
        if exists(select 1 from public.military_battle_armies army join public.military_battles battle on battle.id=army.battle_id
            where army.persistent_force_id in (select id from public.military_forces where marker_id=marker.id and status='active')
              and battle.status='pending') then return null; end if;
        select coalesce(terrain.terrain,grid.base_terrain,'plain') into terrain_name
          from public.military_grid_cells grid left join public.military_terrain_cells terrain
            on terrain.cell_x=grid.cell_x and terrain.cell_y=grid.cell_y
         where grid.cell_x=marker_x and grid.cell_y=marker_y;
        terrain_name:=case when terrain_name='water' then 'plain' else coalesce(terrain_name,'plain') end;
    else return null;
    end if;
    select id into admin_id from public.profiles where role='admin' order by created_at limit 1;
    if admin_id is null then raise exception 'An administrator profile is required to create a battle event'; end if;
    insert into public.military_battles(battle_type,terrain,participant_owners,location,created_by)
    values('land',case when terrain_name in ('plain','hill','forest','marsh','bridge') then terrain_name else 'plain' end,
        case when p_defender_force_id is not null then array[infected.owner,defender.owner] else array[infected.owner,marker.owner] end,
        jsonb_build_object('source',case when p_marker_id is not null then 'infected_assault' else 'infected_encounter' end,
            'infected_force_id',infected.id,'marker_id',p_marker_id,'cell_x',coalesce(marker_x,defender.cell_x),
            'cell_y',coalesce(marker_y,defender.cell_y),'province_id',coalesce(marker.province_id,defender.province_id)),admin_id)
    returning id into battle_id;
    insert into public.military_battle_armies(battle_id,owner,side,name,unit_data,morale,order_name,tactic,decision,persistent_force_id)
    values(battle_id,infected.owner,'attacker',infected.name,
        jsonb_build_object('units',infected.unit_groups,'skills','{}'::jsonb,'conditions',jsonb_build_object('infected',true)),
        100,'решительный','focused_strike','fight',infected.id);
    if p_defender_force_id is not null then
        insert into public.military_battle_armies(battle_id,owner,side,name,unit_data,morale,order_name,tactic,decision,persistent_force_id)
        values(battle_id,defender.owner,'defender',defender.name,
            jsonb_build_object('units',defender.unit_groups,'skills',defender.commander_skills,'conditions',jsonb_build_object('terrain',terrain_name)),
            defender.morale,defender.order_name,defender.tactic,'pending',defender.id);
    else
        for participant in select * from public.military_forces where marker_id=p_marker_id and status='active' and force_kind='garrison' loop
            insert into public.military_battle_armies(battle_id,owner,side,name,unit_data,morale,order_name,tactic,decision,persistent_force_id)
            values(battle_id,participant.owner,'defender',participant.name,
                jsonb_build_object('units',participant.unit_groups,'skills','{}'::jsonb,'conditions',jsonb_build_object('garrison',true)),
                participant.morale,'осторожный','none','pending',participant.id);
        end loop;
    end if;
    update public.military_forces set action_points=0,npc_last_moved_turn=(select turn from public.game_calendar where singleton=true),updated_at=now()
      where id=infected.id;
    return battle_id;
end;
$function$;
revoke all on function public.open_military_infected_battle(uuid,uuid,bigint) from public,anon,authenticated;

create or replace function public.process_military_infected_hordes()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
    eligible_count integer;
    spawn_count integer;
    edge_y integer;
    province_row record;
    infected public.military_forces%rowtype;
    destination record;
    marker_id bigint;
    defender_id uuid;
    current_mean numeric;
    turn_seed bigint;
    admin_id uuid;
begin
    if new.turn<=old.turn then return new; end if;
    if new.season='Лето' and old.season is distinct from 'Лето' then
        select id into admin_id from public.profiles where role='admin' order by created_at limit 1;
        select max(cell_y) into edge_y from public.military_grid_cells where province_id is not null and base_terrain='plain';
        with border_provinces as (
            select distinct province.id,province.main_culture
              from public."Provinces" province join public.military_grid_cells cell on cell.province_id=province.id
             where province.region in ('Эстляндия','Псковская земля','Новгородская земля','Костромская земля',
                 'Галичская земля','Вятская земля','Пермь Великая') and cell.cell_y=edge_y and cell.base_terrain='plain'
               and not exists(select 1 from public.military_forces army where army.force_kind='land_army'
                    and army.status='active' and army.province_id=province.id)
        ) select count(*) into eligible_count from border_provinces;
        if eligible_count>0 then
            turn_seed:=abs(hashtextextended(new.turn::text||':infected-count',0));
            spawn_count:=least(eligible_count,3+mod(turn_seed,8)::integer);
            for province_row in
                with border_provinces as (
                    select distinct province.id,province.main_culture
                      from public."Provinces" province join public.military_grid_cells cell on cell.province_id=province.id
                     where province.region in ('Эстляндия','Псковская земля','Новгородская земля','Костромская земля',
                         'Галичская земля','Вятская земля','Пермь Великая') and cell.cell_y=edge_y and cell.base_terrain='plain'
                       and not exists(select 1 from public.military_forces army where army.force_kind='land_army'
                            and army.status='active' and army.province_id=province.id)
                ) select * from border_provinces order by md5(new.turn::text||':'||id::text||':infected-spawn') limit spawn_count
            loop
                select cell.cell_x,cell.cell_y into destination from public.military_grid_cells cell
                  left join public.military_terrain_cells terrain on terrain.cell_x=cell.cell_x and terrain.cell_y=cell.cell_y
                 where cell.province_id=province_row.id and cell.base_terrain='plain'
                   and coalesce(terrain.terrain,'plain')<>'water'
                   and not exists(select 1 from public.military_forces force where force.status='active'
                        and force.cell_x=cell.cell_x and force.cell_y=cell.cell_y)
                 order by md5(new.turn::text||':'||province_row.id::text||':'||cell.cell_x::text||':'||cell.cell_y::text)
                 limit 1;
                if not found then continue; end if;
                turn_seed:=abs(hashtextextended(new.turn::text||':'||province_row.id::text||':infected-roster',0));
                insert into public.military_forces(owner,name,force_kind,province_id,cell_x,cell_y,unit_groups,morale,action_points,
                    order_name,tactic,status,npc_home_cell_x,npc_home_cell_y,npc_home_province_id,npc_last_moved_turn)
                values('Буйствующие','Буйствующие · отряд '||province_row.id,'land_army',province_row.id,destination.cell_x,destination.cell_y,
                    jsonb_build_array(jsonb_build_object('type','Заражённый','count',1000+mod(turn_seed,4001)::integer)),
                    100,0,'решительный','focused_strike','active',destination.cell_x,destination.cell_y,province_row.id,new.turn-1);
            end loop;
        end if;
    end if;

    if new.season<>'Лето' then
        delete from public.military_forces force where force.owner='Буйствующие' and force.status='active'
          and not exists(select 1 from public.military_battle_armies army join public.military_battles battle on battle.id=army.battle_id
              where army.persistent_force_id=force.id and battle.status='pending');
        return new;
    end if;

    for infected in select * from public.military_forces where owner='Буйствующие' and status='active' and force_kind='land_army'
        and coalesce(npc_last_moved_turn,0)<new.turn order by id for update loop
        if exists(select 1 from public.military_battle_armies army join public.military_battles battle on battle.id=army.battle_id
            where army.persistent_force_id=infected.id and battle.status='pending') then continue; end if;

        -- A neighboring hostile field army starts an ordinary battle event.
        select force.id into defender_id from public.military_forces force
         where force.id<>infected.id and force.status='active' and force.force_kind='land_army'
           and force.owner not in ('Буйствующие')
           and greatest(abs(force.cell_x-infected.cell_x),abs(force.cell_y-infected.cell_y))<=1
         order by greatest(abs(force.cell_x-infected.cell_x),abs(force.cell_y-infected.cell_y)),force.id limit 1;
        if defender_id is null then
            select force.id into defender_id from public.military_forces force
             where force.id<>infected.id and force.status='active' and force.force_kind='land_army'
               and force.owner<>'Буйствующие' and force.province_id=infected.province_id
             order by force.id limit 1;
        end if;
        if defender_id is not null then
            perform public.open_military_infected_battle(infected.id,defender_id,null);
            continue;
        end if;

        -- A settlement in the current province is assaulted immediately.
        select marker.id into marker_id from public.markers marker
         where marker.province_id=infected.province_id and marker.type<>'ruins'
         order by marker.coord_1,marker.coord_2 limit 1;
        if marker_id is not null then
            perform public.open_military_infected_battle(infected.id,null,marker_id);
            continue;
        end if;

        select avg(cell.cell_y)::numeric into current_mean from public.military_grid_cells cell where cell.province_id=infected.province_id;
        -- Advance exactly one dry cell into a neighboring province, preferring
        -- movement northward and provinces that contain enemies or settlements.
        select next_cell.cell_x,next_cell.cell_y,next_cell.province_id into destination
          from public.military_grid_cells current_cell
          join public.military_grid_cells next_cell
            on greatest(abs(current_cell.cell_x-next_cell.cell_x),abs(current_cell.cell_y-next_cell.cell_y))=1
          left join public.military_terrain_cells terrain on terrain.cell_x=next_cell.cell_x and terrain.cell_y=next_cell.cell_y
         where current_cell.cell_x=infected.cell_x and current_cell.cell_y=infected.cell_y
           and next_cell.province_id is not null and next_cell.province_id<>infected.province_id
           and next_cell.base_terrain='plain' and coalesce(terrain.terrain,'plain')<>'water'
           and not exists(select 1 from public.military_forces other where other.id<>infected.id and other.status='active'
                and other.cell_x=next_cell.cell_x and other.cell_y=next_cell.cell_y)
         order by case when (select avg(north.cell_y) from public.military_grid_cells north where north.province_id=next_cell.province_id)<current_mean then 0 else 1 end,
           case when exists(select 1 from public.military_forces target where target.force_kind='land_army' and target.status='active'
                  and target.owner<>'Буйствующие' and target.province_id=next_cell.province_id) then 0
                when exists(select 1 from public.markers target where target.province_id=next_cell.province_id and target.type<>'ruins') then 1 else 2 end,
           (select avg(north.cell_y) from public.military_grid_cells north where north.province_id=next_cell.province_id),
           next_cell.cell_y,next_cell.cell_x limit 1;
        if found then
            update public.military_forces set province_id=destination.province_id,cell_x=destination.cell_x,cell_y=destination.cell_y,
                action_points=0,npc_last_moved_turn=new.turn,updated_at=now() where id=infected.id;
            select force.id into defender_id from public.military_forces force
             where force.id<>infected.id and force.status='active' and force.force_kind='land_army'
               and force.owner<>'Буйствующие' and force.province_id=destination.province_id
             order by greatest(abs(force.cell_x-destination.cell_x),abs(force.cell_y-destination.cell_y)),force.id limit 1;
            if defender_id is not null then
                perform public.open_military_infected_battle(infected.id,defender_id,null);
            else
                select marker.id into marker_id from public.markers marker
                 where marker.province_id=destination.province_id and marker.type<>'ruins'
                 order by greatest(abs(floor(marker.coord_1::numeric/24)::integer-destination.cell_x),
                                   abs(floor(marker.coord_2::numeric/24)::integer-destination.cell_y)),marker.id limit 1;
                if marker_id is not null then perform public.open_military_infected_battle(infected.id,null,marker_id); end if;
            end if;
        else
            update public.military_forces set npc_last_moved_turn=new.turn,updated_at=now() where id=infected.id;
        end if;
    end loop;
    return new;
end;
$function$;
revoke all on function public.process_military_infected_hordes() from public,anon,authenticated;
drop trigger if exists zzzzz_process_military_infected_hordes on public.game_calendar;
create trigger zzzzz_process_military_infected_hordes after update of turn on public.game_calendar
for each row execute function public.process_military_infected_hordes();

create or replace function public.resolve_military_infected_assault()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare battle_location jsonb; battle_outcome text; marker_id bigint;
begin
    select battle.location,battle.public_outcome into battle_location,battle_outcome
      from public.military_battles battle where battle.id=new.battle_id;
    if battle_location->>'source'='infected_assault' and battle_outcome='attacker' then
        marker_id:=(battle_location->>'marker_id')::bigint;
        perform public.ruin_marker_after_infected_assault(marker_id);
    end if;
    if (select season from public.game_calendar where singleton=true)<>'Лето' then
        delete from public.military_forces force where force.owner='Буйствующие' and force.status='active'
          and not exists(select 1 from public.military_battle_armies army join public.military_battles battle on battle.id=army.battle_id
              where army.persistent_force_id=force.id and battle.status='pending');
    end if;
    return new;
end;
$function$;
revoke all on function public.resolve_military_infected_assault() from public,anon,authenticated;
drop trigger if exists zzzzz_resolve_military_infected_assault on public.military_battle_admin_results;
create trigger zzzzz_resolve_military_infected_assault after insert or update on public.military_battle_admin_results
for each row execute function public.resolve_military_infected_assault();
