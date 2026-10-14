-- Persist the battlefield outcome: surviving winners hold the field, defeated
-- forces return to a state garrison, and an attacking victor occupies the cell.
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

    for v_side in select unnest(array['attacker','defender']) loop
        for v_army in
            select item.value
              from jsonb_array_elements(coalesce(new.report #> array['armies', v_side], '[]'::jsonb)) as item(value)
        loop
            if nullif(v_army->>'id','') is null then continue; end if;
            select participant.persistent_force_id, participant.owner into v_force_id,v_owner
              from public.military_battle_armies participant
             where participant.id=(v_army->>'id')::uuid and participant.battle_id=new.battle_id;
            if v_force_id is null then continue; end if;
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
