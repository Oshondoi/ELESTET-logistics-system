-- Добавляет поле "Дата приёма" (reception_date) в таблицу trip_lines.
-- Это дата приёма товара на склад в Бишкеке (КР) до отправки в путь.

ALTER TABLE trip_lines
  ADD COLUMN IF NOT EXISTS reception_date date NULL;
