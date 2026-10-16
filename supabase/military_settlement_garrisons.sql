-- Fixed settlement fortification levels and immovable permanent garrisons.
-- Apply once in the Supabase SQL Editor after military_forces.sql, military_sieges.sql,
-- and military_battle_position_resolution.sql.

alter table public.military_forces
    add column if not exists is_permanent_garrison boolean not null default false;

create unique index if not exists military_forces_one_permanent_garrison_per_marker_idx
    on public.military_forces(marker_id)
    where is_permanent_garrison and marker_id is not null;

create or replace function public.set_settlement_fortification_by_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
    new.fortification_level := case new.type
        when 'large_city' then 3
        when 'city' then 2
        when 'fortress' then 2
        when 'monastery' then 1
        else 0
    end;
    return new;
end;
$function$;

revoke all on function public.set_settlement_fortification_by_type() from public, anon, authenticated;
drop trigger if exists set_settlement_fortification_by_type on public.markers;
create trigger set_settlement_fortification_by_type
    before insert or update on public.markers
    for each row execute function public.set_settlement_fortification_by_type();

create or replace function public.sync_permanent_settlement_garrison()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_force_id uuid;
    v_groups jsonb;
    v_name text;
begin
    if new.type = 'ruins' or nullif(btrim(new.owner), '') is null then
        delete from public.military_forces
         where marker_id = new.id and is_permanent_garrison;
        return new;
    end if;

    v_groups := case new.type
        when 'large_city' then '[{"type":"Копейщики","count":40},{"type":"Лучники","count":20}]'::jsonb
        when 'city' then '[{"type":"Копейщики","count":20},{"type":"Лучники","count":10}]'::jsonb
        when 'fortress' then '[{"type":"Копейщики","count":30},{"type":"Лучники","count":10}]'::jsonb
        when 'monastery' then '[{"type":"Копейщики","count":10},{"type":"Лучники","count":5}]'::jsonb
        else '[]'::jsonb
    end;
    v_name := 'Гарнизон: ' || coalesce(nullif(btrim(new.name), ''), 'поселение #' || new.id::text);

    select id into v_force_id
      from public.military_forces
     where marker_id = new.id and is_permanent_garrison
     for update;

    if v_force_id is null then
        insert into public.military_forces(
            owner, name, force_kind, province_id, marker_id, unit_groups,
            morale, action_points, order_name, tactic, status, is_permanent_garrison
        ) values (
            new.owner, v_name, 'garrison', null, new.id, v_groups,
            100, 0, 'осторожный', 'none', 'active', true
        );
    else
        -- Renaming or transferring a settlement does not restore troops lost in battle.
        update public.military_forces
           set owner = new.owner, name = v_name,
               unit_groups = case when tg_op = 'UPDATE' and old.type is distinct from new.type then v_groups else unit_groups end,
               updated_at = now()
         where id = v_force_id;
    end if;
    return new;
end;
$function$;

revoke all on function public.sync_permanent_settlement_garrison() from public, anon, authenticated;
drop trigger if exists sync_permanent_settlement_garrison_insert on public.markers;
create trigger sync_permanent_settlement_garrison_insert
    after insert on public.markers
    for each row execute function public.sync_permanent_settlement_garrison();
drop trigger if exists sync_permanent_settlement_garrison_update on public.markers;
create trigger sync_permanent_settlement_garrison_update
    after update of owner, type, name on public.markers
    for each row execute function public.sync_permanent_settlement_garrison();

create or replace function public.prevent_permanent_garrison_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
    if old.is_permanent_garrison and (
        new.force_kind is distinct from 'garrison'
        or new.marker_id is distinct from old.marker_id
        or new.province_id is not null
        or new.cell_x is not null
        or new.cell_y is not null
        or not new.is_permanent_garrison
    ) then
        raise exception 'A permanent settlement garrison cannot be moved or mobilized' using errcode = '55000';
    end if;
    return new;
end;
$function$;

revoke all on function public.prevent_permanent_garrison_movement() from public, anon, authenticated;
drop trigger if exists prevent_permanent_garrison_movement on public.military_forces;
create trigger prevent_permanent_garrison_movement
    before update of force_kind, marker_id, province_id, cell_x, cell_y, is_permanent_garrison on public.military_forces
    for each row execute function public.prevent_permanent_garrison_movement();

-- Set canonical levels for existing settlements and create their initial guards.
update public.markers
   set fortification_level = case type
       when 'large_city' then 3
       when 'city' then 2
       when 'fortress' then 2
       when 'monastery' then 1
       else 0
   end;

update public.markers
   set name = name
 where type <> 'ruins' and owner is not null;

-- Fortifications can no longer be edited independently of the settlement type.
drop function if exists public.set_marker_fortification(bigint, integer);

-- A defeated permanent garrison falls with its settlement instead of retreating
-- into another state garrison. Its losses and immobility are persisted.
create or replace function public.apply_confirmed_battle_to_persistent_forces()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_side text;
    v_army jsonb;
    v_force_id uuid;
    v_owner text;
    v_marker_id bigint;
    v_province_id bigint;
    v_winner text;
    v_location jsonb;
    v_attacker_army_id uuid;
    v_is_permanent boolean;
