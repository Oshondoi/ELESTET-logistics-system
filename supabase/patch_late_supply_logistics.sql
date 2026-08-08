-- Безопасная передача поставки, созданной после завершения партии, в логистику.
-- Связь с fulfillment_supply делает операцию идемпотентной, а триггеры
-- поддерживают количество коробов и единиц актуальным после передачи.

alter table public.trip_lines
  add column if not exists fulfillment_supply_id uuid
    references public.fulfillment_supplies(id) on delete set null;

create unique index if not exists trip_lines_fulfillment_supply_uidx
  on public.trip_lines(fulfillment_supply_id)
  where fulfillment_supply_id is not null;

with links as (
  select distinct on (s.trip_line_id)
    s.trip_line_id,
    s.id as supply_id
  from public.fulfillment_supplies s
  where s.trip_line_id is not null
  order by s.trip_line_id, s.created_at, s.id
)
update public.trip_lines tl
set fulfillment_supply_id = links.supply_id
from links
where tl.id = links.trip_line_id
  and tl.fulfillment_supply_id is null;

create or replace function public.refresh_fulfillment_supply_logistics_counts(
  p_supply_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip_line_id uuid;
  v_box_qty integer;
  v_units_qty integer;
begin
  select trip_line_id into v_trip_line_id
  from public.fulfillment_supplies
  where id = p_supply_id;

  if v_trip_line_id is null then
    return;
  end if;

  select
    count(distinct b.id)::integer,
    coalesce(sum(bi.qty), 0)::integer
  into v_box_qty, v_units_qty
  from public.fulfillment_boxes b
  left join public.fulfillment_box_items bi on bi.box_id = b.id
  where b.supply_id = p_supply_id;

  update public.trip_lines
  set
    box_qty = v_box_qty,
    units_qty = v_units_qty,
    units_total = v_units_qty
  where id = v_trip_line_id;
end;
$$;

create or replace function public.on_fulfillment_box_refresh_logistics()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('DELETE', 'UPDATE') then
    perform public.refresh_fulfillment_supply_logistics_counts(old.supply_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op <> 'UPDATE' or new.supply_id is distinct from old.supply_id) then
    perform public.refresh_fulfillment_supply_logistics_counts(new.supply_id);
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists fulfillment_boxes_refresh_logistics on public.fulfillment_boxes;
create trigger fulfillment_boxes_refresh_logistics
after insert or update of supply_id or delete on public.fulfillment_boxes
for each row execute function public.on_fulfillment_box_refresh_logistics();

create or replace function public.on_fulfillment_box_item_refresh_logistics()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_supply_id uuid;
  v_new_supply_id uuid;
begin
  if tg_op in ('DELETE', 'UPDATE') then
    select supply_id into v_old_supply_id
    from public.fulfillment_boxes
    where id = old.box_id;
    if v_old_supply_id is not null then
      perform public.refresh_fulfillment_supply_logistics_counts(v_old_supply_id);
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') and (tg_op <> 'UPDATE' or new.box_id is distinct from old.box_id) then
    select supply_id into v_new_supply_id
    from public.fulfillment_boxes
    where id = new.box_id;
    if v_new_supply_id is not null then
      perform public.refresh_fulfillment_supply_logistics_counts(v_new_supply_id);
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists fulfillment_box_items_refresh_logistics on public.fulfillment_box_items;
create trigger fulfillment_box_items_refresh_logistics
after insert or update of qty, box_id or delete on public.fulfillment_box_items
for each row execute function public.on_fulfillment_box_item_refresh_logistics();

create or replace function public.transfer_fulfillment_supply_to_logistics(
  p_supply_id uuid,
  p_trip_id uuid
)
returns public.trip_lines
language plpgsql
security definer
set search_path = public
as $$
declare
  v_supply public.fulfillment_supplies%rowtype;
  v_batch public.fulfillment_batches%rowtype;
  v_trip public.trips%rowtype;
  v_line public.trip_lines%rowtype;
  v_box_qty integer;
  v_units_qty integer;
  v_next_shipment_number integer;
  v_reception_date date;
begin
  select * into v_supply
  from public.fulfillment_supplies
  where id = p_supply_id
  for update;

  if not found then
    raise exception 'Поставка не найдена';
  end if;

  if not exists (
    select 1 from public.account_members am
    where am.account_id = v_supply.account_id
      and am.user_id = auth.uid()
  ) then
    raise exception 'Нет доступа к поставке';
  end if;

  if v_supply.trip_line_id is not null then
    select * into v_line from public.trip_lines where id = v_supply.trip_line_id;
    if found then
      return v_line;
    end if;
  end if;

  select * into v_batch
  from public.fulfillment_batches
  where id = v_supply.batch_id;

  if v_batch.store_id is null then
    raise exception 'У партии не выбран магазин';
  end if;

  if v_batch.status <> 'done' or not v_batch.stage_logistics then
    raise exception 'Ручная передача доступна только для завершённой партии с этапом логистики';
  end if;

  select * into v_trip
  from public.trips
  where id = p_trip_id
    and account_id = v_supply.account_id;

  if not found then
    raise exception 'Рейс не найден';
  end if;

  if v_trip.status <> 'Формируется' then
    raise exception 'Передавать поставки можно только в формирующийся рейс';
  end if;

  select count(*)::integer into v_box_qty
  from public.fulfillment_boxes
  where supply_id = v_supply.id;

  if v_box_qty = 0 then
    raise exception 'В поставке нет коробов';
  end if;

  select coalesce(sum(bi.qty), 0)::integer into v_units_qty
  from public.fulfillment_boxes b
  join public.fulfillment_box_items bi on bi.box_id = b.id
  where b.supply_id = v_supply.id;

  select completed_at::date into v_reception_date
  from public.fulfillment_stage_logs
  where batch_id = v_supply.batch_id
    and stage = 'reception'
  order by completed_at desc
  limit 1;

  perform pg_advisory_xact_lock(hashtext('trip_line_number'), hashtext(v_supply.account_id::text));

  select coalesce(max(shipment_number), 0) + 1
  into v_next_shipment_number
  from public.trip_lines
  where account_id = v_supply.account_id;

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
    weight,
    reception_date,
    status,
    payment_status,
    comment,
    fulfillment_batch_id,
    fulfillment_supply_id
  ) values (
    v_trip.id,
    v_supply.account_id,
    v_batch.store_id,
    v_next_shipment_number,
    v_supply.warehouse_name,
    v_box_qty,
    v_units_qty,
    v_units_qty,
    0,
    v_supply.weight,
    v_reception_date,
    'Ожидает отправки',
    'Не оплачено',
    '',
    v_supply.batch_id,
    v_supply.id
  )
  returning * into v_line;

  update public.fulfillment_supplies
  set trip_id = v_trip.id, trip_line_id = v_line.id
  where id = v_supply.id;

  return v_line;
end;
$$;

revoke all on function public.refresh_fulfillment_supply_logistics_counts(uuid) from public;
revoke all on function public.transfer_fulfillment_supply_to_logistics(uuid, uuid) from public;
grant execute on function public.transfer_fulfillment_supply_to_logistics(uuid, uuid) to authenticated;
