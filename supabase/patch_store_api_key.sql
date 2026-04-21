-- Добавляет поле api_key в таблицу stores
alter table public.stores add column if not exists api_key text;
