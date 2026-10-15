-- Permanent ruler's retinue: hired in a settlement, trained for one season,
-- and then added to that settlement's garrison.
alter table public.military_forces
    add column if not exists is_retinue boolean not null default false;

create table if not exists public.military_retinue_orders (
    id uuid primary key default gen_random_uuid(),
    owner text not null references public.state_mechanics(owner) on delete restrict,
    destination_marker_id bigint not null references public.markers(id) on delete restrict,
    unit_type text not null,
    unit_count integer not null check (unit_count > 0),
    submitted_turn integer not null,
    due_turn integer not null,
    status text not null default 'training' check (status in ('training','raised')),
    force_id uuid references public.military_forces(id) on delete set null,
    treasury_paid numeric(12,2) not null check (treasury_paid >= 0),
    arms_paid numeric(12,3) not null check (arms_paid >= 0),
    cloth_paid numeric(12,3) not null check (cloth_paid >= 0),
    created_at timestamptz not null default now(),
    check (due_turn > submitted_turn)
);
create index if not exists military_retinue_orders_owner_status_idx
    on public.military_retinue_orders(owner,status,due_turn);
alter table public.military_retinue_orders enable row level security;
drop policy if exists "Owners and admins can read retinue orders" on public.military_retinue_orders;
create policy "Owners and admins can read retinue orders"
    on public.military_retinue_orders for select to authenticated
    using (exists (
        select 1 from public.profiles p
         where p.id=(select auth.uid()) and (p.role='admin' or p.owner=military_retinue_orders.owner)
    ));
revoke all on public.military_retinue_orders from anon,authenticated;
grant select on public.military_retinue_orders to authenticated;

