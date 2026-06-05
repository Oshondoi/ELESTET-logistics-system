-- patch_user_scope_override.sql
-- Добавляет скоп 'user' в access_overrides — переопределение для конкретного пользователя.
-- Архивные компании не показываются в admin_get_billing_overview.
-- create_account_with_owner проверяет user-level override перед блокировкой.
-- Применить в Supabase Dashboard → SQL Editor.

-- ─────────────────────────────────────────────────
-- 1. Добавить user_id в access_overrides
-- ─────────────────────────────────────────────────
ALTER TABLE public.access_overrides
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. Обновить CHECK на scope — добавить 'user'
ALTER TABLE public.access_overrides
  DROP CONSTRAINT IF EXISTS access_overrides_scope_check;
ALTER TABLE public.access_overrides
  ADD CONSTRAINT access_overrides_scope_check
  CHECK (scope IN ('global', 'account', 'user'));

-- ─────────────────────────────────────────────────
-- 3. admin_get_users_list — список всех пользователей для дропдауна
-- ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_users_list()
RETURNS TABLE (id uuid, email text, short_id integer)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF NOT (
    SELECT COALESCE(platform_role, 'user') IN ('admin', 'superadmin')
    FROM public.profiles WHERE user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT u.id, u.email::text, p.short_id
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.user_id = u.id
  ORDER BY u.email;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_users_list() TO authenticated;

-- ─────────────────────────────────────────────────
-- 4. admin_get_access_overrides — добавить user_id + user_email
-- ─────────────────────────────────────────────────
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
    SELECT COALESCE(platform_role, 'user') IN ('admin', 'superadmin')
    FROM public.profiles WHERE user_id = auth.uid()
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
  LEFT JOIN public.accounts a  ON a.id  = ao.account_id
  LEFT JOIN auth.users       u  ON u.id  = ao.user_id
  ORDER BY ao.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_access_overrides() TO authenticated;

-- ─────────────────────────────────────────────────
-- 5. admin_create_override — добавить p_user_id
-- ─────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_create_override(text, uuid, text, text, date, text, boolean);
CREATE FUNCTION public.admin_create_override(
  p_scope                  text,
  p_account_id             uuid    DEFAULT NULL,
  p_user_id                uuid    DEFAULT NULL,
  p_type                   text    DEFAULT 'trial',
  p_plan                   text    DEFAULT NULL,
  p_free_until             date    DEFAULT NULL,
  p_reason                 text    DEFAULT NULL,
  p_include_trial_accounts boolean DEFAULT true
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT (
    SELECT COALESCE(platform_role, 'user') IN ('admin', 'superadmin')
    FROM public.profiles WHERE user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO public.access_overrides
    (scope, account_id, user_id, type, plan, free_until, reason, include_trial_accounts)
  VALUES
    (p_scope, p_account_id, p_user_id, p_type, p_plan, p_free_until, p_reason, p_include_trial_accounts)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_override(text, uuid, uuid, text, text, date, text, boolean) TO authenticated;

-- ─────────────────────────────────────────────────
-- 6. get_active_override — приоритет: account > user > global
-- ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_active_override(p_account_id uuid)
RETURNS TABLE (type text, plan text, free_until date)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_account_trial_active boolean;
  v_owner_user_id        uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.account_members
    WHERE account_id = p_account_id AND user_id = auth.uid()
  ) THEN
    RETURN;
  END IF;

  SELECT (trial_ends_at IS NOT NULL AND trial_ends_at > now()) INTO v_account_trial_active
  FROM public.accounts WHERE id = p_account_id;

  SELECT am.user_id INTO v_owner_user_id
  FROM public.account_members am
  WHERE am.account_id = p_account_id AND am.role = 'owner'
  LIMIT 1;

  RETURN QUERY
  SELECT ao.type, ao.plan, ao.free_until
  FROM public.access_overrides ao
  WHERE ao.is_active = true
    AND ao.free_until >= CURRENT_DATE
    AND (
      (ao.scope = 'account' AND ao.account_id = p_account_id)
      OR (ao.scope = 'user' AND ao.user_id = v_owner_user_id)
      OR (
        ao.scope = 'global'
        AND (ao.include_trial_accounts = true OR NOT v_account_trial_active)
      )
    )
  ORDER BY
    CASE
      WHEN ao.scope = 'account' THEN 0
      WHEN ao.scope = 'user'    THEN 1
      ELSE 2
    END,
    ao.free_until DESC
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_active_override(uuid) TO authenticated;

-- ─────────────────────────────────────────────────
-- 7. admin_get_billing_overview — фильтровать архивные компании
-- ─────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_get_billing_overview();
CREATE FUNCTION public.admin_get_billing_overview()
RETURNS TABLE (
  id             uuid,
  short_id       integer,
  name           text,
  plan           text,
  plan_until     timestamptz,
  trial_ends_at  timestamptz,
  grace_until    timestamptz,
  plan_features  jsonb,
  created_at     timestamptz,
  owner_user_id  uuid,
  owner_email    text,
  owner_short_id integer
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF NOT (
    SELECT COALESCE(platform_role, 'user') IN ('admin', 'superadmin')
    FROM public.profiles WHERE user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.short_id,
    a.name,
    a.plan,
    a.plan_until,
    a.trial_ends_at,
    a.grace_until,
    a.plan_features,
    a.created_at,
    am.user_id       AS owner_user_id,
    u.email::text    AS owner_email,
    p.short_id       AS owner_short_id
  FROM public.accounts a
  LEFT JOIN public.account_members am ON am.account_id = a.id AND am.role = 'owner'
  LEFT JOIN auth.users              u  ON u.id = am.user_id
  LEFT JOIN public.profiles         p  ON p.user_id = am.user_id
  WHERE a.deleted_at IS NULL
  ORDER BY a.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_billing_overview() TO authenticated;

-- ─────────────────────────────────────────────────
-- 8. create_account_with_owner — проверять user-level override
--    (заменяет patch_premium_plan.sql и patch_superadmin_company_bypass.sql)
-- ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_account_with_owner(p_account_name text)
RETURNS public.accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account           public.accounts;
  v_existing_count    int;
  v_has_paid_plan     boolean;
  v_platform_role     text;
  v_has_user_override boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_account_name IS NULL OR btrim(p_account_name) = '' THEN
    RAISE EXCEPTION 'Account name is required';
  END IF;

  SELECT COUNT(*) INTO v_existing_count
  FROM public.account_members am
  JOIN public.accounts a ON a.id = am.account_id
  WHERE am.user_id = auth.uid()
    AND am.role = 'owner'
    AND a.deleted_at IS NULL;

  IF v_existing_count >= 1 THEN
    -- Superadmin обходит всё
    SELECT COALESCE(platform_role, 'user') INTO v_platform_role
    FROM public.profiles
    WHERE user_id = auth.uid();

    IF v_platform_role != 'superadmin' THEN
      -- Проверяем user-level override
      SELECT EXISTS (
        SELECT 1 FROM public.access_overrides
        WHERE scope = 'user'
          AND user_id = auth.uid()
          AND is_active = true
          AND free_until >= CURRENT_DATE
      ) INTO v_has_user_override;

      IF NOT v_has_user_override THEN
        -- Проверяем платный план
        SELECT EXISTS (
          SELECT 1
          FROM public.account_members am
          JOIN public.accounts a ON a.id = am.account_id
          WHERE am.user_id = auth.uid()
            AND am.role = 'owner'
            AND a.deleted_at IS NULL
            AND a.plan IN ('seller', 'operational', 'premium')
            AND a.plan_until > now()
        ) INTO v_has_paid_plan;

        IF NOT v_has_paid_plan THEN
          RAISE EXCEPTION 'Для создания дополнительной компании необходима активная платная подписка (Селлер или Операционный)';
        END IF;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.accounts (name)
  VALUES (btrim(p_account_name))
  RETURNING * INTO v_account;

  INSERT INTO public.account_members (account_id, user_id, role)
  VALUES (v_account.id, auth.uid(), 'owner')
  ON CONFLICT (account_id, user_id) DO NOTHING;

  RETURN v_account;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_account_with_owner(text) TO authenticated;
