-- Fortification levels are now fixed by settlement type.
-- Kept as a compatibility step for projects that previously applied the
-- administrator-controlled fortification migration.
drop function if exists public.set_marker_fortification(bigint, integer);
