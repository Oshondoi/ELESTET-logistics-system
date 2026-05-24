-- Добавляем поля is_primary и exchange_rate в account_currencies
alter table account_currencies
  add column if not exists is_primary boolean not null default false,
  add column if not exists exchange_rate numeric not null default 1;

-- Уникальная основная валюта на аккаунт (максимум одна)
-- Реализуется на уровне приложения, не через constraint (для простоты)
