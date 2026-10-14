-- Filter enemy formations through the military map's seasonal visibility.
create or replace function public.get_visible_military_forces()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_profile public.profiles%rowtype;
    v_result jsonb;
begin
    select * into v_profile from public.profiles where id = (select auth.uid());
    if not found or v_profile.role not in ('player', 'admin') then
        raise exception 'Player authentication required' using errcode = '42501';
    end if;
    if v_profile.role = 'admin' then
        select jsonb_build_object(
            'forces', coalesce((select jsonb_agg(to_jsonb(force)) from public.military_forces force where force.status = 'active'), '[]'::jsonb),
            'visible_cells', coalesce((select jsonb_agg(jsonb_build_object('x',cell.cell_x,'y',cell.cell_y)) from public.military_grid_cells cell), '[]'::jsonb)
        ) into v_result;
        return v_result;
    end if;
    if nullif(v_profile.owner, '') is null then raise exception 'State player has no state' using errcode = '42501'; end if;

    with controlled as (
        select grid.cell_x, grid.cell_y
          from public.military_grid_cells grid
          join public."Provinces" province on province.id = grid.province_id
         where province.owner = v_profile.owner or province.occupied_by = v_profile.owner
    ), territory_open as (
        select cell_x, cell_y from controlled
        union
        select neighbor.cell_x, neighbor.cell_y
          from public.military_grid_cells neighbor
          join controlled own on abs(neighbor.cell_x-own.cell_x) <= 1 and abs(neighbor.cell_y-own.cell_y) <= 1
    ), observers as (
        select force.cell_x, force.cell_y,
               coalesce(terrain.terrain, grid.base_terrain) as terrain,
               case when coalesce(terrain.terrain, grid.base_terrain) = 'hill' then 3 else 2 end as radius
          from public.military_forces force
          join public.military_grid_cells grid on grid.cell_x = force.cell_x and grid.cell_y = force.cell_y
          left join public.military_terrain_cells terrain on terrain.cell_x = force.cell_x and terrain.cell_y = force.cell_y
         where force.owner = v_profile.owner and force.force_kind = 'land_army' and force.status = 'active'
        union all
        select structure.cell_x, structure.cell_y,
               coalesce(terrain.terrain, grid.base_terrain) as terrain, 2 as radius
          from public.military_structures structure
          join public.military_grid_cells grid on grid.cell_x=structure.cell_x and grid.cell_y=structure.cell_y
          left join public.military_terrain_cells terrain on terrain.cell_x=structure.cell_x and terrain.cell_y=structure.cell_y
         where structure.owner=v_profile.owner and structure.structure_type='watchtower'
           and structure.status='active' and structure.available_from_turn <= (select turn from public.game_calendar where singleton=true)
        union all
        select structure.cell_x, structure.cell_y,
               coalesce(terrain.terrain, grid.base_terrain) as terrain, 1 as radius
          from public.military_structures structure
          join public.military_grid_cells grid on grid.cell_x=structure.cell_x and grid.cell_y=structure.cell_y
          left join public.military_terrain_cells terrain on terrain.cell_x=structure.cell_x and terrain.cell_y=structure.cell_y
         where structure.owner=v_profile.owner and structure.structure_type='camp'
           and structure.status='active' and structure.available_from_turn <= (select turn from public.game_calendar where singleton=true)
    ), army_vision as (
        select distinct target.cell_x, target.cell_y
          from public.military_grid_cells target
          join observers observer on greatest(abs(target.cell_x-observer.cell_x),abs(target.cell_y-observer.cell_y)) <= observer.radius
         where (
             coalesce((select terrain.terrain from public.military_terrain_cells terrain where terrain.cell_x=target.cell_x and terrain.cell_y=target.cell_y),target.base_terrain) <> 'forest'
             or exists (
                 select 1 from observers adjacent_observer
                 where greatest(abs(target.cell_x-adjacent_observer.cell_x),abs(target.cell_y-adjacent_observer.cell_y)) <= 1
                   and adjacent_observer.terrain in ('forest','hill')
             )
         ) and not exists (
             select 1
               from generate_series(1, greatest(abs(target.cell_x-observer.cell_x),abs(target.cell_y-observer.cell_y))-1) as step_no
               cross join lateral (
                   select round(observer.cell_x + (target.cell_x-observer.cell_x) * step_no::numeric /
                       greatest(abs(target.cell_x-observer.cell_x),abs(target.cell_y-observer.cell_y)))::integer as x,
                          round(observer.cell_y + (target.cell_y-observer.cell_y) * step_no::numeric /
                       greatest(abs(target.cell_x-observer.cell_x),abs(target.cell_y-observer.cell_y)))::integer as y
               ) point
               left join public.military_grid_cells blocker_grid on blocker_grid.cell_x=point.x and blocker_grid.cell_y=point.y
               left join public.military_terrain_cells blocker on blocker.cell_x=point.x and blocker.cell_y=point.y
              where coalesce(blocker.terrain,blocker_grid.base_terrain) in ('forest','hill')
         )
    ), visible as (
        select cell_x, cell_y from territory_open
        union
        select cell_x, cell_y from army_vision
    )
    select jsonb_build_object(
        'forces', coalesce((
            select jsonb_agg(to_jsonb(force))
              from public.military_forces force
             where force.status = 'active'
               and (force.owner = v_profile.owner or exists (
                   select 1 from visible where visible.cell_x=force.cell_x and visible.cell_y=force.cell_y
               ))
        ), '[]'::jsonb),
        'visible_cells', coalesce((select jsonb_agg(jsonb_build_object('x',cell_x,'y',cell_y)) from visible), '[]'::jsonb)
    ) into v_result;
    return v_result;
end;
$function$;

revoke all on function public.get_visible_military_forces() from public, anon;
grant execute on function public.get_visible_military_forces() to authenticated;
