-- Culture-matched names for mercenary commanders, state commanders, and spies.
-- The shared Finno-Ugric pool follows the common medieval northern naming area;
-- Samoyedic and regional East Slavic / Volga Turkic / Swedish pools remain separate.

create table if not exists public.military_culture_name_pool (
    name_group text not null,
    gender text not null check (gender in ('male','female')),
    name text not null check (length(btrim(name)) between 1 and 80),
    primary key(name_group,gender,name)
);
alter table public.military_culture_name_pool enable row level security;
revoke all on public.military_culture_name_pool from public,anon,authenticated;

insert into public.military_culture_name_pool(name_group,gender,name)
select pools.name_group,pools.gender,names.name
from (values
('east_slavic','male',array['Иван','Василий','Михаил','Андрей','Дмитрий','Фёдор','Семён','Пётр','Гаврила','Алексей','Яков','Фома','Никита','Матвей','Ефим','Лука','Савва','Кузьма','Степан','Борис','Остромир','Всеволод','Мстислав']::text[]),
('east_slavic','female',array['Мария','Анастасия','Христина','София','Ефимия','Евдокия','Ульяна','Федосья','Феврония','Марфа','Маремьяна','Домна','Анна','Фекла','Ирина','Ефросинья','Улита','Антонина','Федора','Аксинья','Акулина','Яна','Катерина']::text[]),
('finno_ugric','male',array['Юсси','Антти','Хейкки','Матти','Пекка','Лаури','Олли','Пааво','Туомас','Яакко','Симо','Кустаа','Олави','Еркки','Хемминг','Перти','Микко','Йонс','Бьёрн','Кнут','Вейкко','Леметти','Вийтта']::text[]),
('finno_ugric','female',array['Анна','Биргитта','Катарина','Кристина','Маргарета','Элин','Ингрид','Хельга','Рагнхильд','Сесилия','Марит','Карин','Грета','Сигрид','Ингеборг','Эльса','Вальборг','Майя','Кайса','Хельми','Хельмикки','Кауникки','Эндзикки']::text[]),
('swedish','male',array['Эрик','Карл','Нильс','Бенгт','Биргер','Кнут','Магнус','Стен','Ульф','Хокан','Олаф','Йонс','Ларс','Педер','Торд','Арвид','Сигурд','Фольке','Эскиль','Туре','Грегерс','Амуд','Халле']::text[]),
('swedish','female',array['Анна','Биргитта','Катарина','Кристина','Маргарета','Ингрид','Рагнхильд','Цецилия','Элин','Марта','Сигрид','Ингеборг','Карин','Гертруда','Хелена','Вальборг','Гунхильд','Эстрид','Бенгта','Керстин','Малин','Агнета','Роза']::text[]),
('volga_turkic','male',array['Мухаммед','Махмуд','Ибрагим','Али','Хасан','Хусейн','Ахмет','Якуб','Юсуф','Исмаил','Умар','Усман','Саид','Сулейман','Абдулла','Гали','Тимер','Булат','Бахтияр','Искандер','Алдар','Бикбулат','Юлдаш']::text[]),
('volga_turkic','female',array['Айша','Фатима','Зайнаб','Хадиджа','Марьям','Амина','Хафса','Салиха','Рабига','Сафия','Биби','Ханбика','Гаухар','Зухра','Асия','Фирдаус','Назира','Лейла','Султанбика','Сююмбике','Айсылу','Тансылу','Бибигайша']::text[]),
('samoyedic','male',array['Вавля','Вадё','Ервко','Ёнко','Йико','Илко','Мюсена','Мяци','Нойко','Някоця','Натена','Панико','Папако','Сатако','Сэвтя','Сэрако','Хадко','Хасавато','Ябко','Аттей','Пунко','Ейко','Няко']::text[]),
('samoyedic','female',array['Ватане','Еване','Едэйне','Еля','Маяне','Недко','Неко','Папаконе','Пуйне','Саване','Сатане','Сывне','Сэраконе','Хадне','Хойне','Ябтане','Яляне','Яруне','Оча','Атени','Некча','Пирибтя','Сырне']::text[])
) as pools(name_group,gender,names)
cross join lateral unnest(pools.names) as names(name)
on conflict(name_group,gender,name) do nothing;

