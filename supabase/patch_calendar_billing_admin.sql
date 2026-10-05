begin;
create table if not exists public.calendar_billing_admin_audit(
 id uuid primary key, account_id uuid not null references public.accounts(id),
 order_id uuid references public.calendar_billing_orders(id), actor_id uuid not null,
 action text not null check(action in ('balance_adjustment','reconciliation_note')),
 note text not null check(length(btrim(note)) between 5 and 2000), delta_som bigint,
 created_at timestamptz not null default now()
);
alter table public.calendar_billing_admin_audit enable row level security;
revoke all on public.calendar_billing_admin_audit from public,anon,authenticated;
create or replace function public.require_billing_superadmin()
returns void language plpgsql stable security definer set search_path=public as $$
begin
 if not exists(select 1 from public.profiles where user_id=auth.uid() and platform_role='superadmin') then raise exception 'Только superadmin'; end if;
end $$;
revoke all on function public.require_billing_superadmin() from public,anon,authenticated;

create or replace function public.admin_calendar_billing(p_search text default '',p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 perform public.require_billing_superadmin();
 if p_offset<0 or p_offset>100000 then raise exception 'Invalid page'; end if;
 return jsonb_build_object(
 'config',(select to_jsonb(c) from public.calendar_billing_config c where id),
 'companies',coalesce((select jsonb_agg(x) from (
 select a.id,a.short_id,a.name,coalesce(w.balance_som,0) balance_som
 from public.accounts a left join public.company_billing_wallets w on w.account_id=a.id
 where a.deleted_at is null and (a.name ilike '%'||left(p_search,100)||'%' or a.short_id::text=replace(upper(p_search),'C-',''))
 order by a.short_id desc limit 50 offset p_offset)x),'[]'::jsonb),
 'orders',coalesce((select jsonb_agg(x) from (
 select o.id,o.account_id,a.short_id,a.name,o.kind,o.target_plan,o.status,o.due_som,o.wallet_som,o.external_som,
 o.credit_som,o.starts_at,o.ends_at,o.created_at,o.paid_at,o.expires_at,o.payment_reference
 from public.calendar_billing_orders o join public.accounts a on a.id=o.account_id
 where a.name ilike '%'||left(p_search,100)||'%' or a.short_id::text=replace(upper(p_search),'C-','') or o.id::text=p_search
 order by o.created_at desc limit 50 offset p_offset)x),'[]'::jsonb));
end $$;
create or replace function public.admin_calendar_billing_detail(p_account uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 perform public.require_billing_superadmin();
 return jsonb_build_object(
 'entries',coalesce((select jsonb_agg(x) from (select * from public.company_balance_entries where account_id=p_account order by created_at desc limit 100)x),'[]'::jsonb),
 'audit',coalesce((select jsonb_agg(x) from (select * from public.calendar_billing_admin_audit where account_id=p_account order by created_at desc limit 100)x),'[]'::jsonb));
end $$;
create or replace function public.admin_adjust_calendar_balance(p_id uuid,p_account uuid,p_delta bigint,p_note text)
returns void language plpgsql security definer set search_path=public as $$
declare old public.calendar_billing_admin_audit%rowtype;
begin
 perform public.require_billing_superadmin();
 if p_id is null or p_delta is null or p_delta=0 or abs(p_delta::numeric)>1000000000 or p_note is null or length(btrim(p_note)) not between 5 and 2000 then raise exception 'Укажите сумму и причину (5–2000 символов)'; end if;
 perform 1 from public.accounts where id=p_account and deleted_at is null for update;
 if not found then raise exception 'Компания недоступна'; end if;
 select * into old from public.calendar_billing_admin_audit where id=p_id;
 if found then
  if old.account_id<>p_account or old.action<>'balance_adjustment' or old.delta_som<>p_delta or old.note<>btrim(p_note) then raise exception 'Конфликт операции'; end if;
  return;
 end if;
 perform public.calendar_wallet_move(p_account,p_id,p_delta,'manual_adjustment',p_id::text,false);
 insert into public.calendar_billing_admin_audit(id,account_id,actor_id,action,note,delta_som)
 values(p_id,p_account,auth.uid(),'balance_adjustment',btrim(p_note),p_delta);
end $$;
create or replace function public.admin_note_calendar_payment(p_id uuid,p_order uuid,p_note text)
returns void language plpgsql security definer set search_path=public as $$
declare a uuid; old public.calendar_billing_admin_audit%rowtype;
begin
 perform public.require_billing_superadmin();
 if p_id is null or p_note is null or length(btrim(p_note)) not between 5 and 2000 then raise exception 'Укажите результат сверки (5–2000 символов)'; end if;
 select account_id into a from public.calendar_billing_orders where id=p_order;
 if not found then raise exception 'Заказ недоступен'; end if;
 select * into old from public.calendar_billing_admin_audit where id=p_id;
 if found then
  if old.order_id is distinct from p_order or old.action<>'reconciliation_note' or old.note<>btrim(p_note) then raise exception 'Конфликт операции'; end if;
  return;
 end if;
 insert into public.calendar_billing_admin_audit(id,account_id,order_id,actor_id,action,note)
 values(p_id,a,p_order,auth.uid(),'reconciliation_note',btrim(p_note));
end $$;
revoke all on function public.admin_calendar_billing(text,integer),public.admin_calendar_billing_detail(uuid),
public.admin_adjust_calendar_balance(uuid,uuid,bigint,text),public.admin_note_calendar_payment(uuid,uuid,text) from public,anon;
grant execute on function public.admin_calendar_billing(text,integer),public.admin_calendar_billing_detail(uuid),
public.admin_adjust_calendar_balance(uuid,uuid,bigint,text),public.admin_note_calendar_payment(uuid,uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
