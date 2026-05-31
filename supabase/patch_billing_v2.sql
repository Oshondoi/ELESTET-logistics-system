-- ============================================================
-- BILLING v2:
--   1. Триал только для первой компании пользователя
--   2. RPC для адмнинского дашборда (обход RLS)
-- ============================================================

-- 1. Исправить триггер: триал только если это первая компания пользователя
CREATE OR REPLACE FUNCTION set_trial_on_account_create()
RETURNS TRIGGER AS $$
DECLARE
  v_existing_count int;
BEGIN
  -- Считаем сколько аккаунтов уже есть у текущего пользователя
  SELECT COUNT(*) INTO v_existing_count
  FROM account_members
  WHERE user_id = auth.uid();

  -- Триал только если аккаунт самый первый (0 существующих)
  IF v_existing_count = 0 THEN
    NEW.trial_ends_at := NEW.created_at + INTERVAL '14 days';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Пересоздаём триггер (функция уже обновлена выше)
DROP TRIGGER IF EXISTS trg_set_trial_on_account_create ON accounts;
CREATE TRIGGER trg_set_trial_on_account_create
  BEFORE INSERT ON accounts
  FOR EACH ROW
  EXECUTE FUNCTION set_trial_on_account_create();

-- 2. RPC: admin_get_billing_overview — возвращает все аккаунты с биллинг-полями
--    SECURITY DEFINER позволяет обойти RLS (читает как суперпользователь БД)
--    В frontend проверяем email = 'sydykovsam@gmail.com' чтобы показать только админу
CREATE OR REPLACE FUNCTION admin_get_billing_overview()
RETURNS TABLE (
  id             uuid,
  name           text,
  plan           text,
  plan_until     timestamptz,
  trial_ends_at  timestamptz,
  grace_until    timestamptz,
  plan_features  jsonb,
  created_at     timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id,
    a.name,
    a.plan,
    a.plan_until,
    a.trial_ends_at,
    a.grace_until,
    a.plan_features,
    a.created_at
  FROM accounts a
  ORDER BY a.created_at DESC;
END;
$$;
