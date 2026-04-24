-- ============================================================
-- Всё в одном: колонки reception_date, shipped_date,
-- payment_status, глобальная нумерация и обновлённая функция
-- Запустить один раз в Supabase SQL Editor
-- ============================================================

-- 1. Колонки
alter table public.trip_lines
  add column if not exists payment_status text not null default 'Не оплачено'
    check (payment_status in ('Не оплачено', 'Частично оплачено', 'Оплачено'));

alter table public.trip_lines
  add column if not exists reception_date date null;

alter table public.trip_lines
  add column if not exists shipped_date date null;

alter table public.trip_lines
  add column if not exists weight numeric(10,2) null;

-- 2. Глобальная нумерация: убираем старый constraint, добавляем новый
alter table public.trip_lines
  drop constraint if exists trip_lines_store_id_shipment_number_key;

alter table public.trip_lines
  drop constraint if exists trip_lines_account_id_shipment_number_key;

alter table public.trip_lines
  add constraint trip_lines_account_id_shipment_number_key
  unique (account_id, shipment_number);

-- 3. Пересчитываем существующие shipment_number глобально по account_id
do $$
declare
  r record;
  counter integer;
  prev_account uuid := null;
begin
  for r in
    select id, account_id
    from public.trip_lines
    order by account_id, created_at
  loop
    if r.account_id is distinct from prev_account then
      counter := 1;
      prev_account := r.account_id;
    else
      counter := counter + 1;
    end if;
    update public.trip_lines set shipment_number = counter where id = r.id;
  end loop;
end;
$$;

-- 4. Обновлённая функция add_trip_line с reception_date, shipped_date, payment_status
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
  p_reception_date date default null,
  p_shipped_date date default null,
  p_weight numeric default null,
  p_status text default 'Ожидает отправки',
  p_payment_status text default 'Не оплачено',
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
     where account_id = p_account_id
     order by shipment_number desc
     limit 1
     for update),
  0) + 1
    into next_shipment_number;

  insert into public.trip_lines (
    trip_id, account_id, store_id, shipment_number,
    destination_warehouse, box_qty, units_qty, units_total,
    arrived_box_qty, planned_marketplace_delivery_date,
    arrival_date, reception_date, shipped_date, weight,
    status, payment_status, comment
  )
  values (
    p_trip_id, p_account_id, p_store_id, next_shipment_number,
    p_destination_warehouse, p_box_qty, p_units_qty, p_units_total,
    p_arrived_box_qty, p_planned_marketplace_delivery_date,
    p_arrival_date, p_reception_date, p_shipped_date, p_weight,
    p_status, p_payment_status,
    coalesce(p_comment, '')
  )
  returning * into created_line;

  return created_line;
end;
$$;
