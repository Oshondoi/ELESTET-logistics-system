-- Добавляет поля Teksher в таблицу stores.
-- teksher_login    — логин от label.teksher.kg (показывается в UI)
-- teksher_password — пароль (НИКОГДА не возвращается клиенту, только Edge Functions)
-- teksher_participant_id — UUID участника в Teksher (получается после первого входа)

alter table public.stores
  add column if not exists teksher_login        text,
  add column if not exists teksher_password     text,
  add column if not exists teksher_participant_id text;

-- Запрещаем SELECT колонки teksher_password для обычных пользователей.
-- Edge Functions используют service_role key — он обходит RLS и Column Security.
-- Это единственный способ читать пароль.

-- Создаём security-barrier view который скрывает teksher_password:
create or replace view public.stores_safe
  with (security_barrier = true, security_invoker = true)
as
select
  id,
  account_id,
  name,
  marketplace,
  store_code,
  api_key,
  supplier,
  supplier_full,
  address,
  inn,
  phone,
  created_at,
  updated_at,
  deleted_at,
  short_id,
  teksher_login,
  teksher_participant_id,
  -- teksher_password НЕ включён — фронт никогда его не получает
  (teksher_login is not null) as has_teksher
from public.stores;
