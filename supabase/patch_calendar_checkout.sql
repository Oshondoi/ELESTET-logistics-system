-- Independent checkout engine. No live payment adapter or money is enabled by migration.
begin;
create table if not exists public.calendar_billing_config(
 id boolean primary key default true check(id), timezone text,
 checkout_enabled boolean not null default false, provider_enabled boolean not null default false
);
insert into public.calendar_billing_config(id) values(true) on conflict do nothing;
create table if not exists public.calendar_billing_cycles(
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.accounts(id),
 plan text not null check(plan in ('seller','operational')), monthly_som bigint not null,
 charged_som bigint not null, purchase_date date not null, start_tomorrow boolean not null,
 starts_at timestamptz not null, ends_at timestamptz not null, original_paid_at timestamptz not null,
 changes integer not null default 0 check(changes between 0 and 3), version integer not null default 0,
 applied_version integer not null default -1
);
create table if not exists public.calendar_billing_orders(
 id uuid primary key, account_id uuid not null references public.accounts(id), user_id uuid not null,
 kind text not null check(kind in ('main','change','brand')), target_plan text not null,
 monthly_som bigint not null, charged_som bigint not null, due_som bigint not null, credit_som bigint not null,
 wallet_som bigint not null default 0, external_som bigint not null,
 use_balance boolean not null, purchase_date date not null, start_tomorrow boolean not null,
 starts_at timestamptz not null, ends_at timestamptz not null,
 cycle_id uuid references public.calendar_billing_cycles(id), cycle_version integer,
 status text not null default 'pending' check(status in ('pending','paid','cancelled','expired')),
 created_at timestamptz not null default now(), expires_at timestamptz not null,
 paid_at timestamptz, payment_reference text unique,
 debit_id uuid not null default gen_random_uuid(), release_id uuid not null default gen_random_uuid(),
 credit_id uuid not null default gen_random_uuid()
);
create unique index if not exists one_pending_calendar_order on public.calendar_billing_orders(account_id) where status='pending';
alter table public.calendar_billing_config enable row level security;
alter table public.calendar_billing_cycles enable row level security;
alter table public.calendar_billing_orders enable row level security;
revoke all on public.calendar_billing_config,public.calendar_billing_cycles,public.calendar_billing_orders from public,anon,authenticated;

create or replace function public.calendar_billing_owner(p_account uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.account_members m join public.accounts a on a.id=m.account_id
 where m.account_id=p_account and m.user_id=auth.uid() and m.role='owner' and a.deleted_at is null)
$$;
revoke all on function public.calendar_billing_owner(uuid) from public,anon,authenticated;

-- Internal only; callers lock the account first. This helper has no browser grant.
create or replace function public.calendar_wallet_move(p_account uuid,p_id uuid,p_delta bigint,p_reason text,p_source text,p_consent boolean)
returns void language plpgsql security definer set search_path=public as $$
declare b bigint; old public.company_balance_entries%rowtype;
begin
 select * into old from public.company_balance_entries where operation_id=p_id;
 if found then
  if old.account_id<>p_account or old.delta_som<>p_delta or old.reason<>p_reason or old.source_reference<>p_source or old.customer_confirmed<>p_consent then raise exception 'Balance operation conflict'; end if;
  return;
 end if;
 if p_delta=0 then return; end if;
 if p_reason='checkout' and (not p_consent or p_delta>0) then raise exception 'Balance consent required'; end if;
 insert into public.company_billing_wallets(account_id) values(p_account) on conflict do nothing;
 select balance_som into b from public.company_billing_wallets where account_id=p_account for update;
 b:=b+p_delta;
 if b<0 then raise exception 'Недостаточно средств на балансе'; end if;
 update public.company_billing_wallets set balance_som=b where account_id=p_account;
 insert into public.company_balance_entries(operation_id,account_id,delta_som,balance_after_som,reason,source_reference,customer_confirmed)
 values(p_id,p_account,p_delta,b,p_reason,p_source,p_consent);
end $$;
revoke all on function public.calendar_wallet_move(uuid,uuid,bigint,text,text,boolean) from public,anon,authenticated;

