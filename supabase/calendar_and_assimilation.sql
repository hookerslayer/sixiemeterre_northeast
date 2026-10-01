alter table public."Provinces"
    add column if not exists culture_assimilation_turns integer check (culture_assimilation_turns is null or culture_assimilation_turns > 0),
    add column if not exists religion_assimilation_turns integer check (religion_assimilation_turns is null or religion_assimilation_turns > 0);

alter table public.markers
    add column if not exists culture_assimilation_turns integer check (culture_assimilation_turns is null or culture_assimilation_turns > 0),
    add column if not exists religion_assimilation_turns integer check (religion_assimilation_turns is null or religion_assimilation_turns > 0);

create table if not exists public.game_calendar (
    singleton boolean primary key default true check (singleton),
    turn integer not null default 1 check (turn > 0),
    season text not null default 'Осень' check (season in ('Осень', 'Зима', 'Весна', 'Лето')),
    year integer not null default 1450 check (year > 0),
    updated_at timestamptz not null default now()
);

insert into public.game_calendar (singleton, turn, season, year)
values (true, 1, 'Осень', 1450)
on conflict (singleton) do nothing;

alter table public.game_calendar enable row level security;
drop policy if exists "Game calendar is publicly readable" on public.game_calendar;
create policy "Game calendar is publicly readable"
    on public.game_calendar for select to anon, authenticated using (true);
grant select on public.game_calendar to anon, authenticated;
revoke insert, update, delete on public.game_calendar from anon, authenticated;

create or replace function public.advance_game_turn()
returns table (turn integer, season text, year integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
    caller_role text;
    next_calendar public.game_calendar%rowtype;
begin
    select p.role into caller_role
    from public.profiles p
    where p.id = (select auth.uid());

    if caller_role is distinct from 'admin' then
        raise exception 'Only an administrator can advance the game turn' using errcode = '42501';
    end if;

    update public.game_calendar as gc
    set turn = gc.turn + 1,
        year = gc.year + case when gc.season = 'Осень' then 1 else 0 end,
        season = case gc.season
            when 'Осень' then 'Зима'
            when 'Зима' then 'Весна'
            when 'Весна' then 'Лето'
            else 'Осень'
        end,
        updated_at = now()
    where gc.singleton = true
    returning gc.* into next_calendar;

    return query select next_calendar.turn, next_calendar.season, next_calendar.year;
end;
$function$;

revoke all on function public.advance_game_turn() from public, anon;
grant execute on function public.advance_game_turn() to authenticated;
