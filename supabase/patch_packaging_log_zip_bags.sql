-- Добавляет поле zip_bags_qty в fulfillment_packaging_logs
-- Для фиксации кол-ва зип-пакетов использованных в конкретной записи работы (этап Упаковка)

ALTER TABLE fulfillment_packaging_logs
  ADD COLUMN IF NOT EXISTS zip_bags_qty integer;