create or replace function public.quote_company_checkout(p_account uuid,p_plan text,p_kind text default 'main',p_tomorrow boolean default false,p_use_balance boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare cfg public.calendar_billing_config%rowtype; a public.accounts%rowtype; c public.calendar_billing_cycles%rowtype;
 price bigint; q jsonb; day date; start_at timestamptz; end_at timestamptz; due bigint; credit bigint:=0; balance bigint; wallet bigint;
begin
 if not public.calendar_billing_owner(p_account) then raise exception 'Только владелец компании управляет оплатой'; end if;
 if p_kind is null or p_kind not in ('main','change','brand') or p_plan is null or p_tomorrow is null or p_use_balance is null then raise exception 'Некорректный запрос'; end if;
 select * into cfg from public.calendar_billing_config where id;
 if cfg.timezone is null or not exists(select 1 from pg_timezone_names where name=cfg.timezone) then
  return jsonb_build_object('available',false,'reason','Календарная оплата готовится к подключению. Обратитесь в поддержку.');
 end if;
 select * into a from public.accounts where id=p_account;
 if p_kind='brand' then
  if p_plan<>'brand' then raise exception 'Некорректная опция'; end if;
  if a.plan is null or a.plan='none' or a.plan_until is null or a.plan_until<=now() then raise exception 'Сначала подключите основной тариф'; end if;
  if a.logo_subscription_until>now() then raise exception 'Опция уже оплачена. Продление — через поддержку'; end if;
  price:=5000;
 else
  if p_plan not in ('seller','operational') then raise exception 'Премиум с внедрением оформляется через команду'; end if;
  select case when price_sale>0 then price_sale else price_full end into price from public.plan_configs where key=p_plan and is_active;
  if price is null or price<=0 then raise exception 'Цена тарифа не настроена'; end if;
 end if;
 day:=(now() at time zone cfg.timezone)::date;
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
  if p_kind='main' and (a.plan_until>now() or exists(select 1 from public.calendar_billing_cycles where account_id=p_account and ends_at>now())) then raise exception 'Для действующего тарифа выберите смену; продление пока через поддержку'; end if;
  q:=public.quote_calendar_month(price,day,p_tomorrow);
  start_at:=(q->>'startDate')::date::timestamp at time zone cfg.timezone;
  end_at:=(q->>'endDateExclusive')::date::timestamp at time zone cfg.timezone;
  if p_kind='brand' and (a.plan_until<end_at or start_at>now()) then raise exception 'Опция доступна на текущий период действующего основного тарифа'; end if;
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
revoke all on function public.quote_company_checkout(uuid,text,text,boolean,boolean) from public,anon;
grant execute on function public.quote_company_checkout(uuid,text,text,boolean,boolean) to authenticated;

create or replace function public.cancel_company_checkout(p_order uuid)
returns void language plpgsql security definer set search_path=public as $$
declare o public.calendar_billing_orders%rowtype;
begin
 select * into o from public.calendar_billing_orders where id=p_order;
 if not found or not public.calendar_billing_owner(o.account_id) then raise exception 'Заказ недоступен'; end if;
 perform 1 from public.accounts where id=o.account_id for update;
 select * into o from public.calendar_billing_orders where id=p_order for update;
 if o.status<>'pending' then return; end if;
 perform public.calendar_wallet_move(o.account_id,o.release_id,o.wallet_som,'checkout_release',o.id::text,false);
 update public.calendar_billing_orders set status='cancelled' where id=o.id;
end $$;
revoke all on function public.cancel_company_checkout(uuid) from public,anon;
grant execute on function public.cancel_company_checkout(uuid) to authenticated;

create or replace function public.create_company_checkout(p_order uuid,p_account uuid,p_plan text,p_kind text default 'main',p_tomorrow boolean default false,p_use_balance boolean default false,p_expected_quote jsonb default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare q jsonb; o public.calendar_billing_orders%rowtype;
begin
 if p_order is null or not public.calendar_billing_owner(p_account) then raise exception 'Заказ недоступен'; end if;
 perform 1 from public.accounts where id=p_account for update;
 select * into o from public.calendar_billing_orders where id=p_order;
 if found then
  if o.account_id<>p_account or o.user_id<>auth.uid() or o.target_plan<>p_plan or o.kind<>p_kind or o.use_balance<>p_use_balance
    or (p_kind<>'change' and o.start_tomorrow<>p_tomorrow) then raise exception 'Конфликт повторного запроса'; end if;
  return to_jsonb(o);
 end if;
 q:=public.quote_company_checkout(p_account,p_plan,p_kind,p_tomorrow,p_use_balance);
 if p_expected_quote is not null and q<>p_expected_quote then raise exception 'Расчёт изменился. Подтвердите новую сумму'; end if;
 if not (q->>'available')::boolean then raise exception '%',q->>'reason'; end if;
 if exists(select 1 from public.calendar_billing_orders where account_id=p_account and status='pending') then raise exception 'Сначала завершите или отмените предыдущий заказ'; end if;
 insert into public.calendar_billing_orders(id,account_id,user_id,kind,target_plan,monthly_som,charged_som,due_som,credit_som,wallet_som,external_som,use_balance,purchase_date,start_tomorrow,starts_at,ends_at,cycle_id,cycle_version,expires_at)
 values(p_order,p_account,auth.uid(),p_kind,p_plan,(q->>'monthly_som')::bigint,(q->>'charged_som')::bigint,(q->>'due_som')::bigint,(q->>'credit_som')::bigint,
 (q->>'wallet_som')::bigint,(q->>'external_som')::bigint,p_use_balance,(q->>'purchase_date')::date,(q->>'start_tomorrow')::boolean,
 (q->>'starts_at')::timestamptz,(q->>'ends_at')::timestamptz,(q->>'cycle_id')::uuid,(q->>'cycle_version')::integer,
 least(now()+interval '30 minutes',case when p_kind='change' then (select original_paid_at+interval '48 hours' from public.calendar_billing_cycles where id=(q->>'cycle_id')::uuid) else ((now() at time zone (select timezone from public.calendar_billing_config where id))::date+1)::timestamp at time zone (select timezone from public.calendar_billing_config where id) end))
 returning * into o;
 perform public.calendar_wallet_move(p_account,o.debit_id,-o.wallet_som,'checkout',p_order::text,p_use_balance);
 return to_jsonb(o);
end $$;
revoke all on function public.create_company_checkout(uuid,uuid,text,text,boolean,boolean,jsonb) from public,anon;
grant execute on function public.create_company_checkout(uuid,uuid,text,text,boolean,boolean,jsonb) to authenticated;

-- Only a verified payment adapter can confirm outside money. Exact amount/currency are mandatory.
create or replace function public.settle_company_checkout(p_order uuid,p_reference text,p_amount bigint,p_currency text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare o public.calendar_billing_orders%rowtype; c public.calendar_billing_cycles%rowtype; a public.accounts%rowtype;
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
 elsif o.kind='main' then
  if a.plan_until>now() or exists(select 1 from public.calendar_billing_cycles where account_id=o.account_id and ends_at>now()) then raise exception 'Подписка уже существует'; end if;
  insert into public.calendar_billing_cycles(account_id,plan,monthly_som,charged_som,purchase_date,start_tomorrow,starts_at,ends_at,original_paid_at)
  values(o.account_id,o.target_plan,o.monthly_som,o.charged_som,o.purchase_date,o.start_tomorrow,o.starts_at,o.ends_at,now()) returning * into c;
  update public.calendar_billing_orders set cycle_id=c.id where id=o.id;
 else
  if a.plan is null or a.plan='none' or a.plan_until<o.ends_at or a.logo_subscription_until>now() then raise exception 'Условия подключения бренда изменились'; end if;
  update public.accounts set logo_subscription_until=o.ends_at where id=o.account_id;
 end if;
 if o.kind in ('main','change') and o.starts_at<=now() then
  update public.accounts set plan=o.target_plan,plan_until=o.ends_at where id=o.account_id;
  update public.calendar_billing_cycles set applied_version=version where id=c.id;
 end if;
 perform public.calendar_wallet_move(o.account_id,o.credit_id,o.credit_som,'plan_downgrade',o.id::text,false);
 update public.calendar_billing_orders set status='paid',paid_at=now(),payment_reference=p_reference where id=o.id returning * into o;
 return to_jsonb(o);
end $$;
revoke all on function public.settle_company_checkout(uuid,text,bigint,text) from public,anon,authenticated;
grant execute on function public.settle_company_checkout(uuid,text,bigint,text) to service_role,authenticated;

create or replace function public.get_company_checkout_state(p_account uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if not public.calendar_billing_owner(p_account) then raise exception 'Только владелец компании управляет оплатой'; end if;
 return jsonb_build_object('balance_som',coalesce((select balance_som from public.company_billing_wallets where account_id=p_account),0),
 'cycle',(select to_jsonb(c) from public.calendar_billing_cycles c where c.account_id=p_account and c.ends_at>now() order by original_paid_at desc limit 1),
 'orders',coalesce((select jsonb_agg(x order by x.created_at desc) from (select id,kind,target_plan,status,due_som,credit_som,wallet_som,external_som,starts_at,ends_at,created_at,expires_at from public.calendar_billing_orders where account_id=p_account order by created_at desc limit 10)x),'[]'::jsonb));
end $$;
revoke all on function public.get_company_checkout_state(uuid) from public,anon;
grant execute on function public.get_company_checkout_state(uuid) to authenticated;

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
end $$;
revoke all on function public.maintain_calendar_billing() from public,anon,authenticated;
grant execute on function public.maintain_calendar_billing() to service_role;
do $$ begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  perform cron.schedule('calendar-billing-maintenance','* * * * *','select public.maintain_calendar_billing()');
 end if;
end $$;
notify pgrst,'reload schema';
commit;
