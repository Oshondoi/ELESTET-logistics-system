-- ============================================================
-- Глобальный short_id для компаний (accounts)
-- Каждая компания в системе получает уникальный порядковый номер C-N
-- ============================================================

-- 1. Добавляем колонку
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS short_id integer;

-- 2. Создаём глобальную последовательность
CREATE SEQUENCE IF NOT EXISTS public.accounts_short_id_seq START 1;

-- 3. Бэкфилл существующих компаний в порядке создания
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) AS rn
  FROM public.accounts
  WHERE short_id IS NULL
)
UPDATE public.accounts
  SET short_id = ranked.rn
FROM ranked
WHERE public.accounts.id = ranked.id;

-- 4. Устанавливаем последовательность на значение после максимального
SELECT setval(
  'public.accounts_short_id_seq',
  COALESCE((SELECT MAX(short_id) FROM public.accounts), 0),
  true
);

-- 5. Default для новых компаний
ALTER TABLE public.accounts
  ALTER COLUMN short_id SET DEFAULT nextval('public.accounts_short_id_seq');

ALTER SEQUENCE public.accounts_short_id_seq
  OWNED BY public.accounts.short_id;

-- 6. Обновляем RPC get_my_accounts — добавляем short_id
DROP FUNCTION IF EXISTS public.get_my_accounts();
CREATE OR REPLACE FUNCTION public.get_my_accounts()
RETURNS TABLE(
  id         uuid,
  name       text,
  created_at timestamptz,
  my_role    text,
  short_id   integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.name, a.created_at, am.role AS my_role, a.short_id
  FROM   public.accounts a
  JOIN   public.account_members am
         ON am.account_id = a.id AND am.user_id = auth.uid()
  WHERE  a.deleted_at IS NULL
  ORDER BY a.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_accounts() TO authenticated;

-- 7. Обновляем get_my_archived_accounts — добавляем short_id
DROP FUNCTION IF EXISTS public.get_my_archived_accounts();
CREATE OR REPLACE FUNCTION public.get_my_archived_accounts()
RETURNS TABLE(
  id         uuid,
  name       text,
  created_at timestamptz,
  deleted_at timestamptz,
  my_role    text,
  short_id   integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.name, a.created_at, a.deleted_at, am.role AS my_role, a.short_id
  FROM   public.accounts a
  JOIN   public.account_members am
         ON am.account_id = a.id AND am.user_id = auth.uid()
  WHERE  a.deleted_at IS NOT NULL
    AND  a.deleted_at > NOW() - INTERVAL '15 days'
  ORDER BY a.deleted_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_archived_accounts() TO authenticated;
