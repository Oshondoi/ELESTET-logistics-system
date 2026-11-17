-- Служебная компания сервиса. Статус для её сотрудников всегда active.
-- Отметка не зависит от plan_until, trial_ends_at и grace_until.
-- Новые компании остаются false. Смена тарифа эту колонку не трогает.

alter table public.accounts
  add column if not exists service_company boolean not null default false;

update public.accounts
set service_company = true
where short_id = 1
  and name = 'Элестет'
  and deleted_at is null;

drop function if exists public.get_my_accounts();

create function public.get_my_accounts()
returns table(
  id uuid,
  name text,
  created_at timestamptz,
  my_role text,
  short_id integer,
  logo_url text,
  logo_subscription_until timestamptz,
  plan text,
  plan_until timestamptz,
  trial_ends_at timestamptz,
  grace_until timestamptz,
  plan_features jsonb,
  service_company boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.id,
    a.name,
    a.created_at,
    case
      when am.role <> 'owner' and public.implementation_access(a.id, auth.uid()) then 'implementation'
      else am.role
    end as my_role,
    a.short_id,
    a.logo_url,
    a.logo_subscription_until,
    a.plan,
    a.plan_until,
    a.trial_ends_at,
    a.grace_until,
    a.plan_features,
    a.service_company
  from public.accounts a
  join public.account_members am
    on am.account_id = a.id and am.user_id = auth.uid()
  where a.deleted_at is null
  order by a.created_at desc;
$$;

revoke all on function public.get_my_accounts() from public, anon;
grant execute on function public.get_my_accounts() to authenticated;
