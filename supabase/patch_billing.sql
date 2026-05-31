-- ============================================================
-- BILLING: план, триал, grace, история изменений подписки
-- Применить в Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Новые колонки в accounts
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS plan          text        NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS plan_until    timestamptz          DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz          DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS grace_until   timestamptz          DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS plan_features jsonb       NOT NULL DEFAULT '{}';

-- 2. Для уже существующих аккаунтов — триал 14 дней от сейчас (свежий старт при введении фичи)
UPDATE accounts
SET trial_ends_at = now() + INTERVAL '14 days'
WHERE trial_ends_at IS NULL;

-- 3. Триггер: новый аккаунт получает trial_ends_at = created_at + 14 дней
CREATE OR REPLACE FUNCTION set_trial_on_account_create()
RETURNS TRIGGER AS $$
BEGIN
  NEW.trial_ends_at := NEW.created_at + INTERVAL '14 days';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_trial_on_account_create ON accounts;
CREATE TRIGGER trg_set_trial_on_account_create
  BEFORE INSERT ON accounts
  FOR EACH ROW
  EXECUTE FUNCTION set_trial_on_account_create();

-- 4. Таблица истории изменений подписки
CREATE TABLE IF NOT EXISTS account_plan_history (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event_type     text        NOT NULL,  -- 'trial_start' | 'plan_activated' | 'plan_expired' | 'grace_activated' | 'admin_override' | 'plan_cancelled'
  old_plan       text,
  new_plan       text,
  old_plan_until timestamptz,
  new_plan_until timestamptz,
  note           text,
  changed_by     uuid        REFERENCES auth.users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- RLS на историю: читать может только суперадмин (через сервисный ключ Edge Function)
ALTER TABLE account_plan_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin can manage plan history" ON account_plan_history;
CREATE POLICY "admin can manage plan history"
  ON account_plan_history
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- 5. Записать стартовые триалы в историю для существующих аккаунтов
INSERT INTO account_plan_history (account_id, event_type, new_plan, new_plan_until, note)
SELECT id, 'trial_start', 'trial', trial_ends_at, 'Billing system launched — trial assigned'
FROM accounts
WHERE trial_ends_at IS NOT NULL
ON CONFLICT DO NOTHING;

-- 6. RPC: activate_grace_period — клиент сам включает 3 дня в долг
CREATE OR REPLACE FUNCTION activate_grace_period(p_account_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_account accounts;
  v_grace_end timestamptz;
BEGIN
  SELECT * INTO v_account FROM accounts WHERE id = p_account_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Account not found');
  END IF;

  -- Только если триал истёк И нет активной подписки И grace ещё не активирован
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

  UPDATE accounts
  SET grace_until = v_grace_end
  WHERE id = p_account_id;

  INSERT INTO account_plan_history (account_id, event_type, note, new_plan_until)
  VALUES (p_account_id, 'grace_activated', '3-day grace period activated by user', v_grace_end);

  RETURN jsonb_build_object('ok', true, 'grace_until', v_grace_end);
END;
$$;

-- 7. RPC: admin_set_plan — суперадмин вручную устанавливает план
CREATE OR REPLACE FUNCTION admin_set_plan(
  p_account_id  uuid,
  p_plan        text,
  p_plan_until  timestamptz,
  p_note        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_old_plan       text;
  v_old_plan_until timestamptz;
BEGIN
  SELECT plan, plan_until INTO v_old_plan, v_old_plan_until
  FROM accounts WHERE id = p_account_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Account not found');
  END IF;

  UPDATE accounts
  SET plan       = p_plan,
      plan_until = p_plan_until
  WHERE id = p_account_id;

  INSERT INTO account_plan_history (
    account_id, event_type, old_plan, new_plan, old_plan_until, new_plan_until, note, changed_by
  ) VALUES (
    p_account_id, 'admin_override', v_old_plan, p_plan, v_old_plan_until, p_plan_until, p_note, auth.uid()
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;
