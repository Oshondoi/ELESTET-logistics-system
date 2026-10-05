begin;
-- Legacy placeholders accepted client amounts and had PUBLIC EXECUTE.
-- Keep historical orders; close direct client creation/activation.
revoke all on function public.create_payment_order(uuid,uuid,text,integer,numeric,integer) from public,anon,authenticated;
revoke all on function public.activate_plan_by_payment(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_payment_order(uuid,uuid,text,integer,numeric,integer) to service_role;
grant execute on function public.activate_plan_by_payment(uuid,text,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
