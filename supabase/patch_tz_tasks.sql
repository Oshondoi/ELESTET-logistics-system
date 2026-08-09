-- Короткие задачи на админской странице «Промпты ТЗ».
-- Доступ, как и у tz_prompts, имеет только superadmin.

CREATE TABLE IF NOT EXISTS public.tz_tasks (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  text         text        NOT NULL CHECK (length(btrim(text)) > 0),
  is_done      boolean     NOT NULL DEFAULT false,
  position     integer     NOT NULL DEFAULT 0,
  completed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tz_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tz_tasks_superadmin_all" ON public.tz_tasks;
CREATE POLICY "tz_tasks_superadmin_all" ON public.tz_tasks
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.platform_role = 'superadmin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.platform_role = 'superadmin'
    )
  );

CREATE INDEX IF NOT EXISTS tz_tasks_position_created_idx
  ON public.tz_tasks (position, created_at);
