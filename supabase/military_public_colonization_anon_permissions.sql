-- Allow the public map view to read only the fields it exposes.
-- RLS still limits anonymous reads to active colonization missions.
alter table public.military_colonization_missions enable row level security;

drop policy if exists "Active colonization publicly visible on map"
    on public.military_colonization_missions;
create policy "Active colonization publicly visible on map"
    on public.military_colonization_missions
    for select to anon, authenticated
    using (status = 'active');

grant select (id, owner, target_province_id, status)
    on public.military_colonization_missions to anon;
