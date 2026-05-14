-- Добавляет кеш-поля Teksher в таблицу stores.
-- Данные обновляются только при нажатии "Синхронизировать" (или при connect).
-- Edge Function action='stats' читает эти поля — без вызова Teksher API.
-- Edge Function action='sync' обновляет эти поля из Teksher API.

alter table public.stores
  add column if not exists teksher_participant_name text,
  add column if not exists teksher_balance          numeric,
  add column if not exists teksher_balance_money    numeric,
  add column if not exists teksher_products         integer,
  add column if not exists teksher_operations       integer,
  add column if not exists teksher_synced_at        timestamptz;
