-- ============================================================
-- Формирование коробов: поставки + коробá + содержимое
-- ============================================================

-- Поставки, созданные из этапа "Формирование коробов"
create table if not exists public.fulfillment_supplies (
  id          uuid primary key default gen_random_uuid(),
  batch_id    uuid not null references public.fulfillment_batches(id) on delete cascade,
  account_id  uuid not null references public.accounts(id) on delete cascade,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  warehouse_name text not null,           -- сохраняем название на случай удаления склада
  trip_id     uuid references public.trips(id) on delete set null,
  trip_line_id uuid references public.trip_lines(id) on delete set null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default timezone('utc', now())
);

create index if not exists idx_fulfillment_supplies_batch on public.fulfillment_supplies(batch_id);
create index if not exists idx_fulfillment_supplies_account on public.fulfillment_supplies(account_id);

-- Коробá внутри поставки
create table if not exists public.fulfillment_boxes (
  id          uuid primary key default gen_random_uuid(),
  supply_id   uuid not null references public.fulfillment_supplies(id) on delete cascade,
  account_id  uuid not null references public.accounts(id) on delete cascade,
  box_number  int not null,               -- порядковый номер короба
  status      text not null default 'open' check (status in ('open', 'closed')),
  created_at  timestamptz not null default timezone('utc', now()),
  unique (supply_id, box_number)
);

create index if not exists idx_fulfillment_boxes_supply on public.fulfillment_boxes(supply_id);

-- Содержимое короба
create table if not exists public.fulfillment_box_items (
  id          uuid primary key default gen_random_uuid(),
  box_id      uuid not null references public.fulfillment_boxes(id) on delete cascade,
  account_id  uuid not null references public.accounts(id) on delete cascade,
  barcode     text not null,
  item_id     uuid references public.fulfillment_items(id) on delete set null,
  product_name text,
  qty         int not null default 1 check (qty > 0),
  created_at  timestamptz not null default timezone('utc', now())
);

create index if not exists idx_fulfillment_box_items_box on public.fulfillment_box_items(box_id);

-- ── RLS ──────────────────────────────────────────────────────

alter table public.fulfillment_supplies enable row level security;
alter table public.fulfillment_boxes enable row level security;
alter table public.fulfillment_box_items enable row level security;

-- fulfillment_supplies
create policy "members_view_supplies" on public.fulfillment_supplies for select
  using (exists (select 1 from public.account_members am where am.account_id = fulfillment_supplies.account_id and am.user_id = auth.uid()));

create policy "members_manage_supplies" on public.fulfillment_supplies for all
  using (exists (select 1 from public.account_members am where am.account_id = fulfillment_supplies.account_id and am.user_id = auth.uid()))
  with check (exists (select 1 from public.account_members am where am.account_id = fulfillment_supplies.account_id and am.user_id = auth.uid()));

-- fulfillment_boxes
create policy "members_view_boxes" on public.fulfillment_boxes for select
  using (exists (select 1 from public.account_members am where am.account_id = fulfillment_boxes.account_id and am.user_id = auth.uid()));

create policy "members_manage_boxes" on public.fulfillment_boxes for all
  using (exists (select 1 from public.account_members am where am.account_id = fulfillment_boxes.account_id and am.user_id = auth.uid()))
  with check (exists (select 1 from public.account_members am where am.account_id = fulfillment_boxes.account_id and am.user_id = auth.uid()));

-- fulfillment_box_items
create policy "members_view_box_items" on public.fulfillment_box_items for select
  using (exists (select 1 from public.account_members am where am.account_id = fulfillment_box_items.account_id and am.user_id = auth.uid()));

create policy "members_manage_box_items" on public.fulfillment_box_items for all
  using (exists (select 1 from public.account_members am where am.account_id = fulfillment_box_items.account_id and am.user_id = auth.uid()))
  with check (exists (select 1 from public.account_members am where am.account_id = fulfillment_box_items.account_id and am.user_id = auth.uid()));
