-- patch_plan_configs.sql
-- Конфигурация тарифных планов — редактируется через AdminPage таб "Тарифы".
-- Применить в Supabase Dashboard → SQL Editor.

-- ─────────────────────────────────────────────────
-- 1. Таблица plan_configs
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.plan_configs (
  key         text PRIMARY KEY,          -- 'seller' | 'operational' | 'premium'
  label       text NOT NULL,
  description text NOT NULL DEFAULT '',
  features    jsonb NOT NULL DEFAULT '[]',  -- string[]
  price_sale  integer NOT NULL,          -- цена покупки (сом/мес)
  price_full  integer,                   -- зачёркнутая цена (NULL = без зачёркивания)
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  updated_at  timestamptz DEFAULT now()
);

ALTER TABLE public.plan_configs ENABLE ROW LEVEL SECURITY;

-- Все аутентифицированные могут читать
DROP POLICY IF EXISTS "authenticated read plan_configs" ON public.plan_configs;
CREATE POLICY "authenticated read plan_configs"
  ON public.plan_configs FOR SELECT
  TO authenticated
  USING (true);

-- Только admin/superadmin могут изменять
DROP POLICY IF EXISTS "admin write plan_configs" ON public.plan_configs;
CREATE POLICY "admin write plan_configs"
  ON public.plan_configs FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = auth.uid()
        AND platform_role IN ('admin', 'superadmin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = auth.uid()
        AND platform_role IN ('admin', 'superadmin')
    )
  );

-- ─────────────────────────────────────────────────
-- 2. Начальные данные
-- ─────────────────────────────────────────────────
INSERT INTO public.plan_configs (key, label, description, features, price_sale, price_full, is_active, sort_order)
VALUES
  ('seller', 'Селлер', 'Для продавцов на маркетплейсах',
   '["Магазины","Товары и GTIN","Стикеры и КИЗы","Отзывы WB","Роли"]'::jsonb,
   2000, NULL, true, 1),
  ('operational', 'Операционный', 'Для фулфилмент-центров, цехов и карго',
   '["Фулфилмент + Пайплайн","Логистика","Магазины","Товары","Справочники","Стикеры и КИЗы","Аутсорс B2B","Счета","Роли"]'::jsonb,
   17000, NULL, true, 2),
  ('premium', 'Премиум', 'Всё включено — сейчас и в будущем',
   '["Всё из Операционного","White-label (логотип + заголовок вкладки)"]'::jsonb,
   20000, NULL, true, 3)
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────
-- 3. get_plan_configs — публичный (для страницы подписки)
-- ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_plan_configs()
RETURNS TABLE (
  key         text,
  label       text,
  description text,
  features    jsonb,
  price_sale  integer,
  price_full  integer,
  sort_order  integer
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT key, label, description, features, price_sale, price_full, sort_order
  FROM public.plan_configs
  WHERE is_active = true
  ORDER BY sort_order;
$$;

GRANT EXECUTE ON FUNCTION public.get_plan_configs() TO authenticated;

-- ─────────────────────────────────────────────────
-- 4. admin_get_plan_configs — для AdminPage
-- ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_plan_configs()
RETURNS TABLE (
  key         text,
  label       text,
  description text,
  features    jsonb,
  price_sale  integer,
  price_full  integer,
  is_active   boolean,
  sort_order  integer,
  updated_at  timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF NOT (
    SELECT COALESCE(platform_role, 'user') IN ('admin', 'superadmin')
    FROM public.profiles WHERE user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT pc.key, pc.label, pc.description, pc.features,
         pc.price_sale, pc.price_full, pc.is_active, pc.sort_order, pc.updated_at
  FROM public.plan_configs pc
  ORDER BY pc.sort_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_plan_configs() TO authenticated;

-- ─────────────────────────────────────────────────
-- 5. admin_upsert_plan_config — сохранение тарифа
-- ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_upsert_plan_config(
  p_key         text,
  p_label       text,
  p_description text,
  p_features    jsonb,
  p_price_sale  integer,
  p_price_full  integer,
  p_is_active   boolean,
  p_sort_order  integer
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF NOT (
    SELECT COALESCE(platform_role, 'user') IN ('admin', 'superadmin')
    FROM public.profiles WHERE user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO public.plan_configs (key, label, description, features, price_sale, price_full, is_active, sort_order, updated_at)
  VALUES (p_key, p_label, p_description, p_features, p_price_sale, p_price_full, p_is_active, p_sort_order, now())
  ON CONFLICT (key) DO UPDATE SET
    label       = EXCLUDED.label,
    description = EXCLUDED.description,
    features    = EXCLUDED.features,
    price_sale  = EXCLUDED.price_sale,
    price_full  = EXCLUDED.price_full,
    is_active   = EXCLUDED.is_active,
    sort_order  = EXCLUDED.sort_order,
    updated_at  = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_upsert_plan_config(text, text, text, jsonb, integer, integer, boolean, integer) TO authenticated;
