-- Фикс: RLS-ошибка при upsert wb_feedbacks
-- Причина: id отзыва (от WB) глобально уникален. Если те же отзывы
-- ранее синхронизировались под другим account_id (при тестировании),
-- upsert по id пытается UPDATE чужую строку → RLS USING блокирует.
-- Решение: составной PRIMARY KEY (store_id, id) — один и тот же WB-отзыв
-- может храниться под разными store_id (разные аккаунты), конфликта нет.

-- 1. Убрать старый PK
ALTER TABLE wb_feedbacks DROP CONSTRAINT IF EXISTS wb_feedbacks_pkey;

-- 2. Удалить дубликаты (оставить самую свежую строку по каждому store_id + id)
DELETE FROM wb_feedbacks a
USING wb_feedbacks b
WHERE a.ctid < b.ctid
  AND a.id = b.id
  AND a.store_id = b.store_id;

-- 3. Новый составной PK
ALTER TABLE wb_feedbacks ADD PRIMARY KEY (store_id, id);
