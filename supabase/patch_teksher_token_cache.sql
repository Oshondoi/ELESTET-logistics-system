-- Кеш JWT-токена Teksher в таблице stores.
-- Edge Function использует закешированный токен вместо повторного логина.
-- Токен живёт ~30 минут. Кешируем на 25 минут (с запасом).
-- Поля НЕ возвращаются клиенту (только service_role в Edge Function).

alter table public.stores
  add column if not exists teksher_token      text,
  add column if not exists teksher_token_exp  timestamptz;
