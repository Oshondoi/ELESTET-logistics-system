-- ============================================================
-- Синхронизация account_members при назначении/снятии роли
--
-- Проблема: при назначении пользователя на роль (roles.assigned_user_id)
-- он не появлялся в account_members и поэтому не видел компанию
-- (RLS на accounts требует запись в account_members).
--
-- Решение:
--   AFTER INSERT/UPDATE/DELETE на roles:
--     - Если assigned_user_id установлен → добавить в account_members
--       с role='viewer' (ON CONFLICT DO NOTHING — не понижать owner/admin)
--     - Если assigned_user_id снят и у пользователя нет других ролей
--       в этой компании → удалить из account_members (только role='viewer')
-- ============================================================

-- Функция-триггер
CREATE OR REPLACE FUNCTION public.sync_role_to_member()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id  uuid;
  v_old_user_id uuid;
  v_new_user_id uuid;
BEGIN
  -- Определяем значения в зависимости от операции
  IF TG_OP = 'DELETE' THEN
    v_account_id  := OLD.account_id;
    v_old_user_id := OLD.assigned_user_id;
    v_new_user_id := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    v_account_id  := NEW.account_id;
    v_old_user_id := NULL;
    v_new_user_id := NEW.assigned_user_id;
  ELSE -- UPDATE
    v_account_id  := NEW.account_id;
    v_old_user_id := OLD.assigned_user_id;
    v_new_user_id := NEW.assigned_user_id;
  END IF;

  -- Добавить нового пользователя (если появился)
  IF v_new_user_id IS NOT NULL THEN
    INSERT INTO public.account_members (account_id, user_id, role)
    VALUES (v_account_id, v_new_user_id, 'viewer')
    ON CONFLICT (account_id, user_id) DO NOTHING;
    -- ON CONFLICT DO NOTHING: не понижаем owner/admin/manager/operator до viewer
  END IF;

  -- Убрать старого пользователя (если он сменился или роль удалена)
  IF v_old_user_id IS NOT NULL AND v_old_user_id IS DISTINCT FROM v_new_user_id THEN
    -- Проверяем: есть ли у него другие роли в этой компании
    IF NOT EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.account_id = v_account_id
        AND r.assigned_user_id = v_old_user_id
        AND (TG_OP = 'DELETE' OR r.id != OLD.id)
    ) THEN
      -- Удаляем только если он "viewer" (не трогаем owner/admin/etc. добавленных вручную)
      DELETE FROM public.account_members
      WHERE account_id = v_account_id
        AND user_id    = v_old_user_id
        AND role       = 'viewer';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

-- Удаляем старый триггер если есть и создаём заново
DROP TRIGGER IF EXISTS roles_sync_member ON public.roles;
CREATE TRIGGER roles_sync_member
  AFTER INSERT OR UPDATE OR DELETE ON public.roles
  FOR EACH ROW EXECUTE FUNCTION public.sync_role_to_member();

-- ============================================================
-- RPC для фронтенда: вернуть компании текущего пользователя
-- вместе с его ролью в каждой (my_role).
-- Используется вместо прямого select на accounts.
-- ============================================================
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
  ORDER BY a.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_accounts() TO authenticated;

-- ============================================================
-- Политика RLS: только owner может переименовывать компанию
-- ============================================================
DROP POLICY IF EXISTS "owners_can_update_accounts" ON public.accounts;
CREATE POLICY "owners_can_update_accounts"
  ON public.accounts FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.account_members am
      WHERE am.account_id = accounts.id
        AND am.user_id    = auth.uid()
        AND am.role       = 'owner'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.account_members am
      WHERE am.account_id = accounts.id
        AND am.user_id    = auth.uid()
        AND am.role       = 'owner'
    )
  );

-- ============================================================
-- Бэкфилл: добавляем в account_members всех пользователей,
-- которым уже назначена роль, но их ещё нет в account_members
-- ============================================================
INSERT INTO public.account_members (account_id, user_id, role)
SELECT DISTINCT r.account_id, r.assigned_user_id, 'viewer'
FROM   public.roles r
WHERE  r.assigned_user_id IS NOT NULL
ON CONFLICT (account_id, user_id) DO NOTHING;
