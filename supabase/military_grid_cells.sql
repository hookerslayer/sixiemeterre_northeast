-- Server-readable geometry for military movement and line-of-sight rules.
create table if not exists public.military_grid_cells (
    cell_x integer not null check (cell_x between 0 and 10000),
    cell_y integer not null check (cell_y between 0 and 10000),
    province_id bigint references public."Provinces"(id) on delete set null,
    base_terrain text not null check (base_terrain in ('plain','water')),
    river_edges integer not null default 0 check (river_edges between 0 and 255),
    water_coverage numeric(5,4) not null default 0 check (water_coverage between 0 and 1),
    updated_at timestamptz not null default now(),
    primary key (cell_x, cell_y)
);

alter table public.military_grid_cells enable row level security;
drop policy if exists "Military grid geometry is readable" on public.military_grid_cells;
create policy "Military grid geometry is readable" on public.military_grid_cells
    for select to anon, authenticated using (true);
revoke all on public.military_grid_cells from anon, authenticated;
grant select on public.military_grid_cells to anon, authenticated;

create or replace function public.sync_military_grid_cells(p_cells jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_count integer;
begin
    if not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin') then
        raise exception 'Only an administrator can synchronize military grid geometry' using errcode = '42501';
    end if;
    if jsonb_typeof(p_cells) is distinct from 'array' then
        raise exception 'Grid geometry must be an array' using errcode = '22023';
    end if;
    if jsonb_array_length(p_cells) < 1 or jsonb_array_length(p_cells) > 10000 then
        raise exception 'Provide between 1 and 10000 grid cells' using errcode = '22023';
    end if;
    if exists (
        select 1 from jsonb_to_recordset(p_cells) as cell(cell_x integer, cell_y integer, base_terrain text, river_edges integer, water_coverage numeric)
        where cell.cell_x is null or cell.cell_y is null or cell.cell_x < 0 or cell.cell_y < 0
           or cell.cell_x > 10000 or cell.cell_y > 10000
           or cell.base_terrain not in ('plain','water')
           or coalesce(cell.river_edges,0) not between 0 and 255
           or coalesce(cell.water_coverage,0) not between 0 and 1
    ) then
        raise exception 'Grid geometry contains invalid coordinates or values' using errcode = '22023';
    end if;
    delete from public.military_grid_cells;
    insert into public.military_grid_cells(cell_x,cell_y,province_id,base_terrain,river_edges,water_coverage,updated_at)
    select cell.cell_x,cell.cell_y,cell.province_id,cell.base_terrain,coalesce(cell.river_edges,0),coalesce(cell.water_coverage,0),now()
      from jsonb_to_recordset(p_cells) as cell(cell_x integer, cell_y integer, province_id bigint, base_terrain text, river_edges integer, water_coverage numeric);
    get diagnostics v_count = row_count;
    return v_count;
end;
$function$;

revoke all on function public.sync_military_grid_cells(jsonb) from public, anon;
grant execute on function public.sync_military_grid_cells(jsonb) to authenticated;
