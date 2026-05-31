-- ============================================================
-- admin_get_stats() — замена Edge Function admin-stats
-- SECURITY DEFINER + проверка platform_role чтобы не было
-- доступа у обычных пользователей
-- ============================================================

CREATE OR REPLACE FUNCTION admin_get_stats()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_my_role text;
  v_result  json;
BEGIN
  -- Только admin/superadmin
  SELECT platform_role INTO v_my_role
  FROM public.profiles
  WHERE user_id = auth.uid();

  IF v_my_role NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'Нет доступа';
  END IF;

  SELECT json_build_object(
    'total_users',     (SELECT COUNT(*) FROM public.profiles),
    'total_companies', (SELECT COUNT(*) FROM public.accounts WHERE deleted_at IS NULL),
    'total_stores',    (SELECT COUNT(*) FROM public.stores WHERE deleted_at IS NULL),
    'users', (
      SELECT json_agg(u ORDER BY u.short_id ASC NULLS LAST)
      FROM (
        SELECT
          p.user_id::text                                             AS id,
          au.email                                                    AS email,
          au.created_at                                               AS created_at,
          au.last_sign_in_at                                          AS last_sign_in_at,
          p.short_id,
          COUNT(DISTINCT am.account_id)                               AS companies,
          COUNT(DISTINCT s.id)                                        AS stores,
          COALESCE(
            json_agg(DISTINCT a.name) FILTER (WHERE a.name IS NOT NULL),
            '[]'::json
          )                                                           AS company_names
        FROM public.profiles p
        JOIN auth.users au ON au.id = p.user_id
        LEFT JOIN public.account_members am ON am.user_id = p.user_id
        LEFT JOIN public.accounts a
          ON a.id = am.account_id AND a.deleted_at IS NULL
        LEFT JOIN public.stores s
          ON s.account_id = am.account_id AND s.deleted_at IS NULL
        GROUP BY p.user_id, p.short_id, au.email, au.created_at, au.last_sign_in_at
      ) u
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;
