do $migration$
declare definition text;
begin
    select pg_get_functiondef('public.attempt_religious_mission(text,bigint)'::regprocedure) into definition;
    definition := replace(definition,
      'select count(*) into monastery_count from public.markers where owner=profile.owner and type=''monastery'';',
      'select count(*) into monastery_count from public.markers where owner=profile.owner and type=''monastery'' and (military_controlled_by is null or military_controlled_by=profile.owner);');
    execute definition;
end;
$migration$;
