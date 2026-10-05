begin;
-- Approved calendar only. Do not enable checkout/provider or change paid periods.
update public.calendar_billing_config set timezone='Asia/Bishkek' where id;
create or replace function public.get_company_checkout_state(p_account uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if not public.calendar_billing_owner(p_account) then raise exception 'Только владелец компании управляет оплатой'; end if;
 return jsonb_build_object('server_now',now(),'timezone','Asia/Bishkek',
 'balance_som',coalesce((select balance_som from public.company_billing_wallets where account_id=p_account),0),
 'cycle',(select to_jsonb(c) from public.calendar_billing_cycles c where c.account_id=p_account and c.ends_at>now() order by original_paid_at desc limit 1),
 'orders',coalesce((select jsonb_agg(x order by x.created_at desc) from (select id,kind,target_plan,status,due_som,credit_som,wallet_som,external_som,starts_at,ends_at,created_at,expires_at from public.calendar_billing_orders where account_id=p_account order by created_at desc limit 10)x),'[]'::jsonb));
end $$;
revoke all on function public.get_company_checkout_state(uuid) from public,anon;
grant execute on function public.get_company_checkout_state(uuid) to authenticated;
commit;
