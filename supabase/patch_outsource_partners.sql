-- =====================================================
-- patch_outsource_partners.sql
-- B2B контакты: список подключённых аутсорс-компаний
-- =====================================================

-- ── 1. Таблица ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.outsource_partners (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  requester_id    UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  partner_id      UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT outsource_partners_unique UNIQUE (requester_id, partner_id),
  CONSTRAINT outsource_partners_no_self CHECK (requester_id <> partner_id)
);

CREATE INDEX IF NOT EXISTS idx_op_requester ON public.outsource_partners(requester_id);
CREATE INDEX IF NOT EXISTS idx_op_partner   ON public.outsource_partners(partner_id);

ALTER TABLE public.outsource_partners ENABLE ROW LEVEL SECURITY;

-- ── 2. RLS ────────────────────────────────────────────────────

DROP POLICY IF EXISTS "op_select"  ON public.outsource_partners;
DROP POLICY IF EXISTS "op_insert"  ON public.outsource_partners;
DROP POLICY IF EXISTS "op_update"  ON public.outsource_partners;
DROP POLICY IF EXISTS "op_delete"  ON public.outsource_partners;

-- Видят оба участника
CREATE POLICY "op_select" ON public.outsource_partners
  FOR SELECT USING (
    requester_id IN (SELECT account_id FROM public.account_members WHERE user_id = auth.uid())
    OR
    partner_id   IN (SELECT account_id FROM public.account_members WHERE user_id = auth.uid())
  );

-- Создаёт только инициатор
CREATE POLICY "op_insert" ON public.outsource_partners
  FOR INSERT WITH CHECK (
    requester_id IN (SELECT account_id FROM public.account_members WHERE user_id = auth.uid())
  );

-- Обновляет любой из участников
CREATE POLICY "op_update" ON public.outsource_partners
  FOR UPDATE USING (
    requester_id IN (SELECT account_id FROM public.account_members WHERE user_id = auth.uid())
    OR
    partner_id   IN (SELECT account_id FROM public.account_members WHERE user_id = auth.uid())
  );

-- Удаляет любой из участников
CREATE POLICY "op_delete" ON public.outsource_partners
  FOR DELETE USING (
    requester_id IN (SELECT account_id FROM public.account_members WHERE user_id = auth.uid())
    OR
    partner_id   IN (SELECT account_id FROM public.account_members WHERE user_id = auth.uid())
  );

-- ── 3. RPC: отправить запрос на подключение ──────────────────

CREATE OR REPLACE FUNCTION public.send_partner_request(
  p_my_account_id UUID,
  p_partner_short_id INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_partner_id  UUID;
  v_exists      RECORD;
BEGIN
  -- Проверяем членство
  IF NOT EXISTS (
    SELECT 1 FROM public.account_members
    WHERE user_id = auth.uid() AND account_id = p_my_account_id
  ) THEN
    RETURN jsonb_build_object('error', 'Нет доступа к компании');
  END IF;

  -- Находим партнёра
  SELECT id INTO v_partner_id
  FROM public.accounts WHERE short_id = p_partner_short_id;

  IF v_partner_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Компания C-' || p_partner_short_id || ' не найдена');
  END IF;

  IF v_partner_id = p_my_account_id THEN
    RETURN jsonb_build_object('error', 'Нельзя добавить свою компанию');
  END IF;

  -- Проверяем существующую связь (в обе стороны)
  SELECT id, status INTO v_exists
  FROM public.outsource_partners
  WHERE (requester_id = p_my_account_id AND partner_id = v_partner_id)
     OR (requester_id = v_partner_id    AND partner_id = p_my_account_id);

  IF v_exists.id IS NOT NULL THEN
    IF v_exists.status = 'accepted' THEN
      RETURN jsonb_build_object('error', 'Компания уже в списке партнёров');
    ELSIF v_exists.status = 'pending' THEN
      RETURN jsonb_build_object('error', 'Запрос уже отправлен, ожидайте ответа');
    ELSIF v_exists.status = 'declined' THEN
      -- Разрешаем повторную отправку — обновляем статус
      UPDATE public.outsource_partners
      SET status = 'pending', updated_at = now(),
          requester_id = p_my_account_id, partner_id = v_partner_id
      WHERE id = v_exists.id;
      RETURN jsonb_build_object('ok', true, 'partner_id', v_partner_id);
    END IF;
  END IF;

  -- Создаём запрос
  INSERT INTO public.outsource_partners (requester_id, partner_id)
  VALUES (p_my_account_id, v_partner_id);

  -- Уведомление партнёру
  INSERT INTO public.batch_notifications (account_id, type, title, body)
  SELECT am.account_id,
         'partner_request',
         'Запрос на партнёрство',
         (SELECT name FROM public.accounts WHERE id = p_my_account_id) || ' хочет добавить вас как аутсорс-партнёра'
  FROM public.account_members am
  WHERE am.account_id = v_partner_id
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'partner_id', v_partner_id);
END;
$$;

