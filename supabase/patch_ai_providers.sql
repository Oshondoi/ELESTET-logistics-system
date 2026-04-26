-- patch_ai_providers.sql
-- Добавляет поддержку нескольких AI-провайдеров (OpenAI + Claude)
-- Применить один раз в Supabase SQL Editor

ALTER TABLE account_ai_settings
  ADD COLUMN IF NOT EXISTS provider     text NOT NULL DEFAULT 'openai',
  ADD COLUMN IF NOT EXISTS claude_key   text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS claude_model text NOT NULL DEFAULT 'claude-sonnet-4-6';

-- Обновить существующие записи со старыми ID моделей
UPDATE account_ai_settings
  SET claude_model = 'claude-sonnet-4-6'
  WHERE claude_model IN ('claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229');
