-- patch_reply_source.sql
-- Добавляет колонку reply_source в wb_feedbacks
-- Значения: 'manual' (ответил пользователь вручную) | 'auto' (автоответ сервера)

ALTER TABLE wb_feedbacks
  ADD COLUMN IF NOT EXISTS reply_source text;
