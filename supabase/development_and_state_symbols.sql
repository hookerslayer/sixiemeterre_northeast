alter table public."Provinces"
    add column if not exists development integer;

update public."Provinces"
set development = 20
where development is null;

alter table public."Provinces"
    alter column development set default 20,
    alter column development set not null;

do $migration$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'Provinces_development_nonnegative'
          and conrelid = 'public."Provinces"'::regclass
    ) then
        alter table public."Provinces"
            add constraint "Provinces_development_nonnegative" check (development >= 0);
    end if;
end;
$migration$;

alter table public.markers
    add column if not exists development integer;

update public.markers
set development = case type
    when 'large_city' then 200
    when 'city' then 50
    when 'monastery' then 20
    when 'fortress' then 10
    when 'ruins' then 0
    else 0
end
where development is null;

create or replace function public.set_marker_default_development()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
    if new.development is null then
        new.development := case new.type
            when 'large_city' then 200
            when 'city' then 50
            when 'monastery' then 20
            when 'fortress' then 10
            when 'ruins' then 0
            else 0
        end;
    end if;
    return new;
end;
$function$;

drop trigger if exists markers_default_development on public.markers;
create trigger markers_default_development
    before insert on public.markers
    for each row execute function public.set_marker_default_development();

alter table public.markers
    alter column development set not null;

do $migration$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'markers_development_nonnegative'
          and conrelid = 'public.markers'::regclass
    ) then
        alter table public.markers
            add constraint markers_development_nonnegative check (development >= 0);
    end if;
end;
$migration$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('state-symbols', 'state-symbols', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can view state symbols" on storage.objects;
create policy "Public can view state symbols"
    on storage.objects for select to public
    using (bucket_id = 'state-symbols');

drop policy if exists "State members can upload state symbols" on storage.objects;
create policy "State members can upload state symbols"
    on storage.objects for insert to authenticated
    with check (
        bucket_id = 'state-symbols'
        and exists (
            select 1 from public.profiles p
            where p.id = (select auth.uid())
              and (p.role = 'admin' or encode(convert_to(p.owner, 'UTF8'), 'hex') = (storage.foldername(name))[1])
        )
    );

drop policy if exists "State members can update state symbols" on storage.objects;
create policy "State members can update state symbols"
    on storage.objects for update to authenticated
    using (
        bucket_id = 'state-symbols'
        and exists (
            select 1 from public.profiles p
            where p.id = (select auth.uid())
              and (p.role = 'admin' or encode(convert_to(p.owner, 'UTF8'), 'hex') = (storage.foldername(name))[1])
        )
    )
    with check (
        bucket_id = 'state-symbols'
        and exists (
            select 1 from public.profiles p
            where p.id = (select auth.uid())
              and (p.role = 'admin' or encode(convert_to(p.owner, 'UTF8'), 'hex') = (storage.foldername(name))[1])
        )
    );

drop policy if exists "State members can delete state symbols" on storage.objects;
create policy "State members can delete state symbols"
    on storage.objects for delete to authenticated
    using (
        bucket_id = 'state-symbols'
        and exists (
            select 1 from public.profiles p
            where p.id = (select auth.uid())
              and (p.role = 'admin' or encode(convert_to(p.owner, 'UTF8'), 'hex') = (storage.foldername(name))[1])
        )
    );
