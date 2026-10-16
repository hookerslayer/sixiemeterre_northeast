-- Normalize the new levy statements injected into the siege function body.
do $migration$
declare definition text;
begin
    select pg_get_functiondef('public.start_military_siege(uuid,bigint)'::regprocedure) into definition;
    definition := replace(definition,chr(92)||'n',chr(10));
    execute definition;
end;
$migration$;
