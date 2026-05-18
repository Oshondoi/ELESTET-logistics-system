-- Добавляет поле boxes_qty в fulfillment_batches для учёта коробов на этапе "Короба"
-- Отдельно от packaging_qty (зип-пакеты на этапе "Упаковка")

ALTER TABLE fulfillment_batches
  ADD COLUMN IF NOT EXISTS boxes_qty integer;
