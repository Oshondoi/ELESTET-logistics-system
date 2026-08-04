-- patch_wms.sql
-- WMS Lite — адресное хранение (Склад → Зона → Ячейки в виде сетки)
-- ──────────────────────────────────────────────────────────────────

-- 1. Склады (собственные склады клиентов — не WB-склады из справочника)
CREATE TABLE IF NOT EXISTS public.wms_warehouses (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid        NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  description text        NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 2. Зоны внутри склада (каждая зона = сетка cols × rows ячеек)
CREATE TABLE IF NOT EXISTS public.wms_zones (
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid    NOT NULL REFERENCES public.wms_warehouses(id) ON DELETE CASCADE,
  account_id   uuid    NOT NULL,
  name         text    NOT NULL,
  cols         integer NOT NULL DEFAULT 6  CHECK (cols  BETWEEN 1 AND 26),
  rows         integer NOT NULL DEFAULT 8  CHECK (rows  BETWEEN 1 AND 50),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- 3. Ячейки (хранятся ТОЛЬКО occupied / reserved; free = отсутствует в таблице)
CREATE TABLE IF NOT EXISTS public.wms_cells (
  id         uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id    uuid    NOT NULL REFERENCES public.wms_zones(id) ON DELETE CASCADE,
  account_id uuid    NOT NULL,
  col        text    NOT NULL,    -- 'A', 'B', 'C'...
  row        integer NOT NULL,    -- 1, 2, 3...
  status     text    NOT NULL DEFAULT 'occupied'
                     CHECK (status IN ('occupied', 'reserved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (zone_id, col, row)
);

-- 4. Содержимое ячеек
CREATE TABLE IF NOT EXISTS public.wms_cell_items (
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  cell_id      uuid    NOT NULL REFERENCES public.wms_cells(id) ON DELETE CASCADE,
  account_id   uuid    NOT NULL,
  barcode      text    NOT NULL DEFAULT '',
  product_name text    NOT NULL DEFAULT '',
  qty          integer NOT NULL DEFAULT 0 CHECK (qty >= 0),
  reserved_qty integer NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- 5. RLS
ALTER TABLE public.wms_warehouses  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wms_zones       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wms_cells       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wms_cell_items  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wms_warehouses_account" ON public.wms_warehouses FOR ALL
  USING      (account_id IN (SELECT account_id FROM public.account_members WHERE user_id = auth.uid()))
  WITH CHECK (account_id IN (SELECT account_id FROM public.account_members WHERE user_id = auth.uid()));

CREATE POLICY "wms_zones_account" ON public.wms_zones FOR ALL
  USING      (account_id IN (SELECT account_id FROM public.account_members WHERE user_id = auth.uid()))
  WITH CHECK (account_id IN (SELECT account_id FROM public.account_members WHERE user_id = auth.uid()));

CREATE POLICY "wms_cells_account" ON public.wms_cells FOR ALL
  USING      (account_id IN (SELECT account_id FROM public.account_members WHERE user_id = auth.uid()))
  WITH CHECK (account_id IN (SELECT account_id FROM public.account_members WHERE user_id = auth.uid()));

CREATE POLICY "wms_cell_items_account" ON public.wms_cell_items FOR ALL
  USING      (account_id IN (SELECT account_id FROM public.account_members WHERE user_id = auth.uid()))
  WITH CHECK (account_id IN (SELECT account_id FROM public.account_members WHERE user_id = auth.uid()));
