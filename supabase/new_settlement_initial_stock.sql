-- Give every newly created inhabited settlement the standard starting stock.
-- Excludes ruins and all luxury resources/goods.
create or replace function public.seed_new_settlement_initial_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
    if new.type in ('city','large_city','monastery','fortress') then
        insert into public.marker_inventories(marker_id,item_type,item_name,quantity)
        values
            (new.id,'resource','Зерно',3000),
            (new.id,'resource','Древесина',500),
            (new.id,'resource','Железная руда',500),
            (new.id,'resource','Скот',500),
            (new.id,'resource','Камень',500),
            (new.id,'resource','Соль',500),
            (new.id,'resource','Ворвань',500),
            (new.id,'resource','Мёд и Воск',500),
            (new.id,'resource','Морепродукты',500),
            (new.id,'resource','Лён',500)
        on conflict (marker_id,item_type,item_name) do nothing;
    end if;
    return new;
end;
$function$;

drop trigger if exists markers_seed_initial_inventory on public.markers;
create trigger markers_seed_initial_inventory
after insert on public.markers
for each row execute function public.seed_new_settlement_initial_stock();
