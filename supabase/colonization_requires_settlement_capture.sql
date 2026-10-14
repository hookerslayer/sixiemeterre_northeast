create or replace function public.block_colonization_before_neutral_settlement_capture()
returns trigger language plpgsql security definer set search_path='' as $$
begin
    if new.status='active' and exists(
        select 1 from public.markers m
        where m.province_id=new.target_province_id and m.type<>'ruins' and m.owner is distinct from new.owner
    ) then
        raise exception 'Capture every settlement in the neutral province before colonizing it' using errcode='55000';
    end if;
    return new;
end $$;
drop trigger if exists block_colonization_before_neutral_settlement_capture on public.military_colonization_missions;
create trigger block_colonization_before_neutral_settlement_capture
before insert or update of target_province_id,owner,status on public.military_colonization_missions
for each row execute function public.block_colonization_before_neutral_settlement_capture();
revoke all on function public.block_colonization_before_neutral_settlement_capture() from public,anon,authenticated;
