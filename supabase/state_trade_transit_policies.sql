-- Contract-specific transit tolls and passage restrictions.
-- The active route is refreshed from the administrator's turn simulation report.

create table if not exists public.state_trade_transit_rules (
    contract_id bigint not null references public.state_trade_contracts(id) on delete cascade,
    transit_owner text not null references public.state_mechanics(owner) on update cascade on delete cascade,
    seller_owner text not null references public.state_mechanics(owner) on update cascade on delete cascade,
    buyer_owner text not null references public.state_mechanics(owner) on update cascade on delete cascade,
    toll_rate numeric not null default 10 check (toll_rate >= 0 and toll_rate <= 50),
    blocked boolean not null default false,
    is_current boolean not null default true,
    toll_last_changed_year integer,
    updated_at timestamptz not null default now(),
    primary key (contract_id, transit_owner),
    check (transit_owner <> seller_owner and transit_owner <> buyer_owner)
);

create index if not exists state_trade_transit_rules_current_owner_idx
    on public.state_trade_transit_rules (transit_owner, contract_id) where is_current;

alter table public.state_trade_transit_rules enable row level security;
revoke all on public.state_trade_transit_rules from public, anon, authenticated;
grant select on public.state_trade_transit_rules to anon, authenticated;

create or replace function public.can_read_state_trade_contract(
    p_contract_id bigint,
    p_seller_owner text,
    p_buyer_owner text
) returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
    select exists (
        select 1
        from public.profiles p
        where p.id = (select auth.uid())
          and p.role is not null
          and (
              p.role = 'admin'
              or p.owner in (p_seller_owner, p_buyer_owner)
              or exists (
                  select 1
                  from public.state_trade_transit_rules r
                  where r.contract_id = p_contract_id
                    and r.transit_owner = p.owner
              )
          )
    );
$function$;
revoke all on function public.can_read_state_trade_contract(bigint,text,text) from public, anon;
grant execute on function public.can_read_state_trade_contract(bigint,text,text) to authenticated;

drop policy if exists state_trade_transit_rules_read_participants on public.state_trade_transit_rules;
create policy state_trade_transit_rules_read_participants
    on public.state_trade_transit_rules for select to authenticated
    using (
        transit_owner = (select p.owner from public.profiles p where p.id = (select auth.uid()))
        or public.can_read_state_trade_contract(contract_id, seller_owner, buyer_owner)
    );

drop policy if exists state_trade_contracts_read_participants on public.state_trade_contracts;
create policy state_trade_contracts_read_participants
    on public.state_trade_contracts for select to authenticated
    using (public.can_read_state_trade_contract(id, seller_owner, buyer_owner));

