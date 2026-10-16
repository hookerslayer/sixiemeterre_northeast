-- Existing offers are still available immediately after the name-pool change.
-- Refresh their commander names from each market town's local culture while
-- preserving the offered unit group, age, contract state, and hired characters.
update public.military_mercenary_market offer
   set culture=source.local_culture,
       commander_name=public.pick_military_culture_name(
           source.local_culture,'male',hashtextextended(offer.marker_id::text||':'||offer.slot::text||':'||calendar.turn::text,0)/7919
       ),
       updated_at=now()
  from public.markers marker
  left join public."Provinces" province on province.id=marker.province_id
  left join public.state_mechanics mechanics on mechanics.owner=marker.owner
  cross join public.game_calendar calendar
  cross join lateral (select coalesce(nullif(marker.culture,''),nullif(province.main_culture,''),mechanics.settings->>'titular_culture','Новгородцы') as local_culture) source
 where offer.marker_id=marker.id and offer.available;
