-- Admin-created fleets must fit the remaining berths in their selected port.
create or replace function public.guard_military_fleet_port_capacity()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
    port_type text;
    capacity integer;
    occupied integer;
    incoming integer;
begin
    if new.location_kind<>'port' or new.port_marker_id is null or jsonb_typeof(new.ships)<>'array' then return new; end if;
    select p.port_type into port_type from public.military_ports p where p.marker_id=new.port_marker_id and p.status='active';
    if not found then raise exception 'A fleet must be based at an active port' using errcode='22023'; end if;
    capacity:=case port_type when 'river_port' then 6 else 12 end;
    select coalesce(sum(case s->>'type' when 'Ушкуй' then 1 when 'Насад' then 2 when 'Ладья' then 2 when 'Когг' then 3 when 'Хольк' then 4 else 99 end),0)::integer
      into occupied from public.military_fleets f cross join lateral jsonb_array_elements(f.ships) s
     where f.port_marker_id=new.port_marker_id and f.location_kind='port' and f.status='active' and f.id is distinct from new.id;
    select occupied+coalesce(sum(case b.ship_type when 'Ушкуй' then 1 when 'Насад' then 2 when 'Ладья' then 2 when 'Когг' then 3 else 4 end),0)::integer
      into occupied from public.military_ship_build_orders b where b.port_marker_id=new.port_marker_id and b.status='building';
    select coalesce(sum(case s->>'type' when 'Ушкуй' then 1 when 'Насад' then 2 when 'Ладья' then 2 when 'Когг' then 3 when 'Хольк' then 4 else 99 end),0)::integer
      into incoming from jsonb_array_elements(new.ships) s;
    if occupied+incoming>capacity then raise exception 'Fleet would exceed remaining berths in this port' using errcode='23514'; end if;
    return new;
end;
$function$;
revoke all on function public.guard_military_fleet_port_capacity() from public,anon,authenticated;
drop trigger if exists guard_military_fleet_port_capacity on public.military_fleets;
create trigger guard_military_fleet_port_capacity before insert on public.military_fleets
for each row execute function public.guard_military_fleet_port_capacity();
