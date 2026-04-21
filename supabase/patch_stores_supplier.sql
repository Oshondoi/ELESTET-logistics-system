-- Добавляем поля поставщик и адрес в таблицу магазинов
ALTER TABLE stores ADD COLUMN IF NOT EXISTS supplier text;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS address  text;