create or replace function public.place_military_retinue_order(
    p_marker_id bigint,p_unit_type text,p_unit_count integer
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
    v_profile public.profiles%rowtype;
    v_marker public.markers%rowtype;
    v_province public."Provinces"%rowtype;
    v_state public.state_mechanics%rowtype;
    v_calendar public.game_calendar%rowtype;
    v_treasury numeric;
    v_arms numeric;
    v_cloth numeric;
    v_cost_factor numeric:=1;
    v_yards numeric:=0;
    v_limit integer;
    v_committed integer;
    v_treasury_cost numeric;
    v_arms_cost numeric;
    v_cloth_cost numeric;
    v_unit_class text;
    v_order_id uuid;
begin
    select * into v_profile from public.profiles where id=(select auth.uid());
    if not found or v_profile.role<>'player' or nullif(v_profile.owner,'') is null then
        raise exception 'Only a state player can recruit a retinue' using errcode='42501';
    end if;
    if p_unit_count is null or p_unit_count<1 or p_unit_count>5000 then
        raise exception 'Recruitment count must be between 1 and 5000' using errcode='22023';
    end if;
    if p_unit_type not in ('Пешие ратники','Копейщики','Лучники','Арбалетчики','Конные копейщики','Лёгкая конница','Конные лучники','Лыжники-разведчики','Ушкуйники') then
        raise exception 'This unit type cannot be recruited into a retinue' using errcode='22023';
    end if;
    select * into v_marker from public.markers where id=p_marker_id for update;
    if not found or v_marker.owner is distinct from v_profile.owner or v_marker.type='ruins' or v_marker.province_id is null then
        raise exception 'Choose one of your settlements' using errcode='22023';
    end if;
    select * into v_province from public."Provinces" where id=v_marker.province_id for update;
    if not found or v_province.owner is distinct from v_profile.owner or v_province.occupied_by is not null then
        raise exception 'The settlement is not in an uncontested province under your control' using errcode='23514';
    end if;
    if (p_unit_type='Арбалетчики' and lower(coalesce(nullif(v_marker.culture,''),v_province.main_culture,'')) !~ '(свей|эст)')
       or (p_unit_type='Конные лучники' and lower(coalesce(nullif(v_marker.culture,''),v_province.main_culture,'')) not like '%казан%')
       or (p_unit_type='Лыжники-разведчики' and lower(coalesce(nullif(v_marker.culture,''),v_province.main_culture,'')) !~ '(коми|саам)')
       or (p_unit_type='Ушкуйники' and lower(coalesce(nullif(v_marker.culture,''),v_province.main_culture,'')) !~ '(новгород|вятич)') then
        raise exception 'This culture cannot recruit the selected unit type' using errcode='23514';
    end if;
    select * into v_calendar from public.game_calendar where singleton=true for update;
    if p_unit_type='Лыжники-разведчики' and v_calendar.season<>'Зима' then
        raise exception 'Ski scouts can only be recruited in winter' using errcode='23514';
    end if;
    select * into v_state from public.state_mechanics where owner=v_profile.owner for update;
    if not found then raise exception 'State economy is unavailable' using errcode='22023'; end if;

    -- Province yards and settlement yards are separate population pools in the levy model.
    select coalesce(sum(greatest(0,coalesce(province.yards,0))),0)
         + coalesce((select sum(greatest(0,coalesce(marker.yards,0))) from public.markers marker
                      join public."Provinces" province on province.id=marker.province_id
                     where marker.owner=v_profile.owner and marker.type<>'ruins'
                       and province.owner=v_profile.owner and province.occupied_by is null),0)
      into v_yards
      from public."Provinces" province
     where province.owner=v_profile.owner and province.occupied_by is null;
    v_limit:=50+floor(v_yards/50)::integer;
    select coalesce(sum(force_count),0)::integer into v_committed from (
        select coalesce(sum((unit.value->>'count')::integer),0) as force_count
          from public.military_forces force cross join lateral jsonb_array_elements(force.unit_groups) unit(value)
         where force.owner=v_profile.owner and force.is_retinue and force.status<>'disbanded'
        union all
        select coalesce(sum(order_row.unit_count),0)
          from public.military_retinue_orders order_row where order_row.owner=v_profile.owner and order_row.status='training'
    ) committed;
    if v_committed+p_unit_count>v_limit then
        raise exception 'The retinue limit is %; % are already serving or training',v_limit,v_committed using errcode='23514';
    end if;
    v_unit_class:=case when p_unit_type in ('Конные копейщики','Лёгкая конница','Конные лучники') then 'cavalry' else 'foot' end;
    select greatest(0,1+coalesce(sum(value),0)/100) into v_cost_factor
      from public.state_modifiers where owner=v_profile.owner and effect_key='military_recruitment_cost_pct'
        and scope_type='state' and status='active' and starts_turn<=v_calendar.turn and (ends_turn is null or ends_turn>=v_calendar.turn);
    v_treasury_cost:=round(p_unit_count*case v_unit_class when 'cavalry' then 1 else 0.5 end*v_cost_factor,2);
    v_arms_cost:=round(p_unit_count*case v_unit_class when 'cavalry' then 0.1 else 0.05 end*v_cost_factor,3);
    v_cloth_cost:=round(p_unit_count*case v_unit_class when 'cavalry' then 0.05 else 0.025 end*v_cost_factor,3);
    v_treasury:=greatest(0,coalesce((v_state.settings #>> '{economy,treasury}')::numeric,0));
    if v_treasury<v_treasury_cost then raise exception 'Not enough treasury: need % z',v_treasury_cost using errcode='23514'; end if;
    select coalesce(quantity,0) into v_arms from public.marker_inventories where marker_id=v_marker.id and item_type='good' and item_name='Оружие и Доспехи' for update;
    select coalesce(quantity,0) into v_cloth from public.marker_inventories where marker_id=v_marker.id and item_type='good' and item_name='Сукно и Одежда' for update;
    if coalesce(v_arms,0)<v_arms_cost then raise exception 'The settlement warehouse lacks Weapons and Armor (% required)',v_arms_cost using errcode='23514'; end if;
    if coalesce(v_cloth,0)<v_cloth_cost then raise exception 'The settlement warehouse lacks Cloth and Clothing (% required)',v_cloth_cost using errcode='23514'; end if;
    update public.state_mechanics set settings=coalesce(settings,'{}'::jsonb)||jsonb_build_object('economy',coalesce(settings->'economy','{}'::jsonb)||jsonb_build_object('treasury',v_treasury-v_treasury_cost)),updated_at=now() where owner=v_profile.owner;
    update public.marker_inventories set quantity=quantity-v_arms_cost where marker_id=v_marker.id and item_type='good' and item_name='Оружие и Доспехи';
    update public.marker_inventories set quantity=quantity-v_cloth_cost where marker_id=v_marker.id and item_type='good' and item_name='Сукно и Одежда';
    insert into public.military_retinue_orders(owner,destination_marker_id,unit_type,unit_count,submitted_turn,due_turn,treasury_paid,arms_paid,cloth_paid)
    values(v_profile.owner,v_marker.id,p_unit_type,p_unit_count,v_calendar.turn,v_calendar.turn+1,v_treasury_cost,v_arms_cost,v_cloth_cost)
    returning id into v_order_id;
    return jsonb_build_object('id',v_order_id,'due_turn',v_calendar.turn+1,'unit_type',p_unit_type,'unit_count',p_unit_count,
        'limit',v_limit,'serving',v_committed,'treasury_paid',v_treasury_cost,'arms_paid',v_arms_cost,'cloth_paid',v_cloth_cost);
end;
$function$;
revoke all on function public.place_military_retinue_order(bigint,text,integer) from public,anon;
grant execute on function public.place_military_retinue_order(bigint,text,integer) to authenticated;

create or replace function public.process_military_retinue_orders()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare v_order public.military_retinue_orders%rowtype; v_force_id uuid;
begin
    if new.turn<=old.turn then return new; end if;
    for v_order in select * from public.military_retinue_orders where status='training' and due_turn<=new.turn order by created_at,id for update loop
        insert into public.military_forces(owner,name,force_kind,marker_id,unit_groups,morale,action_points,status,is_retinue)
        values(v_order.owner,'Дружина · '||v_order.unit_type,'garrison',v_order.destination_marker_id,
            jsonb_build_array(jsonb_build_object('type',v_order.unit_type,'count',v_order.unit_count)),100,0,'active',true)
        returning id into v_force_id;
        update public.military_retinue_orders set status='raised',force_id=v_force_id where id=v_order.id;
    end loop;
    return new;
end;
$function$;
revoke all on function public.process_military_retinue_orders() from public,anon,authenticated;
drop trigger if exists process_military_retinue_orders_on_turn on public.game_calendar;
create trigger process_military_retinue_orders_on_turn after update of turn on public.game_calendar
for each row execute function public.process_military_retinue_orders();
