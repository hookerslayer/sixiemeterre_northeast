-- Admin-only creation and removal of playable states.
-- Removing a state keeps its provinces and settlements, including yards,
-- cultures and religions, while clearing their ownership.

create or replace function public.admin_create_state(
    p_username text,
    p_owner text,
    p_government_form text,
    p_ruler_name text,
    p_ruler_age integer,
    p_region text,
    p_titular_culture text,
    p_titular_religion text,
    p_province_ids bigint[],
    p_capital_province_id bigint,
    p_owner_color text,
    p_city_name text default null,
    p_city_x bigint default null,
    p_city_y bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_actor public.profiles%rowtype;
    v_player public.profiles%rowtype;
    v_city_required boolean;
    v_cost integer;
    v_current_year integer;
    v_title text;
    v_settings jsonb;
    v_capital public."Provinces"%rowtype;
begin
    select * into v_actor from public.profiles where id=(select auth.uid());
    if not found or v_actor.role<>'admin' then
        raise exception 'Only an administrator can create a state' using errcode='42501';
    end if;
    if length(btrim(coalesce(p_username,''))) not between 1 and 80
       or length(btrim(coalesce(p_owner,''))) not between 2 and 80
       or length(btrim(coalesce(p_ruler_name,''))) not between 1 and 80
       or p_ruler_age is null or p_ruler_age not between 30 and 89
       or p_government_form not in ('Феодальная монархия','Вечевая республика','Теократия','Вождество') then
        raise exception 'Check the state name, ruler, age, and government form' using errcode='22023';
    end if;
    if not exists(select 1 from public.region_color where region=btrim(p_region))
       or not exists(select 1 from public.culture_color where culture=btrim(p_titular_culture))
       or not exists(select 1 from public.religion_color where religion=btrim(p_titular_religion)) then
        raise exception 'Choose an existing region, titular culture, and titular religion' using errcode='22023';
    end if;
    if p_government_form='Вождество' and (btrim(p_titular_religion)<>'Язычество'
       or btrim(p_titular_culture) not in ('Вотяки','Вогулы','Самоеды','Саамы','Сумь','Емь','Эсты','Водь','Ижора','Корелы','Коми','Весь')) then
        raise exception 'Chiefdom is available only to pagan Finno-Ugric and Samoyedic cultures' using errcode='22023';
    end if;
    if p_province_ids is null or cardinality(p_province_ids)<1 or cardinality(p_province_ids)>4
       or exists(select 1 from unnest(p_province_ids) id group by id having count(*)>1)
       or p_capital_province_id is null or not (p_capital_province_id=any(p_province_ids)) then
        raise exception 'Select up to four unique provinces and a capital among them' using errcode='22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('state-owner:'||lower(btrim(p_owner)),0));
    if exists(select 1 from public.owner_color where lower(owner)=lower(btrim(p_owner)))
       or exists(select 1 from public.state_mechanics where lower(owner)=lower(btrim(p_owner))) then
        raise exception 'A state with this name already exists' using errcode='23505';
    end if;
    if p_owner_color is null or p_owner_color !~* '^#[0-9a-f]{6}$'
       or exists(select 1 from public.owner_color where lower(owner_color)=lower(p_owner_color)) then
        raise exception 'Choose a valid unused state color' using errcode='22023';
    end if;
    select * into v_player from public.profiles p
     where p.nickname=btrim(p_username) and p.role='player' and p.owner is null
     order by p.created_at limit 1 for update;
    if not found or exists(select 1 from public.profiles p where p.nickname=btrim(p_username) and p.role='player' and p.owner is null offset 1) then
        raise exception 'Choose one registered player without an assigned state' using errcode='22023';
    end if;
    if not exists(select 1 from auth.users u where u.id=v_player.id and u.email_confirmed_at is not null) then
        raise exception 'The player must confirm their email before state assignment' using errcode='22023';
    end if;
    if exists(
        select 1 from unnest(p_province_ids) selected(id)
        left join public."Provinces" province on province.id=selected.id
        where province.id is null or province.region is distinct from btrim(p_region)
           or province.owner is not null or province.occupied_by is not null
    ) then
        raise exception 'Every selected province must be unowned, uncontested, and inside the chosen region' using errcode='22023';
    end if;
    select coalesce(sum(1 + case when province.main_culture is distinct from btrim(p_titular_culture)
                                      or province.main_religion is distinct from btrim(p_titular_religion)
                                      or exists(select 1 from public.markers marker where marker.province_id=province.id and marker.type='large_city')
                                 then 1 else 0 end),0)::integer
      into v_cost
      from public."Provinces" province where province.id=any(p_province_ids);
    if v_cost>4 then raise exception 'Selected provinces exceed the starting limit of four points' using errcode='22023'; end if;
    select * into v_capital from public."Provinces" where id=p_capital_province_id;
    if not found then raise exception 'Capital province was not found' using errcode='22023'; end if;
    v_city_required:=not exists(select 1 from public.markers marker where marker.province_id=any(p_province_ids) and marker.type in ('city','large_city'));
    if not exists(select 1 from public.markers marker where marker.province_id=p_capital_province_id and marker.type in ('city','large_city')) and not v_city_required then
        raise exception 'The capital province must contain a City or Large city' using errcode='22023';
    end if;
    if v_city_required and (length(btrim(coalesce(p_city_name,''))) not between 1 and 80
       or p_city_x is null or p_city_y is null or p_city_x<0 or p_city_y<0 or p_city_x>10000 or p_city_y>10000) then
        raise exception 'Provide a name and map coordinates for the new 400-yard capital city' using errcode='22023';
    end if;

    v_title:=case p_government_form when 'Феодальная монархия' then 'Князь'
        when 'Вечевая республика' then 'Посадник' when 'Теократия' then 'Епископ' else 'Вождь' end;
    select year into v_current_year from public.game_calendar where singleton=true;
    v_settings:=jsonb_build_object(
        'government_form',btrim(p_government_form),'region',btrim(p_region),
        'titular_culture',btrim(p_titular_culture),'titular_religion',btrim(p_titular_religion),
        'ruler',jsonb_build_object('name',btrim(p_ruler_name),'title',v_title,'age',p_ruler_age,'status','active','last_age_year',coalesce(v_current_year,1450)),
        'tax_rates',jsonb_build_object('aristocracy',10,'clergy',1,'burghers',2,'peasants',1),
        'estate_loyalty',jsonb_build_object('aristocracy',50,'clergy',50,'burghers',50,'peasants',50)
    );
    insert into public.state_mechanics(owner,settings) values(btrim(p_owner),v_settings);
    insert into public.owner_color(owner,owner_color) values(btrim(p_owner),lower(p_owner_color));
    update public.profiles set owner=btrim(p_owner) where id=v_player.id;
    update public."Provinces" set owner=btrim(p_owner),occupied_by=null where id=any(p_province_ids);
    update public.markers set owner=btrim(p_owner) where province_id=any(p_province_ids) and type<>'ruins';
    if v_city_required then
        insert into public.markers(name,type,coord_1,coord_2,description,owner,yards,province_id,culture,religion)
        values(btrim(p_city_name),'city',p_city_x,p_city_y,null,btrim(p_owner),400,p_capital_province_id,v_capital.main_culture,v_capital.main_religion);
    end if;
    return jsonb_build_object('owner',btrim(p_owner),'username',btrim(p_username),'province_ids',to_jsonb(p_province_ids),
        'capital_province_id',p_capital_province_id,'created_capital_city',v_city_required,'province_points',v_cost);
end;
$function$;

create or replace function public.admin_delete_state(p_owner text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_actor public.profiles%rowtype;
    v_state public.state_mechanics%rowtype;
    v_battles integer;
    v_forces integer;
    v_fleets integer;
begin
    select * into v_actor from public.profiles where id=(select auth.uid());
    if not found or v_actor.role<>'admin' then
        raise exception 'Only an administrator can delete a state' using errcode='42501';
    end if;
    select * into v_state from public.state_mechanics where owner=btrim(p_owner) for update;
    if not found then raise exception 'State not found' using errcode='22023'; end if;

    delete from public.military_battles battle where btrim(p_owner)=any(coalesce(battle.participant_owners,array[]::text[]))
       or exists(select 1 from public.military_battle_armies army where army.battle_id=battle.id and army.owner=btrim(p_owner));
    get diagnostics v_battles=row_count;
    delete from public.military_battle_armies where owner=btrim(p_owner);
    delete from public.military_battle_reports where owner=btrim(p_owner);
    delete from public.military_prisoners where captor_owner=btrim(p_owner) or original_owner=btrim(p_owner);
    delete from public.military_levy_orders where owner=btrim(p_owner);
    delete from public.military_fleets where owner=btrim(p_owner);
    get diagnostics v_fleets=row_count;
    delete from public.military_forces where owner=btrim(p_owner);
    get diagnostics v_forces=row_count;
    delete from public.military_commanders where owner=btrim(p_owner);
    delete from public.state_modifiers where owner=btrim(p_owner);
    delete from public.territory_rebellions where owner=btrim(p_owner);
    delete from public.turn_economy_reports where owner=btrim(p_owner);
    delete from public.military_raids where attacker_owner=btrim(p_owner) or target_owner=btrim(p_owner);

    update public.profiles set owner=null where owner=btrim(p_owner);
    update public."Provinces" set owner=null,occupied_by=null where owner=btrim(p_owner) or occupied_by=btrim(p_owner);
    update public.markers set owner=null,military_controlled_by=null,
        state_order_good=null,state_order_qty=0 where owner=btrim(p_owner) or military_controlled_by=btrim(p_owner);
    delete from public.owner_color where owner=btrim(p_owner);
    delete from public.state_mechanics where owner=btrim(p_owner);
    return jsonb_build_object('owner',btrim(p_owner),'deleted_battles',v_battles,'deleted_forces',v_forces,'deleted_fleets',v_fleets,
        'preserved_provinces',true,'preserved_settlements',true);
end;
$function$;

revoke all on function public.admin_create_state(text,text,text,text,integer,text,text,text,bigint[],bigint,text,text,bigint,bigint) from public,anon;
grant execute on function public.admin_create_state(text,text,text,text,integer,text,text,text,bigint[],bigint,text,text,bigint,bigint) to authenticated;
revoke all on function public.admin_delete_state(text) from public,anon;
grant execute on function public.admin_delete_state(text) to authenticated;
