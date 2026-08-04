-- FBS заказы: кэш WB данных (stale-while-revalidate)
create table if not exists fbs_orders (
  id            uuid default gen_random_uuid() primary key,
  account_id    uuid not null references accounts(id) on delete cascade,
  store_id      uuid not null references stores(id) on delete cascade,
  wb_order_id   bigint not null,
  wb_status     text not null default 'new', -- new/confirm/complete/cancel
  supply_id     text,
  rid           text,
  article       text,
  nm_id         bigint,
  chrt_id       bigint,
  skus          jsonb default '[]',
  price         int default 0,
  warehouse_id  int default 0,
  created_at    timestamptz,
  ddate         timestamptz,
  data          jsonb default '{}',
  synced_at     timestamptz default now(),
  unique(store_id, wb_order_id)
);

-- Последний синк по магазину
create table if not exists fbs_sync_log (
  store_id       uuid primary key references stores(id) on delete cascade,
  last_synced_at timestamptz,
  orders_count   int default 0,
  error          text
);

-- RLS
alter table fbs_orders enable row level security;
alter table fbs_sync_log enable row level security;

create policy "fbs_orders: account members"
  on fbs_orders for all
  using (
    account_id in (
      select account_id from account_members where user_id = auth.uid()
    )
  );

create policy "fbs_sync_log: account members"
  on fbs_sync_log for all
  using (
    store_id in (
      select s.id from stores s
      join account_members am on am.account_id = s.account_id
      where am.user_id = auth.uid()
    )
  );

-- Индексы
create index if not exists fbs_orders_account_store on fbs_orders(account_id, store_id);
create index if not exists fbs_orders_wb_status on fbs_orders(store_id, wb_status);
create index if not exists fbs_orders_synced_at on fbs_orders(store_id, synced_at desc);
