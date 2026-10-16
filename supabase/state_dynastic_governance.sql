-- Dynastic families, player-approved marriages and fixed-term Veche elections.
-- Uses the existing state_mechanics.settings JSON for the ruler/family record.

create table if not exists public.state_dynastic_marriage_proposals (
    id uuid primary key default gen_random_uuid(),
    proposer_owner text not null references public.state_mechanics(owner) on update cascade on delete cascade,
    target_owner text not null references public.state_mechanics(owner) on update cascade on delete cascade,
    heirs_owner text not null references public.state_mechanics(owner) on update cascade on delete cascade,
    spouse jsonb not null,
    proposer_child_id text,
    target_child_id text,
    target_child jsonb,
    status text not null default 'pending' check(status in ('pending','approved','rejected')),
    player_approved boolean not null default false,
    admin_approved boolean not null default false,
    created_turn integer not null default 0,
    created_at timestamptz not null default now(),
    resolved_at timestamptz,
    check(proposer_owner<>target_owner),
    check(heirs_owner in (proposer_owner,target_owner))
);
alter table public.state_dynastic_marriage_proposals add column if not exists proposer_child_id text;
alter table public.state_dynastic_marriage_proposals add column if not exists target_child_id text;
alter table public.state_dynastic_marriage_proposals add column if not exists target_child jsonb;
alter table public.state_dynastic_marriage_proposals enable row level security;
drop policy if exists state_dynastic_marriage_proposals_read on public.state_dynastic_marriage_proposals;
create policy state_dynastic_marriage_proposals_read on public.state_dynastic_marriage_proposals for select to authenticated
using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and (p.role='admin' or p.owner in (proposer_owner,target_owner))));
revoke all on public.state_dynastic_marriage_proposals from public,anon,authenticated;
grant select on public.state_dynastic_marriage_proposals to authenticated;
create index if not exists state_dynastic_marriage_proposals_proposer_idx on public.state_dynastic_marriage_proposals(proposer_owner);
create index if not exists state_dynastic_marriage_proposals_target_idx on public.state_dynastic_marriage_proposals(target_owner);
create index if not exists state_dynastic_marriage_proposals_heirs_idx on public.state_dynastic_marriage_proposals(heirs_owner);
create index if not exists state_dynastic_marriage_proposals_status_created_idx on public.state_dynastic_marriage_proposals(status,created_at desc);

create or replace function public.build_veche_election_candidate(p_owner text,p_culture text,p_index integer)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare candidate jsonb; effects jsonb:='[]'::jsonb; category integer; effect_key text; value numeric; target text; display_name text; labels text[]; keys text[]; unit text;
begin
    display_name:=public.pick_military_culture_name(p_culture,'male',null);
    for category in 1..3 loop
        if category=1 then
            keys:=array['tax_income_pct','internal_trade_income_pct','guild_capacity_pct','storage_capacity_pct'];
            labels:=array['Итоговые налоговые поступления','Доход от внутренней торговли','Мощность ремесленного производства','Вместимость складов'];
        elsif category=2 then
            keys:=array['crime_rate_pp','corruption_rate_pp','estate_loyalty_pp'];
            labels:=array['Преступность','Коррупция','Лояльность выбранного сословия'];
        else
            keys:=array['battle_strength_pct','military_upkeep_pct','morale_change_pp'];
            labels:=array['Боеспособность сухопутных войск','Содержание войск','Изменение морали войск'];
        end if;
        effect_key:=keys[1+floor(random()*array_length(keys,1))::integer];
        value:=case when random()<0.34 then 5 when random()<0.72 then 10 else 15 end;
        if effect_key='battle_strength_pct' and value>10 then value:=10; end if;
        if random()<0.5 then value:=-value; end if;
        target:=case when effect_key='battle_strength_pct' then 'army' else null end;
        if effect_key in ('crime_rate_pp','corruption_rate_pp','estate_loyalty_pp','morale_change_pp') then unit:='п.п.'; else unit:='%'; end if;
        effects:=effects||jsonb_build_array(jsonb_build_object('effect_key',effect_key,'value',value,'target_type',target,'scope_type',case when effect_key='estate_loyalty_pp' then 'estate' else 'state' end,'scope_value',case when effect_key='estate_loyalty_pp' then 'burghers' else null end,'label',case when effect_key='estate_loyalty_pp' then 'Лояльность Горожан' else labels[array_position(keys,effect_key)] end,'unit',unit));
    end loop;
    candidate:=jsonb_build_object('id',gen_random_uuid(),'name',display_name,'title','Посадник','age',30+floor(random()*31)::integer,'effects',effects,'generated_for_year',(select year from public.game_calendar where singleton=true));
    return candidate;
