-- Apply after military_forces.sql and military_battles.sql.
-- When a battle uses a persistent field army, its confirmed survivors and morale
-- are written back to that army. Previewing or editing a pending battle has no effect.

alter table public.military_battle_armies
    add column if not exists persistent_force_id uuid
        references public.military_forces(id) on delete set null;

create unique index if not exists military_battle_armies_force_once_idx
    on public.military_battle_armies(battle_id, persistent_force_id)
    where persistent_force_id is not null;

create or replace function public.link_persistent_force_to_battle_army()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_force_id uuid := nullif(new.unit_data->>'persistent_force_id', '')::uuid;
    v_force public.military_forces%rowtype;
begin
    if v_force_id is null then
        new.persistent_force_id := null;
        return new;
    end if;
    select * into v_force
      from public.military_forces as force
     where force.id = v_force_id
       and force.force_kind = 'land_army'
       and force.status = 'active'
     for share;
    if not found or v_force.owner is distinct from new.owner then
        raise exception 'Selected persistent army is unavailable to this participant' using errcode = '22023';
    end if;
    new.persistent_force_id := v_force_id;
    return new;
end;
$function$;

revoke all on function public.link_persistent_force_to_battle_army() from public, anon, authenticated;
drop trigger if exists military_battle_army_link_force on public.military_battle_armies;
create trigger military_battle_army_link_force
    before insert on public.military_battle_armies
    for each row execute function public.link_persistent_force_to_battle_army();

create or replace function public.apply_confirmed_battle_to_persistent_forces()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_side text;
    v_army jsonb;
begin
    for v_side in select unnest(array['attacker', 'defender']) loop
        for v_army in
            select item.value
              from jsonb_array_elements(coalesce(new.report #> array['armies', v_side], '[]'::jsonb)) as item(value)
        loop
            if jsonb_typeof(v_army->'units') is distinct from 'array'
               or nullif(v_army->>'id', '') is null then
                continue;
            end if;
            update public.military_forces as force
               set unit_groups = v_army->'units',
                   morale = greatest(0, least(100, coalesce((v_army->>'morale')::numeric, force.morale))),
                   updated_at = now()
              from public.military_battle_armies as battle_army
             where battle_army.id = (v_army->>'id')::uuid
               and battle_army.battle_id = new.battle_id
               and battle_army.side = v_side
               and battle_army.persistent_force_id = force.id;
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
