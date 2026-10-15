-- ONE-TIME DATA GRANT: do not rerun; this intentionally adds to existing stock.
-- Give every inhabited settlement 3,000 Grain and 500 of each ordinary resource.
-- No luxury resources or goods are added.
insert into public.marker_inventories(marker_id,item_type,item_name,quantity)
select m.id, 'resource', stock.item_name, stock.quantity
from public.markers m
cross join (values
    ('Зерно', 3000::numeric),
    ('Древесина', 500::numeric),
    ('Железная руда', 500::numeric),
    ('Скот', 500::numeric),
    ('Камень', 500::numeric),
    ('Соль', 500::numeric),
    ('Ворвань', 500::numeric),
    ('Мёд и Воск', 500::numeric),
    ('Морепродукты', 500::numeric),
    ('Лён', 500::numeric)
) as stock(item_name, quantity)
where m.type in ('city','large_city','monastery')
on conflict (marker_id,item_type,item_name)
do update set quantity = public.marker_inventories.quantity + excluded.quantity;
