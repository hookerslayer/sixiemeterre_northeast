-- Fleet commanders use the same seasonal experience and skill costs as land commanders.
alter table public.military_fleets
    add column if not exists last_battle_experience_turn integer;

create or replace function public.advance_fleet_commander_experience()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    seasons integer := greatest(0, new.turn - old.turn);
begin
    if seasons = 0 then return new; end if;
    update public.military_fleets fleet
       set commander_experience = fleet.commander_experience + seasons,
           updated_at = now()
     where fleet.status = 'active'
       and nullif(btrim(fleet.commander_name), '') is not null;
    return new;
end;
$function$;

revoke all on function public.advance_fleet_commander_experience() from public, anon, authenticated;
drop trigger if exists advance_fleet_commander_experience_on_turn on public.game_calendar;
create trigger advance_fleet_commander_experience_on_turn
    after update of turn on public.game_calendar
    for each row execute function public.advance_fleet_commander_experience();

create or replace function public.award_fleet_commander_battle_experience()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    current_turn integer;
begin
    select calendar.turn into current_turn
      from public.game_calendar calendar
     where calendar.singleton = true;
    if current_turn is null then return new; end if;
    update public.military_fleets fleet
       set commander_experience = fleet.commander_experience + 1,
           last_battle_experience_turn = current_turn,
           updated_at = now()
      from public.military_battle_armies army
     where army.battle_id = new.battle_id
       and army.persistent_fleet_id = fleet.id
       and fleet.status = 'active'
       and fleet.last_battle_experience_turn is distinct from current_turn;
    return new;
end;
$function$;

revoke all on function public.award_fleet_commander_battle_experience() from public, anon, authenticated;
drop trigger if exists military_fleet_commander_battle_experience on public.military_battle_admin_results;
create trigger military_fleet_commander_battle_experience
    after insert on public.military_battle_admin_results
    for each row execute function public.award_fleet_commander_battle_experience();

create or replace function public.train_military_fleet_commander(p_fleet_id uuid, p_skill text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    profile public.profiles%rowtype;
    fleet public.military_fleets%rowtype;
    level integer;
    cost integer;
begin
    select * into profile from public.profiles where id = (select auth.uid());
    if not found or coalesce(profile.role, '') not in ('admin', 'player') then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    if p_skill not in ('management', 'leadership', 'tactics', 'planning', 'engineering') then
        raise exception 'Unknown commander skill' using errcode = '22023';
    end if;
    select * into fleet from public.military_fleets where id = p_fleet_id and status = 'active' for update;
    if not found or (profile.role <> 'admin' and fleet.owner is distinct from profile.owner) then
        raise exception 'You cannot train this fleet commander' using errcode = '42501';
    end if;
    level := coalesce((fleet.commander_skills->>p_skill)::integer, 0);
    if level < 0 or level >= 5 then raise exception 'Commander skill is already at maximum'; end if;
    cost := 2 * (level + 1);
    if fleet.commander_experience < cost then raise exception 'Not enough commander experience'; end if;
    update public.military_fleets
       set commander_skills = jsonb_set(coalesce(commander_skills, '{}'::jsonb), array[p_skill], to_jsonb(level + 1), true),
           commander_experience = commander_experience - cost,
           updated_at = now()
     where id = p_fleet_id;
    return jsonb_build_object('skill', p_skill, 'level', level + 1, 'cost', cost,
                              'experience', fleet.commander_experience - cost);
end;
$function$;

revoke all on function public.train_military_fleet_commander(uuid, text) from public, anon;
grant execute on function public.train_military_fleet_commander(uuid, text) to authenticated;