create or replace function public.pick_military_culture_name(p_culture text,p_gender text,p_seed bigint default null)
returns text language plpgsql security definer set search_path='' as $function$
declare v_name_group text; name_count integer; name_offset integer; selected_name text;
begin
    if p_gender not in ('male','female') then raise exception 'Unknown name gender' using errcode='22023'; end if;
    v_name_group:=case
        when p_culture in ('Вотяки','Вогулы','Саамы','Сумь','Емь','Эсты','Водь','Ижора','Корелы','Коми','Весь') then 'finno_ugric'
        when p_culture in ('Новгородцы','Низовцы','Галичане','Двиняне','Вятчане','Псковичи','Поморы') then 'east_slavic'
        when p_culture='Свеи' then 'swedish'
        when p_culture in ('Казанлы','Башкорт') then 'volga_turkic'
        when p_culture='Самоеды' then 'samoyedic'
        else null
    end;
    if v_name_group is null then raise exception 'No personal-name pool for culture: %',coalesce(p_culture,'—') using errcode='22023'; end if;
    select count(*) into name_count from public.military_culture_name_pool where military_culture_name_pool.name_group=v_name_group and gender=p_gender;
    if name_count<20 then raise exception 'The culture name pool is incomplete' using errcode='55000'; end if;
    if p_seed is null then name_offset:=floor(random()*name_count)::integer;
    else name_offset:=mod(abs(p_seed::numeric),name_count)::integer; end if;
    select name into selected_name from public.military_culture_name_pool
     where military_culture_name_pool.name_group=v_name_group and gender=p_gender
     order by name offset name_offset limit 1;
    return selected_name;
end;
$function$;
revoke all on function public.pick_military_culture_name(text,text,bigint) from public,anon,authenticated;

drop function if exists public.hire_military_commander(text,integer);
create or replace function public.hire_military_commander()
returns public.military_commanders language plpgsql security definer set search_path=''
as $function$
declare prof public.profiles%rowtype; created public.military_commanders%rowtype; settings_row public.state_mechanics%rowtype;
    prestige numeric; limit_count integer; current_count integer; turn_no integer; culture_name text; new_name text; new_age integer;
