-- ============================================================
-- Патч: пользовательские колонки для рейсов и поставок
-- ============================================================

-- 1. Добавляем поля custom_fields для хранения значений
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.trip_lines
  ADD COLUMN IF NOT EXISTS custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2. Таблица конфигурации колонок (одна запись на аккаунт + тип сущности)
CREATE TABLE IF NOT EXISTS public.column_configs (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid        NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  entity_type  text        NOT NULL CHECK (entity_type IN ('trip', 'trip_line')),
  hidden_builtin text[]    NOT NULL DEFAULT '{}',
  custom_cols  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at   timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (account_id, entity_type)
);

-- 3. Триггер updated_at
DROP TRIGGER IF EXISTS column_configs_set_updated_at ON public.column_configs;
CREATE TRIGGER column_configs_set_updated_at
  BEFORE UPDATE ON public.column_configs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. RLS
ALTER TABLE public.column_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "account_members_can_manage_column_configs" ON public.column_configs;
CREATE POLICY "account_members_can_manage_column_configs"
  ON public.column_configs FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.account_members
      WHERE account_members.account_id = column_configs.account_id
        AND account_members.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.account_members
      WHERE account_members.account_id = column_configs.account_id
        AND account_members.user_id = auth.uid()
    )
  );
