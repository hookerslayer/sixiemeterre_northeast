-- The current 4224x3103 map at 24px per cell contains about 22,880 cells.
-- Allow the complete grid to be synchronized in one atomic RPC call.
create or replace function public.sync_military_grid_cells(p_cells jsonb)
returns integer language plpgsql security definer set search_path = '' as $function$
declare
    v_count integer;
begin
    if not exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='admin') then
        raise exception 'Only an administrator can synchronize military grid geometry' using errcode='42501';
    end if;
    if jsonb_typeof(p_cells) is distinct from 'array' or jsonb_array_length(p_cells) not between 1 and 50000 then
        raise exception 'Provide between 1 and 50,000 grid cells' using errcode='22023';
    end if;
    if exists (
        select 1 from jsonb_to_recordset(p_cells) as cell(cell_x integer,cell_y integer,province_id bigint,base_terrain text,river_edges integer,water_coverage numeric,water_types integer)
        where cell.cell_x is null or cell.cell_y is null or cell.cell_x not between 0 and 10000 or cell.cell_y not between 0 and 10000
           or cell.base_terrain not in ('plain','water') or coalesce(cell.river_edges,0) not between 0 and 255
           or coalesce(cell.water_coverage,0) not between 0 and 1 or coalesce(cell.water_types,0) not between 0 and 7
    ) then raise exception 'Grid geometry contains invalid coordinates or values' using errcode='22023'; end if;
    insert into public.military_grid_cells(cell_x,cell_y,province_id,base_terrain,river_edges,water_coverage,water_types,updated_at)
    select cell.cell_x,cell.cell_y,cell.province_id,cell.base_terrain,coalesce(cell.river_edges,0),coalesce(cell.water_coverage,0),coalesce(cell.water_types,0),now()
      from jsonb_to_recordset(p_cells) as cell(cell_x integer,cell_y integer,province_id bigint,base_terrain text,river_edges integer,water_coverage numeric,water_types integer)
    on conflict (cell_x,cell_y) do update set
        province_id=excluded.province_id,
        base_terrain=excluded.base_terrain,
        river_edges=excluded.river_edges,
        water_coverage=excluded.water_coverage,
        water_types=excluded.water_types,
        updated_at=excluded.updated_at;
    get diagnostics v_count=row_count;
    -- Remove only geometry cells absent from the new map snapshot. Terrain
    -- overrides and hand-mapped current directions live in separate tables.
    delete from public.military_grid_cells grid
     where not exists (
         select 1 from jsonb_to_recordset(p_cells) as cell(cell_x integer,cell_y integer)
          where cell.cell_x=grid.cell_x and cell.cell_y=grid.cell_y
     );
    return v_count;
end;
$function$;
revoke all on function public.sync_military_grid_cells(jsonb) from public,anon;
grant execute on function public.sync_military_grid_cells(jsonb) to authenticated;
