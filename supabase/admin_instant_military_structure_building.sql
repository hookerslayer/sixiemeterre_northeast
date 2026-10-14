create or replace function public.admin_build_military_structure(p_type text,p_cell_x integer,p_cell_y integer,p_owner text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare
    profile public.profiles%rowtype;
    grid public.military_grid_cells%rowtype;
    terrain text;
    province_id bigint;
    current_turn integer;
    structure_id bigint;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role<>'admin' then raise exception 'Only an administrator can instantly place structures' using errcode='42501'; end if;
    if p_type not in ('bridge','camp','watchtower','palisade','ferry') then raise exception 'Unknown structure type' using errcode='22023'; end if;
    if not exists(select 1 from public.state_mechanics where owner=p_owner) then raise exception 'Choose an existing state' using errcode='22023'; end if;
    select * into grid from public.military_grid_cells where cell_x=p_cell_x and cell_y=p_cell_y;
    if not found then raise exception 'Synchronize the military grid before building' using errcode='55000'; end if;
    select coalesce(t.terrain,grid.base_terrain),coalesce(t.province_id,grid.province_id) into terrain,province_id
    from public.military_grid_cells g left join public.military_terrain_cells t on t.cell_x=g.cell_x and t.cell_y=g.cell_y
    where g.cell_x=p_cell_x and g.cell_y=p_cell_y;
    if p_type='bridge' and terrain<>'water' then raise exception 'A bridge must be placed on a water crossing cell' using errcode='22023'; end if;
    if p_type<>'bridge' and terrain='water' then raise exception 'This structure must be built on land' using errcode='22023'; end if;
    if exists(select 1 from public.military_structures where cell_x=p_cell_x and cell_y=p_cell_y and status in ('building','active','broken')) then raise exception 'This cell already contains a structure' using errcode='23505'; end if;
    select turn into current_turn from public.game_calendar where singleton=true;
    insert into public.military_structures(owner,structure_type,cell_x,cell_y,province_id,status,available_from_turn)
    values(p_owner,p_type,p_cell_x,p_cell_y,province_id,'active',current_turn) returning id into structure_id;
    return jsonb_build_object('id',structure_id,'owner',p_owner,'structure_type',p_type,'cell_x',p_cell_x,'cell_y',p_cell_y,'status','active','available_from_turn',current_turn,'paid_treasury',0,'paid_wood',0,'paid_tools',0);
end;
$function$;
revoke all on function public.admin_build_military_structure(text,integer,integer,text) from public,anon;
grant execute on function public.admin_build_military_structure(text,integer,integer,text) to authenticated;
