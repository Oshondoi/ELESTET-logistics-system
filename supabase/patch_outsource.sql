-- ============================================================
-- patch_outsource.sql
-- Система аутсорс-этапов для партий фулфилмента
-- Партия = иммутабельный журнал событий между компаниями
-- ============================================================

-- ── 0. Системная компания C-0 (для «осиротевших» партий) ─────
-- short_id=0 зарезервирован для системы. Реальный UUID фиксированный.
INSERT INTO public.accounts (id, name, short_id)
VALUES ('00000000-0000-0000-0000-000000000000', 'Системная компания', 0)
ON CONFLICT (id) DO NOTHING;

-- Убедимся что short_id=0 не займёт сиквенс
-- (сиквенс стартует с 1, C-0 вставлен вручную)

-- ── 1. Аутсорс-этапы партии ──────────────────────────────────
-- Каждый этап = задача для конкретной внешней компании
CREATE TABLE IF NOT EXISTS public.batch_outsource_stages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id        UUID NOT NULL REFERENCES public.fulfillment_batches(id) ON DELETE CASCADE,
  owner_account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  -- порядок выполнения (0 = первый)
  sort_order      INTEGER NOT NULL DEFAULT 0,
  name            TEXT NOT NULL,          -- название этапа (задаёт владелец)
  description     TEXT,                   -- описание/инструкция
  -- назначенная аутсорс-компания
  assigned_company_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  -- статус этапа
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','accepted','in_progress','done','disputed','cancelled')),
  -- данные о количестве (для сверки)
  qty_declared    INTEGER,   -- заявлено передающей стороной
  qty_received    INTEGER,   -- принято этим этапом
  -- расхождение фиксируется автоматически если qty_declared != qty_received
  has_discrepancy BOOLEAN NOT NULL DEFAULT false,
  discrepancy_notes TEXT,
  -- временные метки
  accepted_at     TIMESTAMPTZ,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_batch_outsource_stages_batch ON public.batch_outsource_stages(batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_outsource_stages_company ON public.batch_outsource_stages(assigned_company_id);

ALTER TABLE public.batch_outsource_stages ENABLE ROW LEVEL SECURITY;

-- ── 2. Приглашения компаний на этапы ────────────────────────
CREATE TABLE IF NOT EXISTS public.batch_stage_invites (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id            UUID NOT NULL REFERENCES public.fulfillment_batches(id) ON DELETE CASCADE,
  stage_id            UUID NOT NULL REFERENCES public.batch_outsource_stages(id) ON DELETE CASCADE,
  inviting_company_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  invited_company_id  UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','accepted','declined')),
  message             TEXT,   -- необязательный текст от владельца
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at        TIMESTAMPTZ,
  UNIQUE (stage_id, invited_company_id)
);

CREATE INDEX IF NOT EXISTS idx_batch_invites_batch ON public.batch_stage_invites(batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_invites_invited ON public.batch_stage_invites(invited_company_id);
CREATE INDEX IF NOT EXISTS idx_batch_invites_stage ON public.batch_stage_invites(stage_id);

ALTER TABLE public.batch_stage_invites ENABLE ROW LEVEL SECURITY;

-- ── 3. Иммутабельный журнал событий партии ───────────────────
-- ПРАВИЛО: только INSERT. Никакого UPDATE или DELETE.
CREATE TABLE IF NOT EXISTS public.batch_journal (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id        UUID NOT NULL REFERENCES public.fulfillment_batches(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,
  -- типы: stage_created | stage_assigned | invite_sent | invite_accepted | invite_declined
  --       stage_started | stage_completed | stage_disputed | stage_replaced
  --       qty_declared | qty_received | discrepancy_flagged | discrepancy_resolved
  --       batch_archived | company_removed | owner_transferred
  company_id      UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  payload         JSONB NOT NULL DEFAULT '{}',
  -- timezone-aware метка
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_batch_journal_batch ON public.batch_journal(batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_journal_company ON public.batch_journal(company_id);

ALTER TABLE public.batch_journal ENABLE ROW LEVEL SECURITY;

-- ── 4. Голоса за архивирование партии ───────────────────────
-- Партия архивируется когда все участники проголосовали
CREATE TABLE IF NOT EXISTS public.batch_archive_votes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id    UUID NOT NULL REFERENCES public.fulfillment_batches(id) ON DELETE CASCADE,
  company_id  UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  voted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (batch_id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_batch_archive_votes_batch ON public.batch_archive_votes(batch_id);

ALTER TABLE public.batch_archive_votes ENABLE ROW LEVEL SECURITY;

-- ── 5. Внутренние уведомления ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.batch_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  batch_id    UUID REFERENCES public.fulfillment_batches(id) ON DELETE CASCADE,
  stage_id    UUID REFERENCES public.batch_outsource_stages(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  -- invite_received | stage_ready | discrepancy | batch_completed
  title       TEXT NOT NULL,
  body        TEXT,
  is_read     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_batch_notifications_account ON public.batch_notifications(account_id, is_read);

ALTER TABLE public.batch_notifications ENABLE ROW LEVEL SECURITY;

-- ── 6. RLS — helper: проверка доступа к партии ──────────────
-- Возвращает TRUE если текущий пользователь является членом компании
-- которая имеет доступ к данной партии (owner или назначенный аутсорс)
CREATE OR REPLACE FUNCTION public.user_has_batch_access(p_batch_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    -- Владелец партии (через account_members)
    SELECT 1
    FROM public.fulfillment_batches fb
    JOIN public.account_members am ON am.account_id = fb.account_id
    WHERE fb.id = p_batch_id
      AND am.user_id = auth.uid()
    UNION ALL
    -- Аутсорс-компания с принятым приглашением
    SELECT 1
    FROM public.batch_outsource_stages bos
    JOIN public.account_members am ON am.account_id = bos.assigned_company_id
    WHERE bos.batch_id = p_batch_id
      AND bos.assigned_company_id IS NOT NULL
      AND am.user_id = auth.uid()
  )
$$;

-- ── 7. RLS — helper: текущий пользователь = владелец партии ─
CREATE OR REPLACE FUNCTION public.user_is_batch_owner(p_batch_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.fulfillment_batches fb
    JOIN public.account_members am ON am.account_id = fb.account_id
    WHERE fb.id = p_batch_id
      AND am.user_id = auth.uid()
  )
$$;

-- ── 8. RLS политики — batch_outsource_stages ───────────────
-- Просмотр: все кто имеет доступ к партии
CREATE POLICY "bos_select" ON public.batch_outsource_stages
  FOR SELECT USING (public.user_has_batch_access(batch_id));

-- Вставка: только владелец партии
CREATE POLICY "bos_insert" ON public.batch_outsource_stages
  FOR INSERT WITH CHECK (public.user_is_batch_owner(batch_id));

-- Обновление: 
--   • владелец может обновить всё (кроме завершённых этапов)
--   • назначенная компания может обновить статус/qty своего этапа
CREATE POLICY "bos_update_owner" ON public.batch_outsource_stages
  FOR UPDATE USING (public.user_is_batch_owner(batch_id));

CREATE POLICY "bos_update_assignee" ON public.batch_outsource_stages
  FOR UPDATE USING (
    assigned_company_id IN (
      SELECT account_id FROM public.account_members WHERE user_id = auth.uid()
    )
  );

-- Удаление: только владелец, только если статус pending (никто ещё не взялся)
CREATE POLICY "bos_delete" ON public.batch_outsource_stages
  FOR DELETE USING (
    public.user_is_batch_owner(batch_id)
    AND status = 'pending'
  );

-- ── 9. RLS политики — batch_stage_invites ──────────────────
CREATE POLICY "bsi_select" ON public.batch_stage_invites
  FOR SELECT USING (
    -- приглашающая компания
    inviting_company_id IN (
      SELECT account_id FROM public.account_members WHERE user_id = auth.uid()
    )
    OR
    -- приглашённая компания
    invited_company_id IN (
      SELECT account_id FROM public.account_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "bsi_insert" ON public.batch_stage_invites
  FOR INSERT WITH CHECK (
    inviting_company_id IN (
      SELECT account_id FROM public.account_members WHERE user_id = auth.uid()
    )
  );

-- Обновление статуса (принять/отклонить) — только приглашённая компания
CREATE POLICY "bsi_update" ON public.batch_stage_invites
  FOR UPDATE USING (
    invited_company_id IN (
      SELECT account_id FROM public.account_members WHERE user_id = auth.uid()
    )
  );

-- ── 10. RLS политики — batch_journal ───────────────────────
-- Только чтение для участников. INSERT через функцию (SECURITY DEFINER).
CREATE POLICY "bj_select" ON public.batch_journal
  FOR SELECT USING (public.user_has_batch_access(batch_id));

-- INSERT напрямую для участников (запись своих событий)
CREATE POLICY "bj_insert" ON public.batch_journal
  FOR INSERT WITH CHECK (public.user_has_batch_access(batch_id));

-- Никакого UPDATE или DELETE — иммутабельный журнал

-- ── 11. RLS политики — batch_archive_votes ─────────────────
CREATE POLICY "bav_select" ON public.batch_archive_votes
  FOR SELECT USING (public.user_has_batch_access(batch_id));

CREATE POLICY "bav_insert" ON public.batch_archive_votes
  FOR INSERT WITH CHECK (
    company_id IN (
      SELECT account_id FROM public.account_members WHERE user_id = auth.uid()
    )
    AND public.user_has_batch_access(batch_id)
  );

-- ── 12. RLS политики — batch_notifications ─────────────────
CREATE POLICY "bn_select" ON public.batch_notifications
  FOR SELECT USING (
    account_id IN (
      SELECT account_id FROM public.account_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "bn_update" ON public.batch_notifications
  FOR UPDATE USING (
    account_id IN (
      SELECT account_id FROM public.account_members WHERE user_id = auth.uid()
    )
  );

-- ── 13. RPC: найти компанию по short_id (для invite flow) ───
CREATE OR REPLACE FUNCTION public.find_account_by_short_id(p_short_id INTEGER)
RETURNS TABLE (id UUID, name TEXT, short_id INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT a.id, a.name, a.short_id
  FROM public.accounts a
  WHERE a.short_id = p_short_id
    AND a.deleted_at IS NULL
    AND a.short_id > 0  -- исключаем системную компанию C-0
  LIMIT 1
$$;

-- ── 14. RPC: создать приглашение + записать в журнал ────────
CREATE OR REPLACE FUNCTION public.invite_company_to_stage(
  p_stage_id       UUID,
  p_company_short_id INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_stage          public.batch_outsource_stages%ROWTYPE;
  v_invited_company public.accounts%ROWTYPE;
  v_my_company_id  UUID;
  v_invite_id      UUID;
BEGIN
  -- Получаем этап
  SELECT * INTO v_stage FROM public.batch_outsource_stages WHERE id = p_stage_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Этап не найден');
  END IF;

  -- Проверяем что текущий пользователь — владелец партии
  SELECT account_id INTO v_my_company_id
  FROM public.account_members
  WHERE user_id = auth.uid()
    AND account_id = v_stage.owner_account_id
  LIMIT 1;
  IF v_my_company_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Только владелец партии может отправлять приглашения');
  END IF;

  -- Находим приглашаемую компанию
  SELECT * INTO v_invited_company
  FROM public.accounts
  WHERE short_id = p_company_short_id
    AND deleted_at IS NULL
    AND short_id > 0;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Компания C-' || p_company_short_id || ' не найдена');
  END IF;

  -- Нельзя пригласить саму себя
  IF v_invited_company.id = v_my_company_id THEN
    RETURN jsonb_build_object('error', 'Нельзя пригласить свою компанию');
  END IF;

  -- Вставляем приглашение (или обновляем если уже было declined)
  INSERT INTO public.batch_stage_invites (
    batch_id, stage_id, inviting_company_id, invited_company_id, status
  ) VALUES (
    v_stage.batch_id, p_stage_id, v_my_company_id, v_invited_company.id, 'pending'
  )
  ON CONFLICT (stage_id, invited_company_id)
  DO UPDATE SET status = 'pending', created_at = now(), responded_at = NULL
  RETURNING id INTO v_invite_id;

  -- Обновляем этап — назначаем компанию
  UPDATE public.batch_outsource_stages
  SET assigned_company_id = v_invited_company.id, updated_at = now()
  WHERE id = p_stage_id;

  -- Журнальная запись
  INSERT INTO public.batch_journal (batch_id, event_type, company_id, user_id, payload)
  VALUES (
    v_stage.batch_id, 'invite_sent', v_my_company_id, auth.uid(),
    jsonb_build_object(
      'stage_id', p_stage_id,
      'invite_id', v_invite_id,
      'invited_company_id', v_invited_company.id,
      'invited_company_name', v_invited_company.name,
      'invited_company_short_id', v_invited_company.short_id
    )
  );

  -- Уведомление приглашённой компании
  INSERT INTO public.batch_notifications (account_id, batch_id, stage_id, type, title, body)
  VALUES (
    v_invited_company.id,
    v_stage.batch_id,
    p_stage_id,
    'invite_received',
    'Новое приглашение к партии',
    'Компания C-' || (SELECT short_id FROM public.accounts WHERE id = v_my_company_id) ||
    ' приглашает вас на этап «' || v_stage.name || '»'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'invite_id', v_invite_id,
    'invited_company', jsonb_build_object(
      'id', v_invited_company.id,
      'name', v_invited_company.name,
      'short_id', v_invited_company.short_id
    )
  );
END;
$$;

-- ── 15. RPC: принять/отклонить приглашение ──────────────────
CREATE OR REPLACE FUNCTION public.respond_to_invite(
  p_invite_id UUID,
  p_accept    BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_invite  public.batch_stage_invites%ROWTYPE;
  v_my_company_id UUID;
  v_event_type TEXT;
BEGIN
  SELECT * INTO v_invite FROM public.batch_stage_invites WHERE id = p_invite_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Приглашение не найдено');
  END IF;

  -- Проверяем что текущий пользователь — член приглашённой компании
  SELECT account_id INTO v_my_company_id
  FROM public.account_members
  WHERE user_id = auth.uid()
    AND account_id = v_invite.invited_company_id
  LIMIT 1;
  IF v_my_company_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Нет доступа к этому приглашению');
  END IF;

  IF v_invite.status != 'pending' THEN
    RETURN jsonb_build_object('error', 'Приглашение уже обработано');
  END IF;

  -- Обновляем статус приглашения
  UPDATE public.batch_stage_invites
  SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,
      responded_at = now()
  WHERE id = p_invite_id;

  -- Обновляем статус этапа
  IF p_accept THEN
    UPDATE public.batch_outsource_stages
    SET status = 'accepted', accepted_at = now(), updated_at = now()
    WHERE id = v_invite.stage_id;

    v_event_type := 'invite_accepted';

    -- Уведомляем владельца
    INSERT INTO public.batch_notifications (account_id, batch_id, stage_id, type, title, body)
    VALUES (
      v_invite.inviting_company_id,
      v_invite.batch_id,
      v_invite.stage_id,
      'invite_accepted',
      'Приглашение принято',
      'Компания C-' || (SELECT short_id FROM public.accounts WHERE id = v_my_company_id) ||
      ' приняла приглашение'
    );
  ELSE
    -- При отклонении снимаем назначение
    UPDATE public.batch_outsource_stages
    SET assigned_company_id = NULL, status = 'pending', updated_at = now()
    WHERE id = v_invite.stage_id;

    v_event_type := 'invite_declined';
  END IF;

  -- Журнал
  INSERT INTO public.batch_journal (batch_id, event_type, company_id, user_id, payload)
  VALUES (
    v_invite.batch_id, v_event_type, v_my_company_id, auth.uid(),
    jsonb_build_object('invite_id', p_invite_id, 'stage_id', v_invite.stage_id)
  );

  RETURN jsonb_build_object('ok', true, 'accepted', p_accept);
END;
$$;

-- ── 16. RPC: список входящих приглашений для компании ───────
CREATE OR REPLACE FUNCTION public.get_my_incoming_invites()
RETURNS TABLE (
  invite_id           UUID,
  batch_id            UUID,
  batch_name          TEXT,
  batch_short_id      INTEGER,
  stage_id            UUID,
  stage_name          TEXT,
  stage_sort_order    INTEGER,
  inviting_company_id UUID,
  inviting_company_name TEXT,
  inviting_company_short_id INTEGER,
  status              TEXT,
  message             TEXT,
  created_at          TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    bsi.id                          AS invite_id,
    bsi.batch_id,
    fb.name                         AS batch_name,
    fb.short_id                     AS batch_short_id,
    bsi.stage_id,
    bos.name                        AS stage_name,
    bos.sort_order                  AS stage_sort_order,
    bsi.inviting_company_id,
    ac_inv.name                     AS inviting_company_name,
    ac_inv.short_id                 AS inviting_company_short_id,
    bsi.status,
    bsi.message,
    bsi.created_at
  FROM public.batch_stage_invites bsi
  JOIN public.fulfillment_batches fb ON fb.id = bsi.batch_id
  JOIN public.batch_outsource_stages bos ON bos.id = bsi.stage_id
  JOIN public.accounts ac_inv ON ac_inv.id = bsi.inviting_company_id
  WHERE bsi.invited_company_id IN (
    SELECT account_id FROM public.account_members WHERE user_id = auth.uid()
  )
  ORDER BY bsi.created_at DESC
$$;

-- ── 17. RPC: список исходящих приглашений (мои аутсорсы) ────
CREATE OR REPLACE FUNCTION public.get_my_outgoing_invites()
RETURNS TABLE (
  invite_id            UUID,
  batch_id             UUID,
  batch_name           TEXT,
  batch_short_id       INTEGER,
  stage_id             UUID,
  stage_name           TEXT,
  invited_company_id   UUID,
  invited_company_name TEXT,
  invited_company_short_id INTEGER,
  status               TEXT,
  created_at           TIMESTAMPTZ,
  responded_at         TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    bsi.id                          AS invite_id,
    bsi.batch_id,
    fb.name                         AS batch_name,
    fb.short_id                     AS batch_short_id,
    bsi.stage_id,
    bos.name                        AS stage_name,
    bsi.invited_company_id,
    ac_rec.name                     AS invited_company_name,
    ac_rec.short_id                 AS invited_company_short_id,
    bsi.status,
    bsi.created_at,
    bsi.responded_at
  FROM public.batch_stage_invites bsi
  JOIN public.fulfillment_batches fb ON fb.id = bsi.batch_id
  JOIN public.batch_outsource_stages bos ON bos.id = bsi.stage_id
  JOIN public.accounts ac_rec ON ac_rec.id = bsi.invited_company_id
  WHERE bsi.inviting_company_id IN (
    SELECT account_id FROM public.account_members WHERE user_id = auth.uid()
  )
  ORDER BY bsi.created_at DESC
$$;

-- ── 18. RPC: список партий где я выступаю как аутсорс ───────
CREATE OR REPLACE FUNCTION public.get_outsource_batches()
RETURNS TABLE (
  batch_id            UUID,
  batch_name          TEXT,
  batch_short_id      INTEGER,
  batch_status        TEXT,
  owner_company_id    UUID,
  owner_company_name  TEXT,
  owner_company_short_id INTEGER,
  stage_id            UUID,
  stage_name          TEXT,
  stage_status        TEXT,
  stage_sort_order    INTEGER,
  created_at          TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    fb.id                   AS batch_id,
    fb.name                 AS batch_name,
    fb.short_id             AS batch_short_id,
    fb.status               AS batch_status,
    fb.account_id           AS owner_company_id,
    ac_own.name             AS owner_company_name,
    ac_own.short_id         AS owner_company_short_id,
    bos.id                  AS stage_id,
    bos.name                AS stage_name,
    bos.status              AS stage_status,
    bos.sort_order          AS stage_sort_order,
    bos.created_at
  FROM public.batch_outsource_stages bos
  JOIN public.fulfillment_batches fb ON fb.id = bos.batch_id
  JOIN public.accounts ac_own ON ac_own.id = fb.account_id
  WHERE bos.assigned_company_id IN (
    SELECT account_id FROM public.account_members WHERE user_id = auth.uid()
  )
  ORDER BY bos.created_at DESC
$$;

-- ── 19. RPC: получить журнал партии ─────────────────────────
CREATE OR REPLACE FUNCTION public.get_batch_journal(p_batch_id UUID)
RETURNS TABLE (
  id          UUID,
  event_type  TEXT,
  company_id  UUID,
  company_name TEXT,
  company_short_id INTEGER,
  user_id     UUID,
  payload     JSONB,
  created_at  TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    bj.id,
    bj.event_type,
    bj.company_id,
    ac.name     AS company_name,
    ac.short_id AS company_short_id,
    bj.user_id,
    bj.payload,
    bj.created_at
  FROM public.batch_journal bj
  LEFT JOIN public.accounts ac ON ac.id = bj.company_id
  WHERE bj.batch_id = p_batch_id
    AND public.user_has_batch_access(p_batch_id)
  ORDER BY bj.created_at ASC
$$;

-- ── 20. RPC: голос за архивирование партии ──────────────────
CREATE OR REPLACE FUNCTION public.vote_batch_archive(p_batch_id UUID, p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_batch              public.fulfillment_batches%ROWTYPE;
  v_total_companies    INTEGER;
  v_voted_count        INTEGER;
  v_has_active_stages  BOOLEAN;
BEGIN
  SELECT * INTO v_batch FROM public.fulfillment_batches WHERE id = p_batch_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Партия не найдена');
  END IF;

  -- Проверяем членство
  IF NOT EXISTS (
    SELECT 1 FROM public.account_members
    WHERE user_id = auth.uid() AND account_id = p_company_id
  ) THEN
    RETURN jsonb_build_object('error', 'Нет доступа');
  END IF;

  -- Проверяем есть ли активные этапы (статус in_progress)
  SELECT EXISTS (
    SELECT 1 FROM public.batch_outsource_stages
    WHERE batch_id = p_batch_id AND status = 'in_progress'
  ) INTO v_has_active_stages;

  IF v_has_active_stages THEN
    RETURN jsonb_build_object('error', 'Нельзя архивировать: есть этапы в работе');
  END IF;

  -- Записываем голос
  INSERT INTO public.batch_archive_votes (batch_id, company_id)
  VALUES (p_batch_id, p_company_id)
  ON CONFLICT (batch_id, company_id) DO NOTHING;

  -- Журнал
  INSERT INTO public.batch_journal (batch_id, event_type, company_id, user_id, payload)
  VALUES (p_batch_id, 'batch_archived', p_company_id, auth.uid(),
    jsonb_build_object('company_id', p_company_id));

  -- Считаем всех участников (владелец + аутсорс с accepted статусом)
  SELECT COUNT(DISTINCT company_id) INTO v_total_companies
  FROM (
    SELECT fb.account_id AS company_id
    FROM public.fulfillment_batches fb
    WHERE fb.id = p_batch_id
    UNION
    SELECT bos.assigned_company_id AS company_id
    FROM public.batch_outsource_stages bos
    WHERE bos.batch_id = p_batch_id
      AND bos.assigned_company_id IS NOT NULL
      AND bos.status IN ('accepted', 'in_progress', 'done')
  ) all_companies
  WHERE company_id IS NOT NULL;

  SELECT COUNT(*) INTO v_voted_count
  FROM public.batch_archive_votes
  WHERE batch_id = p_batch_id;

  -- Все проголосовали — архивируем
  IF v_voted_count >= v_total_companies AND v_total_companies > 0 THEN
    UPDATE public.fulfillment_batches
    SET deleted_at = now(), status = 'cancelled', updated_at = now()
    WHERE id = p_batch_id;

    RETURN jsonb_build_object('ok', true, 'archived', true);
  END IF;

  RETURN jsonb_build_object('ok', true, 'archived', false,
    'votes', v_voted_count, 'total', v_total_companies);
END;
$$;

-- ── 21. RLS: обновить fulfillment_batches — добавить аутсорс-доступ ─
-- Существующая политика только для owner. Добавляем SELECT для аутсорсов.
-- (Не удаляем существующую политику — добавляем дополнительную)
DROP POLICY IF EXISTS "fulfillment_batches_outsource_select" ON public.fulfillment_batches;
CREATE POLICY "fulfillment_batches_outsource_select" ON public.fulfillment_batches
  FOR SELECT USING (
    -- Оригинальный доступ (owner через account_members) — уже есть в основной политике
    -- Доп. доступ для назначенных аутсорс-компаний
    id IN (
      SELECT bos.batch_id
      FROM public.batch_outsource_stages bos
      JOIN public.account_members am ON am.account_id = bos.assigned_company_id
      WHERE am.user_id = auth.uid()
        AND bos.assigned_company_id IS NOT NULL
    )
  );

-- ── 22. RLS: fulfillment_items — аутсорс-доступ (только qty, без цен) ─
DROP POLICY IF EXISTS "fulfillment_items_outsource_select" ON public.fulfillment_items;
CREATE POLICY "fulfillment_items_outsource_select" ON public.fulfillment_items
  FOR SELECT USING (
    batch_id IN (
      SELECT bos.batch_id
      FROM public.batch_outsource_stages bos
      JOIN public.account_members am ON am.account_id = bos.assigned_company_id
      WHERE am.user_id = auth.uid()
        AND bos.assigned_company_id IS NOT NULL
    )
  );
