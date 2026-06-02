-- ============================================================
-- BILLING: Добавить billing-поля в get_my_accounts RPC
--   plan, plan_until, trial_ends_at, grace_until, plan_features
-- Применять ПОСЛЕ patch_billing.sql
-- ============================================================

DROP FUNCTION IF EXISTS public.get_my_accounts();
CREATE OR REPLACE FUNCTION public.get_my_accounts()
RETURNS TABLE(
  id                       uuid,
  name                     text,
  created_at               timestamptz,
  my_role                  text,
  short_id                 integer,
  logo_url                 text,
  logo_subscription_until  timestamptz,
  plan                     text,
  plan_until               timestamptz,
  trial_ends_at            timestamptz,
  grace_until              timestamptz,
  plan_features            jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.id,
    a.name,
    a.created_at,
    am.role AS my_role,
    a.short_id,
    a.logo_url,
    a.logo_subscription_until,
    a.plan,
    a.plan_until,
    a.trial_ends_at,
    a.grace_until,
    a.plan_features
  FROM   public.accounts a
  JOIN   public.account_members am
         ON am.account_id = a.id AND am.user_id = auth.uid()
  WHERE  a.deleted_at IS NULL
  ORDER BY a.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_accounts() TO authenticated;
