-- Administrator-set one-season epidemic events for military non-combat losses.
create table if not exists public.military_epidemic_events (
    id uuid primary key default gen_random_uuid(),
    province_id bigint not null references public."Provinces"(id) on delete cascade,
    active_turn integer not null,
    created_by uuid not null references auth.users(id),
    created_at timestamptz not null default now(),
    unique(province_id, active_turn)
);
create index if not exists military_epidemic_events_turn_idx on public.military_epidemic_events(active_turn, province_id);
alter table public.military_epidemic_events enable row level security;
drop policy if exists "Active epidemic events are visible" on public.military_epidemic_events;
create policy "Active epidemic events are visible" on public.military_epidemic_events
    for select to authenticated using (true);
revoke all on public.military_epidemic_events from anon, authenticated;
grant select on public.military_epidemic_events to authenticated;

create or replace function public.set_military_epidemic_event(p_province_id bigint, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare caller_role text; current_turn integer; event_id uuid;
begin
    select profile.role into caller_role from public.profiles profile where profile.id=(select auth.uid());
    if caller_role is distinct from 'admin' then raise exception 'Only an administrator may set epidemic events' using errcode='42501'; end if;
    select turn into current_turn from public.game_calendar where singleton=true for share;
    if not exists(select 1 from public."Provinces" where id=p_province_id) then raise exception 'Province not found' using errcode='22023'; end if;
    if p_enabled then
        insert into public.military_epidemic_events(province_id,active_turn,created_by)
        values(p_province_id,current_turn,(select auth.uid()))
        on conflict(province_id,active_turn) do update set created_by=excluded.created_by
        returning id into event_id;
        return jsonb_build_object('enabled',true,'event_id',event_id,'province_id',p_province_id,'active_turn',current_turn);
    end if;
    delete from public.military_epidemic_events where province_id=p_province_id and active_turn=current_turn;
    return jsonb_build_object('enabled',false,'province_id',p_province_id,'active_turn',current_turn);
end;
$function$;
revoke all on function public.set_military_epidemic_event(bigint,boolean) from public,anon;
grant execute on function public.set_military_epidemic_event(bigint,boolean) to authenticated;
