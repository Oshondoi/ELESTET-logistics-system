-- ============================================================
-- Добавляем payment_status в trip_lines
-- Запустить один раз в Supabase SQL Editor
-- ============================================================

alter table public.trip_lines
  add column if not exists payment_status text not null default 'Не оплачено'
    check (payment_status in ('Не оплачено', 'Частично оплачено', 'Оплачено'));

-- Обновляем RPC add_trip_line: добавляем параметр payment_status
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
    payment_status,
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
    p_payment_status,
    coalesce(p_comment, '')
  )
  returning * into created_line;

  return created_line;
end;
$$;
