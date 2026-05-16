-- ═══════════════════════════════════════════════════════════════
-- patch_teksher_tables.sql
-- Таблицы для кеширования данных из Teksher API.
-- Данные записываются только Edge Function (service_role key).
-- Пользователи — только SELECT по своим магазинам.
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- 1. teksher_products — товары (GTIN) из /products
-- ─────────────────────────────────────────────────────────────
create table if not exists public.teksher_products (
  id                        bigserial primary key,
  store_id                  uuid not null references public.stores(id) on delete cascade,

  -- Идентификаторы
  teksher_id                text,                    -- Teksher internal id
  gtin                      text not null,           -- GTIN-14

  -- Наименования
  name                      text,                    -- короткое имя
  full_name                 text,                    -- полное: "АРТ.25101 цвет бежевый, р.М"

  -- Группа маркировки
  product_group_code        text,                    -- 'LP RF' и т.п.

  -- Статус в Тексхер
  status                    text,

  -- Счётчик кодов
  codes_count               integer,

  -- Производитель / торговая марка
  trademark                 text,
  manufacturer_full_name    text,
  manufactured_country_id   integer,
  manufactured_country_code text,
  manufactured_country_name text,

  -- Дополнительные атрибуты (массив { attributeTypeCode, value, name })
  attributes                jsonb,

  -- Служебные
  synced_at                 timestamptz not null default now(),

  unique (store_id, gtin)
);

alter table public.teksher_products enable row level security;

-- Только участники аккаунта могут читать свои товары
drop policy if exists "teksher_products_select" on public.teksher_products;
create policy "teksher_products_select" on public.teksher_products
  for select using (
    exists (
      select 1 from public.stores s
      join public.account_members am on am.account_id = s.account_id
      where s.id = teksher_products.store_id
        and am.user_id = auth.uid()
    )
  );

create index if not exists idx_teksher_products_store_id on public.teksher_products(store_id);
create index if not exists idx_teksher_products_gtin     on public.teksher_products(gtin);


-- ─────────────────────────────────────────────────────────────
-- 2. teksher_codes — КИЗ-коды из /marking_codes/filter
-- ─────────────────────────────────────────────────────────────
create table if not exists public.teksher_codes (
  id                        bigserial primary key,
  store_id                  uuid not null references public.stores(id) on delete cascade,

  -- Идентификатор из Teksher
  teksher_id                text,

  -- Коды
  code                      text,                    -- GS1 DataMatrix (полный код)
  barcode                   text,                    -- EAN/штрихкод

  -- Привязка к товару
  gtin                      text,

  -- Статус
  status                    text,

  -- Серийный номер (AI 21)
  serial_number             text,

  -- Даты
  issue_date                timestamptz,
  created_date              timestamptz,
  emission_date             timestamptz,

  -- Служебные
  synced_at                 timestamptz not null default now(),

  unique (store_id, teksher_id)
);

alter table public.teksher_codes enable row level security;

drop policy if exists "teksher_codes_select" on public.teksher_codes;
create policy "teksher_codes_select" on public.teksher_codes
  for select using (
    exists (
      select 1 from public.stores s
      join public.account_members am on am.account_id = s.account_id
      where s.id = teksher_codes.store_id
        and am.user_id = auth.uid()
    )
  );

create index if not exists idx_teksher_codes_store_id   on public.teksher_codes(store_id);
create index if not exists idx_teksher_codes_gtin       on public.teksher_codes(gtin);
create index if not exists idx_teksher_codes_status     on public.teksher_codes(status);
create index if not exists idx_teksher_codes_teksher_id on public.teksher_codes(teksher_id);


-- ─────────────────────────────────────────────────────────────
-- 3. teksher_operations — операции из /operations/filter
-- ─────────────────────────────────────────────────────────────
create table if not exists public.teksher_operations (
  id                        bigserial primary key,
  store_id                  uuid not null references public.stores(id) on delete cascade,

  -- Идентификатор операции в Teksher
  operation_id              text,

  -- Тип и статус
  operation_type            text,                    -- 'EMISSION', 'SHIPMENT' и т.п.
  type                      text,                    -- дополнительный тип (из поля type)
  status                    text,

  -- Количества
  kms_count                 integer,                 -- количество КМ кодов
  codes_count               integer,
  quantity                  integer,

  -- Привязка к товару
  gtin                      text,

  -- Даты
  created_at_teksher        timestamptz,             -- createdAt из Teksher (не путать с created_at таблицы)
  created_date              timestamptz,
  operation_date            timestamptz,             -- поле date из Teksher

  -- Группа маркировки
  product_group_code        text,
  product_group_marking     jsonb,                   -- { id, code, alias, name }

  -- Сведения о товаре в операции
  product                   jsonb,                   -- { gtin, fullName }

  -- Служебные
  synced_at                 timestamptz not null default now(),

  unique (store_id, operation_id)
);

alter table public.teksher_operations enable row level security;

drop policy if exists "teksher_operations_select" on public.teksher_operations;
create policy "teksher_operations_select" on public.teksher_operations
  for select using (
    exists (
      select 1 from public.stores s
      join public.account_members am on am.account_id = s.account_id
      where s.id = teksher_operations.store_id
        and am.user_id = auth.uid()
    )
  );

create index if not exists idx_teksher_operations_store_id     on public.teksher_operations(store_id);
create index if not exists idx_teksher_operations_operation_id on public.teksher_operations(operation_id);
create index if not exists idx_teksher_operations_gtin         on public.teksher_operations(gtin);
create index if not exists idx_teksher_operations_status       on public.teksher_operations(status);
