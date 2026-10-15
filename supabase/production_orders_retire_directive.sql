-- Remove the retired single-order entry point and clear its legacy settings.
update public.markers
   set state_order_good=null,state_order_qty=0,production_directive='civilian'
 where state_order_good is not null or state_order_qty<>0 or production_directive<>'civilian';

drop function if exists public.save_production_directive(bigint,text,text,numeric);
