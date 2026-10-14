-- Road infrastructure has been removed; military land supply uses its
-- seasonal base capacity while rivers, lakes and seas retain their own links.
drop function if exists public.build_military_road_segment(bigint,bigint,bigint);
drop function if exists public.admin_build_military_road_segment(bigint,bigint,text);
drop table if exists public.military_roads cascade;

-- Empty owner strings are legacy neutral provinces. Normalize existing rows
-- and keep future admin edits from reintroducing the mismatch.
update public."Provinces" set owner=null where btrim(coalesce(owner,''))='';
create or replace function public.normalize_neutral_province_owner()
returns trigger language plpgsql set search_path = '' as $function$
begin
    if btrim(coalesce(new.owner,''))='' then new.owner:=null; end if;
    return new;
end;
$function$;
drop trigger if exists normalize_neutral_province_owner on public."Provinces";
create trigger normalize_neutral_province_owner before insert or update of owner on public."Provinces"
for each row execute function public.normalize_neutral_province_owner();

create or replace function public.start_military_colonization(p_source_marker_id bigint,p_target_province_id bigint,p_extra_investment integer default 0)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
    profile public.profiles%rowtype; source public.markers%rowtype; target public."Provinces"%rowtype;
    calendar public.game_calendar%rowtype; owner_settings jsonb; investment numeric; bonus integer;
    mission public.military_colonization_missions%rowtype;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role<>'player' or nullif(profile.owner,'') is null then raise exception 'Only a state player can start colonization' using errcode='42501'; end if;
    if p_extra_investment not in (0,1000,2000) then raise exception 'Additional investment must be 0, 1,000 or 2,000 z' using errcode='22023'; end if;
    select * into calendar from public.game_calendar where singleton=true;
    if (select count(*) from public.military_colonization_missions where owner=profile.owner and status='active')>=2 then raise exception 'A state may run at most two missions at once' using errcode='55000'; end if;
    if exists(select 1 from public.military_colonization_missions where owner=profile.owner and started_turn=calendar.turn) then raise exception 'Only one new mission may begin in a season' using errcode='55000'; end if;
    select * into source from public.markers where id=p_source_marker_id and owner=profile.owner and type<>'ruins' for update;
    if not found or source.yards<50 then raise exception 'Choose your settlement with at least 50 yards of population' using errcode='22023'; end if;
    select * into target from public."Provinces" where id=p_target_province_id and nullif(btrim(owner),'') is null for update;
    if not found then raise exception 'The target must be a neutral province' using errcode='22023'; end if;
    if exists(select 1 from public.markers where province_id=target.id and type<>'ruins' and owner is distinct from profile.owner) then
        raise exception 'Capture every settlement in the neutral province before colonizing it' using errcode='55000';
    end if;
    if exists(select 1 from public.military_colonization_missions where target_province_id=target.id and status='active') then raise exception 'Another mission is already headed to this province' using errcode='55000'; end if;
    if exists(select 1 from public.military_forces force where force.force_kind='land_army' and force.status='active' and force.province_id=target.id) then raise exception 'A military force occupies the target province' using errcode='55000'; end if;
    if not exists(select 1 from public.military_grid_cells target_cell join public.military_grid_cells own_cell on greatest(abs(target_cell.cell_x-own_cell.cell_x),abs(target_cell.cell_y-own_cell.cell_y))=1 join public."Provinces" own_province on own_province.id=own_cell.province_id and own_province.owner=profile.owner and own_province.occupied_by is null where target_cell.province_id=target.id) then raise exception 'A land mission target must neighbor an owned, non-occupied province' using errcode='22023'; end if;
    investment:=1000+p_extra_investment; bonus:=least(10,(p_extra_investment/1000)*5);
    select settings into owner_settings from public.state_mechanics where owner=profile.owner for update;
    if coalesce((owner_settings#>>'{economy,treasury}')::numeric,0)<investment then raise exception 'Not enough treasury for colonization' using errcode='22023'; end if;
    update public.state_mechanics set settings=settings||jsonb_build_object('economy',coalesce(settings->'economy','{}'::jsonb)||jsonb_build_object('treasury',(owner_settings#>>'{economy,treasury}')::numeric-investment)),updated_at=now() where owner=profile.owner;
    update public.markers set yards=yards-50 where id=source.id;
    insert into public.military_colonization_missions(owner,source_marker_id,target_province_id,started_turn,investment,bonus_chance,success_chance)
    values(profile.owner,source.id,target.id,calendar.turn,investment,bonus,least(80,50+bonus)) returning * into mission;
    return jsonb_build_object('mission_id',mission.id,'target_province_id',target.id,'started_turn',calendar.turn,'success_chance',mission.success_chance,'next_payment',500,'settlers',200);
end;
$function$;
revoke all on function public.normalize_neutral_province_owner() from public,anon,authenticated;
revoke all on function public.start_military_colonization(bigint,bigint,integer) from public,anon;
grant execute on function public.start_military_colonization(bigint,bigint,integer) to authenticated;

-- The announced default internal-market levy is 15%; preserve any other
-- player-selected rate.
update public.state_mechanics
set settings=jsonb_set(settings,'{internal_trade_tax_rate}','15'::jsonb,true),updated_at=now()
where settings ? 'internal_trade_tax_rate' and (settings->>'internal_trade_tax_rate')::numeric=5;