begin
    if tg_op = 'UPDATE' and old.report is not distinct from new.report then return new; end if;
    for v_side in select unnest(array['attacker', 'defender']) loop
        for v_army in
            select item.value
              from jsonb_array_elements(coalesce(new.report #> array['armies', v_side], '[]'::jsonb)) as item(value)
        loop
            if jsonb_typeof(v_army->'units') is distinct from 'array'
               or nullif(v_army->>'id', '') is null then continue; end if;
            update public.military_forces as force
               set unit_groups = v_army->'units',
                   morale = greatest(0, least(100, coalesce((v_army->>'morale')::numeric, force.morale))),
                   updated_at = now()
              from public.military_battle_armies as participant
             where participant.id = (v_army->>'id')::uuid
               and participant.battle_id = new.battle_id
               and participant.side = v_side
               and participant.persistent_force_id = force.id;
        end loop;
    end loop;
    if coalesce((new.report->>'noBattle')::boolean, false) then return new; end if;
    v_winner := new.report->>'outcome';
    if v_winner not in ('attacker','defender') then return new; end if;
    select battle.location into v_location from public.military_battles battle where battle.id=new.battle_id;

    if v_winner = 'attacker' and jsonb_typeof(v_location)='object'
       and (v_location->>'cell_x') ~ '^\d+$' and (v_location->>'cell_y') ~ '^\d+$' then
        select participant.id into v_attacker_army_id
          from public.military_battle_armies participant
          join lateral jsonb_array_elements(coalesce(new.report #> '{armies,attacker}','[]'::jsonb)) result on result->>'id'=participant.id::text
         where participant.battle_id=new.battle_id and participant.side='attacker'
           and participant.persistent_force_id=coalesce((v_location->>'attacker_force_id')::uuid,participant.persistent_force_id)
           and coalesce((result->>'active')::boolean,false)
         order by participant.id limit 1;
    end if;

    for v_side in select unnest(array['attacker', 'defender']) loop
        for v_army in
            select item.value
              from jsonb_array_elements(coalesce(new.report #> array['armies', v_side], '[]'::jsonb)) as item(value)
        loop
            if nullif(v_army->>'id','') is null then continue; end if;
            select participant.persistent_force_id, participant.owner
              into v_force_id, v_owner
              from public.military_battle_armies participant
             where participant.id=(v_army->>'id')::uuid and participant.battle_id=new.battle_id;
            if v_force_id is null then continue; end if;
            select force.is_permanent_garrison into v_is_permanent
              from public.military_forces force where force.id=v_force_id;
            if coalesce(v_is_permanent,false) then
                if v_side <> v_winner or not coalesce((v_army->>'active')::boolean,true) then
                    update public.military_forces set status='disbanded',updated_at=now() where id=v_force_id;
                end if;
                continue;
            end if;
            v_marker_id := null;
            v_province_id := null;
            if v_side <> v_winner or not coalesce((v_army->>'active')::boolean,true) then
                select marker.id into v_marker_id from public.markers marker
                 where marker.owner=v_owner and marker.type <> 'ruins'
                 order by md5(new.battle_id::text || ':' || v_force_id::text || ':' || marker.id::text) limit 1;
                select province.id into v_province_id from public."Provinces" province
                 where province.owner=v_owner
                 order by md5(new.battle_id::text || ':' || v_force_id::text || ':' || province.id::text) limit 1;
                if v_marker_id is not null then
                    update public.military_forces set force_kind='garrison',province_id=null,marker_id=v_marker_id,
                        cell_x=null,cell_y=null,commander_name=null,commander_age=null,commander_skills='{}'::jsonb,
                        action_points=0,updated_at=now() where id=v_force_id;
                elsif v_province_id is not null then
                    update public.military_forces set force_kind='garrison',province_id=v_province_id,marker_id=null,
                        cell_x=null,cell_y=null,commander_name=null,commander_age=null,commander_skills='{}'::jsonb,
                        action_points=0,updated_at=now() where id=v_force_id;
                else
                    update public.military_forces set status='disbanded',updated_at=now() where id=v_force_id;
                end if;
            elsif v_force_id=v_attacker_army_id then
                update public.military_forces set cell_x=(v_location->>'cell_x')::integer,cell_y=(v_location->>'cell_y')::integer,
                    province_id=coalesce((v_location->>'province_id')::bigint,province_id),updated_at=now()
                 where id=v_force_id;
            end if;
        end loop;
    end loop;
    return new;
end;
$function$;

revoke all on function public.apply_confirmed_battle_to_persistent_forces() from public, anon, authenticated;
drop trigger if exists military_battle_force_sync on public.military_battle_admin_results;
create trigger military_battle_force_sync
    after insert or update on public.military_battle_admin_results
    for each row execute function public.apply_confirmed_battle_to_persistent_forces();
