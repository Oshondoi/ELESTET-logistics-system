-- patch_wms_boxes.sql
-- Добавляет поддержку коробов в ячейках WMS
-- ──────────────────────────────────────────

-- 1. Добавляем поля в wms_cell_items
ALTER TABLE public.wms_cell_items
  ADD COLUMN IF NOT EXISTS item_type text NOT NULL DEFAULT 'item'
    CHECK (item_type IN ('item', 'box')),
  ADD COLUMN IF NOT EXISTS box_name  text NOT NULL DEFAULT '';

-- 2. Таблица содержимого коробов
CREATE TABLE IF NOT EXISTS public.wms_box_contents (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  box_item_id uuid    NOT NULL REFERENCES public.wms_cell_items(id) ON DELETE CASCADE,
  account_id  uuid    NOT NULL,
  barcode     text    NOT NULL DEFAULT '',
  product_name text   NOT NULL DEFAULT '',
  qty_per_box integer NOT NULL DEFAULT 1 CHECK (qty_per_box > 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 3. RLS
ALTER TABLE public.wms_box_contents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wms_box_contents_account" ON public.wms_box_contents FOR ALL
  USING      (account_id IN (SELECT account_id FROM public.account_members WHERE user_id = auth.uid()))
  WITH CHECK (account_id IN (SELECT account_id FROM public.account_members WHERE user_id = auth.uid()));
