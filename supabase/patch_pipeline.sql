-- ============================================================
-- patch_pipeline.sql
-- Мультистадийный аутсорс-пайплайн для партий фулфилмента
-- Владелец настраивает стадии → при создании партии копируется
-- snapshot → каждая компания работает только в своей стадии
-- ============================================================

-- ── 1. Конфигурация пайплайна аккаунта (шаблон) ─────────────
CREATE TABLE IF NOT EXISTS public.account_pipeline_stages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  order_index         INTEGER NOT NULL DEFAULT 0,
  name                TEXT NOT NULL DEFAULT '',
  -- null = сам владелец, иначе партнёрская компания
  partner_account_id  UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  stage_otk           BOOLEAN NOT NULL DEFAULT false,
  stage_packaging     BOOLEAN NOT NULL DEFAULT false,
  stage_marking       BOOLEAN NOT NULL DEFAULT false,
  stage_packing       BOOLEAN NOT NULL DEFAULT false,
  stage_logistics     BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, order_index)
);

CREATE INDEX IF NOT EXISTS idx_aps_account ON public.account_pipeline_stages(account_id);
CREATE INDEX IF NOT EXISTS idx_aps_partner ON public.account_pipeline_stages(partner_account_id);

ALTER TABLE public.account_pipeline_stages ENABLE ROW LEVEL SECURITY;

-- ── 2. Снапшот пайплайна для конкретной партии ──────────────
CREATE TABLE IF NOT EXISTS public.batch_pipeline_stages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id            UUID NOT NULL REFERENCES public.fulfillment_batches(id) ON DELETE CASCADE,
  owner_account_id    UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  -- null = сам владелец исполняет эту стадию
  partner_account_id  UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  order_index         INTEGER NOT NULL DEFAULT 0,
  name                TEXT NOT NULL DEFAULT '',
  current_stage       TEXT NOT NULL DEFAULT 'reception',
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'active', 'done')),
  stage_otk           BOOLEAN NOT NULL DEFAULT false,
  stage_packaging     BOOLEAN NOT NULL DEFAULT false,
  stage_marking       BOOLEAN NOT NULL DEFAULT false,
  stage_packing       BOOLEAN NOT NULL DEFAULT false,
  stage_logistics     BOOLEAN NOT NULL DEFAULT false,
  activated_at        TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bps_batch   ON public.batch_pipeline_stages(batch_id);
CREATE INDEX IF NOT EXISTS idx_bps_partner ON public.batch_pipeline_stages(partner_account_id);
CREATE INDEX IF NOT EXISTS idx_bps_owner   ON public.batch_pipeline_stages(owner_account_id);

ALTER TABLE public.batch_pipeline_stages ENABLE ROW LEVEL SECURITY;

-- ── 3. RLS — account_pipeline_stages ────────────────────────
DROP POLICY IF EXISTS "aps_select" ON public.account_pipeline_stages;
DROP POLICY IF EXISTS "aps_insert" ON public.account_pipeline_stages;
DROP POLICY IF EXISTS "aps_update" ON public.account_pipeline_stages;
DROP POLICY IF EXISTS "aps_delete" ON public.account_pipeline_stages;

CREATE POLICY "aps_select" ON public.account_pipeline_stages
  FOR SELECT USING (
    account_id IN (SELECT account_id FROM public.account_members WHERE user_id = auth.uid())
  );

CREATE POLICY "aps_insert" ON public.account_pipeline_stages
  FOR INSERT WITH CHECK (
    account_id IN (SELECT account_id FROM public.account_members WHERE user_id = auth.uid())
  );

CREATE POLICY "aps_update" ON public.account_pipeline_stages
  FOR UPDATE USING (
    account_id IN (SELECT account_id FROM public.account_members WHERE user_id = auth.uid())
  );

CREATE POLICY "aps_delete" ON public.account_pipeline_stages
  FOR DELETE USING (
    account_id IN (SELECT account_id FROM public.account_members WHERE user_id = auth.uid())
  );

-- ── 4. RLS — batch_pipeline_stages ──────────────────────────
DROP POLICY IF EXISTS "bps_select"          ON public.batch_pipeline_stages;
DROP POLICY IF EXISTS "bps_insert"          ON public.batch_pipeline_stages;
DROP POLICY IF EXISTS "bps_update_owner"    ON public.batch_pipeline_stages;
DROP POLICY IF EXISTS "bps_update_partner"  ON public.batch_pipeline_stages;
DROP POLICY IF EXISTS "bps_delete"          ON public.batch_pipeline_stages;

