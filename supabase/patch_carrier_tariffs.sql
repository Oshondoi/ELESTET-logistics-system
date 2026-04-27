-- patch_carrier_tariffs.sql
-- Тарифы перевозчиков и тарифы отгрузки на склады ВБ

-- ── 1. Тарифы перевозчика до пункта назначения ───────────────────
CREATE TABLE IF NOT EXISTS carrier_tariffs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  carrier_id    uuid        NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  warehouse_id  uuid        NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  price_per_box numeric,          -- цена за 1 короб до склада назначения
  price_per_kg  numeric,          -- цена за 1 кг до склада назначения
  UNIQUE(carrier_id, warehouse_id)
);

ALTER TABLE carrier_tariffs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "carrier_tariffs_member" ON carrier_tariffs;
CREATE POLICY "carrier_tariffs_member"
  ON carrier_tariffs FOR ALL
  USING (
    account_id IN (
      SELECT account_id FROM account_members WHERE user_id = auth.uid()
    )
  );

-- ── 2. Тарифы за отгрузку на склады ВБ (за короб) ───────────────
CREATE TABLE IF NOT EXISTS wb_unload_tariffs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  warehouse_id  uuid        NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  price_per_box numeric     NOT NULL DEFAULT 0,
  UNIQUE(account_id, warehouse_id)
);

ALTER TABLE wb_unload_tariffs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wb_unload_tariffs_member" ON wb_unload_tariffs;
CREATE POLICY "wb_unload_tariffs_member"
  ON wb_unload_tariffs FOR ALL
  USING (
    account_id IN (
      SELECT account_id FROM account_members WHERE user_id = auth.uid()
    )
  );
