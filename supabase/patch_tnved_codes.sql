-- ТН ВЭД коды — общая таблица для всех аккаунтов (одна на всю систему).
-- Источник: Teksher API (который берёт из официальной базы ТН ВЭД ЕАЭС).
-- Обновляется: вручную кнопкой "Обновить ТН ВЭД" или автоматически в 4:00 по Бишкеку (22:00 UTC).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Основная таблица кодов
CREATE TABLE IF NOT EXISTS public.tnved_codes (
  code             text PRIMARY KEY,        -- 10-значный код, напр. 6203120000
  sub_position_name text,                   -- название по субпозиции
  position         text,                    -- позиция (4 цифры), напр. 6203
  position_name    text,                    -- наименование товарной позиции
  group_name       text,                    -- товарная группа
  synced_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tnved_codes_code_trgm   ON public.tnved_codes USING gin(code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS tnved_codes_name_trgm   ON public.tnved_codes USING gin(coalesce(sub_position_name,'') gin_trgm_ops);
CREATE INDEX IF NOT EXISTS tnved_codes_position_idx ON public.tnved_codes (position);

-- Метаданные синхронизации
CREATE TABLE IF NOT EXISTS public.tnved_meta (
  id            int PRIMARY KEY DEFAULT 1,
  last_sync_at  timestamptz,
  total_codes   int
);
INSERT INTO public.tnved_meta (id) VALUES (1) ON CONFLICT DO NOTHING;

-- RLS: читать могут все аутентифицированные пользователи, писать — только service_role
ALTER TABLE public.tnved_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tnved_codes_public_read" ON public.tnved_codes;
CREATE POLICY "tnved_codes_public_read" ON public.tnved_codes FOR SELECT USING (true);

ALTER TABLE public.tnved_meta ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tnved_meta_public_read" ON public.tnved_meta;
CREATE POLICY "tnved_meta_public_read" ON public.tnved_meta FOR SELECT USING (true);

-- ─── CRON: синхронизация в 22:00 UTC = 04:00 Бишкек (UTC+6) ──────────────────
-- Требует: pg_cron + pg_net (включены в Supabase по умолчанию)
-- ВАЖНО: замените <SUPABASE_SERVICE_ROLE_KEY> на реальный ключ из Settings → API
--        или выполните: SELECT cron.schedule(...) вручную в SQL Editor уже с ключом.

SELECT cron.unschedule('sync-tnved-daily') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'sync-tnved-daily'
);

SELECT cron.schedule(
  'sync-tnved-daily',
  '0 22 * * *',
  $$
    SELECT net.http_post(
      url     := 'https://jzucxqakvgzpgtvagsnq.supabase.co/functions/v1/tnved-sync',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);
