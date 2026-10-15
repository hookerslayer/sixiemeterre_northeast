-- Atomically split an army and assign an already-hired commander to the new force.
create or replace function public.split_military_force_with_commander(
    p_force_id uuid,
    p_units jsonb,
    p_name text,
    p_commander_id uuid,
    p_cell_x integer,
    p_cell_y integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
    profile public.profiles%rowtype;
    officer public.military_commanders%rowtype;
    new_force_id uuid;
begin
    select * into profile from public.profiles where id=(select auth.uid());
    if not found or profile.role <> 'player' or profile.owner is null then
        raise exception 'Only a state player can split an army' using errcode='42501';
    end if;

    select * into officer from public.military_commanders
     where id=p_commander_id and owner=profile.owner and status='available'
     for update;
    if not found then raise exception 'Choose an available commander' using errcode='22023'; end if;

    new_force_id := public.split_military_force(
        p_force_id, p_units, p_name, officer.name, officer.age, p_cell_x, p_cell_y
    );
    perform public.assign_military_commander(officer.id, new_force_id);
    return new_force_id;
end;
$function$;

revoke all on function public.split_military_force_with_commander(uuid,jsonb,text,uuid,integer,integer) from public,anon;
grant execute on function public.split_military_force_with_commander(uuid,jsonb,text,uuid,integer,integer) to authenticated;
