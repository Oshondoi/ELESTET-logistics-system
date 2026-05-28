-- Добавляем logo_url и logo_subscription_until в RPC get_my_accounts
-- Без этого логотип пропадает при обновлении страницы (RPC не возвращал эти поля)

DROP FUNCTION IF EXISTS public.get_my_accounts();
CREATE OR REPLACE FUNCTION public.get_my_accounts()
RETURNS TABLE(
  id                       uuid,
  name                     text,
  created_at               timestamptz,
  my_role                  text,
  short_id                 integer,
  logo_url                 text,
  logo_subscription_until  timestamptz
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
    a.logo_subscription_until
  FROM   public.accounts a
  JOIN   public.account_members am
         ON am.account_id = a.id AND am.user_id = auth.uid()
  WHERE  a.deleted_at IS NULL
  ORDER BY a.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_accounts() TO authenticated;
