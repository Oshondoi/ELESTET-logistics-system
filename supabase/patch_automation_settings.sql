-- patch_automation_settings.sql
-- Применить в Supabase SQL Editor

-- ── 1. Таблица настроек автоматизации per-account ────────────────
CREATE TABLE IF NOT EXISTS automation_settings (
  account_id        uuid        PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  is_enabled        boolean     NOT NULL DEFAULT false,
  source            text        NOT NULL DEFAULT 'ai',  -- 'ai' | 'templates' | 'ai_with_fallback'
  daily_limit       integer     NOT NULL DEFAULT 50,    -- 0 = без лимита
  target_ratings    integer[]   NOT NULL DEFAULT '{1,2,3,4,5}',
  require_text      boolean     NOT NULL DEFAULT false,
  delay_seconds     integer     NOT NULL DEFAULT 32,
  store_ids         uuid[]      NOT NULL DEFAULT '{}',
  daily_sent_count  integer     NOT NULL DEFAULT 0,
  daily_reset_date  date,
  last_run_at       timestamptz,
  last_log          text[]      NOT NULL DEFAULT '{}',
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE automation_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "automation_settings_member" ON automation_settings;
CREATE POLICY "automation_settings_member"
  ON automation_settings FOR ALL
  USING (
    account_id IN (
      SELECT account_id FROM account_members WHERE user_id = auth.uid()
    )
  );

-- ── 2. Таблица логов автоматизации ───────────────────────────────
CREATE TABLE IF NOT EXISTS automation_logs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  run_at      timestamptz NOT NULL DEFAULT now(),
  sent_count  integer     NOT NULL DEFAULT 0,
  log         text[]      NOT NULL DEFAULT '{}',
  error       text
);

ALTER TABLE automation_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "automation_logs_member" ON automation_logs;
CREATE POLICY "automation_logs_member"
  ON automation_logs FOR ALL
  USING (
    account_id IN (
      SELECT account_id FROM account_members WHERE user_id = auth.uid()
    )
  );

-- Только последние 100 логов на аккаунт
CREATE INDEX IF NOT EXISTS idx_automation_logs_account_run
  ON automation_logs(account_id, run_at DESC);

-- ── 3. Функция сброса дневного счётчика если новый день ──────────
CREATE OR REPLACE FUNCTION reset_daily_sent_if_needed()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE automation_settings
  SET daily_sent_count = 0,
      daily_reset_date = CURRENT_DATE
  WHERE daily_reset_date IS NULL
     OR daily_reset_date < CURRENT_DATE;
END;
$$;