-- ── 4. RPC: ответить на запрос ────────────────────────────────

CREATE OR REPLACE FUNCTION public.respond_to_partner_request(
  p_connection_id UUID,
  p_accept        BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_conn public.outsource_partners%ROWTYPE;
BEGIN
  SELECT * INTO v_conn FROM public.outsource_partners WHERE id = p_connection_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Запрос не найден');
  END IF;

  -- Только получатель (partner) может ответить
  IF NOT EXISTS (
    SELECT 1 FROM public.account_members
    WHERE user_id = auth.uid() AND account_id = v_conn.partner_id
  ) THEN
    RETURN jsonb_build_object('error', 'Нет доступа');
  END IF;

  IF v_conn.status <> 'pending' THEN
    RETURN jsonb_build_object('error', 'Запрос уже обработан');
  END IF;

  UPDATE public.outsource_partners
  SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,
      updated_at = now()
  WHERE id = p_connection_id;

  -- Уведомление инициатору
  INSERT INTO public.batch_notifications (account_id, type, title, body)
  SELECT am.account_id,
         'partner_response',
         CASE WHEN p_accept THEN 'Запрос принят' ELSE 'Запрос отклонён' END,
         (SELECT name FROM public.accounts WHERE id = v_conn.partner_id)
           || CASE WHEN p_accept THEN ' принял ваш запрос на партнёрство' ELSE ' отклонил ваш запрос на партнёрство' END
  FROM public.account_members am
  WHERE am.account_id = v_conn.requester_id
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'accepted', p_accept);
END;
$$;

-- ── 5. RPC: мои партнёры ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_my_partners(p_account_id UUID)
RETURNS TABLE(
  connection_id    UUID,
  partner_id       UUID,
  partner_name     TEXT,
  partner_short_id INTEGER,
  status           TEXT,
  is_requester     BOOLEAN,
  created_at       TIMESTAMPTZ
)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT
    op.id                                                                         AS connection_id,
    CASE WHEN op.requester_id = p_account_id THEN op.partner_id ELSE op.requester_id END AS partner_id,
    a.name                                                                        AS partner_name,
    a.short_id                                                                    AS partner_short_id,
    op.status,
    (op.requester_id = p_account_id)                                              AS is_requester,
    op.created_at
  FROM public.outsource_partners op
  JOIN public.accounts a
    ON a.id = CASE WHEN op.requester_id = p_account_id THEN op.partner_id ELSE op.requester_id END
  WHERE (op.requester_id = p_account_id OR op.partner_id = p_account_id)
    AND p_account_id IN (
      SELECT account_id FROM public.account_members WHERE user_id = auth.uid()
    )
  ORDER BY op.status, a.name;
$$;

-- ── 6. RPC: удалить партнёра ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.remove_partner(p_connection_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_conn public.outsource_partners%ROWTYPE;
BEGIN
  SELECT * INTO v_conn FROM public.outsource_partners WHERE id = p_connection_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Не найдено'); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.account_members
    WHERE user_id = auth.uid()
      AND account_id IN (v_conn.requester_id, v_conn.partner_id)
  ) THEN
    RETURN jsonb_build_object('error', 'Нет доступа');
  END IF;

  DELETE FROM public.outsource_partners WHERE id = p_connection_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ── 7. Обновить тип уведомлений ──────────────────────────────
-- Добавляем новые типы уведомлений для партнёрских запросов
-- (поле type уже TEXT, ограничений нет — ничего менять не нужно)
