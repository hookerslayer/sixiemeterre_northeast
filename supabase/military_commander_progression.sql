-- Commander experience: +1 per season in command and +1 for at least one
-- completed battle in that season. Skill advancement follows rules_mechanics.txt.
alter table public.military_forces
    add column if not exists commander_experience integer not null default 0 check (commander_experience >= 0),
    add column if not exists last_battle_experience_turn integer;

create or replace function public.advance_commander_experience_with_calendar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_seasons integer := greatest(0, new.turn - old.turn);
begin
    if v_seasons = 0 then return new; end if;
    update public.military_forces as force
       set commander_experience = force.commander_experience + v_seasons,
           updated_at = now()
     where force.force_kind = 'land_army'
       and force.status = 'active'
       and force.commander_name is not null;
    return new;
end;
$function$;

revoke all on function public.advance_commander_experience_with_calendar() from public, anon, authenticated;
drop trigger if exists advance_commander_experience_on_game_turn on public.game_calendar;
create trigger advance_commander_experience_on_game_turn
    after update of turn on public.game_calendar
    for each row execute function public.advance_commander_experience_with_calendar();

create or replace function public.award_commander_battle_experience()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_turn integer;
begin
    select calendar.turn into v_turn
      from public.game_calendar as calendar
     where calendar.singleton = true;
    if v_turn is null then return new; end if;
    update public.military_forces as force
       set commander_experience = force.commander_experience + 1,
           last_battle_experience_turn = v_turn,
           updated_at = now()
      from public.military_battle_armies as army
     where army.battle_id = new.battle_id
       and army.persistent_force_id = force.id
       and army.side in ('attacker', 'defender')
       and force.force_kind = 'land_army'
       and force.status = 'active'
       and force.last_battle_experience_turn is distinct from v_turn;
    return new;
end;
$function$;

revoke all on function public.award_commander_battle_experience() from public, anon, authenticated;
drop trigger if exists military_commander_battle_experience on public.military_battle_admin_results;
create trigger military_commander_battle_experience
    after insert on public.military_battle_admin_results
    for each row execute function public.award_commander_battle_experience();

create or replace function public.train_military_commander(p_force_id uuid, p_skill text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_profile public.profiles%rowtype;
    v_force public.military_forces%rowtype;
    v_level integer;
    v_cost integer;
begin
    select * into v_profile from public.profiles where id = (select auth.uid());
    if not found or coalesce(v_profile.role, '') not in ('admin', 'player') then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    if p_skill not in ('management', 'leadership', 'tactics', 'planning', 'engineering') then
        raise exception 'Unknown commander skill' using errcode = '22023';
    end if;
    select * into v_force from public.military_forces where id = p_force_id for update;
    if not found or v_force.force_kind <> 'land_army' or v_force.status <> 'active' then
        raise exception 'Active field army not found' using errcode = '22023';
    end if;
    if coalesce(v_profile.role, '') <> 'admin' and v_profile.owner is distinct from v_force.owner then
        raise exception 'You cannot train another state commander' using errcode = '42501';
    end if;
    v_level := coalesce((v_force.commander_skills->>p_skill)::integer, 0);
    if v_level < 0 or v_level >= 5 then raise exception 'Commander skill is already at maximum'; end if;
    v_cost := 2 * (v_level + 1);
    if v_force.commander_experience < v_cost then raise exception 'Not enough commander experience'; end if;
    update public.military_forces
       set commander_skills = jsonb_set(coalesce(commander_skills, '{}'::jsonb), array[p_skill], to_jsonb(v_level + 1), true),
           commander_experience = commander_experience - v_cost,
           updated_at = now()
     where id = p_force_id;
    return jsonb_build_object('skill', p_skill, 'level', v_level + 1, 'cost', v_cost,
                              'experience', v_force.commander_experience - v_cost);
end;
$function$;

revoke all on function public.train_military_commander(uuid, text) from public, anon;
grant execute on function public.train_military_commander(uuid, text) to authenticated;
