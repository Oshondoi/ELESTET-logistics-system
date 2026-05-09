-- patch_excluded_nm_ids.sql
-- Добавляет поле excluded_nm_ids в automation_settings
-- Применить в Supabase SQL Editor

ALTER TABLE automation_settings
  ADD COLUMN IF NOT EXISTS excluded_nm_ids integer[] NOT NULL DEFAULT '{}';
