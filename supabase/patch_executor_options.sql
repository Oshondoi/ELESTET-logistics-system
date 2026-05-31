-- ─────────────────────────────────────────────────────────────────────────────
-- patch_executor_options.sql
-- 1. Обновить get_my_partners: фильтровать архивные аккаунты
-- 2. Новый RPC get_executor_options: свои активные аккаунты + принятые партнёры
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Исправить get_my_partners: скрыть архивные ────────────────────────────

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
    op.id                                                                          AS connection_id,
    CASE WHEN op.requester_id = p_account_id THEN op.partner_id ELSE op.requester_id END AS partner_id,
    a.name                                                                         AS partner_name,
    a.short_id                                                                     AS partner_short_id,
    op.status,
    (op.requester_id = p_account_id)                                               AS is_requester,
    op.created_at
  FROM public.outsource_partners op
  JOIN public.accounts a
    ON a.id = CASE WHEN op.requester_id = p_account_id THEN op.partner_id ELSE op.requester_id END
  WHERE (op.requester_id = p_account_id OR op.partner_id = p_account_id)
    AND a.deleted_at IS NULL
    AND p_account_id IN (
      SELECT account_id FROM public.account_members WHERE user_id = auth.uid()
    )
  ORDER BY op.status, a.name;
$$;

-- ── 2. Новый RPC: варианты исполнителя для пайплайна ─────────────────────────
-- Возвращает:
--   • Свои активные аккаунты (все аккаунты юзера, кроме текущего p_account_id)
--   • Принятые аутсорс-партнёры (не архивные, не являющиеся собственными аккаунтами)
-- Текущий аккаунт (p_account_id) НЕ включается — он представлен пустой опцией в UI.

CREATE OR REPLACE FUNCTION public.get_executor_options(p_account_id UUID)
RETURNS TABLE(
  account_id       UUID,
  account_name     TEXT,
  account_short_id INTEGER,
  option_type      TEXT   -- 'own' | 'partner'
)
LANGUAGE sql SECURITY DEFINER AS $$
  -- Проверка: текущий пользователь должен быть членом p_account_id
  WITH current_user_id AS (
    SELECT user_id FROM public.account_members
    WHERE account_id = p_account_id AND user_id = auth.uid()
    LIMIT 1
  )

  -- 1. Свои активные аккаунты (кроме текущего)
  SELECT
    a.id          AS account_id,
    a.name        AS account_name,
    a.short_id    AS account_short_id,
    'own'::TEXT   AS option_type
  FROM public.accounts a
  JOIN public.account_members am ON am.account_id = a.id
  JOIN current_user_id cui ON am.user_id = cui.user_id
  WHERE a.id != p_account_id
    AND a.deleted_at IS NULL

  UNION ALL

  -- 2. Принятые аутсорс-партнёры (не архивные, не собственные аккаунты)
  SELECT
    pa.id           AS account_id,
    pa.name         AS account_name,
    pa.short_id     AS account_short_id,
    'partner'::TEXT AS option_type
  FROM public.outsource_partners op
  JOIN public.accounts pa
    ON pa.id = CASE WHEN op.requester_id = p_account_id THEN op.partner_id ELSE op.requester_id END
  JOIN current_user_id cui ON TRUE
  WHERE (op.requester_id = p_account_id OR op.partner_id = p_account_id)
    AND op.status = 'accepted'
    AND pa.deleted_at IS NULL
    -- Исключить если партнёр — собственный аккаунт пользователя
    AND pa.id NOT IN (
      SELECT account_id FROM public.account_members WHERE user_id = (SELECT user_id FROM current_user_id)
    )

  ORDER BY option_type, account_name;
$$;

GRANT EXECUTE ON FUNCTION public.get_executor_options(UUID) TO authenticated;
