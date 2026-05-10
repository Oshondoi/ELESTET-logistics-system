-- ============================================================
-- Порядковый short_id для партий (fulfillment_batches)
-- Нумерация per-account: внутри каждой компании П-1, П-2, П-3...
-- URL-формат: /fulfillment/C-{account.short_id}/P-{batch.short_id}
-- ============================================================

-- 1. Добавляем колонку
ALTER TABLE public.fulfillment_batches
  ADD COLUMN IF NOT EXISTS short_id integer;

-- 2. Бэкфилл: нумерация внутри каждого аккаунта по дате создания
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY created_at ASC) AS rn
  FROM public.fulfillment_batches
  WHERE short_id IS NULL
)
UPDATE public.fulfillment_batches
  SET short_id = ranked.rn
FROM ranked
WHERE public.fulfillment_batches.id = ranked.id;

-- 3. Функция-триггер: назначает следующий short_id в рамках аккаунта
CREATE OR REPLACE FUNCTION public.assign_batch_short_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.short_id IS NULL THEN
    SELECT COALESCE(MAX(short_id), 0) + 1 INTO NEW.short_id
    FROM public.fulfillment_batches
    WHERE account_id = NEW.account_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Вешаем триггер BEFORE INSERT
DROP TRIGGER IF EXISTS batch_short_id_trigger ON public.fulfillment_batches;
CREATE TRIGGER batch_short_id_trigger
  BEFORE INSERT ON public.fulfillment_batches
  FOR EACH ROW EXECUTE FUNCTION public.assign_batch_short_id();
