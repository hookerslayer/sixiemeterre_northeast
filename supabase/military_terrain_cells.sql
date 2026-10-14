-- Sparse terrain overrides for the 24 px military grid. Unmarked land cells
-- are plains; water is inferred from the province map at the cell centre.
create table if not exists public.military_terrain_cells (
    cell_x integer not null check (cell_x between 0 and 10000),
    cell_y integer not null check (cell_y between 0 and 10000),
    province_id bigint references public."Provinces"(id) on delete set null,
    terrain text not null check (terrain in ('plain', 'water', 'hill', 'forest', 'marsh')),
    bridge boolean not null default false,
    updated_by uuid references auth.users(id),
    updated_at timestamptz not null default now(),
    primary key (cell_x, cell_y),
    check (not bridge or terrain = 'water')
);

alter table public.military_terrain_cells enable row level security;
drop policy if exists "Military terrain is readable" on public.military_terrain_cells;
create policy "Military terrain is readable" on public.military_terrain_cells
    for select to anon, authenticated using (true);
revoke all on public.military_terrain_cells from anon, authenticated;
grant select on public.military_terrain_cells to anon, authenticated;

create or replace function public.set_military_terrain_cell(
    p_cell_x integer,
    p_cell_y integer,
    p_province_id bigint,
    p_terrain text,
    p_bridge boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
    caller_role text;
begin
    select profile.role into caller_role
      from public.profiles as profile
     where profile.id = (select auth.uid());
    if caller_role is distinct from 'admin' then
        raise exception 'Only an administrator can edit military terrain' using errcode = '42501';
    end if;
    if p_cell_x is null or p_cell_y is null or p_cell_x < 0 or p_cell_y < 0
       or p_cell_x > 10000 or p_cell_y > 10000 then
        raise exception 'Invalid military grid coordinates' using errcode = '22023';
    end if;
    if p_terrain not in ('plain', 'water', 'hill', 'forest', 'marsh') then
        raise exception 'Invalid military terrain type' using errcode = '22023';
    end if;
    if coalesce(p_bridge, false) and p_terrain <> 'water' then
        raise exception 'A bridge can only be placed on a water cell' using errcode = '22023';
    end if;
    if p_province_id is not null and not exists (
        select 1 from public."Provinces" as province where province.id = p_province_id
    ) then
        raise exception 'Province not found' using errcode = '22023';
    end if;

    -- Store even an explicit plain override so an administrator can correct
    -- an automatically misclassified water cell and keep that correction.
    insert into public.military_terrain_cells (cell_x, cell_y, province_id, terrain, bridge, updated_by, updated_at)
    values (p_cell_x, p_cell_y, p_province_id, p_terrain, coalesce(p_bridge, false), (select auth.uid()), now())
    on conflict (cell_x, cell_y) do update
      set province_id = excluded.province_id,
          terrain = excluded.terrain,
          bridge = excluded.bridge,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at;
end;
$function$;

revoke all on function public.set_military_terrain_cell(integer, integer, bigint, text, boolean) from public, anon;
grant execute on function public.set_military_terrain_cell(integer, integer, bigint, text, boolean) to authenticated;
