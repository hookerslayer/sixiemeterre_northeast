-- Advance culture and religion assimilation timers once per successfully processed game turn.
-- Status durations: recognition 60 turns, noninterference 30 turns, expulsion 10 turns.

create or replace function public.assimilation_duration(p_status text)
returns integer
language sql
immutable
set search_path = ''
as $function$
    select case p_status
        when 'recognition' then 60
        when 'expulsion' then 10
        else 30
    end;
$function$;

create or replace function public.clear_assimilation_timer_on_group_change()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
    if tg_table_name = 'Provinces' then
        if new.main_culture is distinct from old.main_culture then
            new.culture_assimilation_turns := null;
        end if;
        if new.main_religion is distinct from old.main_religion then
            new.religion_assimilation_turns := null;
        end if;
    else
        if new.culture is distinct from old.culture then
            new.culture_assimilation_turns := null;
        end if;
        if new.religion is distinct from old.religion then
            new.religion_assimilation_turns := null;
        end if;
    end if;
    return new;
end;
$function$;

drop trigger if exists clear_province_assimilation_timer_on_group_change on public."Provinces";
create trigger clear_province_assimilation_timer_on_group_change
before update of main_culture, main_religion on public."Provinces"
for each row execute function public.clear_assimilation_timer_on_group_change();

drop trigger if exists clear_marker_assimilation_timer_on_group_change on public.markers;
create trigger clear_marker_assimilation_timer_on_group_change
before update of culture, religion on public.markers
for each row execute function public.clear_assimilation_timer_on_group_change();

create or replace function public.advance_automatic_assimilation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
    if new.turn <= old.turn then
        return new;
    end if;

    with eligible as (
        select p.id,
               sm.settings->>'titular_culture' as titular,
               greatest(0, coalesce(p.culture_assimilation_turns,
                   public.assimilation_duration(coalesce(sm.settings->'culture_status'->p.main_culture->>'status', 'noninterference'))) - 1) as remaining
        from public."Provinces" p
        join public.state_mechanics sm on sm.owner = p.owner
        where nullif(sm.settings->>'titular_culture', '') is not null
          and p.main_culture is not null
          and p.main_culture is distinct from sm.settings->>'titular_culture'
    )
    update public."Provinces" p
       set main_culture = case when eligible.remaining = 0 then eligible.titular else p.main_culture end,
           culture_assimilation_turns = case when eligible.remaining = 0 then null else eligible.remaining end
      from eligible
     where p.id = eligible.id;

    with eligible as (
        select p.id,
               sm.settings->>'titular_religion' as titular,
               greatest(0, coalesce(p.religion_assimilation_turns,
                   public.assimilation_duration(case
                       when lower(p.main_religion) = lower('язычество') and sm.settings->>'titular_religion' = 'Ислам' then 'expulsion'
                       else coalesce(sm.settings->'religion_status'->p.main_religion->>'status', 'noninterference')
                   end)) - 1) as remaining
        from public."Provinces" p
        join public.state_mechanics sm on sm.owner = p.owner
        where nullif(sm.settings->>'titular_religion', '') is not null
          and p.main_religion is not null
          and p.main_religion is distinct from sm.settings->>'titular_religion'
    )
    update public."Provinces" p
       set main_religion = case when eligible.remaining = 0 then eligible.titular else p.main_religion end,
           religion_assimilation_turns = case when eligible.remaining = 0 then null else eligible.remaining end
      from eligible
     where p.id = eligible.id;

    with eligible as (
        select m.id,
               sm.settings->>'titular_culture' as titular,
               greatest(0, coalesce(m.culture_assimilation_turns,
                   public.assimilation_duration(coalesce(sm.settings->'culture_status'->m.culture->>'status', 'noninterference'))) - 1) as remaining
        from public.markers m
        join public.state_mechanics sm on sm.owner = m.owner
        where m.type <> 'ruins'
          and nullif(sm.settings->>'titular_culture', '') is not null
          and m.culture is not null
          and m.culture is distinct from sm.settings->>'titular_culture'
    )
    update public.markers m
       set culture = case when eligible.remaining = 0 then eligible.titular else m.culture end,
           culture_assimilation_turns = case when eligible.remaining = 0 then null else eligible.remaining end
      from eligible
     where m.id = eligible.id;

    with eligible as (
        select m.id,
               sm.settings->>'titular_religion' as titular,
               greatest(0, coalesce(m.religion_assimilation_turns,
                   public.assimilation_duration(case
                       when lower(m.religion) = lower('язычество') and sm.settings->>'titular_religion' = 'Ислам' then 'expulsion'
                       else coalesce(sm.settings->'religion_status'->m.religion->>'status', 'noninterference')
                   end)) - 1) as remaining
        from public.markers m
        join public.state_mechanics sm on sm.owner = m.owner
        where m.type <> 'ruins'
          and nullif(sm.settings->>'titular_religion', '') is not null
          and m.religion is not null
          and m.religion is distinct from sm.settings->>'titular_religion'
    )
    update public.markers m
       set religion = case when eligible.remaining = 0 then eligible.titular else m.religion end,
           religion_assimilation_turns = case when eligible.remaining = 0 then null else eligible.remaining end
      from eligible
     where m.id = eligible.id;

    update public."Provinces" p
       set culture_assimilation_turns = null
      from public.state_mechanics sm
     where sm.owner = p.owner
       and p.main_culture = sm.settings->>'titular_culture'
       and p.culture_assimilation_turns is not null;
    update public."Provinces" p
       set religion_assimilation_turns = null
      from public.state_mechanics sm
     where sm.owner = p.owner
       and p.main_religion = sm.settings->>'titular_religion'
       and p.religion_assimilation_turns is not null;
    update public.markers m
       set culture_assimilation_turns = null
      from public.state_mechanics sm
     where sm.owner = m.owner
       and (m.type = 'ruins' or m.culture = sm.settings->>'titular_culture')
       and m.culture_assimilation_turns is not null;
    update public.markers m
       set religion_assimilation_turns = null
      from public.state_mechanics sm
     where sm.owner = m.owner
       and (m.type = 'ruins' or m.religion = sm.settings->>'titular_religion')
       and m.religion_assimilation_turns is not null;

    return new;
end;
$function$;

drop trigger if exists advance_assimilation_after_game_turn on public.game_calendar;
create trigger advance_assimilation_after_game_turn
after update of turn on public.game_calendar
for each row execute function public.advance_automatic_assimilation();

revoke all on function public.assimilation_duration(text) from public, anon, authenticated;
revoke all on function public.clear_assimilation_timer_on_group_change() from public, anon, authenticated;
revoke all on function public.advance_automatic_assimilation() from public, anon, authenticated;
