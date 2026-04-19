-- Патч: системные склады Wildberries
-- 1. Делаем account_id nullable
-- 2. Добавляем флаг is_system
-- 3. Уникальный индекс для системных складов по имени
-- 4. Обновляем RLS: системные склады видны всем авторизованным
-- 5. Вставляем склады WB

-- Шаг 1: account_id nullable
alter table public.warehouses
  alter column account_id drop not null;

-- Шаг 2: флаг is_system
alter table public.warehouses
  add column if not exists is_system boolean not null default false;

-- Шаг 3: уникальный индекс на имя среди системных складов
create unique index if not exists warehouses_system_name_unique
  on public.warehouses (name)
  where account_id is null;

-- Шаг 4: обновить SELECT-политику — системные склады (account_id IS NULL) видны всем
drop policy if exists "members_can_view_warehouses" on public.warehouses;

create policy "members_can_view_warehouses"
on public.warehouses
for select
using (
  account_id is null
  or exists (
    select 1
    from public.account_members am
    where am.account_id = warehouses.account_id
      and am.user_id = auth.uid()
  )
);

-- Шаг 5: системные склады Wildberries
insert into public.warehouses (account_id, name, is_system) values
  (null, 'Коледино',           true),
  (null, 'Электросталь',       true),
  (null, 'Подольск',           true),
  (null, 'Казань',             true),
  (null, 'Краснодар',          true),
  (null, 'Екатеринбург',       true),
  (null, 'Новосибирск',        true),
  (null, 'Хабаровск',          true),
  (null, 'Санкт-Петербург',    true),
  (null, 'Пушкино',            true),
  (null, 'Белые Столбы',       true),
  (null, 'Тула',               true),
  (null, 'Домодедово',         true),
  (null, 'Вёшки',              true),
  (null, 'Брянск',             true),
  (null, 'Минск',              true),
  (null, 'Алматы',             true),
  (null, 'Астана',             true),
  (null, 'Ташкент',            true),
  (null, 'Бишкек',             true)
on conflict do nothing;
