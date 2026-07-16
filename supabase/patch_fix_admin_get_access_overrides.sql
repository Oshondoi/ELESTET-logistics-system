-- patch_fix_admin_get_access_overrides.sql
-- Фикс: column reference "user_id" is ambiguous
-- Причина: RETURNS TABLE содержит колонку user_id,
--          а WHERE user_id = auth.uid() не квалифицировано именем таблицы.
-- Применить в Supabase Dashboard → SQL Editor.

DROP FUNCTION IF EXISTS public.admin_get_access_overrides();
CREATE FUNCTION public.admin_get_access_overrides()
RETURNS TABLE (
  id                     uuid,
  scope                  text,
  account_id             uuid,
  account_name           text,
  user_id                uuid,
  user_email             text,
  type                   text,
  plan                   text,
  free_until             date,
  reason                 text,
  created_at             timestamptz,
  is_active              boolean,
  include_trial_accounts boolean
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF NOT (
    SELECT COALESCE(p.platform_role, 'user') IN ('admin', 'superadmin')
    FROM public.profiles p WHERE p.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    ao.id,
    ao.scope,
    ao.account_id,
    a.name        AS account_name,
    ao.user_id,
    u.email::text AS user_email,
    ao.type,
    ao.plan,
    ao.free_until,
    ao.reason,
    ao.created_at,
    ao.is_active,
    ao.include_trial_accounts
  FROM public.access_overrides ao
  LEFT JOIN public.accounts a ON a.id = ao.account_id
  LEFT JOIN auth.users      u ON u.id = ao.user_id
  ORDER BY ao.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_access_overrides() TO authenticated;