create or replace function public.set_state_trade_transit_policy(
    p_contract_id bigint,
    p_transit_owner text,
    p_action text,
    p_toll_rate numeric default null,
    p_blocked boolean default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    caller_owner text;
    caller_role text;
    game_year integer;
    rule_row public.state_trade_transit_rules%rowtype;
    current_rate numeric;
    available_prestige numeric;
begin
    select p.owner, p.role into caller_owner, caller_role
      from public.profiles p
     where p.id = (select auth.uid());
    if caller_role is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    if caller_role <> 'admin' and caller_owner is distinct from p_transit_owner then
        raise exception 'Only the transit state can change its route policy' using errcode = '42501';
    end if;

    select * into rule_row
      from public.state_trade_transit_rules r
     where r.contract_id = p_contract_id and r.transit_owner = p_transit_owner
     for update;
    if rule_row.contract_id is null then
        raise exception 'Transit route was not found';
    end if;
    if not exists (select 1 from public.state_trade_contracts c where c.id = p_contract_id and c.status = 'active') then
        raise exception 'Only active trade routes can be changed';
    end if;

    if p_action = 'set_toll' then
        if p_toll_rate is null or p_toll_rate < 0 or p_toll_rate > 50 then
            raise exception 'Transit toll must be between 0 and 50';
        end if;
        current_rate := coalesce(rule_row.toll_rate, 10);
        if p_toll_rate is distinct from current_rate then
            select gc.year into game_year from public.game_calendar gc where gc.singleton = true;
            if game_year is null then raise exception 'Game calendar is unavailable'; end if;
            if caller_role <> 'admin' then
                if rule_row.toll_last_changed_year = game_year then
                    raise exception 'Transit toll can only be changed once per game year' using errcode = '23514';
                end if;
                update public.state_mechanics sm
                   set settings = jsonb_set(
                       sm.settings,
                       '{economy,prestige}',
                       to_jsonb(coalesce((sm.settings #>> '{economy,prestige}')::numeric, 0) - 2),
                       true
                   ),
                       updated_at = now()
                 where sm.owner = caller_owner
                   and coalesce((sm.settings #>> '{economy,prestige}')::numeric, 0) >= 2;
                if not found then
                    raise exception 'Changing the transit toll requires 2 prestige points' using errcode = '23514';
                end if;
            end if;
            update public.state_trade_transit_rules
               set toll_rate = p_toll_rate,
                   toll_last_changed_year = case when caller_role = 'admin' then toll_last_changed_year else game_year end,
                   updated_at = now()
             where contract_id = p_contract_id and transit_owner = p_transit_owner
             returning * into rule_row;
        end if;
    elsif p_action = 'set_blocked' then
        if p_blocked is null then raise exception 'Passage restriction value is required'; end if;
        update public.state_trade_transit_rules
           set blocked = p_blocked, updated_at = now()
         where contract_id = p_contract_id and transit_owner = p_transit_owner
         returning * into rule_row;
    else
        raise exception 'Unknown transit policy action';
    end if;
    return to_jsonb(rule_row);
end;
$function$;
revoke all on function public.set_state_trade_transit_policy(bigint,text,text,numeric,boolean) from public, anon;
grant execute on function public.set_state_trade_transit_policy(bigint,text,text,numeric,boolean) to authenticated;

create or replace function public.sync_state_trade_transit_rules_from_report()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
    deal jsonb;
    toll jsonb;
    transit_owner_name text;
begin
    for deal in
        select value
          from jsonb_array_elements(coalesce(new.report -> 'external_trade', '[]'::jsonb))
    loop
        if deal ->> 'side' is distinct from 'export' then continue; end if;
        update public.state_trade_transit_rules
           set is_current = false, updated_at = now()
         where contract_id = (deal ->> 'contract_id')::bigint;
        for toll in
            select value
              from jsonb_array_elements(coalesce(deal -> 'transit_tolls', '[]'::jsonb))
        loop
            transit_owner_name := toll ->> 'owner';
            if transit_owner_name is null or transit_owner_name in (deal ->> 'seller_owner', deal ->> 'buyer_owner') then continue; end if;
            insert into public.state_trade_transit_rules(
                contract_id, transit_owner, seller_owner, buyer_owner, toll_rate, is_current
            ) values (
                (deal ->> 'contract_id')::bigint,
                transit_owner_name,
                deal ->> 'seller_owner',
                deal ->> 'buyer_owner',
                coalesce((toll ->> 'rate')::numeric, 10),
                true
            )
            on conflict (contract_id, transit_owner) do update
                set seller_owner = excluded.seller_owner,
                    buyer_owner = excluded.buyer_owner,
                    is_current = true,
                    updated_at = now();
        end loop;
    end loop;
    return new;
end;
$function$;
revoke all on function public.sync_state_trade_transit_rules_from_report() from public, anon, authenticated;
drop trigger if exists turn_report_sync_state_trade_transit_rules on public.turn_economy_reports;
create trigger turn_report_sync_state_trade_transit_rules
    after insert or update of report on public.turn_economy_reports
    for each row execute function public.sync_state_trade_transit_rules_from_report();
