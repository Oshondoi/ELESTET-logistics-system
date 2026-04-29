-- ==============================================================
-- Архив магазинов: мягкое удаление + автоочистка через 15 дней
-- ==============================================================
-- Применить в Supabase SQL Editor.
-- Требует pg_cron (Database → Extensions → pg_cron).

-- 1. Добавить колонку deleted_at к stores
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;

-- 2. Обновить RLS-политику stores (SELECT) — скрывать заархивированные
DROP POLICY IF EXISTS "members_can_view_stores" ON public.stores;
CREATE POLICY "members_can_view_stores"
ON public.stores
FOR SELECT
USING (
  deleted_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.account_members am
    WHERE am.account_id = stores.account_id
      AND am.user_id = auth.uid()
  )
);

-- 3. Обновить RLS-политику stores (ALL) — скрывать заархивированные
DROP POLICY IF EXISTS "members_manage_stores" ON public.stores;
CREATE POLICY "members_manage_stores"
ON public.stores
FOR ALL
USING (
  deleted_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.account_members am
    WHERE am.account_id = stores.account_id
      AND am.user_id = auth.uid()
      AND am.role IN ('owner', 'admin', 'manager', 'operator')
  )
)
WITH CHECK (
  deleted_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.account_members am
    WHERE am.account_id = stores.account_id
      AND am.user_id = auth.uid()
      AND am.role IN ('owner', 'admin', 'manager', 'operator')
  )
);

-- 4. RPC для мягкого удаления магазина
--    Пароль проверяется на фронтенде через supabase.auth.signInWithPassword.
--    Функция просто устанавливает deleted_at = NOW().
CREATE OR REPLACE FUNCTION public.archive_store(p_store_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Проверяем, что пользователь является членом компании, которой принадлежит магазин
  IF NOT EXISTS (
    SELECT 1
    FROM public.stores s
    JOIN public.account_members am ON am.account_id = s.account_id
    WHERE s.id = p_store_id
      AND am.user_id = auth.uid()
      AND am.role IN ('owner', 'admin', 'manager', 'operator')
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE public.stores
  SET deleted_at = NOW()
  WHERE id = p_store_id
    AND deleted_at IS NULL;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.archive_store(uuid) TO authenticated;

-- 5. Изменить FK trip_lines.store_id: RESTRICT → SET NULL
--    Чтобы жёсткое удаление магазина не блокировалось существующими строками рейсов.
ALTER TABLE public.trip_lines
  DROP CONSTRAINT IF EXISTS trip_lines_store_id_fkey;

ALTER TABLE public.trip_lines
  ADD CONSTRAINT trip_lines_store_id_fkey
  FOREIGN KEY (store_id)
  REFERENCES public.stores (id)
  ON DELETE SET NULL;

-- 6. Функция жёсткого удаления просроченных архивных магазинов
CREATE OR REPLACE FUNCTION public.hard_delete_expired_stores()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- trip_lines.store_id → NULL (ON DELETE SET NULL уже справится при удалении строки stores,
  -- но явно обнуляем для совместимости если FK изменится)
  UPDATE public.trip_lines tl
  SET store_id = NULL
  FROM public.stores s
  WHERE tl.store_id = s.id
    AND s.deleted_at IS NOT NULL
    AND s.deleted_at < NOW() - INTERVAL '15 days';

  -- Удаляем сами магазины
  DELETE FROM public.stores
  WHERE deleted_at IS NOT NULL
    AND deleted_at < NOW() - INTERVAL '15 days';
END;
$$;

-- 7. Расписание pg_cron (ежедневно в 03:10 UTC)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hard-delete-expired-stores') THEN
      PERFORM cron.unschedule('hard-delete-expired-stores');
    END IF;
    PERFORM cron.schedule(
      'hard-delete-expired-stores',
      '10 3 * * *',
      'SELECT public.hard_delete_expired_stores()'
    );
  END IF;
END $$;
