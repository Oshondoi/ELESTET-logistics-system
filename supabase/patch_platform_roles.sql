-- ============================================================
-- PLATFORM ROLES:
--   Добавляет platform_role в profiles (superadmin/admin/support/user)
--   RPC get_my_platform_role() — user-facing
--   RPC admin_set_platform_role() — только superadmin
-- ============================================================

-- 1. Добавить колонку platform_role в profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS platform_role text NOT NULL DEFAULT 'user'
  CHECK (platform_role IN ('user', 'support', 'admin', 'superadmin'));

-- 2. Назначить superadmin текущему владельцу
UPDATE public.profiles
SET platform_role = 'superadmin'
WHERE user_id = (
  SELECT id FROM auth.users WHERE email = 'sydykovsam@gmail.com' LIMIT 1
);

-- 3. RPC get_my_platform_role — user-facing, читает свою роль
CREATE OR REPLACE FUNCTION get_my_platform_role()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT platform_role INTO v_role
  FROM public.profiles
  WHERE user_id = auth.uid();
  RETURN COALESCE(v_role, 'user');
END;
$$;

-- 4. RPC admin_set_platform_role — только superadmin может назначать роли
CREATE OR REPLACE FUNCTION admin_set_platform_role(p_user_id uuid, p_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_my_role text;
BEGIN
  SELECT platform_role INTO v_my_role
  FROM public.profiles
  WHERE user_id = auth.uid();

  IF v_my_role != 'superadmin' THEN
    RAISE EXCEPTION 'Только суперадмин может назначать роли платформы';
  END IF;

  IF p_role NOT IN ('user', 'support', 'admin', 'superadmin') THEN
    RAISE EXCEPTION 'Неверная роль: %', p_role;
  END IF;

  UPDATE public.profiles SET platform_role = p_role WHERE user_id = p_user_id;
END;
$$;

-- 5. RPC admin_get_platform_roles — список всех пользователей с ролями (для AdminPage)
CREATE OR REPLACE FUNCTION admin_get_platform_roles()
RETURNS TABLE (user_id uuid, email text, platform_role text, short_id integer)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_my_role text;
BEGIN
  SELECT p.platform_role INTO v_my_role
  FROM public.profiles p
  WHERE p.user_id = auth.uid();

  IF v_my_role NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'Нет доступа';
  END IF;

  RETURN QUERY
  SELECT p.user_id, u.email, p.platform_role, p.short_id
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.user_id
  WHERE p.platform_role != 'user'
  ORDER BY
    CASE p.platform_role
      WHEN 'superadmin' THEN 1
      WHEN 'admin' THEN 2
      WHEN 'support' THEN 3
    END;
END;
$$;
