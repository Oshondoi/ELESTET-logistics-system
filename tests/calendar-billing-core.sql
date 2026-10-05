-- Run after the migration in a transaction; fixtures and all wallet operations MUST be rolled back.
do $$
declare
  v_account uuid;
  v_operation uuid := gen_random_uuid();
  v_date date;
  v_quote jsonb;
begin
  perform set_config('request.jwt.claim.role','service_role',true);
  for v_date in select generate_series('2024-01-01'::date,'2024-12-31'::date,interval '1 day')::date loop
    v_quote := public.quote_calendar_month(3000,v_date,false);
    if extract(day from v_date)<=5 and (v_quote->>'amountSom')::bigint<>3000 then raise exception 'full month not exact'; end if;
    if extract(day from (v_quote->>'endDateExclusive')::date)<>1 then raise exception 'wrong boundary'; end if;
  end loop;
  if public.quote_calendar_month(3000,'2026-04-09')->>'amountSom'<>'2500' then raise exception 'phase2'; end if;
  if public.quote_calendar_month(3000,'2026-04-14')->>'amountSom'<>'2000' then raise exception 'phase3'; end if;
  if public.quote_calendar_month(3000,'2026-12-31',true)->>'amountSom'<>'3000' then raise exception 'tomorrow year boundary'; end if;
  if public.quote_calendar_month(1,'2026-04-16')->>'amountSom'<>'1' then raise exception 'half rounding'; end if;
  select id into strict v_account from public.accounts where deleted_at is null limit 1;
  -- The outer rollback restores this existing company's wallet; no production charge is performed.
  if public.apply_company_balance_entry(v_account,v_operation,100,'plan_downgrade','rollback-test')<100 then raise exception 'credit'; end if;
  if public.apply_company_balance_entry(v_account,v_operation,100,'plan_downgrade','rollback-test')<100 then raise exception 'retry'; end if;
  if (select count(*) from public.company_balance_entries where operation_id=v_operation)<>1 then raise exception 'duplicate entry'; end if;
  begin
    perform public.apply_company_balance_entry(v_account,gen_random_uuid(),-50,'checkout','rollback-test');
    raise exception 'automatic balance spend accepted';
  exception when invalid_parameter_value then null; end;
  perform public.apply_company_balance_entry(v_account,gen_random_uuid(),-50,'checkout','rollback-test',true);
  begin
    perform public.apply_company_balance_entry(v_account,v_operation,200,'plan_downgrade','rollback-test');
    raise exception 'idempotency payload conflict accepted';
  exception when invalid_parameter_value then null; end;
  perform set_config('request.jwt.claim.role','anon',true);
  begin
    perform public.apply_company_balance_entry(v_account,gen_random_uuid(),100,'plan_downgrade','rollback-test');
    raise exception 'anonymous credit accepted';
  exception when insufficient_privilege then null; end;
  if has_function_privilege('authenticated','public.apply_company_balance_entry(uuid,uuid,bigint,text,text,boolean)','EXECUTE') then raise exception 'client mutation privilege'; end if;
end $$;
