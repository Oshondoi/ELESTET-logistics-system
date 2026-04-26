-- patch_ai_reviews.sql
-- Применить один раз в Supabase SQL Editor

-- ── 1. Добавляем AI-поля в wb_feedbacks ─────────────────────────
ALTER TABLE wb_feedbacks
  ADD COLUMN IF NOT EXISTS ai_reply        text,
  ADD COLUMN IF NOT EXISTS ai_reply_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS reply_sent_at   timestamptz;

-- ai_reply_status: 'none' | 'generated' | 'sent'

-- ── 2. Настройки ИИ per-account ─────────────────────────────────
CREATE TABLE IF NOT EXISTS account_ai_settings (
  account_id    uuid        PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  openai_key    text        NOT NULL DEFAULT '',
  model         text        NOT NULL DEFAULT 'gpt-4o-mini',
  tone          text        NOT NULL DEFAULT 'polite',
  system_prompt text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE account_ai_settings ENABLE ROW LEVEL SECURITY;

-- Только члены компании могут читать и менять настройки ИИ
DROP POLICY IF EXISTS "account_ai_settings_member" ON account_ai_settings;
CREATE POLICY "account_ai_settings_member"
  ON account_ai_settings FOR ALL
  USING (
    account_id IN (
      SELECT account_id FROM account_members WHERE user_id = auth.uid()
    )
  );
