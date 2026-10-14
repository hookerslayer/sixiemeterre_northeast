-- Preserve explicit administrator assignments to plain terrain.
-- Apply after military_terrain_cells.sql.
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

    insert into public.military_terrain_cells (cell_x, cell_y, province_id, terrain, bridge, updated_by, updated_at)
    values (p_cell_x, p_cell_y, p_province_id, p_terrain, coalesce(p_bridge, false), (select auth.uid()), now())
    on conflict (cell_x, cell_y) do update
      set province_id = excluded.province_id,
          terrain = excluded.terrain,
          bridge = excluded.bridge,
          updated_by = excluded.updated_by,
          updated_at = now();
end;
$function$;

revoke all on function public.set_military_terrain_cell(integer, integer, bigint, text, boolean) from public, anon;
grant execute on function public.set_military_terrain_cell(integer, integer, bigint, text, boolean) to authenticated;
