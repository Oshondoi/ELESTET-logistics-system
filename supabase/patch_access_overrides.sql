-- ============================================================
-- ACCESS OVERRIDES:
--   1. system_settings — глобальные настройки (trial_days_default)
--   2. access_overrides — ручные переопределения (trial/plan)
--   3. Обновление триггера: читать trial_days_default из system_settings
--   4. RPCs: get_active_override, admin_*
-- ============================================================

-- 1. Таблица system_settings
CREATE TABLE IF NOT EXISTS public.system_settings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

INSERT INTO public.system_settings (key, value)
VALUES ('trial_days_default', '14')
ON CONFLICT (key) DO NOTHING;

-- RLS: только через SECURITY DEFINER RPCs
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny all system_settings" ON public.system_settings;
CREATE POLICY "deny all system_settings" ON public.system_settings USING (false);

-- 2. Таблица access_overrides
CREATE TABLE IF NOT EXISTS public.access_overrides (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope      text NOT NULL CHECK (scope IN ('global', 'account')),
  account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
  type       text NOT NULL CHECK (type IN ('trial', 'plan')),
  plan       text CHECK (plan IN ('seller', 'operational')),
  free_until date NOT NULL,
  reason     text,
  created_at timestamptz DEFAULT now(),
  is_active  boolean NOT NULL DEFAULT true,
  CONSTRAINT chk_account_scope CHECK (
    (scope = 'global' AND account_id IS NULL) OR
    (scope = 'account' AND account_id IS NOT NULL)
  )
);

ALTER TABLE public.access_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny all access_overrides" ON public.access_overrides;
CREATE POLICY "deny all access_overrides" ON public.access_overrides USING (false);

-- 3. Обновить триггер: читать trial_days_default из system_settings
CREATE OR REPLACE FUNCTION set_trial_on_account_create()
RETURNS TRIGGER AS $$
DECLARE
  v_existing_count int;
  v_trial_days     int;
BEGIN
  SELECT COUNT(*) INTO v_existing_count
  FROM account_members
  WHERE user_id = auth.uid();

  IF v_existing_count = 0 THEN
    SELECT COALESCE(value::int, 14) INTO v_trial_days
    FROM public.system_settings
    WHERE key = 'trial_days_default';

    NEW.trial_ends_at := NEW.created_at + (COALESCE(v_trial_days, 14) || ' days')::interval;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. RPC: get_active_override — для фронта (проверяет членство)
CREATE OR REPLACE FUNCTION get_active_override(p_account_id uuid)
RETURNS TABLE (type text, plan text, free_until date)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  -- Проверяем что текущий пользователь имеет доступ к этому аккаунту
  IF NOT EXISTS (
    SELECT 1 FROM account_members
    WHERE account_id = p_account_id AND user_id = auth.uid()
  ) THEN
    RETURN;
  END IF;

  -- Приоритет: account > global; по free_until DESC (берём наибольшую)
  RETURN QUERY
  SELECT ao.type, ao.plan, ao.free_until
  FROM access_overrides ao
  WHERE ao.is_active = true
    AND ao.free_until >= CURRENT_DATE
    AND (
      (ao.scope = 'account' AND ao.account_id = p_account_id)
      OR (ao.scope = 'global')
    )
  ORDER BY
    CASE WHEN ao.scope = 'account' THEN 0 ELSE 1 END,
    ao.free_until DESC
  LIMIT 1;
END;
$$;

-- 5. RPC: admin_get_access_overrides — для AdminPage
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

-- 6. RPC: admin_get_system_settings
CREATE OR REPLACE FUNCTION admin_get_system_settings()
RETURNS TABLE (key text, value text, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY SELECT s.key, s.value, s.updated_at FROM system_settings s;
END;
$$;

-- 7. RPC: admin_upsert_system_setting
CREATE OR REPLACE FUNCTION admin_upsert_system_setting(p_key text, p_value text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO system_settings (key, value, updated_at)
  VALUES (p_key, p_value, now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
END;
$$;

-- 8. RPC: admin_create_override
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
  INSERT INTO access_overrides (scope, account_id, type, plan, free_until, reason)
  VALUES (p_scope, p_account_id, p_type, p_plan, p_free_until, p_reason)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- 9. RPC: admin_deactivate_override
CREATE OR REPLACE FUNCTION admin_deactivate_override(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  UPDATE access_overrides SET is_active = false WHERE id = p_id;
END;
$$;
