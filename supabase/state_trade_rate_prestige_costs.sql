-- Charge prestige for player changes to the internal trade levy and estate tax rates.
-- Both cooldowns and charges are enforced atomically with state_mechanics writes.

create or replace function public.guard_state_trade_rate_costs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    caller_role text;
    game_year integer;
    estate_key text;
    default_rate numeric;
    old_rate numeric;
    new_rate numeric;
    changed_estates integer := 0;
    trade_rate_changed boolean := false;
    old_trade_rate numeric;
    new_trade_rate numeric;
    prestige_cost numeric := 0;
    available_prestige numeric := 0;
begin
    select p.role into caller_role
      from public.profiles p
     where p.id = (select auth.uid());

    if caller_role = 'admin' then
        return new;
    end if;
    if caller_role is null then
        raise exception 'Authentication required to change state tax rates' using errcode = '42501';
    end if;

    select gc.year into game_year
      from public.game_calendar gc
     where gc.singleton = true;
    if game_year is null then
        raise exception 'Game calendar is unavailable';
    end if;

    foreach estate_key in array array['aristocracy', 'clergy', 'burghers', 'peasants'] loop
        default_rate := case estate_key
            when 'aristocracy' then 10
            when 'clergy' then 1
            when 'burghers' then 2
            else 1
        end;
        if tg_op = 'INSERT' then
            old_rate := default_rate;
        else
            old_rate := coalesce((old.settings #>> array['tax_rates', estate_key])::numeric, default_rate);
        end if;
        new_rate := coalesce((new.settings #>> array['tax_rates', estate_key])::numeric, default_rate);
        if new_rate is distinct from old_rate then
            changed_estates := changed_estates + 1;
        end if;
    end loop;

    if tg_op = 'INSERT' then
        old_trade_rate := 5;
    else
        old_trade_rate := coalesce((old.settings ->> 'internal_trade_tax_rate')::numeric, 5);
    end if;
    new_trade_rate := coalesce((new.settings ->> 'internal_trade_tax_rate')::numeric, 5);
    if new_trade_rate < 0 or new_trade_rate > 15 then
        raise exception 'Internal trade tax rate must be between 0 and 15';
    end if;
    trade_rate_changed := new_trade_rate is distinct from old_trade_rate;

    if tg_op = 'UPDATE' and changed_estates > 0
       and (old.settings ->> 'tax_rates_last_changed_year')::integer = game_year then
        raise exception 'Estate tax rates can only be changed once per game year' using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' and trade_rate_changed
       and (old.settings ->> 'internal_trade_tax_last_changed_year')::integer = game_year then
        raise exception 'Internal trade tax can only be changed once per game year' using errcode = '23514';
    end if;

    prestige_cost := changed_estates * 3 + case when trade_rate_changed then 5 else 0 end;
    if prestige_cost > 0 then
        if tg_op = 'INSERT' then
            available_prestige := coalesce((new.settings #>> '{economy,prestige}')::numeric, 0);
        else
            available_prestige := coalesce((old.settings #>> '{economy,prestige}')::numeric, 0);
        end if;
        if available_prestige < prestige_cost then
            raise exception 'Insufficient prestige: requires %, available %', prestige_cost, available_prestige using errcode = '23514';
        end if;
        new.settings := jsonb_set(
            coalesce(new.settings, '{}'::jsonb),
            '{economy}',
            coalesce(new.settings -> 'economy', '{}'::jsonb) || jsonb_build_object('prestige', available_prestige - prestige_cost),
            true
        );
    end if;

    if changed_estates > 0 then
        new.settings := jsonb_set(coalesce(new.settings, '{}'::jsonb), '{tax_rates_last_changed_year}', to_jsonb(game_year), true);
    elsif tg_op = 'UPDATE' and old.settings ? 'tax_rates_last_changed_year' then
        new.settings := jsonb_set(coalesce(new.settings, '{}'::jsonb), '{tax_rates_last_changed_year}', old.settings -> 'tax_rates_last_changed_year', true);
    else
        new.settings := coalesce(new.settings, '{}'::jsonb) - 'tax_rates_last_changed_year';
    end if;

    if trade_rate_changed then
        new.settings := jsonb_set(coalesce(new.settings, '{}'::jsonb), '{internal_trade_tax_last_changed_year}', to_jsonb(game_year), true);
    elsif tg_op = 'UPDATE' and old.settings ? 'internal_trade_tax_last_changed_year' then
        new.settings := jsonb_set(coalesce(new.settings, '{}'::jsonb), '{internal_trade_tax_last_changed_year}', old.settings -> 'internal_trade_tax_last_changed_year', true);
    else
        new.settings := coalesce(new.settings, '{}'::jsonb) - 'internal_trade_tax_last_changed_year';
    end if;

    return new;
end;
$function$;

revoke all on function public.guard_state_trade_rate_costs() from public, anon, authenticated;
drop trigger if exists state_mechanics_trade_rate_cost_guard on public.state_mechanics;
create trigger state_mechanics_trade_rate_cost_guard
    before insert or update on public.state_mechanics
    for each row execute function public.guard_state_trade_rate_costs();
