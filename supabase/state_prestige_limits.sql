-- Set starting finances for newly created states and enforce the prestige cap.
-- The cap is 30 OP plus 20 OP for each owned large city.

create or replace function public.enforce_state_prestige_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_cap numeric;
    v_prestige numeric;
begin
    if tg_op = 'INSERT' and not (new.settings ? 'economy') then
        new.settings := jsonb_set(
            new.settings,
            '{economy}',
            jsonb_build_object('treasury',15000,'prestige',15),
            true
        );
    end if;

    if new.owner is null or jsonb_typeof(new.settings #> '{economy,prestige}') <> 'number' then
        return new;
    end if;

    select 30 + 20 * count(*)
      into v_cap
      from public.markers marker
     where marker.owner = new.owner and marker.type = 'large_city';

    v_prestige := (new.settings #>> '{economy,prestige}')::numeric;
    if v_prestige > v_cap then
        new.settings := jsonb_set(new.settings,'{economy,prestige}',to_jsonb(v_cap),true);
    end if;
    return new;
end;
$function$;
revoke all on function public.enforce_state_prestige_cap() from public, anon, authenticated;

drop trigger if exists state_mechanics_prestige_cap on public.state_mechanics;
create trigger state_mechanics_prestige_cap
    before insert or update of settings, owner on public.state_mechanics
    for each row execute function public.enforce_state_prestige_cap();

create or replace function public.clamp_prestige_after_marker_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_owner text;
    v_cap numeric;
    v_owners text[] := array[]::text[];
begin
    if tg_op <> 'INSERT' and old.owner is not null then
        v_owners := array_append(v_owners,old.owner);
    end if;
    if tg_op <> 'DELETE' and new.owner is not null then
        v_owners := array_append(v_owners,new.owner);
    end if;

    foreach v_owner in array v_owners loop
        select 30 + 20 * count(*)
          into v_cap
          from public.markers marker
         where marker.owner = v_owner and marker.type = 'large_city';

        update public.state_mechanics sm
           set settings = jsonb_set(sm.settings,'{economy,prestige}',to_jsonb(v_cap),true),
               updated_at = now()
         where sm.owner = v_owner
           and jsonb_typeof(sm.settings #> '{economy,prestige}') = 'number'
           and (sm.settings #>> '{economy,prestige}')::numeric > v_cap;
    end loop;
    return null;
end;
$function$;
revoke all on function public.clamp_prestige_after_marker_change() from public, anon, authenticated;

drop trigger if exists markers_prestige_cap on public.markers;
create trigger markers_prestige_cap
    after insert or delete or update of owner, type on public.markers
    for each row execute function public.clamp_prestige_after_marker_change();

-- Apply the new cap to existing states immediately.
update public.state_mechanics sm
   set settings = jsonb_set(
       sm.settings,
       '{economy,prestige}',
       to_jsonb(30 + 20 * (select count(*) from public.markers marker where marker.owner=sm.owner and marker.type='large_city')),
       true
   ), updated_at = now()
 where jsonb_typeof(sm.settings #> '{economy,prestige}') = 'number'
   and (sm.settings #>> '{economy,prestige}')::numeric >
       30 + 20 * (select count(*) from public.markers marker where marker.owner=sm.owner and marker.type='large_city');
