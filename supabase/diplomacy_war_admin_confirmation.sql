-- War declarations are submitted by the initiator and require administrator approval only.
create or replace function public.create_diplomacy_proposal(p_target_owner text,p_action text)
returns uuid language plpgsql security definer set search_path='' as $$
declare prof public.profiles%rowtype; turn_no integer; relation_row public.state_diplomatic_relations%rowtype; a text; b text; new_id uuid;
begin
    select * into prof from public.profiles where id=(select auth.uid());
    if not found or prof.role<>'player' or prof.owner is null then raise exception 'Player state required' using errcode='42501'; end if;
    if p_target_owner is null or p_target_owner=prof.owner or not exists(select 1 from public.state_mechanics where owner=p_target_owner) then raise exception 'Unknown target state'; end if;
    if p_action not in ('non_aggression','alliance','peace','war','end_treaty') then raise exception 'Unsupported diplomatic proposal'; end if;
    a:=least(prof.owner,p_target_owner); b:=greatest(prof.owner,p_target_owner);
    insert into public.state_diplomatic_relations(owner_a,owner_b) values(a,b) on conflict do nothing;
    select * into relation_row from public.state_diplomatic_relations where owner_a=a and owner_b=b for update;
    if p_action='war' and relation_row.treaty='alliance' then raise exception 'End the alliance before declaring war'; end if;
    if p_action='peace' and relation_row.state<>'war' then raise exception 'Peace can only be proposed during war'; end if;
    if p_action='non_aggression' and relation_row.treaty='alliance' then raise exception 'The alliance must be ended first'; end if;
    if p_action='alliance' and relation_row.treaty='non_aggression' then raise exception 'End the non-aggression pact first'; end if;
    if p_action='end_treaty' and relation_row.treaty='none' then raise exception 'There is no pact or alliance to end'; end if;
    if exists(select 1 from public.state_diplomatic_proposals p where p.status='pending' and p.action=p_action and ((p.proposer_owner=prof.owner and p.target_owner=p_target_owner) or (p.proposer_owner=p_target_owner and p.target_owner=prof.owner))) then raise exception 'A matching proposal is already pending'; end if;
    select turn into turn_no from public.game_calendar where singleton=true;
    insert into public.state_diplomatic_proposals(proposer_owner,target_owner,action,created_turn,player_approved)
    values(prof.owner,p_target_owner,p_action,coalesce(turn_no,0),p_action='war') returning id into new_id;
    return new_id;
end $$;
revoke all on function public.create_diplomacy_proposal(text,text) from public,anon;
grant execute on function public.create_diplomacy_proposal(text,text) to authenticated;
