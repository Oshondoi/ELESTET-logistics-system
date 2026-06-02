-- ============================================================
-- BILLING EXTRA:
--   1. create_account_with_owner — блокировать создание 2-й
--      компании без активной платной подписки
--   2. access_overrides — добавить include_trial_accounts
--      (не распространять глобальный оверрайд на аккаунты
--       у которых ещё идёт обычный триал, если не выбрано)
-- ============================================================

-- 1. create_account_with_owner с проверкой подписки
CREATE OR REPLACE FUNCTION public.create_account_with_owner(p_account_name text)
RETURNS public.accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account        public.accounts;
  v_existing_count int;
  v_has_paid_plan  boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_account_name IS NULL OR btrim(p_account_name) = '' THEN
    RAISE EXCEPTION 'Account name is required';
  END IF;

  SELECT COUNT(*) INTO v_existing_count
  FROM account_members am
  JOIN accounts a ON a.id = am.account_id
  WHERE am.user_id = auth.uid()
    AND am.role = 'owner'
    AND a.deleted_at IS NULL;

  IF v_existing_count >= 1 THEN
    SELECT EXISTS (
      SELECT 1
      FROM account_members am
      JOIN accounts a ON a.id = am.account_id
      WHERE am.user_id = auth.uid()
        AND am.role = 'owner'
        AND a.deleted_at IS NULL
        AND a.plan IN ('seller', 'operational')
        AND a.plan_until > now()
    ) INTO v_has_paid_plan;

    IF NOT v_has_paid_plan THEN
      RAISE EXCEPTION 'Для создания дополнительной компании необходима активная платная подписка (Селлер или Операционный)';
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

-- 2. access_overrides — добавить колонку include_trial_accounts
ALTER TABLE public.access_overrides
  ADD COLUMN IF NOT EXISTS include_trial_accounts boolean NOT NULL DEFAULT true;

-- 3. get_active_override — учитывать include_trial_accounts
CREATE OR REPLACE FUNCTION get_active_override(p_account_id uuid)
RETURNS TABLE (type text, plan text, free_until date)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_account_trial_active boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM account_members
    WHERE account_id = p_account_id AND user_id = auth.uid()
  ) THEN
    RETURN;
  END IF;

  SELECT (trial_ends_at IS NOT NULL AND trial_ends_at > now()) INTO v_account_trial_active
  FROM accounts WHERE id = p_account_id;

  RETURN QUERY
  SELECT ao.type, ao.plan, ao.free_until
  FROM access_overrides ao
  WHERE ao.is_active = true
    AND ao.free_until >= CURRENT_DATE
    AND (
      (ao.scope = 'account' AND ao.account_id = p_account_id)
      OR (
        ao.scope = 'global'
        AND (ao.include_trial_accounts = true OR NOT v_account_trial_active)
      )
    )
  ORDER BY
    CASE WHEN ao.scope = 'account' THEN 0 ELSE 1 END,
    ao.free_until DESC
  LIMIT 1;
END;
$$;

-- 4. admin_get_access_overrides — добавить include_trial_accounts в ответ
DROP FUNCTION IF EXISTS admin_get_access_overrides();
CREATE OR REPLACE FUNCTION admin_get_access_overrides()
RETURNS TABLE (
  id                     uuid,
  scope                  text,
  account_id             uuid,
  account_name           text,
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
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    ao.id, ao.scope, ao.account_id, a.name,
    ao.type, ao.plan, ao.free_until, ao.reason,
    ao.created_at, ao.is_active, ao.include_trial_accounts
  FROM access_overrides ao
  LEFT JOIN accounts a ON a.id = ao.account_id
  ORDER BY ao.created_at DESC;
END;
$$;

-- 5. admin_create_override — принимать include_trial_accounts
CREATE OR REPLACE FUNCTION admin_create_override(
  p_scope                  text,
  p_account_id             uuid,
  p_type                   text,
  p_plan                   text,
  p_free_until             date,
  p_reason                 text,
  p_include_trial_accounts boolean DEFAULT true
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO access_overrides (scope, account_id, type, plan, free_until, reason, include_trial_accounts)
  VALUES (p_scope, p_account_id, p_type, p_plan, p_free_until, p_reason, p_include_trial_accounts)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
