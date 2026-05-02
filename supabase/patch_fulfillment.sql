-- ============================================================
-- patch_fulfillment.sql
-- Таблицы для модуля Фулфилмент (приёмка → ОТК → маркировка →
-- формирование коробов → передача на логистику)
-- ============================================================

-- ── 1. Настройки фулфилмента (per account) ──────────────────
CREATE TABLE IF NOT EXISTS fulfillment_settings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  -- Приёмка всегда включена, остальные этапы настраиваются
  stage_otk       BOOL NOT NULL DEFAULT true,
  stage_marking   BOOL NOT NULL DEFAULT true,
  stage_packing   BOOL NOT NULL DEFAULT true,
  stage_logistics BOOL NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE fulfillment_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fulfillment_settings_member_all" ON fulfillment_settings
  FOR ALL USING (
    account_id IN (
      SELECT account_id FROM account_members WHERE user_id = auth.uid()
    )
  );

-- ── 2. Партии фулфилмента ────────────────────────────────────
CREATE TABLE IF NOT EXISTS fulfillment_batches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  store_id    UUID REFERENCES stores(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active',
  -- active | done | cancelled
  current_stage TEXT NOT NULL DEFAULT 'reception',
  -- reception | otk | marking | packing | logistics | done
  -- Этапы партии (перекрывают account-настройки)
  stage_otk       BOOL NOT NULL DEFAULT true,
  stage_marking   BOOL NOT NULL DEFAULT true,
  stage_packing   BOOL NOT NULL DEFAULT true,
  stage_logistics BOOL NOT NULL DEFAULT true,
  -- Связь с логистикой
  trip_line_id UUID REFERENCES trip_lines(id) ON DELETE SET NULL,
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE fulfillment_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fulfillment_batches_member_all" ON fulfillment_batches
  FOR ALL USING (
    account_id IN (
      SELECT account_id FROM account_members WHERE user_id = auth.uid()
    )
  );

-- ── 3. Позиции (товарные строки) партии ─────────────────────
CREATE TABLE IF NOT EXISTS fulfillment_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id      UUID NOT NULL REFERENCES fulfillment_batches(id) ON DELETE CASCADE,
  barcode       TEXT NOT NULL,
  product_name  TEXT,
  size          TEXT,
  article       TEXT,
  -- Кол-во по этапам
  qty_received  INT NOT NULL DEFAULT 0,   -- Приёмка
  qty_otk       INT,                       -- ОТК
  qty_marked    INT,                       -- Маркировка
  qty_packed    INT,                       -- Формирование коробов
  boxes         INT,                       -- коробов для данной строки
  notes         TEXT,
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE fulfillment_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fulfillment_items_member_all" ON fulfillment_items
  FOR ALL USING (
    batch_id IN (
      SELECT id FROM fulfillment_batches
      WHERE account_id IN (
        SELECT account_id FROM account_members WHERE user_id = auth.uid()
      )
    )
  );

-- ── 4. Журнал этапов ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fulfillment_stage_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id     UUID NOT NULL REFERENCES fulfillment_batches(id) ON DELETE CASCADE,
  stage        TEXT NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes        TEXT
);

ALTER TABLE fulfillment_stage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fulfillment_stage_logs_member_all" ON fulfillment_stage_logs
  FOR ALL USING (
    batch_id IN (
      SELECT id FROM fulfillment_batches
      WHERE account_id IN (
        SELECT account_id FROM account_members WHERE user_id = auth.uid()
      )
    )
  );

-- ── 5. Права в ролях ─────────────────────────────────────────
-- Добавляем fulfillment_view и fulfillment_manage в roles.permissions (jsonb)
-- Существующие строки получают дефолт false (будет пересмотрено при нужде)
UPDATE roles
SET permissions = permissions
  || '{"fulfillment_view": false, "fulfillment_manage": false}'::jsonb
WHERE NOT (permissions ? 'fulfillment_view');
