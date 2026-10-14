create table if not exists public.territory_rebellions (
  territory_type text not null check (territory_type in ('province','marker')),
  territory_id bigint not null,
  owner text not null,
  instability numeric(5,2) not null default 0 check (instability between 0 and 100),
  rebellion_turn integer,
  updated_at timestamptz not null default now(),
  primary key (territory_type, territory_id)
);
alter table public.territory_rebellions enable row level security;
drop policy if exists "Territory rebellion state is readable" on public.territory_rebellions;
create policy "Territory rebellion state is readable" on public.territory_rebellions for select to anon, authenticated using (true);
revoke all on public.territory_rebellions from anon, authenticated;
grant select on public.territory_rebellions to anon, authenticated;

create or replace function public.save_territory_rebellions(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare profile public.profiles%rowtype; row_data jsonb; territory_kind text; territory_key bigint; instability_value numeric; rebel_turn integer; owner_name text; count_rows integer := 0;
begin
  select * into profile from public.profiles where id=(select auth.uid());
  if profile.role is distinct from 'admin' then raise exception 'Only an administrator can update rebellion state' using errcode='42501'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>2000 then raise exception 'Invalid rebellion state payload'; end if;
  for row_data in select value from jsonb_array_elements(p_rows) loop
    territory_kind:=row_data->>'territory_type'; territory_key:=(row_data->>'territory_id')::bigint; owner_name:=row_data->>'owner';
    instability_value:=(row_data->>'instability')::numeric; rebel_turn:=nullif(row_data->>'rebellion_turn','')::integer;
    if territory_kind not in ('province','marker') or territory_key is null or owner_name is null or instability_value not between 0 and 100 then raise exception 'Invalid rebellion state row'; end if;
    if (territory_kind='province' and not exists(select 1 from public."Provinces" where id=territory_key and owner=owner_name)) or (territory_kind='marker' and not exists(select 1 from public.markers where id=territory_key and owner=owner_name and type<>'ruins')) then continue; end if;
    insert into public.territory_rebellions(territory_type,territory_id,owner,instability,rebellion_turn,updated_at)
    values(territory_kind,territory_key,owner_name,instability_value,rebel_turn,now())
    on conflict(territory_type,territory_id) do update set owner=excluded.owner,instability=excluded.instability,rebellion_turn=excluded.rebellion_turn,updated_at=now();
    count_rows:=count_rows+1;
  end loop;
  return jsonb_build_object('saved',count_rows);
end;
$function$;
revoke all on function public.save_territory_rebellions(jsonb) from public,anon;
grant execute on function public.save_territory_rebellions(jsonb) to authenticated;
