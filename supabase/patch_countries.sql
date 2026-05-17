-- Таблица стран (кэш из Teksher API)
-- Обновляется кнопкой "Обновить ТН ВЭД" или ночью по cron
create table if not exists public.countries (
  teksher_id  integer      primary key,
  name        text         not null,
  code        text,
  synced_at   timestamptz  not null default now()
);

alter table public.countries enable row level security;

-- Чтение разрешено всем аутентифицированным пользователям
drop policy if exists "countries_select" on public.countries;
create policy "countries_select"
  on public.countries
  for select
  to authenticated
  using (true);

-- Вставка/обновление только через service_role (edge functions)
-- (service_role обходит RLS по умолчанию)