-- Просмотр: владелец партии ИЛИ партнёр назначенный на эту стадию
CREATE POLICY "bps_select" ON public.batch_pipeline_stages
  FOR SELECT USING (
    owner_account_id IN (SELECT account_id FROM public.account_members WHERE user_id = auth.uid())
    OR
    partner_account_id IN (SELECT account_id FROM public.account_members WHERE user_id = auth.uid())
  );

-- Вставка: только владелец партии
CREATE POLICY "bps_insert" ON public.batch_pipeline_stages
  FOR INSERT WITH CHECK (
    owner_account_id IN (SELECT account_id FROM public.account_members WHERE user_id = auth.uid())
  );

-- Обновление: владелец обновляет всё
CREATE POLICY "bps_update_owner" ON public.batch_pipeline_stages
  FOR UPDATE USING (
    owner_account_id IN (SELECT account_id FROM public.account_members WHERE user_id = auth.uid())
  );

-- Обновление: партнёр обновляет только свою стадию (current_stage)
CREATE POLICY "bps_update_partner" ON public.batch_pipeline_stages
  FOR UPDATE USING (
    partner_account_id IN (SELECT account_id FROM public.account_members WHERE user_id = auth.uid())
  );

-- Удаление: только владелец
CREATE POLICY "bps_delete" ON public.batch_pipeline_stages
  FOR DELETE USING (
    owner_account_id IN (SELECT account_id FROM public.account_members WHERE user_id = auth.uid())
  );

-- ── 5. Доп. политика SELECT на fulfillment_batches ──────────
-- Позволяет партнёрам из batch_pipeline_stages читать саму партию
DROP POLICY IF EXISTS "fulfillment_batches_pipeline_partner_select" ON public.fulfillment_batches;

CREATE POLICY "fulfillment_batches_pipeline_partner_select" ON public.fulfillment_batches
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.batch_pipeline_stages bps
      JOIN public.account_members am ON am.account_id = bps.partner_account_id
      WHERE bps.batch_id = fulfillment_batches.id
        AND am.user_id = auth.uid()
    )
  );

