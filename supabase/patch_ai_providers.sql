-- patch_ai_providers.sql
-- Добавляет поддержку нескольких AI-провайдеров (OpenAI + Claude)
-- Применить один раз в Supabase SQL Editor

ALTER TABLE account_ai_settings
  ADD COLUMN IF NOT EXISTS provider     text NOT NULL DEFAULT 'openai',
  ADD COLUMN IF NOT EXISTS claude_key   text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS claude_model text NOT NULL DEFAULT 'claude-3-5-sonnet-20241022';
