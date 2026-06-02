-- ============================================================
-- BILLING SECURITY:
--   1. Все admin_* billing/access RPCs — добавить проверку роли
--   2. activate_grace_period — добавить проверку членства
--   3. account_plan_history — закрыть прямой доступ не-админам
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- Вспомогательная функция проверки admin-роли
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION is_platform_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid()
      AND platform_role IN ('admin', 'superadmin')
  );
$$;

-- ──────────────────────────────────────────────────────────────
-- 1. admin_get_billing_overview — с проверкой роли
-- ──────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS admin_get_billing_overview();

CREATE FUNCTION admin_get_billing_overview()
RETURNS TABLE (
  id              uuid,
  short_id        integer,
  name            text,
  plan            text,
  plan_until      timestamptz,
  trial_ends_at   timestamptz,
  grace_until     timestamptz,
  plan_features   jsonb,
  created_at      timestamptz,
  owner_user_id   uuid,
  owner_email     text,
  owner_short_id  integer
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Нет доступа: требуется роль admin или superadmin';
  END IF;

  RETURN QUERY
  SELECT
    a.id, a.short_id, a.name, a.plan, a.plan_until,
    a.trial_ends_at, a.grace_until, a.plan_features, a.created_at,
    am.user_id AS owner_user_id,
    u.email::text AS owner_email,
    p.short_id AS owner_short_id
  FROM accounts a
  LEFT JOIN account_members am ON am.account_id = a.id AND am.role = 'owner'
  LEFT JOIN auth.users u ON u.id = am.user_id
  LEFT JOIN profiles p ON p.user_id = am.user_id
  ORDER BY a.created_at DESC;
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- 2. admin_set_plan — с проверкой роли
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_set_plan(
  p_account_id  uuid,
  p_plan        text,
  p_plan_until  timestamptz,
  p_note        text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_old_plan       text;
  v_old_plan_until timestamptz;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Нет доступа: требуется роль admin или superadmin';
  END IF;

  SELECT plan, plan_until INTO v_old_plan, v_old_plan_until
  FROM accounts WHERE id = p_account_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Account not found');
  END IF;

  UPDATE accounts
  SET plan = p_plan, plan_until = p_plan_until
  WHERE id = p_account_id;

  INSERT INTO account_plan_history (
    account_id, event_type, old_plan, new_plan,
    old_plan_until, new_plan_until, note, changed_by
  ) VALUES (
    p_account_id, 'admin_override', v_old_plan, p_plan,
    v_old_plan_until, p_plan_until, p_note, auth.uid()
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- 3. admin_get_access_overrides — с проверкой роли
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_get_access_overrides()
RETURNS TABLE (
  id           uuid,
  scope        text,
  account_id   uuid,
  account_name text,
  type         text,
  plan         text,
  free_until   date,
  reason       text,
  created_at   timestamptz,
  is_active    boolean
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Нет доступа: требуется роль admin или superadmin';
  END IF;

  RETURN QUERY
  SELECT
    ao.id, ao.scope, ao.account_id, a.name,
    ao.type, ao.plan, ao.free_until, ao.reason,
    ao.created_at, ao.is_active
  FROM access_overrides ao
  LEFT JOIN accounts a ON a.id = ao.account_id
  ORDER BY ao.created_at DESC;
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- 4. admin_get_system_settings — с проверкой роли
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_get_system_settings()
RETURNS TABLE (key text, value text, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Нет доступа: требуется роль admin или superadmin';
  END IF;

  RETURN QUERY SELECT s.key, s.value, s.updated_at FROM system_settings s;
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- 5. admin_upsert_system_setting — с проверкой роли
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_upsert_system_setting(p_key text, p_value text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Нет доступа: требуется роль admin или superadmin';
  END IF;

  INSERT INTO system_settings (key, value, updated_at)
  VALUES (p_key, p_value, now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- 6. admin_create_override — с проверкой роли
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_create_override(
  p_scope      text,
  p_account_id uuid,
  p_type       text,
  p_plan       text,
  p_free_until date,
  p_reason     text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Нет доступа: требуется роль admin или superadmin';
  END IF;

  INSERT INTO access_overrides (scope, account_id, type, plan, free_until, reason)
  VALUES (p_scope, p_account_id, p_type, p_plan, p_free_until, p_reason)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- 7. admin_deactivate_override — с проверкой роли
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_deactivate_override(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Нет доступа: требуется роль admin или superadmin';
  END IF;

  UPDATE access_overrides SET is_active = false WHERE id = p_id;
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- 8. activate_grace_period — добавить проверку членства
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION activate_grace_period(p_account_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_account   accounts;
  v_grace_end timestamptz;
BEGIN
  -- Проверяем что текущий пользователь — owner этой компании
  IF NOT EXISTS (
    SELECT 1 FROM account_members
    WHERE account_id = p_account_id
      AND user_id = auth.uid()
      AND role = 'owner'
  ) THEN
    RETURN jsonb_build_object('error', 'Access denied');
  END IF;

  SELECT * INTO v_account FROM accounts WHERE id = p_account_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Account not found');
  END IF;

  IF v_account.trial_ends_at > now() THEN
    RETURN jsonb_build_object('error', 'Trial period is still active');
  END IF;
  IF v_account.plan_until IS NOT NULL AND v_account.plan_until > now() THEN
    RETURN jsonb_build_object('error', 'Subscription is already active');
  END IF;
  IF v_account.grace_until IS NOT NULL AND v_account.grace_until > now() THEN
    RETURN jsonb_build_object('error', 'Grace period is already active');
  END IF;

  v_grace_end := now() + INTERVAL '3 days';

  UPDATE accounts SET grace_until = v_grace_end WHERE id = p_account_id;

  INSERT INTO account_plan_history (account_id, event_type, note, new_plan_until)
  VALUES (p_account_id, 'grace_activated', '3-day grace period activated by user', v_grace_end);

  RETURN jsonb_build_object('ok', true, 'grace_until', v_grace_end);
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- 9. account_plan_history RLS — только admin/superadmin
-- ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "admin can manage plan history" ON account_plan_history;

CREATE POLICY "admin can manage plan history"
  ON account_plan_history FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = auth.uid()
        AND platform_role IN ('admin', 'superadmin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = auth.uid()
        AND platform_role IN ('admin', 'superadmin')
    )
  );
