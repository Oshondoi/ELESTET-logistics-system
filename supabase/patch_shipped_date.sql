-- Добавляет поле "Дата отгрузки" (shipped_date) в таблицу trip_lines.
-- Заполняется автоматически при смене статуса на «Отгружен».

ALTER TABLE trip_lines
  ADD COLUMN IF NOT EXISTS shipped_date date NULL;
