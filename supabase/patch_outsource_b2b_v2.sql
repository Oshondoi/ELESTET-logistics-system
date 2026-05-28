-- ════════════════════════════════════════════════════════════
-- OUTSOURCE B2B V2
-- 1. get_executor_options  →  только принятые партнёры
-- 2. RLS для fulfillment-таблиц  →  доступ партнёров по batch_pipeline_stages
-- ════════════════════════════════════════════════════════════

-- ── 1. get_executor_options — ТОЛЬКО принятые партнёры ──────
CREATE OR REPLACE FUNCTION public.get_executor_options(p_account_id UUID)
RETURNS TABLE(
  account_id     UUID,
  account_name   TEXT,
  account_short_id INTEGER,
  option_type    TEXT
)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT
    pa.id,
    pa.name,
    pa.short_id,
    'partner'::TEXT
  FROM public.outsource_partners op
  JOIN public.accounts pa
    ON pa.id = CASE
      WHEN op.requester_id = p_account_id THEN op.partner_id
      ELSE op.requester_id
    END
  WHERE (op.requester_id = p_account_id OR op.partner_id = p_account_id)
    AND op.status = 'accepted'
    AND pa.deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.account_members
      WHERE account_id = p_account_id AND user_id = auth.uid()
    )
  ORDER BY pa.name;
$$;

GRANT EXECUTE ON FUNCTION public.get_executor_options(UUID) TO authenticated;

-- ── 2. Вспомогательная функция: проверка партнёрского доступа к батчу ──
-- (используется в RLS-политиках)
CREATE OR REPLACE FUNCTION public._is_batch_partner(p_batch_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.batch_pipeline_stages bps
    JOIN public.account_members am ON am.account_id = bps.partner_account_id
    WHERE bps.batch_id = p_batch_id
      AND am.user_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public._is_batch_partner(UUID) TO authenticated;

-- ── 3. RLS: fulfillment_items — партнёры могут читать и менять ──
-- (партнёр должен иметь возможность принимать товар, проставлять результаты)

-- Удаляем старую политику если была
DROP POLICY IF EXISTS "fulfillment_items_partner_all" ON fulfillment_items;

CREATE POLICY "fulfillment_items_partner_all" ON fulfillment_items
  FOR ALL USING (
    public._is_batch_partner(batch_id)
  )
  WITH CHECK (
    public._is_batch_partner(batch_id)
  );

-- ── 4. RLS: fulfillment_otk_logs ────────────────────────────
DROP POLICY IF EXISTS "fulfillment_otk_logs_partner_all" ON fulfillment_otk_logs;

CREATE POLICY "fulfillment_otk_logs_partner_all" ON fulfillment_otk_logs
  FOR ALL USING (
    public._is_batch_partner(batch_id)
  )
  WITH CHECK (
    public._is_batch_partner(batch_id)
  );

-- ── 5. RLS: fulfillment_marking_logs ────────────────────────
DROP POLICY IF EXISTS "fulfillment_marking_logs_partner_all" ON fulfillment_marking_logs;

CREATE POLICY "fulfillment_marking_logs_partner_all" ON fulfillment_marking_logs
  FOR ALL USING (
    public._is_batch_partner(batch_id)
  )
  WITH CHECK (
    public._is_batch_partner(batch_id)
  );

-- ── 6. RLS: fulfillment_packaging_logs ──────────────────────
DROP POLICY IF EXISTS "fulfillment_packaging_logs_partner_all" ON fulfillment_packaging_logs;

CREATE POLICY "fulfillment_packaging_logs_partner_all" ON fulfillment_packaging_logs
  FOR ALL USING (
    public._is_batch_partner(batch_id)
  )
  WITH CHECK (
    public._is_batch_partner(batch_id)
  );

-- ── 7. RLS: fulfillment_packing_logs (если таблица есть) ──────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'fulfillment_packing_logs') THEN
    EXECUTE $p$
      DROP POLICY IF EXISTS "fulfillment_packing_logs_partner_all" ON fulfillment_packing_logs;
      CREATE POLICY "fulfillment_packing_logs_partner_all" ON fulfillment_packing_logs
        FOR ALL USING (public._is_batch_partner(batch_id))
        WITH CHECK (public._is_batch_partner(batch_id));
    $p$;
  END IF;
END $$;

-- ── 8. RLS: fulfillment_stage_logs (если таблица есть) ────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'fulfillment_stage_logs') THEN
    EXECUTE $p$
      DROP POLICY IF EXISTS "fulfillment_stage_logs_partner_all" ON fulfillment_stage_logs;
      CREATE POLICY "fulfillment_stage_logs_partner_all" ON fulfillment_stage_logs
        FOR ALL USING (public._is_batch_partner(batch_id))
        WITH CHECK (public._is_batch_partner(batch_id));
    $p$;
  END IF;
END $$;

-- ── 9. RLS: fulfillment_packing_photos (если таблица есть) ──
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'fulfillment_packing_photos') THEN
    EXECUTE $p$
      DROP POLICY IF EXISTS "fulfillment_packing_photos_partner_all" ON fulfillment_packing_photos;
      CREATE POLICY "fulfillment_packing_photos_partner_all" ON fulfillment_packing_photos
        FOR ALL USING (public._is_batch_partner(batch_id))
        WITH CHECK (public._is_batch_partner(batch_id));
    $p$;
  END IF;
END $$;

-- ── 10. RLS: fulfillment_otk_photos (если таблица есть) ─────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'fulfillment_otk_photos') THEN
    EXECUTE $p$
      DROP POLICY IF EXISTS "fulfillment_otk_photos_partner_all" ON fulfillment_otk_photos;
      CREATE POLICY "fulfillment_otk_photos_partner_all" ON fulfillment_otk_photos
        FOR ALL USING (public._is_batch_partner(batch_id))
        WITH CHECK (public._is_batch_partner(batch_id));
    $p$;
  END IF;
END $$;
