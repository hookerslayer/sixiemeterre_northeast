-- Historical initial turn RPC. The newer economy_feedback_and_transport.sql
-- migration replaces this with tax settlement, local loyalty/population updates,
-- and route-aware reports. Apply the newer migration last.
-- Apply state-order costs as treasury deltas. Do not overwrite concurrently
-- edited player settings with the admin's browser snapshot.
create or replace function public.apply_economy_turn(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $function$
declare
    caller_role text;
    cal public.game_calendar%rowtype;
    row_data jsonb;
    owner_name text;
    report_data jsonb;
    treasury_delta numeric;
begin
    select role into caller_role from public.profiles where id=(select auth.uid());
    if caller_role is distinct from 'admin' then raise exception 'Only an administrator can advance the game turn' using errcode = '42501'; end if;
    select * into cal from public.game_calendar where singleton=true for update;
    if p_payload->'processed_calendar'->>'turn' is distinct from cal.turn::text
       or p_payload->'processed_calendar'->>'season' is distinct from cal.season
       or p_payload->'processed_calendar'->>'year' is distinct from cal.year::text then
        raise exception 'Calendar changed; reload and recalculate the turn' using errcode = '40001';
    end if;
    if jsonb_typeof(p_payload->'inventoryUpdates') <> 'array'
       or jsonb_typeof(p_payload->'provinceUpdates') <> 'array'
       or jsonb_array_length(p_payload->'inventoryUpdates') > 20000
       or jsonb_array_length(p_payload->'provinceUpdates') > 1000 then raise exception 'Invalid economy payload'; end if;

    delete from public.marker_inventories;
    for row_data in select value from jsonb_array_elements(p_payload->'inventoryUpdates') loop
        if (row_data->>'quantity')::numeric < 0 or row_data->>'item_type' not in ('resource','good') then raise exception 'Invalid inventory row'; end if;
        insert into public.marker_inventories(marker_id,item_type,item_name,quantity)
        values ((row_data->>'marker_id')::bigint,row_data->>'item_type',row_data->>'item_name',(row_data->>'quantity')::numeric)
        on conflict (marker_id,item_type,item_name) do update set quantity=excluded.quantity;
    end loop;
    for row_data in select value from jsonb_array_elements(p_payload->'provinceUpdates') loop
        update public."Provinces" set target_marker_id=nullif(row_data->>'target_marker_id','')::bigint,
            stored_resource_qty=(row_data->>'stored_resource_qty')::numeric
        where id=(row_data->>'id')::bigint;
    end loop;

    for owner_name, report_data in select key, value from jsonb_each(p_payload->'ownerReports') loop
        insert into public.turn_economy_reports(owner,turn,season,year,report)
        values(owner_name,cal.turn,cal.season,cal.year,report_data)
        on conflict(owner,turn,season,year) do update set report=excluded.report,created_at=now();
    end loop;
    for owner_name, report_data in select key,value from jsonb_each(p_payload->'treasuryAdjustments') loop
        treasury_delta := report_data::text::numeric;
        update public.state_mechanics sm
        set settings = sm.settings || jsonb_build_object(
            'economy', coalesce(sm.settings->'economy','{}'::jsonb) || jsonb_build_object(
                'treasury', greatest(0,coalesce((sm.settings#>>'{economy,treasury}')::numeric,0)+treasury_delta)
            )
        ), updated_at=now()
        where sm.owner=owner_name and treasury_delta<>0;
    end loop;

    update public.game_calendar set turn=cal.turn+1,
        year=cal.year+case when cal.season='Осень' then 1 else 0 end,
        season=case cal.season when 'Осень' then 'Зима' when 'Зима' then 'Весна' when 'Весна' then 'Лето' else 'Осень' end,
        updated_at=now() where singleton=true returning * into cal;
    if cal.year > (p_payload->'processed_calendar'->>'year')::integer then
        update public.state_mechanics sm set settings=jsonb_set(sm.settings,'{ruler,age}',
            to_jsonb(least(150,coalesce((sm.settings#>>'{ruler,age}')::integer,0)+1)),true),
            updated_at=now()
        where sm.settings ? 'ruler' and sm.settings#>'{ruler}' is not null;
    end if;
    return jsonb_build_object('turn',cal.turn,'season',cal.season,'year',cal.year);
end;
$function$;
revoke all on function public.apply_economy_turn(jsonb) from public, anon;
grant execute on function public.apply_economy_turn(jsonb) to authenticated;
