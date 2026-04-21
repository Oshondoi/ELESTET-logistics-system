-- ============================================================
-- Таблица товаров (синхронизация с маркетплейсами через API)
-- ============================================================

-- Основная таблица товаров
create table if not exists public.products (
  id            uuid        primary key default gen_random_uuid(),
  account_id    uuid        not null references public.accounts(id) on delete cascade,
  store_id      uuid        not null references public.stores(id)   on delete cascade,
  nm_id         bigint      not null,           -- WB: nmID (артикул WB)
  vendor_code   text,                           -- артикул продавца
  name          text,                           -- название товара
  brand         text,
  category      text,                           -- subjectName в WB API
  barcodes      text[]      default '{}',       -- штрихкоды (из sizes[].skus)
  photos        jsonb,                          -- массив фото
  sizes         jsonb,                          -- размеры / остатки
  raw_data      jsonb,                          -- полный ответ API (для будущих полей)
  synced_at     timestamptz not null default now(),
  created_at    timestamptz not null default now(),

  unique (store_id, nm_id)
);

-- Лог синхронизаций (когда, сколько товаров, успешно ли)
create table if not exists public.store_sync_log (
  id              uuid        primary key default gen_random_uuid(),
  store_id        uuid        not null references public.stores(id) on delete cascade,
  synced_at       timestamptz not null default now(),
  products_count  int,
  status          text        not null default 'ok',  -- 'ok' | 'error'
  error_message   text
);

-- ── RLS ──────────────────────────────────────────────────────

alter table public.products       enable row level security;
alter table public.store_sync_log enable row level security;

-- Чтение товаров — любой участник компании
create policy "members can view products"
  on public.products for select
  using (
    account_id in (
      select account_id from public.account_members
      where user_id = auth.uid()
    )
  );

-- Запись товаров — Edge Function использует service role (обходит RLS)
-- Но добавим политику на случай прямого insert с клиента
create policy "members can manage products"
  on public.products for all
  using (
    account_id in (
      select account_id from public.account_members
      where user_id = auth.uid()
    )
  );

-- Чтение лога синхронизаций
create policy "members can view sync log"
  on public.store_sync_log for select
  using (
    store_id in (
      select id from public.stores
      where account_id in (
        select account_id from public.account_members
        where user_id = auth.uid()
      )
    )
  );

-- Запись лога (только service role нужна, но на случай клиента)
create policy "members can manage sync log"
  on public.store_sync_log for all
  using (
    store_id in (
      select id from public.stores
      where account_id in (
        select account_id from public.account_members
        where user_id = auth.uid()
      )
    )
  );

-- ── Индексы ──────────────────────────────────────────────────

create index if not exists products_account_id_idx  on public.products (account_id);
create index if not exists products_store_id_idx    on public.products (store_id);
create index if not exists products_nm_id_idx       on public.products (nm_id);
create index if not exists sync_log_store_id_idx    on public.store_sync_log (store_id);
create index if not exists sync_log_synced_at_idx   on public.store_sync_log (synced_at desc);
