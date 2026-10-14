-- Persistent one-turn raids against foreign provinces.
alter table public."Provinces"
    add column if not exists last_military_raid_turn integer;
alter table public.military_forces
    add column if not exists cargo jsonb not null default '{}'::jsonb;

create table if not exists public.military_raids (
    id uuid primary key default gen_random_uuid(),
    force_id uuid not null references public.military_forces(id) on delete cascade,
    attacker_owner text not null references public.state_mechanics(owner) on delete cascade,
    province_id bigint not null references public."Provinces"(id) on delete cascade,
    target_owner text not null references public.state_mechanics(owner) on delete cascade,
    started_turn integer not null,
    status text not null default 'active' check (status in ('active','completed','failed')),
    success_scale numeric not null check (success_scale > 0 and success_scale <= 1),
    result jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    resolved_at timestamptz
);
create unique index if not exists military_raids_one_active_force_idx on public.military_raids(force_id) where status='active';
create unique index if not exists military_raids_one_active_province_idx on public.military_raids(province_id) where status='active';
create index if not exists military_raids_owner_turn_idx on public.military_raids(attacker_owner, started_turn desc);

create table if not exists public.military_raid_loot (
    id bigint generated always as identity primary key,
    raid_id uuid not null references public.military_raids(id) on delete cascade,
    item_type text not null check (item_type in ('resource','good')),
    item_name text not null,
    quantity numeric not null check (quantity > 0),
    destination_marker_id bigint references public.markers(id) on delete set null,
    created_at timestamptz not null default now()
);

alter table public.military_raids enable row level security;
alter table public.military_raid_loot enable row level security;
drop policy if exists "Raid participants can read raids" on public.military_raids;
create policy "Raid participants can read raids" on public.military_raids for select to authenticated
using (exists (select 1 from public.profiles p where p.id=(select auth.uid()) and (p.role='admin' or p.owner in (attacker_owner,target_owner))));
drop policy if exists "Raid participants can read loot" on public.military_raid_loot;
create policy "Raid participants can read loot" on public.military_raid_loot for select to authenticated
using (exists (select 1 from public.military_raids r join public.profiles p on p.id=(select auth.uid()) where r.id=raid_id and (p.role='admin' or p.owner in (r.attacker_owner,r.target_owner))));
revoke all on public.military_raids, public.military_raid_loot from anon, authenticated;
grant select on public.military_raids, public.military_raid_loot to authenticated;

