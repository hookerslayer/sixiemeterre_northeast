create or replace function public.modified_assimilation_duration(p_status text,p_owner text,p_scope_type text,p_scope_value bigint)
returns integer language sql stable set search_path='' as $function$
    select greatest(1,least(300,ceil(public.assimilation_duration(p_status)*(1+coalesce(sum(m.value),0)/100.0))::integer))
    from public.state_modifiers m
    where m.owner=p_owner and m.effect_key='assimilation_duration_pct' and m.status='active'
      and m.starts_turn<=(select turn from public.game_calendar where singleton=true)
      and (m.ends_turn is null or m.ends_turn>=(select turn from public.game_calendar where singleton=true))
      and (m.scope_type='state' or (m.scope_type=p_scope_type and m.scope_value=p_scope_value::text));
$function$;
revoke all on function public.modified_assimilation_duration(text,text,text,bigint) from public,anon,authenticated;
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
                   public.modified_assimilation_duration(coalesce(sm.settings->'culture_status'->p.main_culture->>'status', 'noninterference'),p.owner,'province',p.id)) - 1) as remaining
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
                   public.modified_assimilation_duration(case
                       when lower(p.main_religion) = lower('язычество') and sm.settings->>'titular_religion' = 'Ислам' then 'expulsion'
                       else coalesce(sm.settings->'religion_status'->p.main_religion->>'status', 'noninterference')
                   end,p.owner,'province',p.id)) - 1) as remaining
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
                   public.modified_assimilation_duration(coalesce(sm.settings->'culture_status'->m.culture->>'status', 'noninterference'),m.owner,'marker',m.id)) - 1) as remaining
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
                   public.modified_assimilation_duration(case
                       when lower(m.religion) = lower('язычество') and sm.settings->>'titular_religion' = 'Ислам' then 'expulsion'
                       else coalesce(sm.settings->'religion_status'->m.religion->>'status', 'noninterference')
                   end,m.owner,'marker',m.id)) - 1) as remaining
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
revoke all on function public.advance_automatic_assimilation() from public,anon,authenticated;
drop trigger if exists advance_assimilation_after_game_turn on public.game_calendar;
create trigger advance_assimilation_after_game_turn after update of turn on public.game_calendar for each row execute function public.advance_automatic_assimilation();
