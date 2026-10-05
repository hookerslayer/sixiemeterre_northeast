alter table public.state_trade_contracts
    add column if not exists route_province_ids bigint[];

create or replace function public.save_state_trade_contract_route(
    p_contract_id bigint,
    p_route_province_ids bigint[] default null
) returns public.state_trade_contracts
language plpgsql
security definer
set search_path = ''
as $function$
declare
    caller_owner text;
    caller_role text;
    contract_row public.state_trade_contracts%rowtype;
    source_province_id bigint;
    destination_province_id bigint;
    existing_provinces bigint;
begin
    select p.owner, p.role into caller_owner, caller_role
      from public.profiles p
     where p.id = (select auth.uid());
    if caller_role is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;

    select * into contract_row
      from public.state_trade_contracts c
     where c.id = p_contract_id
     for update;
    if contract_row.id is null then raise exception 'Trade contract was not found'; end if;
    if contract_row.status not in ('pending', 'active') then
        raise exception 'Only pending or active trade routes can be changed';
    end if;
    if caller_role <> 'admin' and caller_owner not in (contract_row.seller_owner, contract_row.buyer_owner) then
        raise exception 'Only a trade participant can change this route' using errcode = '42501';
    end if;

    if p_route_province_ids is not null then
        if cardinality(p_route_province_ids) < 1 or cardinality(p_route_province_ids) > 200
           or array_position(p_route_province_ids, null) is not null
           or cardinality(p_route_province_ids) <> (select count(distinct u.id) from unnest(p_route_province_ids) as u(id)) then
            raise exception 'Route must contain 1 to 200 unique province IDs';
        end if;
        select s.province_id, d.province_id into source_province_id, destination_province_id
          from public.markers s, public.markers d
         where s.id = contract_row.source_marker_id and d.id = contract_row.destination_marker_id;
        if p_route_province_ids[1] is distinct from source_province_id
           or p_route_province_ids[cardinality(p_route_province_ids)] is distinct from destination_province_id then
            raise exception 'Route must start and end in the contract endpoint provinces';
        end if;
        select count(*) into existing_provinces
          from public."Provinces" p
         where p.id = any(p_route_province_ids);
        if existing_provinces <> cardinality(p_route_province_ids) then
            raise exception 'Route contains an unknown province';
        end if;
    end if;

    update public.state_trade_contracts
       set route_province_ids = p_route_province_ids,
           updated_at = now()
     where id = p_contract_id
     returning * into contract_row;
    return contract_row;
end;
$function$;

revoke all on function public.save_state_trade_contract_route(bigint, bigint[]) from public, anon;
grant execute on function public.save_state_trade_contract_route(bigint, bigint[]) to authenticated;
