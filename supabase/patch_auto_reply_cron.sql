-- patch_auto_reply_cron.sql
-- Применить в Supabase SQL Editor ПОСЛЕ:
-- 1. patch_automation_settings.sql
-- 2. Deploy Edge Function "auto-reply" (supabase functions deploy auto-reply)

-- ── Включить расширения ───────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── Удалить старое задание если есть ─────────────────────────────
SELECT cron.unschedule('auto-reply-every-30min')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'auto-reply-every-30min'
);

-- ── Создать задание: каждые 30 минут ─────────────────────────────
-- Замените <PROJECT_REF> на реальный ref вашего Supabase проекта
-- (найти в: Supabase Dashboard → Settings → General → Reference ID)
SELECT cron.schedule(
  'auto-reply-every-30min',
  '*/30 * * * *',  -- каждые 30 минут
  $$
  SELECT net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/auto-reply',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
    ),
    body := '{}'::jsonb
  )
  $$
);

-- ── Проверить задания ─────────────────────────────────────────────
-- SELECT * FROM cron.job;
-- SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
