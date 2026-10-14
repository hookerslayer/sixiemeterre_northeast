-- Ships in a captured port transfer with the port and settlement owner.
create or replace function public.sync_military_port_owner()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare fleet_row record; next_name text;
begin
    if new.owner is distinct from old.owner and new.owner is not null then
        update public.military_ports set owner=new.owner,updated_at=now()
         where marker_id=new.id and status<>'destroyed';
        for fleet_row in select id,name from public.military_fleets
          where port_marker_id=new.id and location_kind='port' and owner is distinct from new.owner for update loop
            next_name:=fleet_row.name;
            if exists(select 1 from public.military_fleets other where other.owner=new.owner and other.name=fleet_row.name and other.id<>fleet_row.id) then
                next_name:=left(fleet_row.name,58)||' · трофей '||left(fleet_row.id::text,6);
            end if;
            update public.military_fleets set owner=new.owner,name=next_name,updated_at=now() where id=fleet_row.id;
        end loop;
    end if;
    if new.type='ruins' then update public.military_ports set status='destroyed',updated_at=now() where marker_id=new.id; end if;
    return new;
end;
$function$;
revoke all on function public.sync_military_port_owner() from public,anon,authenticated;
