do $migration$
declare
    definition text;
    anchor text := $anchor$if target_owner=profile.owner then raise exception 'Cannot target your own territory' using errcode='42501'; end if;$anchor$;
    replacement text := $replacement$if target_owner=profile.owner then raise exception 'Cannot target your own territory' using errcode='42501'; end if;
    if p_target_type='province' then
      if not exists (
        select 1
          from public.military_grid_cells target_cell
          join public.military_grid_cells own_cell
            on greatest(abs(target_cell.cell_x-own_cell.cell_x),abs(target_cell.cell_y-own_cell.cell_y))<=1
          join public."Provinces" own_province on own_province.id=own_cell.province_id and own_province.owner=profile.owner
         where target_cell.province_id=p_target_id and own_cell.province_id is distinct from target_cell.province_id
      ) then
        raise exception 'A province mission must target a province neighboring your state' using errcode='22023';
      end if;
    else
      if not exists (
        select 1 from public.state_trade_contracts contract
         where contract.status='active'
           and p_target_id in (contract.source_marker_id,contract.destination_marker_id)
           and ((contract.seller_owner=profile.owner and contract.buyer_owner=target_owner)
             or (contract.buyer_owner=profile.owner and contract.seller_owner=target_owner))
      ) then
        raise exception 'A settlement mission requires an active trade contract with that state' using errcode='22023';
      end if;
    end if;$replacement$;
begin
    select pg_get_functiondef('public.attempt_religious_mission(text,bigint)'::regprocedure) into definition;
    if definition is null then raise exception 'attempt_religious_mission(text,bigint) is not installed'; end if;
    if position(anchor in definition)=0 then raise exception 'Could not locate the territory ownership check in attempt_religious_mission'; end if;
    definition:=replace(definition,anchor,replacement);
    execute definition;
end;
$migration$;
