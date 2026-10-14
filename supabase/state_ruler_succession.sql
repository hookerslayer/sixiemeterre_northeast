-- Annual ruler ageing/death and form-of-government succession.
create or replace function public.protect_player_ruler_fields()
returns trigger language plpgsql security definer set search_path='' as $function$
declare actor_role text; old_ruler jsonb; new_ruler jsonb; key_name text;
begin
    select role into actor_role from public.profiles where id=(select auth.uid());
    if actor_role is distinct from 'player' then return new; end if;
    old_ruler:=coalesce(old.settings->'ruler','{}'::jsonb);
    new_ruler:=coalesce(new.settings->'ruler','{}'::jsonb);
    foreach key_name in array array['age','status','deceased_name','vacant_since_turn','last_death_check_year','term_start_year','term_end_year','proposal_name','proposal_title','proposal_age'] loop
        if old_ruler ? key_name then new_ruler:=jsonb_set(new_ruler,array[key_name],old_ruler->key_name,true);
        else new_ruler:=new_ruler-key_name; end if;
    end loop;
    if coalesce(old_ruler->>'status','active')='vacant' then
        foreach key_name in array array['name','title','heir_name','heir_age'] loop
            if old_ruler ? key_name then new_ruler:=jsonb_set(new_ruler,array[key_name],old_ruler->key_name,true);
            else new_ruler:=new_ruler-key_name; end if;
        end loop;
    else
        if coalesce(new.settings->>'government_form','')<>'Феодальная монархия' then
            new_ruler:=new_ruler-'heir_name'-'heir_age';
        end if;
    end if;
    new.settings:=jsonb_set(coalesce(new.settings,'{}'::jsonb),'{ruler}',new_ruler,true);
    return new;
end;$function$;
revoke all on function public.protect_player_ruler_fields() from public,anon,authenticated;
drop trigger if exists protect_player_ruler_fields on public.state_mechanics;
create trigger protect_player_ruler_fields before update of settings on public.state_mechanics for each row execute function public.protect_player_ruler_fields();

create or replace function public.process_ruler_age_and_succession()
returns trigger language plpgsql security definer set search_path='' as $function$
declare ruler jsonb; government text; ruler_age integer; current_year integer; current_turn integer; last_checked integer; term_end integer; chance numeric; roll numeric; next_name text; next_title text; next_age integer;
begin
    ruler:=coalesce(new.settings->'ruler','{}'::jsonb);
    if nullif(ruler->>'name','') is null or (ruler->>'age') is null then return new; end if;
    select year,turn into current_year,current_turn from public.game_calendar where singleton=true;
    ruler_age:=greatest(0,coalesce((ruler->>'age')::integer,0));
    last_checked:=coalesce((ruler->>'last_death_check_year')::integer,0);
    if last_checked>=current_year or ruler->>'status'='vacant' then return new; end if;
    government:=coalesce(new.settings->>'government_form','');
    chance:=case when ruler_age>=50 then least(100.0,0.5*power(2.0,(ruler_age-50)/5.0)) else 0 end;
    roll:=mod(abs(hashtextextended(new.owner||':'||current_year||':ruler',0)::numeric),1000000)/10000.0;
    ruler:=jsonb_set(ruler,'{last_death_check_year}',to_jsonb(current_year),true);
    ruler:=jsonb_set(ruler,'{last_death_roll}',to_jsonb(roll),true);
    if roll<chance then
        if government='Феодальная монархия' and nullif(ruler->>'heir_name','') is not null and (ruler->>'heir_age') is not null then
            next_name:=ruler->>'heir_name'; next_age:=greatest(16,least(100,(ruler->>'heir_age')::integer));
            ruler:=jsonb_set(ruler,'{name}',to_jsonb(next_name),true);
            ruler:=jsonb_set(ruler,'{age}',to_jsonb(next_age),true);
            ruler:=jsonb_set(ruler,'{status}','"active"'::jsonb,true);
            ruler:=ruler-'heir_name'-'heir_age'-'deceased_name'-'vacant_since_turn';
            ruler:=jsonb_set(ruler,'{last_death_check_year}',to_jsonb(current_year),true);
        else
            ruler:=jsonb_set(ruler,'{deceased_name}',to_jsonb(coalesce(ruler->>'name','Правитель')),true);
            ruler:=jsonb_set(ruler,'{status}','"vacant"'::jsonb,true);
            ruler:=jsonb_set(ruler,'{vacant_since_turn}',to_jsonb(current_turn),true);
            ruler:=jsonb_set(ruler,'{name}','""'::jsonb,true);
            ruler:=ruler-'term_end_year';
        end if;
        update public.state_mechanics set settings=jsonb_set(settings,'{ruler}',ruler,true),updated_at=now() where owner=new.owner;
        return new;
    end if;
    if government='Вечевая республика' then
        term_end:=nullif(ruler->>'term_end_year','')::integer;
        if term_end is null then term_end:=current_year+4; ruler:=jsonb_set(ruler,'{term_start_year}',to_jsonb(current_year),true); ruler:=jsonb_set(ruler,'{term_end_year}',to_jsonb(term_end),true); end if;
        if current_year>=term_end then
            ruler:=jsonb_set(ruler,'{status}','"vacant"'::jsonb,true);
            ruler:=jsonb_set(ruler,'{name}','""'::jsonb,true);
            ruler:=jsonb_set(ruler,'{vacant_since_turn}',to_jsonb(current_turn),true);
            ruler:=ruler-'term_end_year';
        end if;
    end if;
    update public.state_mechanics set settings=jsonb_set(settings,'{ruler}',ruler,true),updated_at=now() where owner=new.owner;
    return new;
