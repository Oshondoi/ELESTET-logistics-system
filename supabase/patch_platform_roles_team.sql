-- ============================================================
-- Фикс: admin_get_platform_roles — явный cast email::text
-- Доп. RPC: admin_find_user_by_short_id
-- ============================================================

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
  SELECT p.user_id, u.email::text, p.platform_role, p.short_id
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

CREATE OR REPLACE FUNCTION admin_find_user_by_short_id(p_short_id integer)
RETURNS TABLE(found_user_id uuid, found_email text, found_role text)
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
  SELECT p.user_id, u.email::text, p.platform_role
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.user_id
  WHERE p.short_id = p_short_id;
END;
$$;