end;$function$;
revoke all on function public.build_veche_election_candidate(text,text,integer) from public,anon,authenticated;

create or replace function public.open_state_governance(p_owner text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare prof public.profiles%rowtype; state_row public.state_mechanics%rowtype; ruler jsonb; government text; calendar_year integer; candidates jsonb:='[]'::jsonb; idx integer;
begin
    select * into prof from public.profiles where id=(select auth.uid());
    if not found or (prof.role<>'admin' and (prof.role<>'player' or prof.owner is distinct from p_owner)) then raise exception 'You cannot view this state government' using errcode='42501'; end if;
    select * into state_row from public.state_mechanics where owner=p_owner for update;
    if not found then raise exception 'State not found'; end if;
    select year into calendar_year from public.game_calendar where singleton=true;
    ruler:=coalesce(state_row.settings->'ruler','{}'::jsonb);
    government:=coalesce(state_row.settings->>'government_form','');
    if government='Вечевая республика' and (ruler->>'status'='vacant' or coalesce((ruler->>'term_end_year')::integer,calendar_year+1)<=calendar_year) then
        if jsonb_typeof(ruler->'election_candidates') is distinct from 'array' or jsonb_array_length(coalesce(ruler->'election_candidates','[]'::jsonb))<>3 then
            for idx in 1..3 loop candidates:=candidates||jsonb_build_array(public.build_veche_election_candidate(p_owner,state_row.settings->>'titular_culture',idx)); end loop;
            ruler:=jsonb_set(ruler,'{status}','"vacant"'::jsonb,true);
            ruler:=jsonb_set(ruler,'{election_candidates}',candidates,true);
            ruler:=jsonb_set(ruler,'{election_year}',to_jsonb(calendar_year),true);
            perform set_config('app.allow_ruler_governance_write','on',true);
            update public.state_mechanics set settings=jsonb_set(settings,'{ruler}',ruler,true),updated_at=now() where owner=p_owner;
        end if;
    end if;
    return ruler;
end;$function$;

create or replace function public.elect_state_ruler(p_candidate_id text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare prof public.profiles%rowtype; state_row public.state_mechanics%rowtype; ruler jsonb; candidate jsonb; calendar_year integer;
begin
    select * into prof from public.profiles where id=(select auth.uid());
    if not found or prof.role<>'player' or nullif(prof.owner,'') is null then raise exception 'State player required' using errcode='42501'; end if;
    select * into state_row from public.state_mechanics where owner=prof.owner for update;
    if state_row.settings->>'government_form'<>'Вечевая республика' then raise exception 'Only a Veche republic elects a Posadnik'; end if;
    ruler:=coalesce(state_row.settings->'ruler','{}'::jsonb);
    if ruler->>'status'<>'vacant' or jsonb_typeof(ruler->'election_candidates') is distinct from 'array' then raise exception 'There is no election open'; end if;
    select value into candidate from jsonb_array_elements(ruler->'election_candidates') where value->>'id'=p_candidate_id limit 1;
    if candidate is null then raise exception 'Election candidate not found'; end if;
    select year into calendar_year from public.game_calendar where singleton=true;
    ruler:=jsonb_set(ruler,'{name}',candidate->'name',true);
    ruler:=jsonb_set(ruler,'{title}',candidate->'title',true);
    ruler:=jsonb_set(ruler,'{age}',candidate->'age',true);
    ruler:=jsonb_set(ruler,'{gender}','"male"'::jsonb,true);
    ruler:=jsonb_set(ruler,'{status}','"active"'::jsonb,true);
    ruler:=jsonb_set(ruler,'{term_start_year}',to_jsonb(calendar_year),true);
    ruler:=jsonb_set(ruler,'{term_end_year}',to_jsonb(calendar_year+4),true);
    ruler:=jsonb_set(ruler,'{elected_effects}',coalesce(candidate->'effects','[]'::jsonb),true);
    ruler:=ruler-'election_candidates'-'election_year'-'vacant_since_turn'-'deceased_name';
    perform set_config('app.allow_ruler_governance_write','on',true);
    update public.state_mechanics set settings=jsonb_set(settings,'{ruler}',ruler,true),updated_at=now() where owner=prof.owner;
    return ruler;
end;$function$;

create or replace function public.find_local_ruler_spouse()
returns jsonb language plpgsql security definer set search_path='' as $function$
declare prof public.profiles%rowtype; state_row public.state_mechanics%rowtype; ruler jsonb; spouse jsonb; balance numeric; culture text; current_year integer; new_spouse jsonb;
begin
    select * into prof from public.profiles where id=(select auth.uid());
    if not found or prof.role<>'player' or nullif(prof.owner,'') is null then raise exception 'State player required' using errcode='42501'; end if;
    select * into state_row from public.state_mechanics where owner=prof.owner for update;
    ruler:=coalesce(state_row.settings->'ruler','{}'::jsonb);
    if coalesce(ruler->>'status','active')<>'active' or coalesce((ruler->>'age')::integer,0)<16 then raise exception 'A spouse can be searched for only for an adult active ruler'; end if;
    if ruler ? 'spouse' and ruler->'spouse'<>'null'::jsonb then raise exception 'The ruler already has a spouse'; end if;
    culture:=state_row.settings->>'titular_culture';
    if nullif(culture,'') is null then raise exception 'Titular culture is not set'; end if;
    balance:=coalesce((state_row.settings#>>'{economy,prestige}')::numeric,0);
    if balance<5 then raise exception 'Finding a spouse costs 5 prestige'; end if;
    select year into current_year from public.game_calendar where singleton=true;
    new_spouse:=jsonb_build_object('id',gen_random_uuid(),'name',public.pick_military_culture_name(culture,'female',null),'gender','female','age',18+floor(random()*13)::integer,'culture',culture,'origin_owner',prof.owner,'children_owner',prof.owner,'created_year',current_year);
    ruler:=jsonb_set(ruler,'{spouse}',new_spouse,true);
    perform set_config('app.allow_ruler_governance_write','on',true);
    update public.state_mechanics set settings=jsonb_set(settings,'{economy,prestige}',to_jsonb(balance-5),true),updated_at=now() where owner=prof.owner;
    update public.state_mechanics set settings=jsonb_set(settings,'{ruler}',ruler,true),updated_at=now() where owner=prof.owner;
    return ruler;
end;$function$;

drop function if exists public.create_dynastic_marriage_proposal(text,text);
create or replace function public.create_dynastic_marriage_proposal(p_target_owner text,p_heirs_owner text,p_child_id text)
returns uuid language plpgsql security definer set search_path='' as $function$
declare prof public.profiles%rowtype; source_state public.state_mechanics%rowtype; target_state public.state_mechanics%rowtype; ruler jsonb; child jsonb; current_turn integer; proposal_id uuid;
begin
    select * into prof from public.profiles where id=(select auth.uid());
    if not found or prof.role<>'player' or nullif(prof.owner,'') is null then raise exception 'State player required' using errcode='42501'; end if;
    if p_target_owner=prof.owner or p_heirs_owner not in (prof.owner,p_target_owner) then raise exception 'Choose another state and a valid heir state'; end if;
    if not exists(select 1 from public.profiles where owner=p_target_owner and role='player') then raise exception 'Dynastic marriage must be proposed to another player state'; end if;
    select * into source_state from public.state_mechanics where owner=prof.owner for update;
    select * into target_state from public.state_mechanics where owner=p_target_owner;
    if not found then raise exception 'Target state not found'; end if;
    ruler:=coalesce(source_state.settings->'ruler','{}'::jsonb);
    select value into child from jsonb_array_elements(coalesce(ruler->'children','[]'::jsonb)) where value->>'id'=p_child_id limit 1;
    if child is null or coalesce((child->>'age')::integer,0)<16 or coalesce(child->>'gender','') not in ('male','female') or (child ? 'spouse' and child->'spouse'<>'null'::jsonb) then raise exception 'Choose an unmarried adult child'; end if;
    select turn into current_turn from public.game_calendar where singleton=true;
    insert into public.state_dynastic_marriage_proposals(proposer_owner,target_owner,heirs_owner,spouse,proposer_child_id,created_turn)
    values(prof.owner,p_target_owner,p_heirs_owner,child,p_child_id,coalesce(current_turn,0)) returning id into proposal_id;
    return proposal_id;
end;$function$;

drop function if exists public.decide_dynastic_marriage_proposal(uuid,boolean);
create or replace function public.decide_dynastic_marriage_proposal(p_proposal_id uuid,p_approve boolean,p_target_child_id text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare prof public.profiles%rowtype; proposal public.state_dynastic_marriage_proposals%rowtype; source_state public.state_mechanics%rowtype; target_state public.state_mechanics%rowtype; source_ruler jsonb; target_ruler jsonb; source_child jsonb; target_child jsonb; source_children jsonb; target_children jsonb; source_spouse jsonb; target_spouse jsonb; source_balance numeric; target_balance numeric; source_cap numeric; target_cap numeric;
begin
    select * into prof from public.profiles where id=(select auth.uid());
    if not found then raise exception 'Authentication required' using errcode='42501'; end if;
    select * into proposal from public.state_dynastic_marriage_proposals where id=p_proposal_id for update;
    if not found or proposal.status<>'pending' then raise exception 'Pending marriage proposal not found'; end if;
    if prof.role='admin' then
        if p_approve then update public.state_dynastic_marriage_proposals set admin_approved=true where id=proposal.id returning * into proposal;
        else update public.state_dynastic_marriage_proposals set status='rejected',resolved_at=now() where id=proposal.id returning * into proposal; end if;
    elsif prof.role='player' and prof.owner=proposal.target_owner then
        if p_approve then
            if nullif(p_target_child_id,'') is null then raise exception 'Choose your unmarried adult child'; end if;
            select * into target_state from public.state_mechanics where owner=proposal.target_owner for update;
            target_ruler:=coalesce(target_state.settings->'ruler','{}'::jsonb);
            select value into target_child from jsonb_array_elements(coalesce(target_ruler->'children','[]'::jsonb)) where value->>'id'=p_target_child_id limit 1;
            if target_child is null or coalesce((target_child->>'age')::integer,0)<16 or target_child->>'gender'=proposal.spouse->>'gender' or coalesce(target_child->>'gender','') not in ('male','female') or (target_child ? 'spouse' and target_child->'spouse'<>'null'::jsonb) then raise exception 'Choose an unmarried adult child of the opposite sex'; end if;
            update public.state_dynastic_marriage_proposals set player_approved=true,target_child_id=p_target_child_id,target_child=target_child where id=proposal.id returning * into proposal;
        else update public.state_dynastic_marriage_proposals set status='rejected',resolved_at=now() where id=proposal.id returning * into proposal; end if;
    else raise exception 'Only the target state or administrator may decide this proposal' using errcode='42501'; end if;
    if proposal.player_approved and proposal.admin_approved then
        select * into source_state from public.state_mechanics where owner=proposal.proposer_owner for update;
        select * into target_state from public.state_mechanics where owner=proposal.target_owner for update;
        source_ruler:=coalesce(source_state.settings->'ruler','{}'::jsonb);
        target_ruler:=coalesce(target_state.settings->'ruler','{}'::jsonb);
        select value into source_child from jsonb_array_elements(coalesce(source_ruler->'children','[]'::jsonb)) where value->>'id'=proposal.proposer_child_id limit 1;
        select value into target_child from jsonb_array_elements(coalesce(target_ruler->'children','[]'::jsonb)) where value->>'id'=proposal.target_child_id limit 1;
        if source_child is null or target_child is null or coalesce((source_child->>'age')::integer,0)<16 or coalesce((target_child->>'age')::integer,0)<16 then raise exception 'Both chosen children must still exist and be adults'; end if;
        if source_child->>'gender'=target_child->>'gender' or coalesce(source_child->>'gender','') not in ('male','female') or coalesce(target_child->>'gender','') not in ('male','female') then raise exception 'Dynastic spouses must be of opposite sexes'; end if;
        if (source_child ? 'spouse' and source_child->'spouse'<>'null'::jsonb) or (target_child ? 'spouse' and target_child->'spouse'<>'null'::jsonb) then raise exception 'One of the chosen children is already married'; end if;
        source_spouse:=jsonb_build_object('id',target_child->'id','name',target_child->'name','gender',target_child->'gender','age',target_child->'age','culture',coalesce(target_child->>'culture',target_state.settings->>'titular_culture'),'origin_owner',proposal.target_owner,'children_owner',proposal.heirs_owner,'marriage_id',proposal.id);
        target_spouse:=jsonb_build_object('id',source_child->'id','name',source_child->'name','gender',source_child->'gender','age',source_child->'age','culture',coalesce(source_child->>'culture',source_state.settings->>'titular_culture'),'origin_owner',proposal.proposer_owner,'children_owner',proposal.heirs_owner,'marriage_id',proposal.id);
        select coalesce(jsonb_agg(case when value->>'id'=proposal.proposer_child_id then jsonb_set(jsonb_set(value,'{spouse}',source_spouse,true),'{marriage_id}',to_jsonb(proposal.id),true) else value end),'[]'::jsonb) into source_children from jsonb_array_elements(coalesce(source_ruler->'children','[]'::jsonb));
        select coalesce(jsonb_agg(case when value->>'id'=proposal.target_child_id then jsonb_set(jsonb_set(value,'{spouse}',target_spouse,true),'{marriage_id}',to_jsonb(proposal.id),true) else value end),'[]'::jsonb) into target_children from jsonb_array_elements(coalesce(target_ruler->'children','[]'::jsonb));
        source_ruler:=jsonb_set(source_ruler,'{children}',source_children,true);
        target_ruler:=jsonb_set(target_ruler,'{children}',target_children,true);
        select 30+20*count(*) into source_cap from public.markers where owner=proposal.proposer_owner and type='large_city';
        select 30+20*count(*) into target_cap from public.markers where owner=proposal.target_owner and type='large_city';
        source_balance:=least(source_cap,coalesce((source_state.settings#>>'{economy,prestige}')::numeric,0)+10);
        target_balance:=least(target_cap,coalesce((target_state.settings#>>'{economy,prestige}')::numeric,0)+10);
        perform set_config('app.allow_ruler_governance_write','on',true);
        update public.state_mechanics set settings=jsonb_set(jsonb_set(settings,'{ruler}',source_ruler,true),'{economy,prestige}',to_jsonb(source_balance),true),updated_at=now() where owner=proposal.proposer_owner;
        update public.state_mechanics set settings=jsonb_set(jsonb_set(settings,'{ruler}',target_ruler,true),'{economy,prestige}',to_jsonb(target_balance),true),updated_at=now() where owner=proposal.target_owner;
        update public.state_dynastic_marriage_proposals set status='approved',resolved_at=now() where id=proposal.id;
    end if;
    return jsonb_build_object('status',(select status from public.state_dynastic_marriage_proposals where id=proposal.id),'player_approved',proposal.player_approved,'admin_approved',proposal.admin_approved);
end;$function$;

create or replace function public.process_dynastic_calendar()
returns trigger language plpgsql security definer set search_path='' as $function$
declare state_row public.state_mechanics%rowtype; ruler jsonb; spouse jsonb; children jsonb; spouse_age integer; last_age_year integer; pregnancy_due integer; child_owner text; child_state public.state_mechanics%rowtype; child_ruler jsonb; child_name text; child_culture text; child_gender text; year_advanced boolean;
begin
    year_advanced:=new.year>old.year;
    perform set_config('app.allow_ruler_governance_write','on',true);
    for state_row in select * from public.state_mechanics where settings ? 'ruler' loop
        ruler:=coalesce(state_row.settings->'ruler','{}'::jsonb);
        spouse:=coalesce(ruler->'spouse','{}'::jsonb);
        children:=coalesce(ruler->'children','[]'::jsonb);
        if year_advanced and coalesce((ruler->>'dynasty_last_age_year')::integer,old.year)<new.year then
            if spouse<>'{}'::jsonb then spouse:=jsonb_set(spouse,'{age}',to_jsonb(coalesce((spouse->>'age')::integer,18)+1),true); end if;
            select coalesce(jsonb_agg(case when jsonb_typeof(item->'spouse')='object' then jsonb_set(jsonb_set(item,'{age}',to_jsonb(coalesce((item->>'age')::integer,0)+1),true),'{spouse,age}',to_jsonb(coalesce((item#>>'{spouse,age}')::integer,18)+1),true) else jsonb_set(item,'{age}',to_jsonb(coalesce((item->>'age')::integer,0)+1),true) end),'[]'::jsonb) into children from jsonb_array_elements(children) item;
            ruler:=jsonb_set(ruler,'{children}',children,true);
            ruler:=jsonb_set(ruler,'{dynasty_last_age_year}',to_jsonb(new.year),true);
        end if;
        pregnancy_due:=nullif(ruler->>'pregnancy_due_turn','')::integer;
        if pregnancy_due is not null and pregnancy_due<=new.turn and spouse<>'{}'::jsonb then
            child_owner:=coalesce(spouse->>'children_owner',state_row.owner);
            if child_owner=state_row.owner then
                child_ruler:=ruler; child_culture:=state_row.settings->>'titular_culture';
            else
                select * into child_state from public.state_mechanics where owner=child_owner for update;
                child_ruler:=coalesce(child_state.settings->'ruler','{}'::jsonb); child_culture:=coalesce(child_state.settings->>'titular_culture',state_row.settings->>'titular_culture');
            end if;
            child_gender:=case when random()<0.5 then 'male' else 'female' end;
            child_name:=public.pick_military_culture_name(child_culture,child_gender,null);
            child_ruler:=jsonb_set(child_ruler,'{children}',coalesce(child_ruler->'children','[]'::jsonb)||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'name',child_name,'gender',child_gender,'age',0,'mother',spouse->>'name','father',ruler->>'name','born_year',new.year,'dynasty_owner',child_owner)),true);
            spouse:=jsonb_set(spouse,'{children_count}',to_jsonb(coalesce((spouse->>'children_count')::integer,0)+1),true);
            ruler:=jsonb_set(ruler,'{spouse}',spouse,true);
            ruler:=ruler-'pregnancy_due_turn';
            if child_owner=state_row.owner then ruler:=child_ruler;
            else update public.state_mechanics set settings=jsonb_set(settings,'{ruler}',child_ruler,true),updated_at=now() where owner=child_owner; end if;
        elsif year_advanced and spouse<>'{}'::jsonb and not (ruler ? 'pregnancy_due_turn') and coalesce((spouse->>'children_count')::integer,0)<3 then
            spouse_age:=coalesce((spouse->>'age')::integer,18);
            if spouse_age between 18 and 45 and coalesce((ruler->>'last_conception_year')::integer,0)<new.year and random()<(case when spouse_age<=40 then 0.25 else 0.10 end) then
                ruler:=jsonb_set(ruler,'{pregnancy_due_turn}',to_jsonb(new.turn+3),true);
                ruler:=jsonb_set(ruler,'{last_conception_year}',to_jsonb(new.year),true);
            elsif spouse_age between 18 and 45 then ruler:=jsonb_set(ruler,'{last_conception_year}',to_jsonb(new.year),true); end if;
            ruler:=jsonb_set(ruler,'{spouse}',spouse,true);
        end if;
        if year_advanced or pregnancy_due is not null or ruler is distinct from coalesce(state_row.settings->'ruler','{}'::jsonb) then
            update public.state_mechanics set settings=jsonb_set(settings,'{ruler}',ruler,true),updated_at=now() where owner=state_row.owner;
        end if;
    end loop;
    return new;
end;$function$;
revoke all on function public.process_dynastic_calendar() from public,anon,authenticated;
drop trigger if exists process_dynastic_calendar on public.game_calendar;
create trigger process_dynastic_calendar after update of turn on public.game_calendar for each row when (new.turn is distinct from old.turn) execute function public.process_dynastic_calendar();

create or replace function public.process_ruler_age_and_succession()
returns trigger language plpgsql security definer set search_path='' as $function$
declare ruler jsonb; government text; ruler_age integer; current_year integer; current_turn integer; last_checked integer; term_end integer; chance numeric; roll numeric; next_name text; next_title text; next_age integer; next_gender text; next_child jsonb;
begin
    ruler:=coalesce(new.settings->'ruler','{}'::jsonb);
    if nullif(ruler->>'name','') is null or ruler->>'age' is null then return new; end if;
    select year,turn into current_year,current_turn from public.game_calendar where singleton=true;
    ruler_age:=greatest(0,coalesce((ruler->>'age')::integer,0));
    last_checked:=coalesce((ruler->>'last_death_check_year')::integer,0);
    if last_checked>=current_year or ruler->>'status'='vacant' then return new; end if;
    if ruler->>'status'='regency' then
        if ruler_age<16 then return new; end if;
        ruler:=jsonb_set(ruler,'{status}','"active"'::jsonb,true);
        ruler:=ruler-'regent_name';
    end if;
    government:=coalesce(new.settings->>'government_form','');
    chance:=case when ruler_age>=50 then least(100.0,0.5*power(2.0,(ruler_age-50)/5.0)) else 0 end;
    roll:=mod(abs(hashtextextended(new.owner||':'||current_year||':ruler',0)::numeric),1000000)/10000.0;
    ruler:=jsonb_set(ruler,'{last_death_check_year}',to_jsonb(current_year),true);
    ruler:=jsonb_set(ruler,'{last_death_roll}',to_jsonb(roll),true);
    if roll<chance then
        if government in ('Феодальная монархия','Вождество') then
            if nullif(ruler->>'heir_name','') is not null and coalesce((ruler->>'heir_age')::integer,0)>=16 then
                next_name:=ruler->>'heir_name'; next_age:=(ruler->>'heir_age')::integer;
                select child into next_child from jsonb_array_elements(coalesce(ruler->'children','[]'::jsonb)) child where child->>'name'=next_name order by coalesce((child->>'age')::integer,0) desc limit 1;
            else
                select child into next_child from jsonb_array_elements(coalesce(ruler->'children','[]'::jsonb)) child order by coalesce((child->>'age')::integer,0) desc limit 1;
                next_name:=next_child->>'name'; next_age:=nullif(next_child->>'age','')::integer;
            end if;
            if nullif(next_name,'') is not null then
                next_title:=case government when 'Феодальная монархия' then 'Князь' else 'Вождь' end;
                next_gender:=coalesce(next_child->>'gender',ruler->>'gender','male');
                ruler:=jsonb_set(ruler,'{name}',to_jsonb(next_name),true); ruler:=jsonb_set(ruler,'{title}',to_jsonb(next_title),true);
                ruler:=jsonb_set(ruler,'{age}',to_jsonb(greatest(0,coalesce(next_age,16))),true); ruler:=jsonb_set(ruler,'{gender}',to_jsonb(next_gender),true);
                if jsonb_typeof(next_child->'spouse')='object' then ruler:=jsonb_set(ruler,'{spouse}',next_child->'spouse',true); else ruler:=ruler-'spouse'; end if;
                if coalesce(next_age,16)<16 then ruler:=jsonb_set(ruler,'{status}','"regency"'::jsonb,true); ruler:=jsonb_set(ruler,'{regent_name}','"Совет регентства"'::jsonb,true);
                else ruler:=jsonb_set(ruler,'{status}','"active"'::jsonb,true); ruler:=ruler-'regent_name'; end if;
                ruler:=ruler-'heir_name'-'heir_age'-'deceased_name'-'vacant_since_turn'-'elected_effects';
                ruler:=jsonb_set(ruler,'{last_death_check_year}',to_jsonb(current_year),true);
            else
                ruler:=jsonb_set(ruler,'{deceased_name}',to_jsonb(coalesce(ruler->>'name','Правитель')),true); ruler:=jsonb_set(ruler,'{status}','"vacant"'::jsonb,true);
                ruler:=jsonb_set(ruler,'{vacant_since_turn}',to_jsonb(current_turn),true); ruler:=jsonb_set(ruler,'{name}','""'::jsonb,true); ruler:=ruler-'term_end_year'-'elected_effects';
            end if;
        else
            ruler:=jsonb_set(ruler,'{deceased_name}',to_jsonb(coalesce(ruler->>'name','Правитель')),true); ruler:=jsonb_set(ruler,'{status}','"vacant"'::jsonb,true);
            ruler:=jsonb_set(ruler,'{vacant_since_turn}',to_jsonb(current_turn),true); ruler:=jsonb_set(ruler,'{name}','""'::jsonb,true); ruler:=ruler-'term_end_year'-'elected_effects';
        end if;
        perform set_config('app.allow_ruler_governance_write','on',true);
        update public.state_mechanics set settings=jsonb_set(settings,'{ruler}',ruler,true),updated_at=now() where owner=new.owner;
        return new;
    end if;
    if government='Вечевая республика' then
        term_end:=nullif(ruler->>'term_end_year','')::integer;
        if term_end is null then term_end:=current_year+4; ruler:=jsonb_set(ruler,'{term_start_year}',to_jsonb(current_year),true); ruler:=jsonb_set(ruler,'{term_end_year}',to_jsonb(term_end),true); end if;
        if current_year>=term_end then
            ruler:=jsonb_set(ruler,'{status}','"vacant"'::jsonb,true); ruler:=jsonb_set(ruler,'{name}','""'::jsonb,true);
            ruler:=jsonb_set(ruler,'{vacant_since_turn}',to_jsonb(current_turn),true); ruler:=ruler-'term_end_year'-'elected_effects';
        end if;
    end if;
    perform set_config('app.allow_ruler_governance_write','on',true);
    update public.state_mechanics set settings=jsonb_set(settings,'{ruler}',ruler,true),updated_at=now() where owner=new.owner;
    return new;
end;$function$;

create or replace function public.set_state_ruler_heir(p_name text,p_age integer)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare profile public.profiles%rowtype; settings_row public.state_mechanics%rowtype; ruler jsonb; heir jsonb;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role<>'player' then raise exception 'Only a state player can appoint an heir' using errcode='42501'; end if;
    if length(btrim(coalesce(p_name,''))) not between 1 and 80 or p_age is null or p_age not between 16 and 100 then raise exception 'Choose an adult child as heir'; end if;
    select * into settings_row from public.state_mechanics where owner=profile.owner for update;
    if settings_row.settings->>'government_form' not in ('Феодальная монархия','Вождество') then raise exception 'This form of government does not appoint a dynastic heir'; end if;
    ruler:=coalesce(settings_row.settings->'ruler','{}'::jsonb);
    if ruler->>'status'<>'active' then raise exception 'The ruler must be active to appoint an heir'; end if;
    select child into heir from jsonb_array_elements(coalesce(ruler->'children','[]'::jsonb)) child where child->>'name'=btrim(p_name) and coalesce((child->>'age')::integer,0)=p_age and p_age>=16 limit 1;
    if heir is null then raise exception 'The selected heir must be an adult child in the dynasty'; end if;
    ruler:=jsonb_set(ruler,'{heir_name}',to_jsonb(btrim(p_name)),true); ruler:=jsonb_set(ruler,'{heir_age}',to_jsonb(p_age),true);
    if heir ? 'id' then ruler:=jsonb_set(ruler,'{heir_character_id}',heir->'id',true); end if;
    perform set_config('app.allow_ruler_governance_write','on',true);
    update public.state_mechanics set settings=jsonb_set(settings,'{ruler}',ruler,true),updated_at=now() where owner=profile.owner;
    return ruler;
end;$function$;

revoke all on function public.open_state_governance(text),public.elect_state_ruler(text),public.find_local_ruler_spouse(),public.create_dynastic_marriage_proposal(text,text,text),public.decide_dynastic_marriage_proposal(uuid,boolean,text),public.set_state_ruler_heir(text,integer) from public,anon;
grant execute on function public.open_state_governance(text),public.elect_state_ruler(text),public.find_local_ruler_spouse(),public.create_dynastic_marriage_proposal(text,text,text),public.decide_dynastic_marriage_proposal(uuid,boolean,text),public.set_state_ruler_heir(text,integer) to authenticated;

create or replace function public.protect_player_ruler_fields()
returns trigger language plpgsql security definer set search_path='' as $function$
declare actor_role text; old_ruler jsonb; new_ruler jsonb; key_name text;
begin
    select role into actor_role from public.profiles where id=(select auth.uid());
    if actor_role is distinct from 'player' or current_setting('app.allow_ruler_governance_write',true)='on' then return new; end if;
    old_ruler:=coalesce(old.settings->'ruler','{}'::jsonb);
    new_ruler:=coalesce(new.settings->'ruler','{}'::jsonb);
    foreach key_name in array array['age','status','deceased_name','vacant_since_turn','last_death_check_year','last_death_roll','last_age_year','term_start_year','term_end_year','proposal_name','proposal_title','proposal_age','proposal_turn','spouse','children','dynasty_last_age_year','pregnancy_due_turn','last_conception_year','election_candidates','election_year','elected_effects','marriage_id','heir_name','heir_age','heir_character_id'] loop
        if old_ruler ? key_name then new_ruler:=jsonb_set(new_ruler,array[key_name],old_ruler->key_name,true); else new_ruler:=new_ruler-key_name; end if;
    end loop;
    if coalesce(old_ruler->>'status','active')='vacant' then
        foreach key_name in array array['name','title','heir_name','heir_age','heir_character_id'] loop
            if old_ruler ? key_name then new_ruler:=jsonb_set(new_ruler,array[key_name],old_ruler->key_name,true); else new_ruler:=new_ruler-key_name; end if;
        end loop;
    end if;
    new.settings:=jsonb_set(coalesce(new.settings,'{}'::jsonb),'{ruler}',new_ruler,true);
    return new;
end;$function$;
notify pgrst,'reload schema';
notify pgrst,'reload schema';
