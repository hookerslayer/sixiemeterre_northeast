create or replace function public.persist_internal_market_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    effects jsonb;
    trade_value numeric;
    prices jsonb;
begin
    if (select p.role from public.profiles p where p.id=(select auth.uid())) is distinct from 'admin' then
        raise exception 'Only an administrator can persist turn market results' using errcode='42501';
    end if;
    effects := new.report->'state_effects';
    if effects is null or jsonb_typeof(effects) is distinct from 'object' then return new; end if;
    if not (effects ? 'trade_income' or effects ? 'market_prices') then return new; end if;
    trade_value := coalesce((effects->>'trade_income')::numeric, 0);
    prices := coalesce(effects->'market_prices', '{}'::jsonb);
    if trade_value < 0 or jsonb_typeof(prices) is distinct from 'object' then
        raise exception 'Invalid internal market settlement';
    end if;
    update public.state_mechanics sm
    set settings = sm.settings || jsonb_build_object(
        'market_prices', prices,
        'economy', coalesce(sm.settings->'economy', '{}'::jsonb) || jsonb_build_object(
            'income', coalesce(sm.settings#>'{economy,income}', '{}'::jsonb) || jsonb_build_object('trade', trade_value)
        )
    ), updated_at=now()
    where sm.owner=new.owner;
    return new;
end;
$function$;
