-- Loot carried by a raiding army is deposited when it enters a friendly settlement province.
create or replace function public.deliver_military_raid_cargo()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
    destination public.markers%rowtype;
    cargo_item record;
begin
    if new.force_kind<>'land_army' or new.status<>'active' or coalesce(new.cargo,'{}'::jsonb)='{}'::jsonb then return new; end if;
    if old.cell_x is not distinct from new.cell_x and old.cell_y is not distinct from new.cell_y then return new; end if;
    select marker.* into destination from public.markers marker
    where marker.province_id=new.province_id and marker.owner=new.owner and marker.type<>'ruins'
      and coalesce(marker.military_controlled_by,marker.owner)=new.owner
    order by case marker.type when 'large_city' then 1 when 'city' then 2 when 'fortress' then 3 else 4 end, marker.id
    limit 1;
    if not found then return new; end if;
    for cargo_item in select key as item_name, value::text::numeric as quantity from jsonb_each(new.cargo) loop
        if cargo_item.quantity>0 then
            insert into public.marker_inventories(marker_id,item_type,item_name,quantity)
            values(destination.id,'resource',cargo_item.item_name,cargo_item.quantity)
            on conflict(marker_id,item_type,item_name) do update set quantity=public.marker_inventories.quantity+excluded.quantity;
        end if;
    end loop;
    update public.military_raid_loot loot set destination_marker_id=destination.id
    from public.military_raids raid where loot.raid_id=raid.id and raid.force_id=new.id and loot.destination_marker_id is null;
    update public.military_forces set cargo='{}'::jsonb,updated_at=now() where id=new.id;
    return new;
end;
$function$;
revoke all on function public.deliver_military_raid_cargo() from public,anon,authenticated;
drop trigger if exists deliver_military_raid_cargo on public.military_forces;
create trigger deliver_military_raid_cargo after update of cell_x,cell_y on public.military_forces
for each row execute function public.deliver_military_raid_cargo();
