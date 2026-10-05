-- Calendar quotation and opt-in wallet primitives. No provider, charges or plan activation are enabled here.
begin;
create or replace function public.quote_calendar_month(p_monthly_som bigint,p_purchase_date date,p_start_tomorrow boolean default false)
returns jsonb language plpgsql immutable set search_path=pg_catalog,public as $$
declare
  v_start date := p_purchase_date;
  v_end date;
  v_day integer;
  v_from integer;
  v_days integer;
  v_amount bigint;
begin
  if p_monthly_som is null or p_monthly_som < 0 or p_monthly_som > 1000000000 or p_purchase_date is null or p_start_tomorrow is null then
    raise exception 'Invalid calendar quote' using errcode='22023';
  end if;
  if p_start_tomorrow then
    if extract(day from v_start)<=15 then raise exception 'Tomorrow is available after day 15' using errcode='22023'; end if;
    v_start := v_start+1;
  end if;
  v_end := (date_trunc('month',v_start::timestamp)+interval '1 month')::date;
  v_day := extract(day from v_start);
  v_from := case when v_day<=15 then ((v_day-1)/5)*5+1 else v_day end;
  v_days := extract(day from v_end-1)::integer-v_from+1;
  v_amount := case when v_from=1 then p_monthly_som else (p_monthly_som*v_days+15)/30 end;
  return jsonb_build_object('startDate',v_start,'endDateExclusive',v_end,'chargedDays',v_days,'amountSom',v_amount);
end;
$$;

create table if not exists public.company_billing_wallets (
  account_id uuid primary key references public.accounts(id),
  balance_som bigint not null default 0 check(balance_som>=0 and balance_som<=1000000000)
);
create table if not exists public.company_balance_entries (
  operation_id uuid primary key,
  account_id uuid not null references public.company_billing_wallets(account_id),
  delta_som bigint not null check(delta_som<>0),
  balance_after_som bigint not null check(balance_after_som>=0),
  reason text not null check(reason in ('plan_downgrade','checkout','manual_adjustment','checkout_release')),
  source_reference text not null check(length(source_reference) between 1 and 200),
  customer_confirmed boolean not null default false,
  created_at timestamptz not null default clock_timestamp()
);
alter table public.company_billing_wallets enable row level security;
alter table public.company_balance_entries enable row level security;
revoke all on public.company_billing_wallets,public.company_balance_entries from public,anon,authenticated;

-- Called ONLY by a trusted settlement transaction, never directly by the browser.
-- Checkout confirmation must come from the persisted customer's order, not provider callback input.
create or replace function public.apply_company_balance_entry(
  p_account_id uuid,p_operation_id uuid,p_delta_som bigint,p_reason text,p_source_reference text,
  p_customer_confirmed boolean default false
) returns bigint language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_entry public.company_balance_entries%rowtype;
  v_balance bigint;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server settlement only' using errcode='42501'; end if;
  if p_operation_id is null or p_account_id is null or p_delta_som is null or p_delta_som=0 or abs(p_delta_som::numeric)>1000000000
    or p_reason is null or p_reason not in ('plan_downgrade','checkout','manual_adjustment','checkout_release')
    or p_source_reference is null or length(p_source_reference) not between 1 and 200 or p_customer_confirmed is null then
    raise exception 'Invalid balance entry' using errcode='22023';
  end if;
  if (p_reason in ('plan_downgrade','checkout_release') and p_delta_som<0)
     or (p_reason='checkout' and (p_delta_som>0 or not p_customer_confirmed)) then
    raise exception 'Invalid balance direction or missing customer choice' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,734));
  select * into v_entry from public.company_balance_entries where operation_id=p_operation_id;
  if found then
    if v_entry.account_id<>p_account_id or v_entry.delta_som<>p_delta_som or v_entry.reason<>p_reason
       or v_entry.source_reference<>p_source_reference or v_entry.customer_confirmed<>p_customer_confirmed then
      raise exception 'Balance operation conflict' using errcode='22023';
    end if;
    return v_entry.balance_after_som;
  end if;
  if not exists(select 1 from public.accounts where id=p_account_id and deleted_at is null) then
    raise exception 'Company unavailable' using errcode='22023';
  end if;
  insert into public.company_billing_wallets(account_id) values(p_account_id) on conflict do nothing;
  select balance_som into v_balance from public.company_billing_wallets where account_id=p_account_id for update;
  v_balance := v_balance+p_delta_som;
  if v_balance<0 or v_balance>1000000000 then raise exception 'Insufficient balance or balance limit' using errcode='22023'; end if;
  update public.company_billing_wallets set balance_som=v_balance where account_id=p_account_id;
  insert into public.company_balance_entries(operation_id,account_id,delta_som,balance_after_som,reason,source_reference,customer_confirmed)
    values(p_operation_id,p_account_id,p_delta_som,v_balance,p_reason,p_source_reference,p_customer_confirmed);
  return v_balance;
end;
$$;
create or replace function public.get_company_billing_balance(p_account_id uuid)
returns bigint language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if not exists(select 1 from public.account_members m join public.accounts a on a.id=m.account_id
    where m.account_id=p_account_id and m.user_id=auth.uid() and m.role='owner' and a.deleted_at is null) then
    raise exception 'Company billing access denied' using errcode='42501';
  end if;
  return coalesce((select balance_som from public.company_billing_wallets where account_id=p_account_id),0);
end;
$$;
revoke all on function public.quote_calendar_month(bigint,date,boolean) from public,anon,authenticated;
revoke all on function public.apply_company_balance_entry(uuid,uuid,bigint,text,text,boolean) from public,anon,authenticated;
revoke all on function public.get_company_billing_balance(uuid) from public,anon;
grant execute on function public.quote_calendar_month(bigint,date,boolean) to service_role;
grant execute on function public.apply_company_balance_entry(uuid,uuid,bigint,text,text,boolean) to service_role;
grant execute on function public.get_company_billing_balance(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
