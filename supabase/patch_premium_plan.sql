-- patch_premium_plan.sql
-- Добавляет тариф 'premium' — всё включено, включая white-label.
-- Применить в Supabase Dashboard → SQL Editor.

-- 1. Расширяем CHECK на plan в access_overrides (пересоздаём через ALTER)
ALTER TABLE public.access_overrides
  DROP CONSTRAINT IF EXISTS access_overrides_plan_check;
ALTER TABLE public.access_overrides
  ADD CONSTRAINT access_overrides_plan_check
  CHECK (plan IN ('seller', 'operational', 'premium'));

-- 2. Расширяем CHECK в payment_orders
ALTER TABLE public.payment_orders
  DROP CONSTRAINT IF EXISTS payment_orders_plan_check;
ALTER TABLE public.payment_orders
  ADD CONSTRAINT payment_orders_plan_check
  CHECK (plan IN ('seller', 'operational', 'premium'));

-- 3. Обновляем create_account_with_owner — считать premium как платный план
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

  SELECT COUNT(*) INTO v_existing_count
  FROM account_members am
  JOIN accounts a ON a.id = am.account_id
  WHERE am.user_id = auth.uid()
    AND am.role = 'owner'
    AND a.deleted_at IS NULL;

  IF v_existing_count >= 1 THEN
    -- Superadmin обходит проверку
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
          AND a.plan IN ('seller', 'operational', 'premium')
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
