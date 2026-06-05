-- patch_superadmin_company_bypass.sql
-- Superadmin обходит проверку подписки при создании дополнительной компании.
-- Admin, support и обычные пользователи — по-прежнему требуют платный план.

CREATE OR REPLACE FUNCTION public.create_account_with_owner(p_account_name text)
RETURNS public.accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account        public.accounts;
  v_existing_count int;
  v_has_paid_plan  boolean;
  v_platform_role  text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_account_name IS NULL OR btrim(p_account_name) = '' THEN
    RAISE EXCEPTION 'Account name is required';
  END IF;

  -- Считаем сколько компаний уже есть у пользователя
  SELECT COUNT(*) INTO v_existing_count
  FROM account_members am
  JOIN accounts a ON a.id = am.account_id
  WHERE am.user_id = auth.uid()
    AND am.role = 'owner'
    AND a.deleted_at IS NULL;

  IF v_existing_count >= 1 THEN
    -- Superadmin обходит проверку без ограничений
    SELECT COALESCE(platform_role, 'user') INTO v_platform_role
    FROM public.profiles
    WHERE user_id = auth.uid();

    IF v_platform_role != 'superadmin' THEN
      SELECT EXISTS (
        SELECT 1
        FROM account_members am
        JOIN accounts a ON a.id = am.account_id
        WHERE am.user_id = auth.uid()
          AND am.role = 'owner'
          AND a.deleted_at IS NULL
          AND a.plan IN ('seller', 'operational')
          AND a.plan_until > now()
      ) INTO v_has_paid_plan;

      IF NOT v_has_paid_plan THEN
        RAISE EXCEPTION 'Для создания дополнительной компании необходима активная платная подписка (Селлер или Операционный)';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.accounts (name)
  VALUES (btrim(p_account_name))
  RETURNING * INTO v_account;

  INSERT INTO public.account_members (account_id, user_id, role)
  VALUES (v_account.id, auth.uid(), 'owner')
  ON CONFLICT (account_id, user_id) DO NOTHING;

  RETURN v_account;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_account_with_owner(text) TO authenticated;
