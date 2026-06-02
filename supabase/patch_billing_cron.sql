-- ============================================================
-- BILLING CRON:
--   Раз в сутки обнуляет plan → 'none' у аккаунтов
--   у которых plan_until истёк (и grace тоже истёк).
--   Использует pg_cron (встроен в Supabase).
-- ============================================================

-- 1. Включаем pg_cron (если ещё не включён)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Функция обнуления истёкших планов
CREATE OR REPLACE FUNCTION expire_outdated_plans()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  UPDATE accounts
  SET plan = 'none'
  WHERE plan != 'none'
    AND plan_until IS NOT NULL
    AND plan_until < now()
    -- Grace тоже истёк (или не был активирован)
    AND (grace_until IS NULL OR grace_until < now());
END;
$$;

-- 3. Удаляем старый job если был
SELECT cron.unschedule('expire-outdated-plans')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'expire-outdated-plans'
);

-- 4. Запускаем каждый день в 03:00 UTC
SELECT cron.schedule(
  'expire-outdated-plans',
  '0 3 * * *',
  'SELECT expire_outdated_plans()'
);
