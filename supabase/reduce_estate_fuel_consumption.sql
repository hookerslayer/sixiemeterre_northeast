-- Lower estate fuel demand to a sustainable level across all consumption models.
update public.estate_consumption_rates
   set aristocracy = aristocracy * 0.5,
       clergy = clergy * 0.5,
       burghers = burghers * 0.5,
       peasants = peasants * 0.5
 where need_name = 'Топливо';
