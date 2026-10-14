-- Keep the public map view under caller permissions and expose only active
-- mission identifiers, owner, target, and status needed by the view filter.
drop policy if exists "Active colonization publicly visible on map" on public.military_colonization_missions;
create policy "Active colonization publicly visible on map"
    on public.military_colonization_missions
    for select to anon, authenticated
    using (status='active');

grant select (id, owner, target_province_id, status)
    on public.military_colonization_missions to anon;

create or replace view public.military_active_colonization_map
with (security_barrier=true, security_invoker=true)
as
select id, owner, target_province_id
from public.military_colonization_missions
where status='active';
revoke all on public.military_active_colonization_map from public;
grant select on public.military_active_colonization_map to anon, authenticated;
