-- ==============================================================
-- Восстановление из архива: компании и магазины
-- ==============================================================
-- Применить в Supabase SQL Editor.

-- ----------------------------------------------------------------
-- 1. Получить архивные компании текущего пользователя
--    (где он owner, не старше 15 дней)
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_archived_accounts()
RETURNS TABLE(
  id         uuid,
  name       text,
  created_at timestamptz,
  deleted_at timestamptz,
  my_role    text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.name, a.created_at, a.deleted_at, am.role AS my_role
  FROM   public.accounts a
  JOIN   public.account_members am
         ON am.account_id = a.id AND am.user_id = auth.uid()
  WHERE  a.deleted_at IS NOT NULL
    AND  a.deleted_at > NOW() - INTERVAL '15 days'
  ORDER BY a.deleted_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_archived_accounts() TO authenticated;

-- ----------------------------------------------------------------
-- 2. Восстановить компанию (только owner)
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.restore_account(p_account_id uuid)
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
    RAISE EXCEPTION 'Only owner can restore company';
  END IF;

  UPDATE public.accounts
  SET deleted_at = NULL
  WHERE id = p_account_id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.restore_account(uuid) TO authenticated;

-- ----------------------------------------------------------------
-- 3. Получить архивные магазины аккаунта
--    (только члены компании с нужной ролью, не старше 15 дней)
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_archived_stores(p_account_id uuid)
RETURNS TABLE(
  id           uuid,
  account_id   uuid,
  store_code   text,
  name         text,
  marketplace  text,
  supplier     text,
  supplier_full text,
  address      text,
  inn          text,
  ai_prompt    text,
  created_at   timestamptz,
  deleted_at   timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id, s.account_id, s.store_code, s.name, s.marketplace,
    s.supplier, s.supplier_full, s.address, s.inn, s.ai_prompt,
    s.created_at, s.deleted_at
  FROM public.stores s
  JOIN public.account_members am
       ON am.account_id = s.account_id AND am.user_id = auth.uid()
  WHERE s.account_id = p_account_id
    AND s.deleted_at IS NOT NULL
    AND s.deleted_at > NOW() - INTERVAL '15 days'
    AND am.role IN ('owner', 'admin', 'manager', 'operator')
  ORDER BY s.deleted_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_archived_stores(uuid) TO authenticated;

-- ----------------------------------------------------------------
-- 4. Восстановить магазин
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.restore_store(p_store_id uuid)
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
    FROM public.stores s
    JOIN public.account_members am ON am.account_id = s.account_id
    WHERE s.id = p_store_id
      AND am.user_id = auth.uid()
      AND am.role IN ('owner', 'admin', 'manager', 'operator')
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE public.stores
  SET deleted_at = NULL
  WHERE id = p_store_id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.restore_store(uuid) TO authenticated;
