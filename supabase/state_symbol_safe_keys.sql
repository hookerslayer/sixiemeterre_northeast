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
