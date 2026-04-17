-- ============================================================
-- Рейсы (trips) — верхний уровень отправки
-- Каждый рейс имеет порядковый номер внутри аккаунта
-- ============================================================

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete restrict,
  trip_number integer not null,
  carrier text not null,
  departure_date date,
  status text not null default 'Формируется'
    check (status in ('Формируется', 'Отправлен', 'Прибыл', 'Завершён')),
  payment_status text not null default 'Не оплачено'
    check (payment_status in ('Не оплачено', 'Частично оплачено', 'Оплачено')),
  comment text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (account_id, trip_number)
);

create index if not exists trips_account_id_idx on public.trips (account_id);
create index if not exists trips_status_idx on public.trips (status);

-- ============================================================
-- Строки рейса (trip_lines) — поставка одного магазина
-- shipment_number уникален в рамках магазина (store_id)
-- ============================================================

create table if not exists public.trip_lines (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete restrict,
  account_id uuid not null references public.accounts (id) on delete restrict,
  store_id uuid not null references public.stores (id) on delete restrict,
  shipment_number integer not null,
  destination_warehouse text not null,
  box_qty integer not null default 0 check (box_qty >= 0),
  units_qty integer not null default 0 check (units_qty >= 0),
  units_total integer not null default 0 check (units_total >= 0),
  arrived_box_qty integer not null default 0 check (arrived_box_qty >= 0),
  planned_marketplace_delivery_date date,
  arrival_date date,
  status text not null default 'Ожидает отправки'
    check (status in ('Ожидает отправки', 'В пути', 'Прибыл', 'Отгружен')),
  comment text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (store_id, shipment_number)
);

create index if not exists trip_lines_trip_id_idx on public.trip_lines (trip_id);
create index if not exists trip_lines_account_id_idx on public.trip_lines (account_id);
create index if not exists trip_lines_store_id_idx on public.trip_lines (store_id);

-- ============================================================
-- Триггер updated_at для обеих таблиц
-- ============================================================

drop trigger if exists trips_set_updated_at on public.trips;
create trigger trips_set_updated_at
before update on public.trips
for each row
execute function public.set_updated_at();

drop trigger if exists trip_lines_set_updated_at on public.trip_lines;
create trigger trip_lines_set_updated_at
before update on public.trip_lines
for each row
execute function public.set_updated_at();

-- ============================================================
-- Триггер: автозаполнение arrival_date при статусе "Прибыл"
-- ============================================================

drop trigger if exists trip_lines_handle_arrival_date_insert on public.trip_lines;
create trigger trip_lines_handle_arrival_date_insert
before insert on public.trip_lines
for each row
execute function public.handle_arrival_date();

drop trigger if exists trip_lines_handle_arrival_date_update on public.trip_lines;
create trigger trip_lines_handle_arrival_date_update
before update on public.trip_lines
for each row
execute function public.handle_arrival_date();

-- ============================================================
-- RPC: создать рейс с авто-номером внутри аккаунта
-- ============================================================

create or replace function public.create_trip(
  p_account_id uuid,
  p_carrier text,
  p_departure_date date default null,
  p_status text default 'Формируется',
  p_payment_status text default 'Не оплачено',
  p_comment text default ''
)
returns public.trips
language plpgsql
security definer
as $$
declare
  next_trip_number integer;
  created_trip public.trips;
begin
  select coalesce(
    (select trip_number from public.trips
     where account_id = p_account_id
     order by trip_number desc
     limit 1
     for update),
  0) + 1
    into next_trip_number;

  insert into public.trips (
    account_id,
    trip_number,
    carrier,
    departure_date,
    status,
    payment_status,
    comment
  )
  values (
    p_account_id,
    next_trip_number,
    p_carrier,
    p_departure_date,
    p_status,
    p_payment_status,
    coalesce(p_comment, '')
  )
  returning * into created_trip;

  return created_trip;
end;
$$;

-- ============================================================
-- RPC: добавить строку в рейс с авто-номером внутри магазина
-- ============================================================

create or replace function public.add_trip_line(
  p_trip_id uuid,
  p_account_id uuid,
  p_store_id uuid,
  p_destination_warehouse text,
  p_box_qty integer default 0,
  p_units_qty integer default 0,
  p_units_total integer default 0,
  p_arrived_box_qty integer default 0,
  p_planned_marketplace_delivery_date date default null,
  p_arrival_date date default null,
  p_status text default 'Ожидает отправки',
  p_comment text default ''
)
returns public.trip_lines
language plpgsql
security definer
as $$
declare
  next_shipment_number integer;
  created_line public.trip_lines;
begin
  select coalesce(
    (select shipment_number from public.trip_lines
     where store_id = p_store_id
     order by shipment_number desc
     limit 1
     for update),
  0) + 1
    into next_shipment_number;

  insert into public.trip_lines (
    trip_id,
    account_id,
    store_id,
    shipment_number,
    destination_warehouse,
    box_qty,
    units_qty,
    units_total,
    arrived_box_qty,
    planned_marketplace_delivery_date,
    arrival_date,
    status,
    comment
  )
  values (
    p_trip_id,
    p_account_id,
    p_store_id,
    next_shipment_number,
    p_destination_warehouse,
    p_box_qty,
    p_units_qty,
    p_units_total,
    p_arrived_box_qty,
    p_planned_marketplace_delivery_date,
    p_arrival_date,
    p_status,
    coalesce(p_comment, '')
  )
  returning * into created_line;

  return created_line;
end;
$$;

-- ============================================================
-- RLS
-- ============================================================

alter table public.trips enable row level security;
alter table public.trip_lines enable row level security;

-- trips: просмотр
create policy "members_can_view_trips"
on public.trips
for select
using (
  exists (
    select 1 from public.account_members am
    where am.account_id = trips.account_id
      and am.user_id = auth.uid()
  )
);

-- trips: управление (owner / admin / manager / operator)
create policy "members_manage_trips"
on public.trips
for all
using (
  exists (
    select 1 from public.account_members am
    where am.account_id = trips.account_id
      and am.user_id = auth.uid()
      and am.role in ('owner', 'admin', 'manager', 'operator')
  )
)
with check (
  exists (
    select 1 from public.account_members am
    where am.account_id = trips.account_id
      and am.user_id = auth.uid()
      and am.role in ('owner', 'admin', 'manager', 'operator')
  )
);

-- trip_lines: просмотр
create policy "members_can_view_trip_lines"
on public.trip_lines
for select
using (
  exists (
    select 1 from public.account_members am
    where am.account_id = trip_lines.account_id
      and am.user_id = auth.uid()
  )
);

-- trip_lines: управление
create policy "members_manage_trip_lines"
on public.trip_lines
for all
using (
  exists (
    select 1 from public.account_members am
    where am.account_id = trip_lines.account_id
      and am.user_id = auth.uid()
      and am.role in ('owner', 'admin', 'manager', 'operator')
  )
)
with check (
  exists (
    select 1 from public.account_members am
    where am.account_id = trip_lines.account_id
      and am.user_id = auth.uid()
      and am.role in ('owner', 'admin', 'manager', 'operator')
  )
);
