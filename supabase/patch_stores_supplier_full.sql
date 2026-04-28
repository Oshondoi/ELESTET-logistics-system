-- Добавляем поле полного наименования поставщика
ALTER TABLE stores ADD COLUMN IF NOT EXISTS supplier_full text;
