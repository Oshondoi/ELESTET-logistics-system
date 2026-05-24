-- Добавляет расходник и количество этикеток в журнал Маркировки

ALTER TABLE fulfillment_marking_logs
  ADD COLUMN IF NOT EXISTS consumable_id uuid REFERENCES consumables(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS labels_qty integer;

CREATE INDEX IF NOT EXISTS idx_marking_logs_consumable_id
  ON fulfillment_marking_logs(consumable_id)
  WHERE consumable_id IS NOT NULL;
