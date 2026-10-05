begin;
alter table public.calendar_billing_orders drop constraint if exists calendar_billing_orders_kind_check;
alter table public.calendar_billing_orders add constraint calendar_billing_orders_kind_check check(kind in ('main','change','brand','renew','brand_renew'));
alter table public.calendar_billing_orders add column if not exists brand_applied boolean not null default false;
create or replace function public.quote_company_checkout(p_account uuid,p_plan text,p_kind text default 'main',p_tomorrow boolean default false,p_use_balance boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare cfg public.calendar_billing_config%rowtype; a public.accounts%rowtype; c public.calendar_billing_cycles%rowtype;
 price bigint; q jsonb; day date; start_at timestamptz; end_at timestamptz; due bigint; credit bigint:=0; balance bigint; wallet bigint; coverage timestamptz; paid_end timestamptz;
begin
 if not public.calendar_billing_owner(p_account) then raise exception 'Только владелец компании управляет оплатой'; end if;
 if p_kind is null or p_kind not in ('main','change','brand','renew','brand_renew') or p_plan is null or p_tomorrow is null or p_use_balance is null then raise exception 'Некорректный запрос'; end if;
 select * into cfg from public.calendar_billing_config where id;
 if cfg.timezone is null or not exists(select 1 from pg_timezone_names where name=cfg.timezone) then
  return jsonb_build_object('available',false,'reason','Календарная оплата готовится к подключению. Обратитесь в поддержку.');
 end if;
 select * into a from public.accounts where id=p_account;
 if p_kind in ('brand','brand_renew') then
  if p_plan<>'brand' then raise exception 'Некорректная опция'; end if;
  if a.plan is null or a.plan='none' or a.plan_until is null or a.plan_until<=now() then raise exception 'Сначала подключите основной тариф'; end if;
  if p_kind='brand' and (a.logo_subscription_until>now() or exists(select 1 from public.calendar_billing_orders where account_id=p_account and kind in ('brand','brand_renew') and status='paid' and ends_at>now())) then raise exception 'Опция уже оплачена: выберите продление'; end if;
  price:=5000;
 else
  if p_plan not in ('seller','operational') then raise exception 'Премиум с внедрением оформляется через команду'; end if;
  select case when price_sale>0 then price_sale else price_full end into price from public.plan_configs where key=p_plan and is_active;
  if price is null or price<=0 then raise exception 'Цена тарифа не настроена'; end if;
 end if;
 coverage:=greatest(a.plan_until,(select max(ends_at) from public.calendar_billing_cycles where account_id=p_account));
 day:=(now() at time zone cfg.timezone)::date;
 if p_kind in ('renew','brand_renew') then
  if p_tomorrow then raise exception 'Продление начинается после оплаченного периода'; end if;
  paid_end:=case when p_kind='renew' then coverage else greatest(a.logo_subscription_until,(select max(ends_at) from public.calendar_billing_orders where account_id=p_account and kind in ('brand','brand_renew') and status='paid')) end;
  if paid_end is null or paid_end<=now() then raise exception 'Нет действующего периода для продления'; end if;
  day:=(paid_end at time zone cfg.timezone)::date;
  if extract(day from day)<>1 or paid_end is distinct from day::timestamp at time zone cfg.timezone then raise exception 'Некалендарный срок: обратитесь в поддержку'; end if;
 end if;
 if p_kind='change' then
  select * into c from public.calendar_billing_cycles where account_id=p_account and ends_at>now() order by original_paid_at desc limit 1;
  if not found or now()>=c.original_paid_at+interval '48 hours' or c.changes>=3 then raise exception 'Для смены тарифа обратитесь в поддержку'; end if;
  if c.plan=p_plan then raise exception 'Этот тариф уже выбран'; end if;
  if c.starts_at<=now() and (a.plan is distinct from c.plan or a.plan_until is distinct from c.ends_at) then raise exception 'Подписка изменена вручную. Обратитесь в поддержку'; end if;
  day:=c.purchase_date;
  q:=public.quote_calendar_month(price,day,c.start_tomorrow);
  start_at:=c.starts_at;end_at:=c.ends_at;
  due:=greatest(0,(q->>'amountSom')::bigint-c.charged_som);
  credit:=greatest(0,c.charged_som-(q->>'amountSom')::bigint);
 else
  if p_kind='main' and (a.plan_until>now() or exists(select 1 from public.calendar_billing_cycles where account_id=p_account and ends_at>now())) then raise exception 'Для действующего тарифа выберите смену или продление'; end if;
  q:=public.quote_calendar_month(price,day,p_tomorrow);
  start_at:=(q->>'startDate')::date::timestamp at time zone cfg.timezone;
  end_at:=(q->>'endDateExclusive')::date::timestamp at time zone cfg.timezone;
  if p_kind in ('brand','brand_renew') and (coverage is null or coverage<end_at) then raise exception 'Сначала оплатите основной тариф на весь период опции'; end if;
  due:=(q->>'amountSom')::bigint;
 end if;
 select coalesce((select balance_som from public.company_billing_wallets where account_id=p_account),0) into balance;
 wallet:=case when p_use_balance then least(balance,due) else 0 end;
 return jsonb_build_object('available',cfg.checkout_enabled and (cfg.provider_enabled or due-wallet=0),
  'reason',case when not cfg.checkout_enabled then 'Оплата пока не включена' when due-wallet>0 and not cfg.provider_enabled then 'Внешняя оплата ожидает подключения Finik' else null end,
  'monthly_som',price,'charged_som',(q->>'amountSom')::bigint,'due_som',due,'credit_som',credit,'balance_som',balance,
  'wallet_som',wallet,'external_som',due-wallet,'purchase_date',day,'starts_at',start_at,'ends_at',end_at,
  'cycle_id',c.id,'cycle_version',c.version,'start_tomorrow',case when p_kind='change' then c.start_tomorrow else p_tomorrow end);
end $$;
create or replace function public.settle_company_checkout(p_order uuid,p_reference text,p_amount bigint,p_currency text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare o public.calendar_billing_orders%rowtype; c public.calendar_billing_cycles%rowtype; a public.accounts%rowtype; coverage timestamptz; paid_end timestamptz;
begin
 if p_reference is null or length(p_reference) not between 1 and 200 or p_amount is null or p_currency is distinct from 'KGS' then raise exception 'Invalid payment proof'; end if;
 select * into o from public.calendar_billing_orders where id=p_order;
 if not found then raise exception 'Заказ не найден'; end if;
 if coalesce(auth.role(),'')<>'service_role' and
   (o.external_som<>0 or not public.calendar_billing_owner(o.account_id) or p_reference is distinct from 'wallet:'||o.id::text) then
   raise exception 'Server settlement only';
 end if;
 select * into a from public.accounts where id=o.account_id and deleted_at is null for update;
 if not found then raise exception 'Компания недоступна'; end if;
 select * into o from public.calendar_billing_orders where id=p_order for update;
 if p_amount<>o.external_som then raise exception 'Payment amount mismatch'; end if;
 if o.status='paid' then
  if o.payment_reference<>p_reference then raise exception 'Payment reference conflict'; end if;
  return to_jsonb(o);
 end if;
 if o.status<>'pending' or o.expires_at<=now() then raise exception 'Заказ закрыт или истёк: требуется ручная сверка платежа'; end if;
 if o.kind='change' then
  select * into c from public.calendar_billing_cycles where id=o.cycle_id for update;
  if c.version<>o.cycle_version or c.changes>=3 or now()>=c.original_paid_at+interval '48 hours' then raise exception 'Условия смены изменились'; end if;
  if c.starts_at<=now() and (a.plan is distinct from c.plan or a.plan_until is distinct from c.ends_at) then raise exception 'Подписка изменена вручную'; end if;
  update public.calendar_billing_cycles set plan=o.target_plan,monthly_som=o.monthly_som,charged_som=o.charged_som,changes=changes+1,version=version+1 where id=c.id;
 elsif o.kind in ('main','renew') then
  coverage:=greatest(a.plan_until,(select max(ends_at) from public.calendar_billing_cycles where account_id=o.account_id));
  if o.kind='main' and coverage>now() then raise exception 'Подписка уже существует'; end if;
  if o.kind='renew' and coverage is distinct from o.starts_at then raise exception 'Оплаченный период изменился: пересоздайте заказ'; end if;
  insert into public.calendar_billing_cycles(account_id,plan,monthly_som,charged_som,purchase_date,start_tomorrow,starts_at,ends_at,original_paid_at)
  values(o.account_id,o.target_plan,o.monthly_som,o.charged_som,o.purchase_date,o.start_tomorrow,o.starts_at,o.ends_at,now()) returning * into c;
  update public.calendar_billing_orders set cycle_id=c.id where id=o.id;
 else
  coverage:=greatest(a.plan_until,(select max(ends_at) from public.calendar_billing_cycles where account_id=o.account_id));
  paid_end:=greatest(a.logo_subscription_until,(select max(ends_at) from public.calendar_billing_orders where account_id=o.account_id and kind in ('brand','brand_renew') and status='paid'));
  if a.plan is null or a.plan='none' or a.plan_until is null or a.plan_until<=now() or coverage is null or coverage<o.ends_at
    or (o.kind='brand' and paid_end>now()) or (o.kind='brand_renew' and paid_end is distinct from o.starts_at) then raise exception 'Условия подключения бренда изменились'; end if;
  if o.starts_at<=now() then update public.accounts set logo_subscription_until=o.ends_at where id=o.account_id; end if;
 end if;
 if o.kind in ('main','change','renew') and o.starts_at<=now() then
  update public.accounts set plan=o.target_plan,plan_until=o.ends_at where id=o.account_id;
  update public.calendar_billing_cycles set applied_version=version where id=c.id;
 end if;
 perform public.calendar_wallet_move(o.account_id,o.credit_id,o.credit_som,'plan_downgrade',o.id::text,false);
 update public.calendar_billing_orders set status='paid',paid_at=now(),payment_reference=p_reference,brand_applied=(o.kind in ('brand','brand_renew') and o.starts_at<=now()) where id=o.id returning * into o;
 return to_jsonb(o);
end $$;
create or replace function public.maintain_calendar_billing()
returns void language plpgsql security definer set search_path=public as $$
declare row record; o public.calendar_billing_orders%rowtype; c public.calendar_billing_cycles%rowtype;
begin
 if coalesce(auth.role(),'')<>'service_role' and current_user<>'postgres' then raise exception 'Server only'; end if;
 for row in select id,account_id from public.calendar_billing_orders where status='pending' and expires_at<=now() loop
  perform 1 from public.accounts where id=row.account_id for update;
  select * into o from public.calendar_billing_orders where id=row.id for update;
  if o.status='pending' and o.expires_at<=now() then
   perform public.calendar_wallet_move(o.account_id,o.release_id,o.wallet_som,'checkout_release',o.id::text,false);
   update public.calendar_billing_orders set status='expired' where id=o.id;
  end if;
 end loop;
 for row in select id,account_id from public.calendar_billing_cycles where starts_at<=now() and ends_at>now() and applied_version<version loop
  perform 1 from public.accounts where id=row.account_id for update;
  select * into c from public.calendar_billing_cycles where id=row.id for update;
  if c.applied_version<c.version and not exists(select 1 from public.accounts a where a.id=c.account_id and a.plan_until>now()) then
   update public.accounts set plan=c.plan,plan_until=c.ends_at where id=c.account_id and deleted_at is null;
   update public.calendar_billing_cycles set applied_version=version where id=c.id;
  end if;
 end loop;
 for row in select id,account_id from public.calendar_billing_orders where status='paid' and kind in ('brand','brand_renew') and not brand_applied and starts_at<=now() and ends_at>now() order by starts_at loop
  perform 1 from public.accounts where id=row.account_id for update;
  select * into o from public.calendar_billing_orders where id=row.id for update;
  if not o.brand_applied and exists(select 1 from public.accounts where id=o.account_id and deleted_at is null and plan<>'none' and plan_until>=o.ends_at) then
   update public.accounts set logo_subscription_until=greatest(logo_subscription_until,o.ends_at) where id=o.account_id;
   update public.calendar_billing_orders set brand_applied=true where id=o.id;
  end if;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
