-- Добавляет поле ai_prompt в таблицу stores для хранения промпта магазина
ALTER TABLE stores ADD COLUMN IF NOT EXISTS ai_prompt text;
