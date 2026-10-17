-- Neutral territories have a higher base conversion chance than territories
-- controlled by another state. Preserve the function's existing guards and limits.
do $migration$
declare
    definition text;
    anchor text := 'chance:=least(75,5+(previous_attempts*5));';
    replacement text := 'chance:=least(75,(case when target_owner is null then 15 else 5 end)+(previous_attempts*5));';
begin
    select pg_get_functiondef('public.attempt_religious_mission(text,bigint)'::regprocedure) into definition;
    if definition is null then
        raise exception 'attempt_religious_mission(text,bigint) is not installed';
    end if;
    if position(anchor in definition)=0 then
        raise exception 'Could not locate the current base chance calculation in attempt_religious_mission';
    end if;
    execute replace(definition,anchor,replacement);
end;
$migration$;
