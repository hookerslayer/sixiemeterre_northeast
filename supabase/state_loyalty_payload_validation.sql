-- Persist state-wide loyalty changes atomically with economy turns.
-- Territorial loyalty remains unused; shortages only affect state-level values.

create or replace function public.apply_economy_turn(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
    caller_role text;
    cal public.game_calendar%rowtype;
    row_data jsonb;
    owner_name text;
    report_data jsonb;
    treasury_delta numeric;
    local_loyalty jsonb;
begin
    select p.role into caller_role from public.profiles p where p.id=(select auth.uid());
    if caller_role is distinct from 'admin' then raise exception 'Only an administrator can advance the game turn' using errcode='42501'; end if;
    select * into cal from public.game_calendar where singleton=true for update;
    if p_payload->'processed_calendar'->>'turn' is distinct from cal.turn::text
       or p_payload->'processed_calendar'->>'season' is distinct from cal.season
       or p_payload->'processed_calendar'->>'year' is distinct from cal.year::text then
        raise exception 'Calendar changed; reload and recalculate the turn' using errcode='40001';
    end if;
    if jsonb_typeof(p_payload->'inventoryUpdates')<>'array' or jsonb_typeof(p_payload->'provinceUpdates')<>'array'
       or jsonb_typeof(p_payload->'markerUpdates')<>'array' or jsonb_typeof(p_payload->'territoryLoyaltyUpdates')<>'array'
       or jsonb_typeof(p_payload->'ownerReports')<>'object' or jsonb_typeof(p_payload->'treasuryAdjustments')<>'object'
       or jsonb_typeof(coalesce(p_payload->'stateLoyaltyUpdates','{}'::jsonb))<>'object'
       or jsonb_array_length(p_payload->'inventoryUpdates')>20000 or jsonb_array_length(p_payload->'provinceUpdates')>1000
       or jsonb_array_length(p_payload->'markerUpdates')>1000 or jsonb_array_length(p_payload->'territoryLoyaltyUpdates')>2000
       or jsonb_object_length(coalesce(p_payload->'stateLoyaltyUpdates','{}'::jsonb))>100 then raise exception 'Invalid economy payload'; end if;

    delete from public.marker_inventories;
    for row_data in select value from jsonb_array_elements(p_payload->'inventoryUpdates') loop
        if (row_data->>'quantity')::numeric<0 or row_data->>'item_type' not in ('resource','good') then raise exception 'Invalid inventory row'; end if;
        insert into public.marker_inventories(marker_id,item_type,item_name,quantity)
        values((row_data->>'marker_id')::bigint,row_data->>'item_type',row_data->>'item_name',(row_data->>'quantity')::numeric)
        on conflict(marker_id,item_type,item_name) do update set quantity=excluded.quantity;
    end loop;
    for row_data in select value from jsonb_array_elements(p_payload->'provinceUpdates') loop
        if coalesce((row_data->>'yards')::numeric,0)<0 or coalesce((row_data->>'stored_resource_qty')::numeric,0)<0 then raise exception 'Invalid province state'; end if;
        update public."Provinces" set yards=coalesce((row_data->>'yards')::bigint,yards),target_marker_id=nullif(row_data->>'target_marker_id','')::bigint,
            stored_resource_qty=(row_data->>'stored_resource_qty')::numeric where id=(row_data->>'id')::bigint;
    end loop;
    for row_data in select value from jsonb_array_elements(p_payload->'markerUpdates') loop
        if coalesce((row_data->>'yards')::numeric,0)<0 then raise exception 'Invalid settlement population'; end if;
        update public.markers set yards=coalesce((row_data->>'yards')::bigint,yards) where id=(row_data->>'id')::bigint;
    end loop;
    for row_data in select value from jsonb_array_elements(p_payload->'territoryLoyaltyUpdates') loop
        if row_data->>'territory_type' not in ('province','marker') then raise exception 'Invalid loyalty territory'; end if;
        local_loyalty=jsonb_build_object(
            'aristocracy',greatest(0,least(100,coalesce((row_data->'loyalty'->>'aristocracy')::numeric,100))),
            'clergy',greatest(0,least(100,coalesce((row_data->'loyalty'->>'clergy')::numeric,100))),
            'burghers',greatest(0,least(100,coalesce((row_data->'loyalty'->>'burghers')::numeric,100))),
            'peasants',greatest(0,least(100,coalesce((row_data->'loyalty'->>'peasants')::numeric,100))));
        insert into public.territory_loyalty(territory_type,territory_id,loyalty,updated_at)
        values(row_data->>'territory_type',(row_data->>'territory_id')::bigint,local_loyalty,now())
        on conflict(territory_type,territory_id) do update set loyalty=excluded.loyalty,updated_at=now();
    end loop;
    for owner_name,report_data in select key,value from jsonb_each(coalesce(p_payload->'stateLoyaltyUpdates','{}'::jsonb)) loop
        if jsonb_typeof(report_data) is distinct from 'object'
           or exists(select 1 from jsonb_object_keys(report_data) as keys(key) where key not in ('aristocracy','clergy','burghers','peasants'))
           or not (report_data ?& array['aristocracy','clergy','burghers','peasants'])
           or jsonb_typeof(report_data->'aristocracy') is distinct from 'number' or jsonb_typeof(report_data->'clergy') is distinct from 'number'
           or jsonb_typeof(report_data->'burghers') is distinct from 'number' or jsonb_typeof(report_data->'peasants') is distinct from 'number'
           or (report_data->>'aristocracy')::numeric not between 0 and 100
           or (report_data->>'clergy')::numeric not between 0 and 100
           or (report_data->>'burghers')::numeric not between 0 and 100
           or (report_data->>'peasants')::numeric not between 0 and 100 then raise exception 'Invalid state loyalty values'; end if;
        update public.state_mechanics set settings=jsonb_set(settings,'{estate_loyalty}',report_data,true),updated_at=now() where owner=owner_name;
        if not found then raise exception 'State mechanics not found'; end if;
    end loop;
    for owner_name,report_data in select key,value from jsonb_each(p_payload->'ownerReports') loop
        insert into public.turn_economy_reports(owner,turn,season,year,report) values(owner_name,cal.turn,cal.season,cal.year,report_data)
        on conflict(owner,turn,season,year) do update set report=excluded.report,created_at=now();
    end loop;
    for owner_name,report_data in select key,value from jsonb_each(p_payload->'treasuryAdjustments') loop
        treasury_delta=report_data::text::numeric;
        update public.state_mechanics sm set settings=sm.settings||jsonb_build_object('economy',coalesce(sm.settings->'economy','{}'::jsonb)||jsonb_build_object('treasury',greatest(0,coalesce((sm.settings#>>'{economy,treasury}')::numeric,0)+treasury_delta))),updated_at=now()
        where sm.owner=owner_name and treasury_delta<>0;
    end loop;
    update public.game_calendar set turn=cal.turn+1,year=cal.year+case when cal.season='Осень' then 1 else 0 end,
        season=case cal.season when 'Осень' then 'Зима' when 'Зима' then 'Весна' when 'Весна' then 'Лето' else 'Осень' end,
        updated_at=now() where singleton=true returning * into cal;
    if cal.year>(p_payload->'processed_calendar'->>'year')::integer then
        update public.state_mechanics sm set settings=jsonb_set(sm.settings,'{ruler,age}',to_jsonb(least(150,coalesce((sm.settings#>>'{ruler,age}')::integer,0)+1)),true),updated_at=now()
        where sm.settings?'ruler' and sm.settings#>'{ruler}' is not null;
    end if;
    return jsonb_build_object('turn',cal.turn,'season',cal.season,'year',cal.year);
end;
$function$;
revoke all on function public.apply_economy_turn(jsonb) from public,anon;
grant execute on function public.apply_economy_turn(jsonb) to authenticated;
