-- ==============================================================
-- Архив компаний: мягкое удаление + автоочистка через 15 дней
-- ==============================================================
-- Применить в Supabase SQL Editor.
-- Требует pg_cron (Database → Extensions → pg_cron).

-- 1. Добавить колонку deleted_at
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;

-- 2. Обновить get_my_accounts — исключать заархивированные компании
CREATE OR REPLACE FUNCTION public.get_my_accounts()
RETURNS TABLE(
  id         uuid,
  name       text,
  created_at timestamptz,
  my_role    text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.name, a.created_at, am.role AS my_role
  FROM   public.accounts a
  JOIN   public.account_members am
         ON am.account_id = a.id AND am.user_id = auth.uid()
  WHERE  a.deleted_at IS NULL
  ORDER BY a.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_accounts() TO authenticated;

-- 3. Обновить RLS-политику accounts — скрывать заархивированные
DROP POLICY IF EXISTS "members_can_view_accounts" ON public.accounts;
CREATE POLICY "members_can_view_accounts"
ON public.accounts
FOR SELECT
USING (
  deleted_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.account_members am
    WHERE am.account_id = accounts.id
      AND am.user_id = auth.uid()
  )
);

-- 4. Изменить delete_account_with_owner → мягкое удаление (soft delete)
--    Пароль проверяется на фронтенде через supabase.auth.signInWithPassword.
--    Функция просто устанавливает deleted_at = NOW().
CREATE OR REPLACE FUNCTION public.delete_account_with_owner(p_account_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.account_members am
    WHERE am.account_id = p_account_id
      AND am.user_id = auth.uid()
      AND am.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Only owner can delete company';
  END IF;

  UPDATE public.accounts
  SET deleted_at = NOW()
  WHERE id = p_account_id
    AND deleted_at IS NULL;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_account_with_owner(uuid) TO authenticated;

-- 5. Функция жёсткого удаления (вызывается pg_cron раз в сутки)
CREATE OR REPLACE FUNCTION public.hard_delete_expired_accounts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Строки рейсов
  DELETE FROM public.trip_lines tl
  USING public.accounts a
  WHERE tl.account_id = a.id
    AND a.deleted_at IS NOT NULL
    AND a.deleted_at < NOW() - INTERVAL '15 days';

  -- Рейсы
  DELETE FROM public.trips t
  USING public.accounts a
  WHERE t.account_id = a.id
    AND a.deleted_at IS NOT NULL
    AND a.deleted_at < NOW() - INTERVAL '15 days';

  -- Перевозчики
  DELETE FROM public.carriers c
  USING public.accounts a
  WHERE c.account_id = a.id
    AND a.deleted_at IS NOT NULL
    AND a.deleted_at < NOW() - INTERVAL '15 days';

  -- Склады назначения
  DELETE FROM public.warehouses w
  USING public.accounts a
  WHERE w.account_id = a.id
    AND a.deleted_at IS NOT NULL
    AND a.deleted_at < NOW() - INTERVAL '15 days';

  -- Отзывы WB
  DELETE FROM public.wb_feedbacks wf
  USING public.accounts a
  WHERE wf.account_id = a.id
    AND a.deleted_at IS NOT NULL
    AND a.deleted_at < NOW() - INTERVAL '15 days';

  -- ИИ-промпты
  DELETE FROM public.ai_prompts ap
  USING public.accounts a
  WHERE ap.account_id = a.id
    AND a.deleted_at IS NOT NULL
    AND a.deleted_at < NOW() - INTERVAL '15 days';

  -- ИИ-настройки аккаунта
  DELETE FROM public.account_ai_settings aas
  USING public.accounts a
  WHERE aas.account_id = a.id
    AND a.deleted_at IS NOT NULL
    AND a.deleted_at < NOW() - INTERVAL '15 days';

  -- Шаблоны ответов
  DELETE FROM public.review_templates rt
  USING public.accounts a
  WHERE rt.account_id = a.id
    AND a.deleted_at IS NOT NULL
    AND a.deleted_at < NOW() - INTERVAL '15 days';

  -- Роли
  DELETE FROM public.roles r
  USING public.accounts a
  WHERE r.account_id = a.id
    AND a.deleted_at IS NOT NULL
    AND a.deleted_at < NOW() - INTERVAL '15 days';

  -- Стикеры и наборы
  DELETE FROM public.sticker_bundle_items sbi
  USING public.sticker_bundles sb
  JOIN public.accounts a ON a.id = sb.account_id
  WHERE sbi.bundle_id = sb.id
    AND a.deleted_at IS NOT NULL
    AND a.deleted_at < NOW() - INTERVAL '15 days';

  DELETE FROM public.sticker_bundles sb
  USING public.accounts a
  WHERE sb.account_id = a.id
    AND a.deleted_at IS NOT NULL
    AND a.deleted_at < NOW() - INTERVAL '15 days';

  DELETE FROM public.sticker_templates st
  USING public.accounts a
  WHERE st.account_id = a.id
    AND a.deleted_at IS NOT NULL
    AND a.deleted_at < NOW() - INTERVAL '15 days';

  -- Магазины
  DELETE FROM public.stores s
  USING public.accounts a
  WHERE s.account_id = a.id
    AND a.deleted_at IS NOT NULL
    AND a.deleted_at < NOW() - INTERVAL '15 days';

  -- Участники аккаунта
  DELETE FROM public.account_members am
  USING public.accounts a
  WHERE am.account_id = a.id
    AND a.deleted_at IS NOT NULL
    AND a.deleted_at < NOW() - INTERVAL '15 days';

  -- Сам аккаунт
  DELETE FROM public.accounts
  WHERE deleted_at IS NOT NULL
    AND deleted_at < NOW() - INTERVAL '15 days';
END;
$$;

-- 6. Расписание pg_cron (ежедневно в 03:00 UTC)
--    Убедитесь, что расширение pg_cron включено: Database → Extensions → pg_cron
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hard-delete-expired-accounts') THEN
      PERFORM cron.unschedule('hard-delete-expired-accounts');
    END IF;
    PERFORM cron.schedule(
      'hard-delete-expired-accounts',
      '0 3 * * *',
      'SELECT public.hard_delete_expired_accounts()'
    );
  END IF;
END $$;
