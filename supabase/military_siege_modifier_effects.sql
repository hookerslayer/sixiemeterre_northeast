create or replace function public.resolve_military_sieges_on_turn()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
    siege public.military_sieges%rowtype;
    target public.markers%rowtype;
    primary_force public.military_forces%rowtype;
    participant public.military_forces%rowtype;
    participant_id uuid;
    battle_id uuid;
    terrain_name text;
    target_x integer;
    target_y integer;
    gain numeric;
    work_modifier numeric;
    rank integer;
    unit_count integer;
    equipment_count integer;
    fully_supplied boolean;
    units_json jsonb;
    attacker_count integer;
    defender_count integer;
    stock_wood numeric;
    stock_tools numeric;
    next_progress integer;
    weakened_threshold integer;
    breach_threshold integer;
begin
    if new.turn<=old.turn then return new; end if;
    for siege in select * from public.military_sieges where status='active' and last_resolved_turn<old.turn loop
        select * into target from public.markers where id=siege.marker_id for update;
        if not found then update public.military_sieges set status='lifted',last_resolved_turn=old.turn where id=siege.id; continue; end if;
        target_x:=floor(target.coord_1::numeric/24)::integer;
        target_y:=floor(target.coord_2::numeric/24)::integer;
        update public.military_sieges set last_resolved_turn=old.turn where id=siege.id;
        if siege.attacker_order='lift' then update public.military_sieges set status='lifted' where id=siege.id; continue; end if;
        if siege.defender_order='surrender' then
            select * into primary_force from public.military_forces where id=any(siege.attacker_force_ids) and status='active' and force_kind='land_army' order by id limit 1 for update;
            if found then update public.military_forces set cell_x=target_x,cell_y=target_y,province_id=target.province_id,updated_at=now() where id=primary_force.id; end if;
            update public.markers set military_controlled_by=siege.attacker_owner where id=siege.marker_id;
            update public.military_sieges set status='captured' where id=siege.id;
            continue;
        end if;
        if siege.defender_order='repair' then
            select coalesce((select quantity from public.marker_inventories where marker_id=target.id and item_type='resource' and item_name='Древесина'),0),
                   coalesce((select quantity from public.marker_inventories where marker_id=target.id and item_type='good' and item_name='Инструменты'),0)
              into stock_wood,stock_tools;
            if stock_wood>=2 and stock_tools>=1 then
                update public.marker_inventories set quantity=quantity-2 where marker_id=target.id and item_type='resource' and item_name='Древесина';
                update public.marker_inventories set quantity=quantity-1 where marker_id=target.id and item_type='good' and item_name='Инструменты';
                next_progress:=greatest(0,siege.works-20);
                weakened_threshold:=case siege.fortification_level when 1 then 20 when 2 then 35 else 50 end;
                breach_threshold:=case siege.fortification_level when 1 then 40 when 2 then 70 else 100 end;
                if siege.works>=weakened_threshold and next_progress<weakened_threshold then
                    next_progress:=least(next_progress,weakened_threshold-1);
                elsif siege.works>=breach_threshold and next_progress<breach_threshold then
                    next_progress:=least(next_progress,breach_threshold-1);
                end if;
                update public.military_sieges set works=next_progress where id=siege.id;
            end if;
        end if;
        if siege.attacker_order='works' then
            select coalesce(bool_and(force.maintenance_coverage>=1),false) into fully_supplied
              from public.military_forces force where force.id=any(siege.attacker_force_ids) and force.owner=siege.attacker_owner
                and force.status='active' and force.force_kind='land_army';
            if fully_supplied then
                select greatest(0,least(5,coalesce(max((force.commander_skills->>'engineering')::integer),0))),
                       coalesce(sum(case item.key when 'Малая пушка / пищаль' then 8 when 'Требюше' then 12 when 'Бомбарда' then 16 else 0 end*greatest(0,item.value::integer)),0),
                       coalesce(sum(case item.key when 'Малая пушка / пищаль' then 4 when 'Требюше' then 20 when 'Бомбарда' then 30 else 0 end*greatest(0,item.value::integer)),0)
                  into rank,gain,equipment_count
                  from public.military_forces force
                  left join lateral jsonb_each_text(force.siege_equipment) item on true
                 where force.id=any(siege.attacker_force_ids) and force.owner=siege.attacker_owner and force.status='active' and force.force_kind='land_army';
                select coalesce(sum(greatest(0,(group_row.value->>'count')::integer)),0) into unit_count
                  from public.military_forces force cross join lateral jsonb_array_elements(force.unit_groups) group_row(value)
                 where force.id=any(siege.attacker_force_ids) and force.owner=siege.attacker_owner and force.status='active' and force.force_kind='land_army'
                   and group_row.value->>'type' in ('Пешие ратники','Копейщики','Лучники','Арбалетчики','Лыжники-разведчики');
                if siege.work_method='sapping' then
                    if rank>=2 and unit_count>=20 and exists(select 1 from public.military_grid_cells grid left join public.military_terrain_cells override on override.cell_x=grid.cell_x and override.cell_y=grid.cell_y
                        where grid.cell_x=target_x and grid.cell_y=target_y and coalesce(override.terrain,grid.base_terrain) in ('plain','hill')) then gain:=10; else gain:=0; end if;
                elsif equipment_count=0 or unit_count<equipment_count then gain:=0; end if;
                gain:=least(30,gain*(1+0.1*rank));
                select coalesce(sum(m.value),0) into work_modifier from public.state_modifiers m
                 where m.owner=siege.attacker_owner and m.effect_key='siege_work_gain_pct' and m.status='active'
                   and m.starts_turn<=new.turn and (m.ends_turn is null or m.ends_turn>=new.turn)
                   and (m.scope_type='state' or (m.scope_type='army' and m.scope_value in (select unnest(siege.attacker_force_ids)::text)));
                gain:=least(30,gain*greatest(0,1+coalesce(work_modifier,0)/100));
                update public.military_sieges set works=least(100,works+floor(gain)::integer) where id=siege.id;
            end if;
        end if;
        if siege.attacker_order='assault' or siege.defender_order='sortie' then
            target_x:=floor(target.coord_1::numeric/24)::integer; target_y:=floor(target.coord_2::numeric/24)::integer;
            select coalesce(override.terrain,grid.base_terrain,'plain') into terrain_name from public.military_grid_cells grid
              left join public.military_terrain_cells override on override.cell_x=grid.cell_x and override.cell_y=grid.cell_y
             where grid.cell_x=target_x and grid.cell_y=target_y;
            terrain_name:=case when terrain_name='water' then 'plain' else coalesce(terrain_name,'plain') end;
            select count(*) into attacker_count from public.military_forces where id=any(siege.attacker_force_ids) and status='active' and force_kind='land_army';
            select count(*) into defender_count from public.military_forces where marker_id=target.id and status='active' and force_kind='garrison';
            if attacker_count=0 then update public.military_sieges set status='lifted' where id=siege.id; continue; end if;
            if defender_count=0 then
                select * into primary_force from public.military_forces where id=any(siege.attacker_force_ids) and status='active' and force_kind='land_army' order by id limit 1 for update;
                if found then update public.military_forces set cell_x=target_x,cell_y=target_y,province_id=target.province_id,updated_at=now() where id=primary_force.id; end if;
                update public.markers set military_controlled_by=siege.attacker_owner where id=target.id;
                update public.military_sieges set status='captured' where id=siege.id; continue;
            end if;
            insert into public.military_battles(battle_type,terrain,participant_owners,location,created_by)
            values('land',terrain_name,array[siege.attacker_owner,siege.defender_owner],jsonb_build_object(
                'source','siege','siege_action',case when siege.defender_order='sortie' then 'sortie' else 'assault' end,
                'siege_id',siege.id,'marker_id',target.id,'cell_x',target_x,'cell_y',target_y,'province_id',target.province_id,
                'siege',case when siege.defender_order<>'sortie' and siege.attacker_order='assault'
                    then jsonb_build_object('level',siege.fortification_level,'works',coalesce((select works from public.military_sieges where id=siege.id),siege.works),'route',siege.assault_route) else null end
            ),(select auth.uid())) returning id into battle_id;
            for participant in select * from public.military_forces where id=any(siege.attacker_force_ids) and status='active' and force_kind='land_army' loop
                units_json:=coalesce((select jsonb_agg(jsonb_build_object('type',g->>'type','count',(g->>'count')::integer)) from jsonb_array_elements(participant.unit_groups) g),'[]'::jsonb);
                insert into public.military_battle_armies(battle_id,owner,side,name,unit_data,morale,order_name,tactic,decision)
                values(battle_id,participant.owner,'attacker',participant.name,jsonb_build_object('units',units_json,'skills',participant.commander_skills,'persistent_force_id',participant.id),participant.morale,participant.order_name,participant.tactic,'pending');
            end loop;
            for participant in select * from public.military_forces where marker_id=target.id and status='active' and force_kind='garrison' loop
                units_json:=coalesce((select jsonb_agg(jsonb_build_object('type',g->>'type','count',(g->>'count')::integer)) from jsonb_array_elements(participant.unit_groups) g),'[]'::jsonb);
                insert into public.military_battle_armies(battle_id,owner,side,name,unit_data,morale,order_name,tactic,decision)
                values(battle_id,participant.owner,'defender',participant.name,jsonb_build_object('units',units_json,'skills','{}'::jsonb),participant.morale,'осторожный','none','pending') returning id into participant_id;
                update public.military_battle_armies set persistent_force_id=participant.id where id=participant_id;
            end loop;
            update public.military_sieges set status='battle_pending',battle_id=battle_id where id=siege.id;
        end if;
        update public.military_sieges set attacker_order='blockade',defender_order='defend' where id=siege.id and status='active';
    end loop;
    return new;
end;
$function$;
revoke all on function public.resolve_military_sieges_on_turn() from public,anon,authenticated;
drop trigger if exists resolve_military_sieges_on_turn on public.game_calendar;
create trigger resolve_military_sieges_on_turn after update of turn on public.game_calendar for each row execute function public.resolve_military_sieges_on_turn();

