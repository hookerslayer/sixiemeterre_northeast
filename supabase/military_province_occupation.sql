-- Provincial control follows the foreign field armies physically present there.
create or replace function public.sync_military_province_occupation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    province_key bigint;
begin
    if tg_op <> 'INSERT' then
        province_key := old.province_id;
        if province_key is not null then
            update public."Provinces" province
               set occupied_by = (
                   select force.owner
                     from public.military_forces force
                    where force.force_kind='land_army' and force.status='active'
                      and force.province_id=province.id and force.owner<>province.owner
                    group by force.owner
                    order by sum(coalesce((select sum(greatest(0,(unit.value->>'count')::numeric)) from jsonb_array_elements(force.unit_groups) unit(value)),0)) desc, force.owner
                    limit 1
               )
             where province.id=province_key and province.owner is not null;
        end if;
    end if;
    if tg_op <> 'DELETE' then
        province_key := new.province_id;
        if province_key is not null and (tg_op='INSERT' or province_key is distinct from old.province_id or new.owner is distinct from old.owner or new.status is distinct from old.status or new.force_kind is distinct from old.force_kind or new.cell_x is distinct from old.cell_x or new.cell_y is distinct from old.cell_y) then
            update public."Provinces" province
               set occupied_by = (
                   select force.owner
                     from public.military_forces force
                    where force.force_kind='land_army' and force.status='active'
                      and force.province_id=province.id and force.owner<>province.owner
                    group by force.owner
                    order by sum(coalesce((select sum(greatest(0,(unit.value->>'count')::numeric)) from jsonb_array_elements(force.unit_groups) unit(value)),0)) desc, force.owner
                    limit 1
               )
             where province.id=province_key and province.owner is not null;
        end if;
    end if;
    if tg_op='DELETE' then return old; end if;
    return new;
end;
$function$;

revoke all on function public.sync_military_province_occupation() from public,anon,authenticated;
drop trigger if exists sync_military_province_occupation on public.military_forces;
create trigger sync_military_province_occupation
after insert or update of province_id,owner,status,force_kind,cell_x,cell_y or delete on public.military_forces
for each row execute function public.sync_military_province_occupation();

update public."Provinces" province
   set occupied_by = (
       select force.owner
         from public.military_forces force
        where force.force_kind='land_army' and force.status='active'
          and force.province_id=province.id and force.owner<>province.owner
        group by force.owner
        order by sum(coalesce((select sum(greatest(0,(unit.value->>'count')::numeric)) from jsonb_array_elements(force.unit_groups) unit(value)),0)) desc, force.owner
        limit 1
   )
 where province.owner is not null;
