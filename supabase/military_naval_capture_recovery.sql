-- Persist ships that are explicitly captured in a confirmed naval battle.
-- Captured ships transfer as prizes without operating crews; they must be
-- recruited/repaired before they can return to service.
create or replace function public.recover_captured_military_ships()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    battle public.military_battles%rowtype;
    winner record;
    capture jsonb;
    fleet public.military_fleets%rowtype;
    prize_fleet_id uuid;
    prize_name text;
    suffix integer;
    prize_ships jsonb;
    passengers jsonb;
begin
    select * into battle from public.military_battles where id=new.battle_id;
    if not found or battle.battle_type<>'naval' then return new; end if;
    for winner in
        select army.side,army.owner,army.persistent_fleet_id
          from public.military_battle_armies army
         where army.battle_id=new.battle_id and army.persistent_fleet_id is not null
    loop
        for capture in
            select ship.value
              from jsonb_each(coalesce(new.report->'fleets','{}'::jsonb)) side(key,value)
              cross join lateral jsonb_array_elements(coalesce(side.value->'ships','[]'::jsonb)) ship(value)
             where coalesce((ship.value->>'captured')::boolean,false)
               and ship.value->>'capturedBy'=winner.side
        loop
            select * into fleet from public.military_fleets where id=winner.persistent_fleet_id for update;
            if not found then continue; end if;
            passengers:=coalesce((
                select jsonb_agg(jsonb_set(p.value,'{captured_by}',to_jsonb(winner.owner),true))
                  from jsonb_array_elements(coalesce(capture->'passengers','[]'::jsonb)) p(value)
            ),'[]'::jsonb);
            capture:=jsonb_set(capture,'{passengers}',passengers,true);
            capture:=jsonb_set(capture,'{crew}',to_jsonb(0),true);
            capture:=jsonb_set(capture,'{boardingMen}',to_jsonb(0),true);
            capture:=jsonb_set(capture,'{boarding_troops}',to_jsonb(0),true);
            capture:=jsonb_set(capture,'{captured}',to_jsonb(false),true);
            capture:=jsonb_set(capture,'{capturedBy}','null'::jsonb,true);
            capture:=jsonb_set(capture,'{fire}',to_jsonb(false),true);
            capture:=jsonb_set(capture,'{morale}',to_jsonb(0),true);
            if jsonb_array_length(fleet.ships)<12 then
                update public.military_fleets set ships=ships||jsonb_build_array(capture),status='active',updated_at=now()
                 where id=fleet.id;
            else
                prize_ships:=jsonb_build_array(capture);
                prize_name:='Призовая флотилия '||substr(battle.id::text,1,8);
                suffix:=1;
                while exists(select 1 from public.military_fleets where owner=winner.owner and name=prize_name) loop
                    suffix:=suffix+1;
                    prize_name:='Призовая флотилия '||substr(battle.id::text,1,8)||' #'||suffix::text;
                end loop;
                prize_fleet_id:=gen_random_uuid();
                insert into public.military_fleets(id,owner,name,ships,morale,action_points,status,location_kind,cell_x,cell_y,port_marker_id,commander_name,commander_age,commander_skills,commander_experience)
                values(prize_fleet_id,winner.owner,prize_name,prize_ships,50,0,'active',fleet.location_kind,fleet.cell_x,fleet.cell_y,fleet.port_marker_id,'Призовой капитан',35,'{}'::jsonb,0);
            end if;
        end loop;
    end loop;
    return new;
end;
$function$;
revoke all on function public.recover_captured_military_ships() from public,anon,authenticated;
drop trigger if exists military_naval_capture_recovery on public.military_battle_admin_results;
create trigger military_naval_capture_recovery
    after insert on public.military_battle_admin_results
    for each row execute function public.recover_captured_military_ships();