create or replace function public.start_military_raid(p_force_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
    profile public.profiles%rowtype;
    force public.military_forces%rowtype;
    target public."Provinces"%rowtype;
    cal public.game_calendar%rowtype;
    troop_count numeric;
    occupied_province bigint;
    strength numeric;
    raid public.military_raids%rowtype;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role<>'player' or nullif(profile.owner,'') is null then raise exception 'Only a state player can order a raid' using errcode='42501'; end if;
    select * into force from public.military_forces where id=p_force_id and owner=profile.owner and force_kind='land_army' and status='active' for update;
    if not found then raise exception 'Choose your active field army' using errcode='22023'; end if;
    select coalesce(sum(greatest(0,(entry->>'count')::numeric)),0) into troop_count from jsonb_array_elements(force.unit_groups) entry;
    if troop_count<100 then raise exception 'A raid requires at least 100 fighters' using errcode='22023'; end if;
    select coalesce(override.province_id,grid.province_id) into occupied_province from public.military_grid_cells grid
    left join public.military_terrain_cells override on override.cell_x=grid.cell_x and override.cell_y=grid.cell_y
    where grid.cell_x=force.cell_x and grid.cell_y=force.cell_y;
    if occupied_province is null then raise exception 'Army must be inside a mapped province' using errcode='22023'; end if;
    select * into target from public."Provinces" where id=occupied_province for update;
    if target.owner is null or target.owner=profile.owner then raise exception 'A raid requires a foreign, non-neutral province' using errcode='22023'; end if;
    if exists(select 1 from public.military_forces enemy where enemy.status='active' and enemy.force_kind='land_army' and enemy.owner=target.owner and enemy.id<>force.id and enemy.province_id=target.id) then
        raise exception 'An enemy field army is present in the province' using errcode='55000';
    end if;
    select * into cal from public.game_calendar where singleton=true;
    if target.last_military_raid_turn is not null and cal.turn-target.last_military_raid_turn<5 then raise exception 'This province is still recovering from a raid' using errcode='55000'; end if;
    if exists(select 1 from public.military_raids where force_id=force.id and status='active') then raise exception 'This army is already committed to a raid' using errcode='55000'; end if;
    strength:=least(1,troop_count/500);
    insert into public.military_raids(force_id,attacker_owner,province_id,target_owner,started_turn,success_scale)
    values(force.id,profile.owner,target.id,target.owner,cal.turn,strength) returning * into raid;
    update public."Provinces" set last_military_raid_turn=cal.turn where id=target.id;
    update public.military_forces set action_points=0,updated_at=now() where id=force.id;
    return jsonb_build_object('raid_id',raid.id,'province_id',target.id,'strength',strength,'started_turn',cal.turn,'completes_on_turn_end',cal.turn);
end;
$function$;
revoke all on function public.start_military_raid(uuid) from public,anon;
grant execute on function public.start_military_raid(uuid) to authenticated;

create or replace function public.cancel_military_raid_on_force_change()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
    if old.status='active' and new.status<>'active' or old.cell_x is distinct from new.cell_x or old.cell_y is distinct from new.cell_y then
        update public.military_raids set status='failed',result=jsonb_build_object('reason','army_moved_or_disbanded'),resolved_at=now()
        where force_id=old.id and status='active';
    end if;
    return new;
end;
$function$;
revoke all on function public.cancel_military_raid_on_force_change() from public,anon,authenticated;
drop trigger if exists cancel_military_raid_on_force_change on public.military_forces;
create trigger cancel_military_raid_on_force_change after update of cell_x,cell_y,status on public.military_forces
for each row execute function public.cancel_military_raid_on_force_change();

create or replace function public.resolve_military_raids_after_economy_turn()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
    raid public.military_raids%rowtype;
    province public."Provinces"%rowtype;
    report_data jsonb;
    province_data jsonb;
    delivery jsonb;
    surplus jsonb;
    loot_amount numeric;
    total_treasury numeric;
    prestige numeric;
    development_loss integer;
    yards_loss bigint;
    goods jsonb;
    result_data jsonb;
    item_row record;
    force_cargo jsonb;
    allocated jsonb;
    allocation_key text;
    already_looted numeric;
begin
    if new.turn<=old.turn then return new; end if;
    for raid in select * from public.military_raids where status='active' and started_turn=old.turn for update loop
        select * into province from public."Provinces" where id=raid.province_id for update;
        if not found or province.owner is distinct from raid.target_owner then
            update public.military_raids set status='failed',result=jsonb_build_object('reason','province_changed'),resolved_at=now() where id=raid.id;
            continue;
        end if;
        select report into report_data from public.turn_economy_reports where owner=raid.target_owner and turn=old.turn order by created_at desc limit 1;
        if report_data is null then
            update public.military_raids set status='failed',result=jsonb_build_object('reason','economy_report_missing'),resolved_at=now() where id=raid.id;
            continue;
        end if;
        province_data:=coalesce(report_data#>array['provinceReports',raid.province_id::text],'{}'::jsonb);
        goods:='[]'::jsonb;
        allocated:='{}'::jsonb;
        for delivery in select value from jsonb_array_elements(coalesce(province_data->'deliveries','[]'::jsonb)) loop
            select value into surplus from jsonb_array_elements(coalesce(report_data->'free_surplus','[]'::jsonb)) value
            where (value->>'marker_id')::bigint=(delivery->>'marker_id')::bigint and value->>'item_type'='resource' and value->>'item_name'=delivery->>'item_name'
            limit 1;
            allocation_key:=(delivery->>'marker_id')||'|'||(delivery->>'item_name');
            already_looted:=coalesce((allocated->>allocation_key)::numeric,0);
            loot_amount:=least(coalesce((delivery->>'quantity')::numeric,0),greatest(0,coalesce((surplus->>'quantity')::numeric,0)-already_looted))*0.25*raid.success_scale;
            if loot_amount>0 then
                insert into public.military_raid_loot(raid_id,item_type,item_name,quantity,destination_marker_id)
                values(raid.id,'resource',delivery->>'item_name',loot_amount,(delivery->>'marker_id')::bigint);
                update public.marker_inventories set quantity=greatest(0,quantity-loot_amount)
                where marker_id=(delivery->>'marker_id')::bigint and item_type='resource' and item_name=delivery->>'item_name';
                allocated:=jsonb_set(allocated,array[allocation_key],to_jsonb(already_looted+loot_amount),true);
                goods:=goods||jsonb_build_array(jsonb_build_object('type','resource','name',delivery->>'item_name','quantity',loot_amount));
            end if;
        end loop;
        loot_amount:=least(coalesce((province_data->>'stored_resource_qty')::numeric,0),coalesce((province_data->>'stored_resource_qty')::numeric,0))*0.25*raid.success_scale;
        if loot_amount>0 and nullif(province.resource,'') is not null then
            update public."Provinces" set stored_resource_qty=greatest(0,stored_resource_qty-loot_amount) where id=province.id;
            insert into public.military_raid_loot(raid_id,item_type,item_name,quantity,destination_marker_id) values(raid.id,'resource',province.resource,loot_amount,null);
            goods:=goods||jsonb_build_array(jsonb_build_object('type','resource','name',province.resource,'quantity',loot_amount));
        end if;
        loot_amount:=round(coalesce((province_data->>'tax_income')::numeric,0)*0.25*raid.success_scale,2);
        total_treasury:=loot_amount;
        if loot_amount>0 then
            update public.state_mechanics set settings=settings||jsonb_build_object('economy',coalesce(settings->'economy','{}'::jsonb)||jsonb_build_object('treasury',coalesce((settings#>>'{economy,treasury}')::numeric,0)+loot_amount)),updated_at=now() where owner=raid.attacker_owner;
        end if;
        update public.state_mechanics set settings=settings||jsonb_build_object('economy',coalesce(settings->'economy','{}'::jsonb)||jsonb_build_object('prestige',coalesce((settings#>>'{economy,prestige}')::numeric,0)+2)),updated_at=now() where owner=raid.attacker_owner;
        select cargo into force_cargo from public.military_forces where id=raid.force_id for update;
        for item_row in select item_name,sum(quantity) as quantity from public.military_raid_loot where raid_id=raid.id group by item_name loop
            force_cargo:=jsonb_set(coalesce(force_cargo,'{}'::jsonb),array[item_row.item_name],to_jsonb(coalesce((force_cargo->>item_row.item_name)::numeric,0)+item_row.quantity),true);
        end loop;
        update public.military_forces set cargo=coalesce(force_cargo,'{}'::jsonb) where id=raid.force_id;
        development_loss:=greatest(1,ceil(province.development*0.05*raid.success_scale)::integer);
        yards_loss:=ceil(province.yards*0.02*raid.success_scale)::bigint;
        update public."Provinces" set development=greatest(0,development-development_loss),yards=greatest(0,yards-yards_loss) where id=province.id;
        result_data:=jsonb_build_object('development_lost',development_loss,'yards_lost',yards_loss,'treasury_loot',total_treasury,'prestige_gained',2,'resources',goods);
        update public.military_raids set status='completed',result=result_data,resolved_at=now() where id=raid.id;
    end loop;
    return new;
end;
$function$;
revoke all on function public.resolve_military_raids_after_economy_turn() from public,anon,authenticated;
drop trigger if exists resolve_military_raids_after_economy_turn on public.game_calendar;
create trigger resolve_military_raids_after_economy_turn after update of turn on public.game_calendar
for each row execute function public.resolve_military_raids_after_economy_turn();
