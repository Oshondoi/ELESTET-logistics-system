-- Добавить колонку color в fulfillment_items
ALTER TABLE fulfillment_items ADD COLUMN IF NOT EXISTS color text;
