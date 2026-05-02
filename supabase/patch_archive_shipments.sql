-- ==============================================================
-- Архив поставок: мягкое удаление trip_lines + автоочистка 15 дней
-- ==============================================================
-- Применить в Supabase SQL Editor.

-- 1. Добавить колонку deleted_at к trip_lines
ALTER TABLE public.trip_lines ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;

-- 2. RPC: мягкое удаление поставки (архивирование)
CREATE OR REPLACE FUNCTION public.archive_trip_line(p_line_id uuid, p_account_id uuid)
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
    FROM public.trip_lines tl
    JOIN public.account_members am ON am.account_id = tl.account_id
    WHERE tl.id = p_line_id
      AND tl.account_id = p_account_id
      AND am.user_id = auth.uid()
      AND am.role IN ('owner', 'admin', 'manager', 'operator')
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE public.trip_lines
  SET deleted_at = NOW()
  WHERE id = p_line_id
    AND account_id = p_account_id
    AND deleted_at IS NULL;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.archive_trip_line(uuid, uuid) TO authenticated;

-- 3. RPC: восстановление поставки из архива
CREATE OR REPLACE FUNCTION public.restore_trip_line(p_line_id uuid, p_account_id uuid)
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
    FROM public.trip_lines tl
    JOIN public.account_members am ON am.account_id = tl.account_id
    WHERE tl.id = p_line_id
      AND tl.account_id = p_account_id
      AND am.user_id = auth.uid()
      AND am.role IN ('owner', 'admin', 'manager', 'operator')
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE public.trip_lines
  SET deleted_at = NULL
  WHERE id = p_line_id
    AND account_id = p_account_id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.restore_trip_line(uuid, uuid) TO authenticated;

-- 4. RPC: получить архивные поставки аккаунта
CREATE OR REPLACE FUNCTION public.get_archived_trip_lines(p_account_id uuid)
RETURNS SETOF public.trip_lines
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  SELECT tl.*
  FROM public.trip_lines tl
  WHERE tl.account_id = p_account_id
    AND tl.deleted_at IS NOT NULL
  ORDER BY tl.deleted_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_archived_trip_lines(uuid) TO authenticated;

-- 5. Скрывать заархивированные поставки из обычных запросов
--    Обновляем политику SELECT для trip_lines (если RLS включён)
DROP POLICY IF EXISTS "members_view_trip_lines" ON public.trip_lines;
CREATE POLICY "members_view_trip_lines"
ON public.trip_lines
FOR SELECT
USING (
  deleted_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.account_members am
    WHERE am.account_id = trip_lines.account_id
      AND am.user_id = auth.uid()
  )
);

-- 6. Функция жёсткого удаления просроченных архивных поставок (15 дней)
CREATE OR REPLACE FUNCTION public.hard_delete_expired_trip_lines()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.trip_lines
  WHERE deleted_at IS NOT NULL
    AND deleted_at < NOW() - INTERVAL '15 days';
END;
$$;

-- 7. Расписание pg_cron (ежедневно в 03:20 UTC)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hard-delete-expired-trip-lines') THEN
      PERFORM cron.unschedule('hard-delete-expired-trip-lines');
    END IF;
    PERFORM cron.schedule(
      'hard-delete-expired-trip-lines',
      '20 3 * * *',
      'SELECT public.hard_delete_expired_trip_lines()'
    );
  END IF;
END $$;
