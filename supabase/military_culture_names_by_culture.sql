-- Give each non-Finno-Ugric culture its own pool, while retaining the shared
-- regional base and adding local historical forms to distinguish each pool.
insert into public.military_culture_name_pool(name_group,gender,name)
select culture_groups.name_group,pool.gender,pool.name
from (values
 ('novgorod','east_slavic'),('nizovian','east_slavic'),('galichian','east_slavic'),
 ('dvinyan','east_slavic'),('vyatich','east_slavic'),('pskov','east_slavic'),('pomor','east_slavic'),
 ('kazan_tatar','volga_turkic'),('bashkort','volga_turkic')
) as culture_groups(name_group,base_group)
join public.military_culture_name_pool pool on pool.name_group=culture_groups.base_group
on conflict(name_group,gender,name) do nothing;

insert into public.military_culture_name_pool(name_group,gender,name) values
('novgorod','male','Гюрята'),('novgorod','male','Милята'),('novgorod','male','Петрята'),('novgorod','male','Остромир'),
('novgorod','female','Малуша'),('novgorod','female','Передслава'),('novgorod','female','Маремьяна'),('novgorod','female','Евпраксия'),
('nizovian','male','Ждан'),('nizovian','male','Добрыня'),('nizovian','male','Ярополк'),('nizovian','male','Ратибор'),
('nizovian','female','Аграфена'),('nizovian','female','Авдотья'),('nizovian','female','Василиса'),('nizovian','female','Пелагея'),
('galichian','male','Мирослав'),('galichian','male','Ярослав'),('galichian','male','Данила'),('galichian','male','Богдан'),
('galichian','female','Агафья'),('galichian','female','Параскева'),('galichian','female','Марина'),('galichian','female','Василиса'),
('dvinyan','male','Кондрат'),('dvinyan','male','Сидор'),('dvinyan','male','Анисим'),('dvinyan','male','Тихон'),
('dvinyan','female','Матрона'),('dvinyan','female','Домна'),('dvinyan','female','Акулина'),('dvinyan','female','Агафья'),
('vyatich','male','Святослав'),('vyatich','male','Станислав'),('vyatich','male','Прохор'),('vyatich','male','Фрол'),
('vyatich','female','Аксинья'),('vyatich','female','Улита'),('vyatich','female','Феодосия'),('vyatich','female','Фекла'),
('pskov','male','Яким'),('pskov','male','Никон'),('pskov','male','Терентий'),('pskov','male','Григорий'),
('pskov','female','Яна'),('pskov','female','Катерина'),('pskov','female','Феврония'),('pskov','female','Ефросинья'),
('pomor','male','Макар'),('pomor','male','Филипп'),('pomor','male','Нестор'),('pomor','male','Ермолай'),
('pomor','female','Аграфена'),('pomor','female','Васса'),('pomor','female','Ульяна'),('pomor','female','Марфа'),
('kazan_tatar','male','Утемиш'),('kazan_tatar','male','Ядегар'),('kazan_tatar','male','Касим'),('kazan_tatar','male','Кул-Мухаммед'),
('kazan_tatar','female','Сююмбике'),('kazan_tatar','female','Нурсолтан'),('kazan_tatar','female','Ханзаде'),('kazan_tatar','female','Гульбахор'),
('bashkort','male','Акман'),('bashkort','male','Ишмухамет'),('bashkort','male','Карасакал'),('bashkort','male','Кусюм'),
('bashkort','female','Айсылу'),('bashkort','female','Тансылу'),('bashkort','female','Гульбика'),('bashkort','female','Бибикамал')
on conflict(name_group,gender,name) do nothing;

create or replace function public.pick_military_culture_name(p_culture text,p_gender text,p_seed bigint default null)
returns text language plpgsql security definer set search_path='' as $function$
declare v_name_group text; name_count integer; name_offset integer; selected_name text;
begin
    if p_gender not in ('male','female') then raise exception 'Unknown name gender' using errcode='22023'; end if;
    v_name_group:=case
        when p_culture in ('Вотяки','Вогулы','Саамы','Сумь','Емь','Эсты','Водь','Ижора','Корелы','Коми','Весь') then 'finno_ugric'
        when p_culture='Новгородцы' then 'novgorod'
        when p_culture='Низовцы' then 'nizovian'
        when p_culture='Галичане' then 'galichian'
        when p_culture='Двиняне' then 'dvinyan'
        when p_culture='Вятчане' then 'vyatich'
        when p_culture='Псковичи' then 'pskov'
        when p_culture='Поморы' then 'pomor'
        when p_culture='Свеи' then 'swedish'
        when p_culture='Казанлы' then 'kazan_tatar'
        when p_culture='Башкорт' then 'bashkort'
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
notify pgrst,'reload schema';