end;$function$;
revoke all on function public.process_ruler_age_and_succession() from public,anon,authenticated;
drop trigger if exists process_ruler_age_and_succession on public.state_mechanics;
create trigger process_ruler_age_and_succession after update of settings on public.state_mechanics
for each row when ((new.settings#>>'{ruler,age}') is distinct from (old.settings#>>'{ruler,age}')) execute function public.process_ruler_age_and_succession();

create or replace function public.set_state_ruler_heir(p_name text,p_age integer)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare profile public.profiles%rowtype; settings_row public.state_mechanics%rowtype; ruler jsonb;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role<>'player' then raise exception 'Only a state player can appoint an heir' using errcode='42501'; end if;
    if length(btrim(coalesce(p_name,''))) not between 1 and 80 or p_age is null or p_age not between 16 and 100 then raise exception 'Enter a valid heir name and age'; end if;
    select * into settings_row from public.state_mechanics where owner=profile.owner for update;
    if settings_row.settings->>'government_form'<>'Феодальная монархия' then raise exception 'Only a feudal monarchy appoints an heir'; end if;
    ruler:=coalesce(settings_row.settings->'ruler','{}'::jsonb);
    if ruler->>'status'='vacant' then raise exception 'The throne is vacant; submit a successor proposal for administrator approval'; end if;
    ruler:=jsonb_set(ruler,'{heir_name}',to_jsonb(btrim(p_name)),true);
    ruler:=jsonb_set(ruler,'{heir_age}',to_jsonb(p_age),true);
    update public.state_mechanics set settings=jsonb_set(settings,'{ruler}',ruler,true),updated_at=now() where owner=profile.owner;
    return ruler;
end;$function$;

create or replace function public.propose_state_ruler(p_name text,p_title text,p_age integer)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare profile public.profiles%rowtype; settings_row public.state_mechanics%rowtype; ruler jsonb;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role<>'player' then raise exception 'Only a state player can propose a successor' using errcode='42501'; end if;
    if length(btrim(coalesce(p_name,''))) not between 1 and 80 or length(btrim(coalesce(p_title,'')))>80 or p_age is null or p_age not between 16 and 100 then raise exception 'Enter a valid candidate name, title and age'; end if;
    select * into settings_row from public.state_mechanics where owner=profile.owner for update;
    ruler:=coalesce(settings_row.settings->'ruler','{}'::jsonb);
    if ruler->>'status'<>'vacant' then raise exception 'A successor proposal is accepted only while the office is vacant'; end if;
    ruler:=jsonb_set(ruler,'{proposal_name}',to_jsonb(btrim(p_name)),true);
    ruler:=jsonb_set(ruler,'{proposal_title}',to_jsonb(btrim(p_title)),true);
    ruler:=jsonb_set(ruler,'{proposal_age}',to_jsonb(p_age),true);
    ruler:=jsonb_set(ruler,'{proposal_turn}',to_jsonb((select turn from public.game_calendar where singleton=true)),true);
    update public.state_mechanics set settings=jsonb_set(settings,'{ruler}',ruler,true),updated_at=now() where owner=profile.owner;
    return ruler;
end;$function$;

create or replace function public.resolve_state_ruler_proposal(p_owner text,p_approve boolean)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare profile public.profiles%rowtype; settings_row public.state_mechanics%rowtype; ruler jsonb; current_year integer;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role<>'admin' then raise exception 'Only an administrator can resolve ruler proposals' using errcode='42501'; end if;
    select * into settings_row from public.state_mechanics where owner=p_owner for update;
    ruler:=coalesce(settings_row.settings->'ruler','{}'::jsonb);
    if ruler->>'status'<>'vacant' or nullif(ruler->>'proposal_name','') is null then raise exception 'No pending successor proposal'; end if;
    select year into current_year from public.game_calendar where singleton=true;
    if p_approve then
        ruler:=jsonb_set(ruler,'{name}',ruler->'proposal_name',true);
        ruler:=jsonb_set(ruler,'{title}',coalesce(ruler->'proposal_title','""'::jsonb),true);
        ruler:=jsonb_set(ruler,'{age}',ruler->'proposal_age',true);
        ruler:=jsonb_set(ruler,'{status}','"active"'::jsonb,true);
        ruler:=ruler-'proposal_name'-'proposal_title'-'proposal_age'-'proposal_turn'-'deceased_name'-'vacant_since_turn';
        ruler:=jsonb_set(ruler,'{last_death_check_year}',to_jsonb(current_year),true);
        if settings_row.settings->>'government_form'='Вечевая республика' then
            ruler:=jsonb_set(ruler,'{term_start_year}',to_jsonb(current_year),true);
            ruler:=jsonb_set(ruler,'{term_end_year}',to_jsonb(current_year+4),true);
        end if;
    else ruler:=ruler-'proposal_name'-'proposal_title'-'proposal_age'-'proposal_turn'; end if;
    update public.state_mechanics set settings=jsonb_set(settings,'{ruler}',ruler,true),updated_at=now() where owner=p_owner;
    return ruler;
end;$function$;

revoke all on function public.set_state_ruler_heir(text,integer),public.propose_state_ruler(text,text,integer),public.resolve_state_ruler_proposal(text,boolean) from public,anon;
grant execute on function public.set_state_ruler_heir(text,integer),public.propose_state_ruler(text,text,integer) to authenticated;
grant execute on function public.resolve_state_ruler_proposal(text,boolean) to authenticated;
