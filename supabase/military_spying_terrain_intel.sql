create or replace function public.process_military_spy_season()
returns trigger language plpgsql security definer set search_path='' as $function$
declare turn_no integer:=new.turn; order_row record; net public.military_spy_networks%rowtype; spy public.military_spies%rowtype; counter public.military_spies%rowtype;
    target_marker public.markers%rowtype; target_province public."Provinces"%rowtype; settings_row public.state_mechanics%rowtype;
    cost integer; success_chance numeric; reveal_chance numeric; counter_bonus numeric; success_roll numeric; reveal_roll numeric; counter_roll numeric;
    outcome jsonb; target_label text; exposed boolean; succeeded boolean; limit_count integer; spy_index integer; prestige numeric; current_strength integer; next_level integer;
begin
    if new.turn<=old.turn then return new; end if;
    delete from public.military_spy_intel where expires_turn<turn_no;
    delete from public.military_spy_sabotage_effects where ends_turn<turn_no;

    if new.year>old.year then
        for spy in select * from public.military_spies where status='active' order by id for update loop
            if spy.age>=149 then update public.military_spies set status='dead',age=150,counterintelligence=false where id=spy.id;
            else
                if spy.age+1>=50 and mod(abs(hashtextextended(spy.id::text||':'||new.year::text,0)::numeric),1000000)/10000.0 < least(100,0.5*power(2.0,(spy.age+1-50)/5.0)) then
                    update public.military_spies set status='dead',age=spy.age+1,counterintelligence=false,updated_at=now() where id=spy.id;
                    delete from public.military_spy_networks where spy_id=spy.id;
                    insert into public.military_spy_alerts(owner,message,details,created_turn) values(spy.owner,'Шпион умер от старости или болезни.',jsonb_build_object('spy_name',spy.name),turn_no);
                else update public.military_spies set age=spy.age+1,updated_at=now() where id=spy.id; end if;
            end if;
        end loop;
    end if;

    -- Normal agents act for free; each agent above the state limit costs 2 prestige this season.
    for settings_row in select * from public.state_mechanics loop
        select 1+count(*) into limit_count from public.markers where owner=settings_row.owner and type='large_city';
        select coalesce((settings_row.settings#>>'{economy,prestige}')::numeric,0) into prestige;
        spy_index:=0;
        for spy in select * from public.military_spies where owner=settings_row.owner and status='active' order by created_at,id for update loop
            spy_index:=spy_index+1;
            if spy_index<=limit_count then update public.military_spies set can_operate_turn=turn_no where id=spy.id;
            elsif prestige>=2 then
                prestige:=prestige-2;
                update public.military_spies set can_operate_turn=turn_no where id=spy.id;
            else update public.military_spies set can_operate_turn=-turn_no where id=spy.id; end if;
        end loop;
        update public.state_mechanics set settings=jsonb_set(settings,'{economy,prestige}',to_jsonb(prestige),true),updated_at=now() where owner=settings_row.owner;
    end loop;
    update public.military_spy_networks n set strength=least(100,n.strength+5+2*greatest(0,s.level-1)),updated_at=now()
      from public.military_spies s where s.id=n.spy_id and s.status='active';

    for order_row in select o.*,s.name as spy_name,s.level,s.experience,s.can_operate_turn,n.id as network_id,n.strength
        from public.military_spy_orders o join public.military_spies s on s.id=o.spy_id join public.military_spy_networks n on n.spy_id=s.id
        where o.status='pending' and o.queued_turn<turn_no and s.status='active' order by o.created_at for update of o,s,n loop
        cost:=order_row.network_cost; current_strength:=order_row.strength;
        if order_row.can_operate_turn<>turn_no then
            update public.military_spy_orders set status='resolved',result=jsonb_build_object('success',false,'exposed',false,'message','Операция отложена: шпион не получил содержание сверх лимита.') where id=order_row.id;
            continue;
        end if;
        select coalesce(10+3*greatest(0,max(level)-1),0) into counter_bonus from public.military_spies where owner=order_row.target_owner and counterintelligence and status='active';
        counter_bonus:=coalesce(counter_bonus,0);
        success_chance:=greatest(5,least(95,(case order_row.operation when 'garrison_intel' then 80 when 'province_recon' then 70 when 'network_detection' then 55 else 55 end)+5*greatest(0,order_row.level-1)));
        reveal_chance:=greatest(5,least(85,(case order_row.operation when 'garrison_intel' then 15 when 'province_recon' then 20 when 'network_detection' then 25 else 35 end)-3*greatest(0,order_row.level-1)-0.25*greatest(0,current_strength-cost)+0.5*greatest(0,cost-current_strength)+counter_bonus));
        success_roll:=mod(abs(hashtextextended(order_row.id::text||':success:'||turn_no,0)::numeric),10000)/100.0;
        reveal_roll:=mod(abs(hashtextextended(order_row.id::text||':reveal:'||turn_no,0)::numeric),10000)/100.0;
        succeeded:=success_roll<success_chance; exposed:=reveal_roll<reveal_chance;
        update public.military_spy_networks set strength=greatest(0,strength-cost),updated_at=now() where id=order_row.network_id;
        outcome:=jsonb_build_object('success',succeeded,'exposed',exposed,'success_chance',success_chance,'reveal_chance',reveal_chance,'success_roll',success_roll,'reveal_roll',reveal_roll);
        if exposed then
            delete from public.military_spy_networks where id=order_row.network_id;
            update public.military_spies set status='dead',counterintelligence=false,updated_at=now() where id=order_row.spy_id;
            update public.state_mechanics set settings=jsonb_set(settings,'{economy,prestige}',to_jsonb(coalesce((settings#>>'{economy,prestige}')::numeric,0)-5),true),updated_at=now() where owner=order_row.owner;
            insert into public.military_spy_alerts(owner,message,details,created_turn) values(order_row.target_owner,'Ваша служба раскрыла иностранного шпиона.',jsonb_build_object('spy_name',order_row.spy_name,'sender',order_row.owner),turn_no);
            insert into public.military_spy_alerts(owner,message,details,created_turn) values(order_row.owner,'Шпион раскрыт и погиб; государство узнало об отправителе. Потеряно 5 ОП.',jsonb_build_object('spy_name',order_row.spy_name,'target',order_row.target_owner),turn_no);
            outcome:=outcome||jsonb_build_object('message','Шпион раскрыт и погиб.');
        elsif succeeded then
            if order_row.operation='garrison_intel' then
                select * into target_marker from public.markers where id=order_row.target_marker_id;
                select coalesce(jsonb_agg(jsonb_build_object('name',f.name,'units',f.unit_groups,'commander',f.commander_name)), '[]'::jsonb) into outcome
                  from public.military_forces f where f.marker_id=target_marker.id and f.force_kind='garrison' and f.status='active';
                insert into public.military_spy_intel(owner,source_owner,intel_type,target_label,payload,created_turn,expires_turn) values(order_row.owner,order_row.target_owner,'garrison',target_marker.name,coalesce(outcome,'[]'::jsonb),turn_no,turn_no+1);
            elsif order_row.operation='province_recon' then
                select * into target_province from public."Provinces" where id=order_row.target_province_id;
                outcome:=jsonb_build_object('province_id',target_province.id,'name',target_province.province_name,'owner',target_province.owner,'development',target_province.development,'resource',target_province.resource,
                  'forces',(select coalesce(jsonb_agg(jsonb_build_object('name',f.name,'units',f.unit_groups,'cell_x',f.cell_x,'cell_y',f.cell_y)), '[]'::jsonb) from public.military_forces f where f.province_id=target_province.id and f.status='active'),
                  'terrain',(select coalesce(jsonb_agg(jsonb_build_object('cell_x',g.cell_x,'cell_y',g.cell_y,'terrain',coalesce(t.terrain,g.base_terrain),'bridge',coalesce(t.bridge,false))), '[]'::jsonb)
                      from public.military_grid_cells g left join public.military_terrain_cells t using(cell_x,cell_y)
                      where coalesce(t.province_id,g.province_id)=target_province.id));
                insert into public.military_spy_intel(owner,source_owner,intel_type,target_label,payload,created_turn,expires_turn) values(order_row.owner,order_row.target_owner,'province',target_province.province_name,outcome,turn_no,turn_no+1);
            elsif order_row.operation='network_detection' then
                outcome:=jsonb_build_object('networks',(select coalesce(jsonb_agg(jsonb_build_object('sender',n.owner,'strength',n.strength,'agent',s.name)), '[]'::jsonb) from public.military_spy_networks n join public.military_spies s on s.id=n.spy_id where n.target_owner=order_row.target_owner and n.owner<>order_row.owner));
                insert into public.military_spy_intel(owner,source_owner,intel_type,target_label,payload,created_turn,expires_turn) values(order_row.owner,order_row.target_owner,'networks',order_row.target_owner,outcome,turn_no,turn_no+1);
            else
                insert into public.military_spy_sabotage_effects(owner,marker_id,item_name,starts_turn,ends_turn,source_owner) values(order_row.target_owner,order_row.target_marker_id,order_row.item_name,turn_no,turn_no,order_row.owner);
                outcome:=jsonb_build_object('marker_id',order_row.target_marker_id,'item_name',order_row.item_name,'reduction',25,'expires_turn',turn_no);
            end if;
            update public.military_spies set experience=experience+10,level=case when experience+10>=500 then 5 when experience+10>=300 then 4 when experience+10>=150 then 3 when experience+10>=50 then 2 else 1 end,updated_at=now() where id=order_row.spy_id returning level into next_level;
            outcome:=outcome||jsonb_build_object('success',true,'exposed',false,'message','Операция успешна.','spy_level',next_level);
            insert into public.military_spy_alerts(owner,message,details,created_turn) values(order_row.owner,'Шпионская операция завершена успешно.',jsonb_build_object('operation',order_row.operation,'target',order_row.target_owner,'result',outcome),turn_no);
        else outcome:=outcome||jsonb_build_object('message','Операция провалилась; сеть ослаблена.');
            insert into public.military_spy_alerts(owner,message,details,created_turn) values(order_row.owner,'Шпионская операция не удалась.',jsonb_build_object('operation',order_row.operation,'target',order_row.target_owner),turn_no);
        end if;
        update public.military_spy_orders set status='resolved',result=outcome where id=order_row.id;
    end loop;

    -- A counterspy checks one foreign network each season; a discovery kills the agent and exposes its sender.
    for counter in select * from public.military_spies where status='active' and counterintelligence and can_operate_turn=turn_no order by id loop
        select n.* into net from public.military_spy_networks n join public.military_spies s on s.id=n.spy_id
          where n.target_owner=counter.owner and n.owner<>counter.owner order by md5(counter.id::text||':'||turn_no::text||':'||n.id::text) limit 1;
        if not found then continue; end if;
        select name into target_label from public.military_spies where id=net.spy_id;
        counter_roll:=mod(abs(hashtextextended(counter.id::text||':counter:'||turn_no,0)::numeric),10000)/100.0;
        success_chance:=least(35,5+2*counter.level+floor(net.strength/10.0));
        if counter_roll<success_chance then
            update public.military_spies set status='dead',counterintelligence=false,updated_at=now() where id=net.spy_id;
            delete from public.military_spy_networks where id=net.id;
            update public.state_mechanics set settings=jsonb_set(settings,'{economy,prestige}',to_jsonb(coalesce((settings#>>'{economy,prestige}')::numeric,0)-5),true),updated_at=now() where owner=net.owner;
            insert into public.military_spy_alerts(owner,message,details,created_turn) values(counter.owner,'Контршпионаж обнаружил иностранного агента.',jsonb_build_object('sender',net.owner,'agent',target_label),turn_no);
            insert into public.military_spy_alerts(owner,message,details,created_turn) values(net.owner,'Шпион раскрыт контршпионажем и погиб; потеряно 5 ОП.',jsonb_build_object('target',counter.owner,'agent',target_label),turn_no);
        end if;
    end loop;
    return new;
end;$function$;

revoke all on function public.process_military_spy_season() from public,anon,authenticated;

