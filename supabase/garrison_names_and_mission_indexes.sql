update public.military_forces set name=replace(name,'Постоянный гарнизон: ','Гарнизон: ')
 where is_permanent_garrison and name like 'Постоянный гарнизон:%';
create index if not exists religious_mission_events_owner_turn_idx on public.religious_mission_events(owner,turn);