begin
    select * into prof from public.profiles where id=(select auth.uid());
    if not found or prof.role<>'player' or nullif(prof.owner,'') is null then raise exception 'Only a state player can hire a commander' using errcode='42501'; end if;
    select * into settings_row from public.state_mechanics where owner=prof.owner for update;
    if not found then raise exception 'State data is missing'; end if;
    culture_name:=settings_row.settings->>'titular_culture';
    if nullif(culture_name,'') is null then raise exception 'The state titular culture is not set'; end if;
    prestige:=coalesce((settings_row.settings#>>'{economy,prestige}')::numeric,0);
    if prestige<10 then raise exception 'Hiring a commander costs 10 prestige'; end if;
    select 1+coalesce(sum(case when m.type='large_city' then 2 when m.type in ('fortress','city','monastery') then 1 else 0 end),0)
      into limit_count from public.markers m where m.owner=prof.owner and m.type<>'ruins';
    select count(*) into current_count from public.military_commanders c where c.owner=prof.owner and c.status<>'dead';
    if current_count>=limit_count then raise exception 'Commander limit reached (%).',limit_count; end if;
    select turn into turn_no from public.game_calendar limit 1;
    new_name:=public.pick_military_culture_name(culture_name,'male');
    new_age:=30+floor(random()*31)::integer;
    update public.state_mechanics set settings=jsonb_set(settings,'{economy,prestige}',to_jsonb(prestige-10),true),updated_at=now() where owner=prof.owner;
    insert into public.military_commanders(owner,name,age,hired_turn) values(prof.owner,new_name,new_age,coalesce(turn_no,0)) returning * into created;
    return created;
end $function$;
revoke all on function public.hire_military_commander() from public,anon;
grant execute on function public.hire_military_commander() to authenticated;

drop function if exists public.hire_military_spy(text,integer);
create or replace function public.hire_military_spy()
returns uuid language plpgsql security definer set search_path='' as $function$
declare profile public.profiles%rowtype; settings_row public.state_mechanics%rowtype; active_count integer; spy_limit integer; new_id uuid;
    culture_name text; new_name text; new_gender text; new_age integer;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role<>'player' or nullif(profile.owner,'') is null then raise exception 'Only a state player can hire a spy' using errcode='42501'; end if;
    select * into settings_row from public.state_mechanics where owner=profile.owner for update;
    if not found then raise exception 'State data is missing'; end if;
    culture_name:=settings_row.settings->>'titular_culture';
    if nullif(culture_name,'') is null then raise exception 'The state titular culture is not set'; end if;
    select count(*) into active_count from public.military_spies where owner=profile.owner and status='active';
    select 1+count(*) into spy_limit from public.markers where owner=profile.owner and type='large_city';
    if active_count>=spy_limit+3 then raise exception 'Spy limit exceeded'; end if;
    if coalesce((settings_row.settings#>>'{economy,prestige}')::numeric,0)<10 then raise exception 'Hiring a spy costs 10 prestige'; end if;
    new_gender:=case when random()<0.5 then 'male' else 'female' end;
    new_name:=public.pick_military_culture_name(culture_name,new_gender);
    new_age:=30+floor(random()*31)::integer;
    update public.state_mechanics set settings=jsonb_set(settings,'{economy,prestige}',to_jsonb(coalesce((settings#>>'{economy,prestige}')::numeric,0)-10),true),updated_at=now() where owner=profile.owner;
    insert into public.military_spies(owner,name,age) values(profile.owner,new_name,new_age) returning id into new_id;
    return new_id;
end;$function$;
revoke all on function public.hire_military_spy() from public,anon;
grant execute on function public.hire_military_spy() to authenticated;

create or replace function public.generate_military_mercenary_offer(p_marker_id bigint,p_slot smallint,p_turn integer)
returns void language plpgsql security definer set search_path = '' as $function$
declare
    marker public.markers%rowtype;
    culture_name text;
    candidates text[];
    unit_name text;
    troop_count integer;
    seed bigint;
    new_groups jsonb;
begin
    select * into marker from public.markers where id=p_marker_id and type in ('city','large_city');
    if not found or p_slot>(case marker.type when 'large_city' then 2 else 1 end) then return; end if;
    select coalesce(nullif(m.culture,''),nullif(province.main_culture,''),'Новгородцы') into culture_name
      from public.markers m left join public."Provinces" province on province.id=m.province_id where m.id=marker.id;
    seed:=abs(hashtextextended(marker.id::text||':'||p_slot::text||':'||p_turn::text,0));
    if lower(culture_name) like '%свей%' or lower(culture_name) like '%эст%' then
        candidates:=array['Пешие ратники','Копейщики','Лучники','Арбалетчики'];
    elsif lower(culture_name) like '%казан%' then
        candidates:=array['Лучники','Лёгкая конница','Конные лучники'];
    elsif lower(culture_name) like '%коми%' or lower(culture_name) like '%саам%' then
        candidates:=array['Пешие ратники','Копейщики','Лучники','Лыжники-разведчики'];
    else
        candidates:=array['Пешие ратники','Копейщики','Лучники'];
    end if;
    unit_name:=candidates[mod(seed,cardinality(candidates))::integer+1];
    troop_count:=100+mod(seed/97,201)::integer;
    new_groups:=jsonb_build_array(jsonb_build_object('type',unit_name,'count',troop_count,'serviceType','mercenary'));
    insert into public.military_mercenary_market(marker_id,slot,culture,commander_name,commander_age,unit_groups,available,refresh_turn,hired_force_id,updated_at)
    values(marker.id,p_slot,culture_name,public.pick_military_culture_name(culture_name,'male',seed/7919),25+mod(seed/15485863,26)::integer,new_groups,true,null,null,now())
    on conflict(marker_id,slot) do update set culture=excluded.culture,commander_name=excluded.commander_name,commander_age=excluded.commander_age,
       unit_groups=excluded.unit_groups,available=true,refresh_turn=null,hired_force_id=null,updated_at=now();
end;
$function$;
revoke all on function public.generate_military_mercenary_offer(bigint,smallint,integer) from public,anon,authenticated;

notify pgrst,'reload schema';
