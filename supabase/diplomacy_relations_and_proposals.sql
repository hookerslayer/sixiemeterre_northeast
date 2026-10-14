-- Independent peace/war, security treaty and player/admin approval state.
create table if not exists public.state_diplomatic_relations (
    owner_a text not null references public.state_mechanics(owner) on update cascade on delete cascade,
    owner_b text not null references public.state_mechanics(owner) on update cascade on delete cascade,
    state text not null default 'peace' check (state in ('peace','war')),
    treaty text not null default 'none' check (treaty in ('none','non_aggression','alliance')),
    updated_at timestamptz not null default now(),
    primary key (owner_a,owner_b), check (owner_a < owner_b)
);
create table if not exists public.state_diplomatic_proposals (
    id uuid primary key default gen_random_uuid(),
    proposer_owner text not null references public.state_mechanics(owner) on update cascade on delete cascade,
    target_owner text not null references public.state_mechanics(owner) on update cascade on delete cascade,
    action text not null check (action in ('non_aggression','alliance','peace','war','end_treaty')),
    status text not null default 'pending' check (status in ('pending','approved','rejected')),
    player_approved boolean not null default false,
    admin_approved boolean not null default false,
    created_turn integer not null default 0,
    created_at timestamptz not null default now(),
    resolved_at timestamptz,
    check (proposer_owner <> target_owner)
);
alter table public.state_diplomatic_relations enable row level security;
alter table public.state_diplomatic_proposals enable row level security;
drop policy if exists diplomacy_relations_read on public.state_diplomatic_relations;
create policy diplomacy_relations_read on public.state_diplomatic_relations for select to authenticated using (
    exists(select 1 from public.profiles p where p.id=(select auth.uid()) and (p.role='admin' or p.owner in (owner_a,owner_b)))
);
drop policy if exists diplomacy_proposals_read on public.state_diplomatic_proposals;
create policy diplomacy_proposals_read on public.state_diplomatic_proposals for select to authenticated using (
    exists(select 1 from public.profiles p where p.id=(select auth.uid()) and (p.role='admin' or p.owner in (proposer_owner,target_owner)))
);
grant select on public.state_diplomatic_relations, public.state_diplomatic_proposals to authenticated;
revoke insert,update,delete on public.state_diplomatic_relations, public.state_diplomatic_proposals from anon,authenticated;
insert into public.state_diplomatic_relations(owner_a,owner_b)
select a.owner,b.owner from public.state_mechanics a cross join public.state_mechanics b where a.owner < b.owner on conflict do nothing;

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

create or replace function public.decide_diplomacy_proposal(p_proposal_id uuid,p_approve boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prof public.profiles%rowtype; proposal public.state_diplomatic_proposals%rowtype; a text; b text; cost numeric:=0; current_prestige numeric; relation_row public.state_diplomatic_relations%rowtype;
begin
    select * into prof from public.profiles where id=(select auth.uid());
    if not found then raise exception 'Authentication required' using errcode='42501'; end if;
    select * into proposal from public.state_diplomatic_proposals where id=p_proposal_id for update;
    if not found or proposal.status<>'pending' then raise exception 'Pending proposal not found'; end if;
    if prof.role='admin' then
        if p_approve then update public.state_diplomatic_proposals set admin_approved=true where id=proposal.id returning * into proposal;
        else update public.state_diplomatic_proposals set status='rejected',resolved_at=now() where id=proposal.id returning * into proposal; end if;
    elsif prof.role='player' and prof.owner=proposal.target_owner and proposal.action<>'war' then
        if p_approve then update public.state_diplomatic_proposals set player_approved=true where id=proposal.id returning * into proposal;
        else update public.state_diplomatic_proposals set status='rejected',resolved_at=now() where id=proposal.id returning * into proposal; end if;
    else raise exception 'Only the recipient or administrator may decide this proposal' using errcode='42501';
    end if;
    if proposal.player_approved and proposal.admin_approved then
        a:=least(proposal.proposer_owner,proposal.target_owner); b:=greatest(proposal.proposer_owner,proposal.target_owner);
        select * into relation_row from public.state_diplomatic_relations where owner_a=a and owner_b=b for update;
        cost:=case proposal.action when 'non_aggression' then 5 when 'alliance' then 10 when 'peace' then 10 when 'war' then 5 else 0 end;
        select coalesce((settings#>>'{economy,prestige}')::numeric,0) into current_prestige from public.state_mechanics where owner=proposal.proposer_owner for update;
        if proposal.action in ('non_aggression','alliance') and current_prestige<cost then raise exception 'Not enough prestige'; end if;
        update public.state_mechanics set settings=jsonb_set(settings,'{economy,prestige}',to_jsonb(current_prestige-cost),true),updated_at=now() where owner=proposal.proposer_owner;
        if proposal.action='war' then update public.state_diplomatic_relations set state='war',updated_at=now() where owner_a=a and owner_b=b;
        elsif proposal.action='peace' then update public.state_diplomatic_relations set state='peace',updated_at=now() where owner_a=a and owner_b=b;
        elsif proposal.action='non_aggression' then update public.state_diplomatic_relations set treaty='non_aggression',updated_at=now() where owner_a=a and owner_b=b;
        elsif proposal.action='alliance' then update public.state_diplomatic_relations set treaty='alliance',updated_at=now() where owner_a=a and owner_b=b;
        elsif proposal.action='end_treaty' then update public.state_diplomatic_relations set treaty='none',updated_at=now() where owner_a=a and owner_b=b; end if;
        update public.state_diplomatic_proposals set status='approved',resolved_at=now() where id=proposal.id;
    end if;
    return jsonb_build_object('status',(select status from public.state_diplomatic_proposals where id=proposal.id),'player_approved',proposal.player_approved,'admin_approved',proposal.admin_approved);
end $$;
revoke all on function public.decide_diplomacy_proposal(uuid,boolean) from public,anon;
grant execute on function public.decide_diplomacy_proposal(uuid,boolean) to authenticated;
