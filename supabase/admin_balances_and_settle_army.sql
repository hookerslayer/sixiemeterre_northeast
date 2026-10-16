-- Administrator balance editing and conversion of field armies into settlement garrisons.
create or replace function public.admin_set_state_balances(p_owner text, p_treasury numeric, p_prestige numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    profile public.profiles%rowtype;
    state_settings jsonb;
    prestige_limit numeric;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role<>'admin' then
        raise exception 'Only administrator can change state balances' using errcode='42501';
    end if;
    if nullif(btrim(coalesce(p_owner,'')),'') is null or p_treasury is null or p_prestige is null
       or p_treasury<0 or p_prestige<0 then
        raise exception 'Treasury and prestige must be non-negative values' using errcode='22023';
    end if;
    select 30+20*count(*) into prestige_limit from public.markers where owner=p_owner and type='large_city';
    if p_prestige>prestige_limit then
        raise exception 'Prestige cannot exceed the state limit of % OP',prestige_limit using errcode='22023';
    end if;
    update public.state_mechanics
       set settings=jsonb_set(coalesce(settings,'{}'::jsonb),'{economy}',
           coalesce(settings->'economy','{}'::jsonb)||jsonb_build_object(
               'treasury',round(p_treasury,2),'prestige',round(p_prestige,2)),true),
           updated_at=now()
     where owner=p_owner
     returning settings into state_settings;
    if not found then raise exception 'State settings were not found' using errcode='P0002'; end if;
    return state_settings;
end;
$function$;
revoke all on function public.admin_set_state_balances(text,numeric,numeric) from public,anon;
grant execute on function public.admin_set_state_balances(text,numeric,numeric) to authenticated;

create or replace function public.settle_military_force(p_force_id uuid,p_marker_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    profile public.profiles%rowtype;
    force public.military_forces%rowtype;
    settlement public.markers%rowtype;
    freed_commander uuid;
    settlement_x integer;
    settlement_y integer;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role<>'player' or profile.owner is null then
        raise exception 'Only a state player can settle an army' using errcode='42501';
    end if;
    select * into force from public.military_forces where id=p_force_id for update;
    if not found or force.owner is distinct from profile.owner or force.force_kind<>'land_army' or force.status<>'active' then
        raise exception 'Active field army not found' using errcode='42501';
    end if;
    select * into settlement from public.markers where id=p_marker_id and owner=profile.owner and type<>'ruins' for update;
    if not found then raise exception 'Choose a settlement controlled by your state' using errcode='42501'; end if;
    settlement_x:=floor(settlement.coord_1::numeric/24)::integer;
    settlement_y:=floor(settlement.coord_2::numeric/24)::integer;
    if greatest(abs(force.cell_x-settlement_x),abs(force.cell_y-settlement_y))>1 then
        raise exception 'Army must be on or next to the settlement' using errcode='22023';
    end if;
    if exists(select 1 from public.military_battle_armies ba join public.military_battles battle on battle.id=ba.battle_id
              where ba.persistent_force_id=force.id and battle.status='pending') then
        raise exception 'An army in an unresolved battle cannot enter a settlement' using errcode='55000';
    end if;
    freed_commander:=force.commander_id;
    if freed_commander is not null then
        update public.military_commanders set status='available',force_id=null,fleet_id=null
         where id=freed_commander and owner=profile.owner;
    end if;
    update public.military_forces
       set force_kind='garrison',province_id=null,marker_id=settlement.id,cell_x=null,cell_y=null,
           commander_id=null,commander_name=null,commander_age=null,commander_skills='{}'::jsonb,
           action_points=0,updated_at=now()
     where id=force.id
     returning * into force;
    return jsonb_build_object('force',to_jsonb(force),'settlement',settlement.name,'commander_released',freed_commander is not null);
end;
$function$;
revoke all on function public.settle_military_force(uuid,bigint) from public,anon;
grant execute on function public.settle_military_force(uuid,bigint) to authenticated;
