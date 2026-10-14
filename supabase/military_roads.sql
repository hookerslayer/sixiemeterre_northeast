-- Province-to-province roads improve supply capacity after one season of work.
create table if not exists public.military_roads (
    id bigint generated always as identity primary key,
    owner text not null references public.state_mechanics(owner) on delete cascade,
    province_a bigint not null references public."Provinces"(id) on delete cascade,
    province_b bigint not null references public."Provinces"(id) on delete cascade,
    available_from_turn integer not null,
    created_at timestamptz not null default now(),
    check (province_a < province_b),
    unique(owner,province_a,province_b)
);
create index if not exists military_roads_owner_turn_idx on public.military_roads(owner,available_from_turn);

alter table public.military_roads enable row level security;
drop policy if exists "Military roads are visible to authenticated players" on public.military_roads;
create policy "Military roads are visible to authenticated players" on public.military_roads
    for select to authenticated using (true);
revoke all on public.military_roads from anon, authenticated;
grant select on public.military_roads to authenticated;

create or replace function public.build_military_road_segment(p_province_a bigint,p_province_b bigint,p_source_marker_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_profile public.profiles%rowtype;
    v_calendar public.game_calendar%rowtype;
    v_a public."Provinces"%rowtype;
    v_b public."Provinces"%rowtype;
    v_marker public.markers%rowtype;
    v_treasury numeric;
    v_wood numeric;
    v_tools numeric;
    v_road_id bigint;
    v_low bigint;
    v_high bigint;
begin
    select * into v_profile from public.profiles where id=(select auth.uid());
    if not found or v_profile.role <> 'player' or nullif(v_profile.owner,'') is null then
        raise exception 'Only a state player can build military roads' using errcode='42501';
    end if;
    if p_province_a is null or p_province_b is null or p_province_a=p_province_b then raise exception 'Choose two different provinces' using errcode='22023'; end if;
    v_low := least(p_province_a,p_province_b); v_high := greatest(p_province_a,p_province_b);
    select * into v_a from public."Provinces" where id=v_low for share;
    select * into v_b from public."Provinces" where id=v_high for share;
    if not found or v_a.owner is distinct from v_profile.owner or v_b.owner is distinct from v_profile.owner
       or v_a.occupied_by is not null or v_b.occupied_by is not null then
        raise exception 'Both provinces must be under your uncontested control' using errcode='42501';
    end if;
    if not exists (
        select 1 from public.military_grid_cells a join public.military_grid_cells b
          on abs(a.cell_x-b.cell_x)+abs(a.cell_y-b.cell_y)=1
         where a.province_id=v_low and b.province_id=v_high
    ) then raise exception 'The selected provinces are not adjacent on the military map' using errcode='22023'; end if;
    if exists(select 1 from public.military_roads where owner=v_profile.owner and province_a=v_low and province_b=v_high) then
        raise exception 'A road already exists or is under construction on this border' using errcode='23505';
    end if;
    select * into v_marker from public.markers where id=p_source_marker_id for update;
    if not found or v_marker.owner is distinct from v_profile.owner or v_marker.type='ruins' then
        raise exception 'Choose a working settlement under your control as the supply source' using errcode='42501';
    end if;
    select * into v_calendar from public.game_calendar where singleton=true;
    select coalesce((settings#>>'{economy,treasury}')::numeric,0) into v_treasury
      from public.state_mechanics where owner=v_profile.owner for update;
    v_treasury:=coalesce(v_treasury,0);
    select coalesce(quantity,0) into v_wood from public.marker_inventories where marker_id=p_source_marker_id and item_type='resource' and item_name='Древесина' for update;
    select coalesce(quantity,0) into v_tools from public.marker_inventories where marker_id=p_source_marker_id and item_type='good' and item_name='Инструменты' for update;
    v_wood:=coalesce(v_wood,0); v_tools:=coalesce(v_tools,0);
    if v_treasury<400 or v_wood<30 or v_tools<5 then
        raise exception 'Недостаточно средств: требуется 400 z, 30 Древесины и 5 Инструментов' using errcode='22023';
    end if;
    update public.state_mechanics set settings=jsonb_set(settings,'{economy,treasury}',to_jsonb(v_treasury-400),true),updated_at=now() where owner=v_profile.owner;
    update public.marker_inventories set quantity=quantity-30 where marker_id=p_source_marker_id and item_type='resource' and item_name='Древесина';
    update public.marker_inventories set quantity=quantity-5 where marker_id=p_source_marker_id and item_type='good' and item_name='Инструменты';
    insert into public.military_roads(owner,province_a,province_b,available_from_turn)
    values(v_profile.owner,v_low,v_high,v_calendar.turn+1) returning id into v_road_id;
    return jsonb_build_object('id',v_road_id,'owner',v_profile.owner,'province_a',v_low,'province_b',v_high,
        'available_from_turn',v_calendar.turn+1,'paid_treasury',400,'paid_wood',30,'paid_tools',5);
end;
$function$;

revoke all on function public.build_military_road_segment(bigint,bigint,bigint) from public,anon;
grant execute on function public.build_military_road_segment(bigint,bigint,bigint) to authenticated;