-- ── 6. RPC: получить конфигурацию пайплайна аккаунта ────────
CREATE OR REPLACE FUNCTION public.get_account_pipeline(p_account_id UUID)
RETURNS TABLE (
  id                  UUID,
  account_id          UUID,
  order_index         INTEGER,
  name                TEXT,
  partner_account_id  UUID,
  partner_name        TEXT,
  partner_short_id    INTEGER,
  stage_otk           BOOLEAN,
  stage_packaging     BOOLEAN,
  stage_marking       BOOLEAN,
  stage_packing       BOOLEAN,
  stage_logistics     BOOLEAN,
  created_at          TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    aps.id,
    aps.account_id,
    aps.order_index,
    aps.name,
    aps.partner_account_id,
    a.name        AS partner_name,
    a.short_id    AS partner_short_id,
    aps.stage_otk,
    aps.stage_packaging,
    aps.stage_marking,
    aps.stage_packing,
    aps.stage_logistics,
    aps.created_at
  FROM public.account_pipeline_stages aps
  LEFT JOIN public.accounts a ON a.id = aps.partner_account_id
  WHERE aps.account_id = p_account_id
    AND EXISTS (
      SELECT 1 FROM public.account_members am
      WHERE am.account_id = p_account_id AND am.user_id = auth.uid()
    )
  ORDER BY aps.order_index
$$;

-- ── 7. RPC: инициализировать пайплайн партии ────────────────
CREATE OR REPLACE FUNCTION public.init_batch_pipeline(
  p_batch_id   UUID,
  p_account_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_stage  RECORD;
  v_count  INTEGER := 0;
BEGIN
  -- Проверка членства
  IF NOT EXISTS (
    SELECT 1 FROM public.account_members
    WHERE account_id = p_account_id AND user_id = auth.uid()
  ) THEN
    RETURN jsonb_build_object('error', 'Нет доступа');
  END IF;

  -- Проверка принадлежности партии
  IF NOT EXISTS (
    SELECT 1 FROM public.fulfillment_batches
    WHERE id = p_batch_id AND account_id = p_account_id
  ) THEN
    RETURN jsonb_build_object('error', 'Партия не найдена');
  END IF;

  -- Удалить существующий пайплайн
  DELETE FROM public.batch_pipeline_stages WHERE batch_id = p_batch_id;

  -- Копируем конфигурацию как snapshot
  FOR v_stage IN
    SELECT * FROM public.account_pipeline_stages
    WHERE account_id = p_account_id
    ORDER BY order_index
  LOOP
    INSERT INTO public.batch_pipeline_stages (
      batch_id, owner_account_id, partner_account_id,
      order_index, name, current_stage, status,
      stage_otk, stage_packaging, stage_marking, stage_packing, stage_logistics
    ) VALUES (
      p_batch_id, p_account_id, v_stage.partner_account_id,
      v_stage.order_index, v_stage.name, 'reception', 'pending',
      v_stage.stage_otk, v_stage.stage_packaging, v_stage.stage_marking,
      v_stage.stage_packing, v_stage.stage_logistics
    );
    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 THEN
    RETURN jsonb_build_object('error', 'Пайплайн не настроен');
  END IF;

  -- Активируем первую стадию
  UPDATE public.batch_pipeline_stages
  SET status = 'active', activated_at = now()
  WHERE batch_id = p_batch_id AND order_index = 0;

  RETURN jsonb_build_object('ok', true, 'stages_count', v_count);
END;
$$;

-- ── 8. RPC: завершить стадию → активировать следующую ───────
CREATE OR REPLACE FUNCTION public.complete_batch_pipeline_stage(
  p_stage_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_stage public.batch_pipeline_stages%ROWTYPE;
  v_next  public.batch_pipeline_stages%ROWTYPE;
BEGIN
  SELECT * INTO v_stage FROM public.batch_pipeline_stages WHERE id = p_stage_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Стадия не найдена');
  END IF;

  -- Проверка доступа: владелец ИЛИ партнёр этой стадии
  IF NOT EXISTS (
    SELECT 1 FROM public.account_members am
    WHERE am.user_id = auth.uid()
      AND (
        am.account_id = v_stage.owner_account_id
        OR (v_stage.partner_account_id IS NOT NULL AND am.account_id = v_stage.partner_account_id)
      )
  ) THEN
    RETURN jsonb_build_object('error', 'Нет доступа');
  END IF;

  -- Завершаем стадию
  UPDATE public.batch_pipeline_stages
  SET status = 'done', completed_at = now(), updated_at = now()
  WHERE id = p_stage_id;

  -- Находим следующую pending-стадию
  SELECT * INTO v_next
  FROM public.batch_pipeline_stages
  WHERE batch_id = v_stage.batch_id
    AND order_index > v_stage.order_index
    AND status = 'pending'
  ORDER BY order_index
  LIMIT 1;

  IF FOUND THEN
    UPDATE public.batch_pipeline_stages
    SET status = 'active', activated_at = now(), updated_at = now()
    WHERE id = v_next.id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'next_stage_id', v_next.id);
END;
$$;

-- ── 9. RPC: получить партнёрские партии ─────────────────────
-- Возвращает партии где данный аккаунт является partner в pipeline
CREATE OR REPLACE FUNCTION public.get_partner_batches(p_account_id UUID)
RETURNS TABLE (
  batch_id            UUID,
  my_stage_id         UUID,
  my_stage_order      INTEGER,
  my_stage_name       TEXT,
  my_stage_status     TEXT,
  my_current_stage    TEXT,
  my_stage_otk        BOOLEAN,
  my_stage_packaging  BOOLEAN,
  my_stage_marking    BOOLEAN,
  my_stage_packing    BOOLEAN,
  my_stage_logistics  BOOLEAN,
  batch_name          TEXT,
  batch_short_id      INTEGER,
  batch_status        TEXT,
  batch_created_at    TIMESTAMPTZ,
  owner_account_id    UUID,
  owner_name          TEXT,
  owner_short_id      INTEGER
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    fb.id                     AS batch_id,
    bps.id                    AS my_stage_id,
    bps.order_index           AS my_stage_order,
    bps.name                  AS my_stage_name,
    bps.status                AS my_stage_status,
    bps.current_stage         AS my_current_stage,
    bps.stage_otk,
    bps.stage_packaging,
    bps.stage_marking,
    bps.stage_packing,
    bps.stage_logistics,
    fb.name                   AS batch_name,
    fb.short_id               AS batch_short_id,
    fb.status::TEXT           AS batch_status,
    fb.created_at             AS batch_created_at,
    fb.account_id             AS owner_account_id,
    a.name                    AS owner_name,
    a.short_id                AS owner_short_id
  FROM public.batch_pipeline_stages bps
  JOIN public.fulfillment_batches fb ON fb.id = bps.batch_id
  JOIN public.accounts a ON a.id = fb.account_id
  WHERE bps.partner_account_id = p_account_id
    AND EXISTS (
      SELECT 1 FROM public.account_members am
      WHERE am.account_id = p_account_id AND am.user_id = auth.uid()
    )
    AND fb.deleted_at IS NULL
  ORDER BY fb.created_at DESC
$$;
