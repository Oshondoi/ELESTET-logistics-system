-- Добавляем поля состав, цвет, страна производства в таблицу товаров
ALTER TABLE products ADD COLUMN IF NOT EXISTS color       text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS composition text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS country     text;
