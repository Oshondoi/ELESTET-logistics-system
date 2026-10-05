begin;
do $$
declare
 u uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); stranger uuid:=gen_random_uuid();
 oid uuid:=gen_random_uuid(); change_id uuid; q jsonb; o jsonb; first_paid timestamptz; count_before bigint; i integer;
begin
 insert into auth.users(id,email) values(u,u::text||'@example.invalid'),(stranger,stranger::text||'@example.invalid');
 insert into public.accounts(id,name) values(a,'Rollback checkout');
 insert into public.account_members(account_id,user_id,role) values(a,u,'owner');
 insert into public.company_billing_wallets(account_id,balance_som) values(a,1000000);
 update public.calendar_billing_config set timezone='Asia/Bishkek',checkout_enabled=true,provider_enabled=true;
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 set local role authenticated;
 q:=public.quote_company_checkout(a,'operational','main',false,false);
 if (q->>'wallet_som')::bigint<>0 then raise exception 'automatic balance deduction'; end if;
 o:=public.create_company_checkout(oid,a,'operational','main',false,true);
 if (o->>'external_som')::bigint<>0 then raise exception 'wallet not offered'; end if;
 perform public.create_company_checkout(oid,a,'operational','main',false,true);
 perform public.settle_company_checkout(oid,'wallet:'||oid,0,'KGS');
 perform public.settle_company_checkout(oid,'wallet:'||oid,0,'KGS');
 reset role;
 if (select count(*) from public.calendar_billing_cycles where account_id=a)<>1 then raise exception 'duplicate cycle'; end if;
 select original_paid_at into first_paid from public.calendar_billing_cycles where account_id=a;
 select count(*) into count_before from public.company_balance_entries where account_id=a;
 if count_before<>1 then raise exception 'duplicate debit'; end if;
 for i in 1..3 loop
  change_id:=gen_random_uuid();
  set local role authenticated;
  o:=public.create_company_checkout(change_id,a,case when i%2=1 then 'seller' else 'operational' end,'change',false,true);
  perform public.settle_company_checkout(change_id,'wallet:'||change_id,0,'KGS');
  perform public.settle_company_checkout(change_id,'wallet:'||change_id,0,'KGS');
  reset role;
 end loop;
 if not exists(select 1 from public.calendar_billing_cycles where account_id=a and changes=3 and original_paid_at=first_paid) then raise exception 'window moved or duplicate change'; end if;
 set local role authenticated;
 begin
  perform public.quote_company_checkout(a,'operational','change');
  raise exception 'fourth change allowed';
 exception when raise_exception then
  if sqlerrm<>'Для смены тарифа обратитесь в поддержку' then raise; end if;
 end;
 reset role;
 perform set_config('request.jwt.claim.sub',stranger::text,true);
 set local role authenticated;
 begin
  perform public.get_company_checkout_state(a);
  raise exception 'foreign billing readable';
 exception when raise_exception then
  if sqlerrm<>'Только владелец компании управляет оплатой' then raise; end if;
 end;
 reset role;
 perform set_config('request.jwt.claim.sub',u::text,true);
 -- Brand has no tariff replacement or trial. Reserve and cancel once.
 oid:=gen_random_uuid();
 set local role authenticated;
 o:=public.create_company_checkout(oid,a,'brand','brand',false,true);
 perform public.cancel_company_checkout(oid);
 perform public.cancel_company_checkout(oid);
 reset role;
 if (select count(*) from public.company_balance_entries where source_reference=oid::text)<>2 then raise exception 'cancel did not release exactly once'; end if;
 -- An external payment cannot be confirmed by the browser.
 oid:=gen_random_uuid();
 set local role authenticated;
 o:=public.create_company_checkout(oid,a,'brand','brand',false,false);
 begin
  perform public.settle_company_checkout(oid,'fake-provider',5000,'KGS');
  raise exception 'forged payment accepted';
 exception when raise_exception then
  if sqlerrm<>'Server settlement only' then raise; end if;
 end;
 reset role;
 update public.calendar_billing_orders set expires_at=now()-interval '1 second' where id=oid;
 perform public.maintain_calendar_billing();
 if (select status from public.calendar_billing_orders where id=oid)<>'expired' then raise exception 'expired order left pending'; end if;
 -- Partial payment requires exact verified external amount and currency.
 update public.company_billing_wallets set balance_som=100 where account_id=a;
 oid:=gen_random_uuid();
 set local role authenticated;
 o:=public.create_company_checkout(oid,a,'brand','brand',false,true);
 reset role;
 if (o->>'wallet_som')::bigint<>100 then raise exception 'partial balance not reserved'; end if;
 perform set_config('request.jwt.claim.role','service_role',true);
 begin
  perform public.settle_company_checkout(oid,'fixture-proof',1,'KGS');
  raise exception 'wrong amount accepted';
 exception when raise_exception then
  if sqlerrm<>'Payment amount mismatch' then raise; end if;
 end;
 perform public.settle_company_checkout(oid,'fixture-proof',(o->>'external_som')::bigint,'KGS');
 perform public.settle_company_checkout(oid,'fixture-proof',(o->>'external_som')::bigint,'KGS');
 if not exists(select 1 from public.accounts where id=a and logo_subscription_until>now()) then raise exception 'brand not activated'; end if;
 perform set_config('request.jwt.claim.role','authenticated',true);
 -- Strict 48-hour boundary independent of starts_at.
 update public.calendar_billing_cycles set changes=0,original_paid_at=now()-interval '48 hours' where account_id=a;
 set local role authenticated;
 begin
  perform public.quote_company_checkout(a,'operational','change');
  raise exception '48 hour boundary allowed';
 exception when raise_exception then
  if sqlerrm<>'Для смены тарифа обратитесь в поддержку' then raise; end if;
 end;
 reset role;
end $$;
rollback;
