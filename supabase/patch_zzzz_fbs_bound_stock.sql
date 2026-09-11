-- Canonical FBS stock model: a unit is either inside a fulfillment box or
-- physically taken from that box and bound to one WB order.
-- WB statuses never remove or restore fulfillment-box stock.

begin;

alter table public.fbs_stock_allocations
  add column if not exists stock_removed_at timestamptz,
  add column if not exists source_wms_warehouse_id uuid references public.wms_warehouses(id) on delete set null,
  add column if not exists returned_box_item_id uuid references public.fulfillment_box_items(id) on delete set null,
  add column if not exists returned_box_id uuid references public.fulfillment_boxes(id) on delete set null,
  add column if not exists returned_wms_warehouse_id uuid references public.wms_warehouses(id) on delete set null,
  add column if not exists returned_by uuid references auth.users(id) on delete set null,
  add column if not exists return_note text,
  add column if not exists requires_review boolean not null default false,
  add column if not exists review_reason text;

create index if not exists idx_fbs_stock_allocations_source_warehouse_active
  on public.fbs_stock_allocations(source_wms_warehouse_id, status, product_barcode);

-- The previous trigger required box qty to include active reservations. The
-- new model removes a bound unit from the box immediately, so that invariant
-- must be removed before the one-time conversion below.
drop trigger if exists protect_reserved_fulfillment_stock_trigger on public.fulfillment_box_items;

-- Remember the source warehouse for existing audit rows. A current WMS
-- placement wins; an unplaced box falls back to the warehouse of its batch.
with allocation_warehouses as (
  select allocation.id,
    coalesce(placement.warehouse_id, batch.wms_warehouse_id) as warehouse_id
  from public.fbs_stock_allocations allocation
  left join public.fulfillment_box_items item on item.id = allocation.box_item_id
  left join public.fulfillment_boxes box on box.id = item.box_id
  left join public.fulfillment_supplies supply on supply.id = box.supply_id
  left join public.fulfillment_batches batch on batch.id = supply.batch_id
  left join lateral (
    select warehouse.id as warehouse_id
    from public.wms_cell_items cell_item
    join public.wms_cells cell on cell.id = cell_item.cell_id
    join public.wms_zones zone on zone.id = cell.zone_id
    join public.wms_warehouses warehouse on warehouse.id = zone.warehouse_id
    where cell_item.fulfillment_box_id = box.id
    order by cell_item.updated_at desc, cell_item.created_at desc
    limit 1
  ) placement on true
)
update public.fbs_stock_allocations allocation
set source_wms_warehouse_id = source.warehouse_id
from allocation_warehouses source
where source.id = allocation.id
  and allocation.source_wms_warehouse_id is null;

-- Existing consumed rows were already deducted by the legacy acceptance
-- trigger. Mark them as removed without changing the box a second time.
update public.fbs_stock_allocations
set stock_removed_at = coalesce(stock_removed_at, consumed_at, updated_at, created_at)
where status = 'consumed'
  and stock_removed_at is null;

-- Validate the one-time conversion before touching quantities. Under the old
-- protection trigger every source item had at least this many units.
do $$
declare v_problem text;
begin
  select string_agg(format('%s: нужно %s, в коробе %s', active.box_item_id, active.quantity, item.qty), '; ')
  into v_problem
  from (
    select allocation.box_item_id, sum(allocation.quantity)::integer as quantity
    from public.fbs_stock_allocations allocation
    where allocation.status in ('reserved', 'awaiting_wb')
      and allocation.stock_removed_at is null
    group by allocation.box_item_id
  ) active
  left join public.fulfillment_box_items item on item.id = active.box_item_id
  where active.box_item_id is null or item.id is null or item.qty < active.quantity;

  if v_problem is not null then
    raise exception 'Нельзя преобразовать активные FBS-привязки: %', v_problem;
  end if;
end;
$$;

with active as (
  select allocation.box_item_id, sum(allocation.quantity)::integer as quantity
  from public.fbs_stock_allocations allocation
  where allocation.status in ('reserved', 'awaiting_wb')
    and allocation.stock_removed_at is null
  group by allocation.box_item_id
)
update public.fulfillment_box_items item
set qty = item.qty - active.quantity
from active
where item.id = active.box_item_id;

update public.fbs_stock_allocations
set stock_removed_at = coalesce(dispatched_at, updated_at, created_at)
where status in ('reserved', 'awaiting_wb')
  and stock_removed_at is null;

-- A bound unit is no longer part of the box quantity. Deleting its source row
-- would destroy the audit trail, but ordinary non-negative qty updates are safe.
create or replace function public.protect_reserved_fulfillment_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.fbs_stock_allocations allocation
    where allocation.box_item_id = old.id
      and allocation.status in ('reserved', 'awaiting_wb')
  ) then
    raise exception 'Нельзя удалить исходный товар короба: он привязан к активному FBS-заказу';
  end if;
  return old;
end;
$$;

create trigger protect_reserved_fulfillment_stock_trigger
before delete on public.fulfillment_box_items
for each row execute function public.protect_reserved_fulfillment_stock();

create or replace function public.reserve_fbs_order_from_box(
  p_store_id uuid,
  p_order_id text,
  p_box_id uuid
)
returns public.fbs_stock_allocations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.fbs_orders%rowtype;
  v_item public.fulfillment_box_items%rowtype;
  v_existing public.fbs_stock_allocations%rowtype;
  v_result public.fbs_stock_allocations%rowtype;
  v_source_warehouse_id uuid;
  v_event text;
  v_scanned_barcode text;
  v_now timestamptz := timezone('utc', now());
begin
  if not public.fbs_can_access_store(p_store_id, 'fbs_assembly') then
    raise exception 'Нет права собирать заказы этого магазина';
  end if;

  select * into v_order
  from public.fbs_orders
  where store_id = p_store_id and wb_order_id = p_order_id
  for update;
  if not found then raise exception 'FBS-заказ не найден'; end if;
  if coalesce(v_order.supplier_status, '') <> 'confirm'
     or coalesce(v_order.wb_system_status, '') <> 'waiting' then
    raise exception 'Взять товар из короба можно только пока заказ находится на сборке';
  end if;

  select session.pending_product_barcode into v_scanned_barcode
  from public.fbs_marking_sessions session
  where session.store_id = p_store_id
    and session.pending_order_id = p_order_id
    and session.active_box_id = p_box_id
    and session.created_by = auth.uid()
    and session.status in ('active', 'partial')
  order by session.last_seen_at desc
  limit 1;

  select item.*
  into v_item
  from public.fulfillment_box_items item
  join public.fulfillment_boxes box on box.id = item.box_id
  join public.fulfillment_supplies supply on supply.id = box.supply_id
  join public.fulfillment_batches batch on batch.id = supply.batch_id
  where box.id = p_box_id
    and item.account_id = v_order.account_id
    and batch.deleted_at is null
    and batch.status <> 'cancelled'
    and not exists (
      select 1 from public.trip_lines shipped_line
      where shipped_line.fulfillment_supply_id = supply.id
        and shipped_line.status = 'Отгружен'
    )
    and item.barcode in (
      select value from jsonb_array_elements_text(coalesce(v_order.skus, '[]'::jsonb)) value
    )
    and (v_scanned_barcode is null or item.barcode = v_scanned_barcode)
  for update of item;
  if not found then raise exception 'В выбранном коробе нет товара этого заказа'; end if;

  select coalesce(placement.warehouse_id, batch.wms_warehouse_id)
  into v_source_warehouse_id
  from public.fulfillment_boxes box
  join public.fulfillment_supplies supply on supply.id = box.supply_id
  join public.fulfillment_batches batch on batch.id = supply.batch_id
  left join lateral (
    select warehouse.id as warehouse_id
    from public.wms_cell_items cell_item
    join public.wms_cells cell on cell.id = cell_item.cell_id
    join public.wms_zones zone on zone.id = cell.zone_id
    join public.wms_warehouses warehouse on warehouse.id = zone.warehouse_id
    where cell_item.fulfillment_box_id = box.id
    order by cell_item.updated_at desc, cell_item.created_at desc
    limit 1
  ) placement on true
  where box.id = p_box_id;

  if v_source_warehouse_id is null or not exists (
    select 1 from public.wms_warehouses warehouse
    where warehouse.id = v_source_warehouse_id
      and warehouse.account_id = v_order.account_id
      and warehouse.fbs_enabled = true
  ) then
    raise exception 'Короб должен находиться на складе ELESTET с включённым режимом FBS';
  end if;

  select * into v_existing
  from public.fbs_stock_allocations
  where store_id = p_store_id and wb_order_id = p_order_id
  for update;

  if found and v_existing.status = 'consumed' then
    raise exception 'Привязка этого заказа уже закрыта после приёмки Wildberries';
  end if;
  if found and v_existing.status = 'awaiting_wb' then
    raise exception 'Товар уже передан в доставку; менять исходный короб нельзя';
  end if;
  if found and v_existing.status = 'reserved' and v_existing.box_item_id = v_item.id then
    return v_existing;
  end if;
  if v_item.qty < 1 then raise exception 'В выбранном коробе нет свободной единицы'; end if;

  if found and v_existing.status = 'reserved' then
    if v_existing.box_item_id is null or v_existing.stock_removed_at is null then
      raise exception 'У старой привязки повреждён источник; требуется проверка администратором';
    end if;
    update public.fulfillment_box_items
    set qty = qty + v_existing.quantity
    where id = v_existing.box_item_id;
    if not found then raise exception 'Исходный короб старой привязки не найден'; end if;
    v_event := 'moved';
  else
    v_event := 'reserved';
  end if;

  update public.fulfillment_box_items
  set qty = qty - 1
  where id = v_item.id and qty >= 1;
  if not found then raise exception 'В выбранном коробе уже нет свободной единицы'; end if;

  insert into public.fbs_stock_allocations (
    account_id, store_id, wb_order_id, box_item_id, box_id, product_barcode,
    quantity, status, created_by, updated_by, updated_at, stock_removed_at,
    source_wms_warehouse_id, dispatched_at, consumed_at, released_at,
    returned_box_item_id, returned_box_id, returned_wms_warehouse_id,
    returned_by, return_note, requires_review, review_reason,
    last_supplier_status, last_wb_status
  ) values (
    v_order.account_id, p_store_id, p_order_id, v_item.id, p_box_id, v_item.barcode,
    1, 'reserved', auth.uid(), auth.uid(), v_now, v_now,
    v_source_warehouse_id, null, null, null,
    null, null, null, null, null, false, null,
    v_order.supplier_status, v_order.wb_system_status
  )
  on conflict (store_id, wb_order_id) do update set
    box_item_id = excluded.box_item_id,
    box_id = excluded.box_id,
    product_barcode = excluded.product_barcode,
    quantity = 1,
    status = 'reserved',
    updated_by = auth.uid(),
    updated_at = v_now,
    stock_removed_at = v_now,
    source_wms_warehouse_id = excluded.source_wms_warehouse_id,
    dispatched_at = null,
    consumed_at = null,
    released_at = null,
    returned_box_item_id = null,
    returned_box_id = null,
    returned_wms_warehouse_id = null,
    returned_by = null,
    return_note = null,
    requires_review = false,
    review_reason = null,
    last_supplier_status = excluded.last_supplier_status,
    last_wb_status = excluded.last_wb_status
  returning * into v_result;

  insert into public.fbs_stock_allocation_events (
    allocation_id, account_id, store_id, wb_order_id, event_type,
    from_box_item_id, to_box_item_id, actor_id, supplier_status, wb_status
  ) values (
    v_result.id, v_result.account_id, v_result.store_id, v_result.wb_order_id,
    v_event, v_existing.box_item_id, v_item.id, auth.uid(),
    v_order.supplier_status, v_order.wb_system_status
  );

  insert into public.fbs_action_audit(account_id, store_id, user_id, action, details)
  values (
    v_order.account_id, p_store_id, auth.uid(), 'bind_order_stock',
    jsonb_build_object('order_id', p_order_id, 'box_id', p_box_id, 'box_item_id', v_item.id)
  );
  return v_result;
end;
$$;

create or replace function public.receive_fbs_order_bound_stock(
  p_store_id uuid,
  p_order_id text,
  p_target_box_id uuid,
  p_note text default null
)
returns public.fbs_stock_allocations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.fbs_orders%rowtype;
  v_allocation public.fbs_stock_allocations%rowtype;
  v_source_item public.fulfillment_box_items%rowtype;
  v_target_box public.fulfillment_boxes%rowtype;
  v_target_item public.fulfillment_box_items%rowtype;
  v_target_warehouse_id uuid;
  v_now timestamptz := timezone('utc', now());
  v_is_cancelled boolean;
  v_is_accepted boolean;
  v_is_assembly_correction boolean;
begin
  if not public.fbs_can_access_store(p_store_id, 'fbs_assembly') then
    raise exception 'Нет права принимать товары FBS этого магазина';
  end if;

  select * into v_order
  from public.fbs_orders
  where store_id = p_store_id and wb_order_id = p_order_id
  for update;
  if not found then raise exception 'FBS-заказ не найден'; end if;

  select * into v_allocation
  from public.fbs_stock_allocations
  where store_id = p_store_id and wb_order_id = p_order_id
  for update;
  if not found then raise exception 'У заказа нет товара, ранее взятого из короба'; end if;
  if v_allocation.status = 'released' then return v_allocation; end if;
  if v_allocation.status = 'consumed' then
    raise exception 'Wildberries уже принял товар. Его последующий возврат оформляется как новая фактическая приёмка';
  end if;
  if v_allocation.status not in ('reserved', 'awaiting_wb') then
    raise exception 'Активная привязка товара к заказу не найдена';
  end if;

  v_is_accepted := coalesce(v_order.wb_system_status, '') in (
    'sorted', 'ready_for_pickup', 'postponed_delivery', 'accepted_by_carrier',
    'sent_to_carrier', 'sold', 'canceled_by_client', 'defect'
  );
  v_is_cancelled := coalesce(v_order.supplier_status, '') in ('cancel', 'canceled')
    or coalesce(v_order.wb_system_status, '') in ('canceled', 'declined_by_client');
  v_is_assembly_correction := v_allocation.status = 'reserved'
    and coalesce(v_order.supplier_status, '') = 'confirm'
    and coalesce(v_order.wb_system_status, '') = 'waiting';

  if v_is_accepted then
    raise exception 'Wildberries уже подтвердил приёмку товара; возврат по активной FBS-привязке запрещён';
  end if;
  if not v_is_cancelled and not v_is_assembly_correction then
    raise exception 'Вернуть товар можно при исправлении сборки или после официальной отмены заказа';
  end if;

  select box.*
  into v_target_box
  from public.fulfillment_boxes box
  join public.fulfillment_supplies supply on supply.id = box.supply_id
  join public.fulfillment_batches batch on batch.id = supply.batch_id
  where box.id = p_target_box_id
    and box.account_id = v_order.account_id
    and batch.deleted_at is null
    and batch.status <> 'cancelled'
    and not exists (
      select 1 from public.trip_lines shipped_line
      where shipped_line.fulfillment_supply_id = supply.id
        and shipped_line.status = 'Отгружен'
    )
  for update of box;
  if not found then raise exception 'Целевой короб не найден или уже недоступен для приёмки'; end if;

  select coalesce(placement.warehouse_id, batch.wms_warehouse_id)
  into v_target_warehouse_id
  from public.fulfillment_boxes box
  join public.fulfillment_supplies supply on supply.id = box.supply_id
  join public.fulfillment_batches batch on batch.id = supply.batch_id
  left join lateral (
    select warehouse.id as warehouse_id
    from public.wms_cell_items cell_item
    join public.wms_cells cell on cell.id = cell_item.cell_id
    join public.wms_zones zone on zone.id = cell.zone_id
    join public.wms_warehouses warehouse on warehouse.id = zone.warehouse_id
    where cell_item.fulfillment_box_id = box.id
    order by cell_item.updated_at desc, cell_item.created_at desc
    limit 1
  ) placement on true
  where box.id = p_target_box_id;

  if v_target_warehouse_id is null or not exists (
    select 1 from public.wms_warehouses warehouse
    where warehouse.id = v_target_warehouse_id
      and warehouse.account_id = v_order.account_id
      and warehouse.fbs_enabled = true
  ) then
    raise exception 'Целевой короб должен находиться на складе ELESTET с включённым режимом FBS';
  end if;

  select * into v_source_item
  from public.fulfillment_box_items
  where id = v_allocation.box_item_id;
  if not found then raise exception 'Исходная товарная строка привязки не найдена'; end if;

  insert into public.fulfillment_box_items (
    box_id, account_id, barcode, item_id, product_name, qty
  ) values (
    v_target_box.id, v_order.account_id, v_allocation.product_barcode,
    v_source_item.item_id, v_source_item.product_name, v_allocation.quantity
  )
  on conflict (box_id, barcode) do update set
    qty = fulfillment_box_items.qty + excluded.qty,
    item_id = coalesce(fulfillment_box_items.item_id, excluded.item_id),
    product_name = coalesce(fulfillment_box_items.product_name, excluded.product_name)
  returning * into v_target_item;

  update public.fbs_stock_allocations
  set status = 'released',
      released_at = v_now,
      updated_at = v_now,
      updated_by = auth.uid(),
      returned_box_item_id = v_target_item.id,
      returned_box_id = p_target_box_id,
      returned_wms_warehouse_id = v_target_warehouse_id,
      returned_by = auth.uid(),
      return_note = nullif(btrim(coalesce(p_note, '')), ''),
      last_supplier_status = v_order.supplier_status,
      last_wb_status = v_order.wb_system_status
  where id = v_allocation.id
    and status in ('reserved', 'awaiting_wb')
  returning * into v_allocation;
  if not found then raise exception 'Привязка уже была закрыта другим действием'; end if;

  insert into public.fbs_stock_allocation_events (
    allocation_id, account_id, store_id, wb_order_id, event_type,
    from_box_item_id, to_box_item_id, actor_id, supplier_status, wb_status
  ) values (
    v_allocation.id, v_allocation.account_id, v_allocation.store_id,
    v_allocation.wb_order_id, 'released', v_allocation.box_item_id,
    v_target_item.id, auth.uid(), v_order.supplier_status, v_order.wb_system_status
  );

  insert into public.fbs_action_audit(account_id, store_id, user_id, action, details)
  values (
    v_order.account_id, p_store_id, auth.uid(), 'receive_bound_order_stock',
    jsonb_build_object(
      'order_id', p_order_id,
      'source_box_id', v_allocation.box_id,
      'target_box_id', p_target_box_id,
      'target_box_item_id', v_target_item.id
    )
  );
  return v_allocation;
end;
$$;

-- Backward-compatible action used by the assembly modal: it is now a real
-- manual return to the exact source box, not a bookkeeping-only unreserve.
create or replace function public.release_fbs_order_box_reservation(
  p_store_id uuid,
  p_order_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_box_id uuid;
begin
  select allocation.box_id into v_box_id
  from public.fbs_stock_allocations allocation
  where allocation.store_id = p_store_id
    and allocation.wb_order_id = p_order_id
    and allocation.status = 'reserved';
  if v_box_id is null then raise exception 'Активная привязка товара не найдена'; end if;
  perform public.receive_fbs_order_bound_stock(
    p_store_id,
    p_order_id,
    v_box_id,
    'Ручной возврат в исходный короб во время сборки'
  );
  return true;
end;
$$;

create or replace function public.reconcile_fbs_stock_allocation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allocation public.fbs_stock_allocations%rowtype;
  v_now timestamptz := timezone('utc', now());
  v_next_status text;
  v_is_accepted boolean;
begin
  select * into v_allocation
  from public.fbs_stock_allocations
  where store_id = new.store_id and wb_order_id = new.wb_order_id
  for update;
  if not found then return new; end if;

  v_is_accepted := coalesce(new.wb_system_status, '') in (
    'sorted', 'ready_for_pickup', 'postponed_delivery', 'accepted_by_carrier',
    'sent_to_carrier', 'sold', 'canceled_by_client', 'defect'
  );

  if v_allocation.status = 'released' then
    if v_is_accepted then
      update public.fbs_stock_allocations
      set requires_review = true,
          review_reason = 'WB подтвердил приёмку после ручного возврата товара в короб',
          updated_at = v_now,
          last_supplier_status = new.supplier_status,
          last_wb_status = new.wb_system_status
      where id = v_allocation.id;
    end if;
    return new;
  end if;

  if v_allocation.status = 'consumed' then
    update public.fbs_stock_allocations
    set updated_at = v_now,
        last_supplier_status = new.supplier_status,
        last_wb_status = new.wb_system_status
    where id = v_allocation.id;
    return new;
  end if;

  -- Cancellation changes only the order. The detached physical unit remains
  -- bound until an operator actually receives it into a chosen box.
  if coalesce(new.supplier_status, '') in ('cancel', 'canceled')
     or coalesce(new.wb_system_status, '') in ('canceled', 'declined_by_client') then
    update public.fbs_stock_allocations
    set updated_at = v_now,
        last_supplier_status = new.supplier_status,
        last_wb_status = new.wb_system_status
    where id = v_allocation.id;
    return new;
  elsif v_is_accepted then
    v_next_status := 'consumed';
  elsif coalesce(new.supplier_status, '') = 'complete'
        and coalesce(new.wb_system_status, '') = 'waiting' then
    v_next_status := 'awaiting_wb';
  else
    return new;
  end if;

  if v_next_status = 'consumed' then
    update public.fbs_stock_allocations
    set status = 'consumed',
        consumed_at = coalesce(consumed_at, v_now),
        updated_at = v_now,
        requires_review = stock_removed_at is null,
        review_reason = case when stock_removed_at is null
          then 'WB принял заказ, но у привязки нет подтверждения списания из короба'
          else review_reason end,
        last_supplier_status = new.supplier_status,
        last_wb_status = new.wb_system_status
    where id = v_allocation.id
      and status in ('reserved', 'awaiting_wb');
    if not found then return new; end if;
  else
    update public.fbs_stock_allocations
    set status = 'awaiting_wb',
        dispatched_at = coalesce(dispatched_at, v_now),
        updated_at = v_now,
        last_supplier_status = new.supplier_status,
        last_wb_status = new.wb_system_status
    where id = v_allocation.id and status = 'reserved';
    if not found then return new; end if;
  end if;

  insert into public.fbs_stock_allocation_events (
    allocation_id, account_id, store_id, wb_order_id, event_type,
    from_box_item_id, to_box_item_id, supplier_status, wb_status
  ) values (
    v_allocation.id, v_allocation.account_id, v_allocation.store_id,
    v_allocation.wb_order_id, v_next_status, v_allocation.box_item_id,
    v_allocation.box_item_id, new.supplier_status, new.wb_system_status
  );
  return new;
end;
$$;

drop trigger if exists reconcile_fbs_stock_allocation_trigger on public.fbs_orders;
create trigger reconcile_fbs_stock_allocation_trigger
after insert or update of supplier_status, wb_system_status on public.fbs_orders
for each row execute function public.reconcile_fbs_stock_allocation();

-- Product-location compatibility RPC. `quantity` and `physical_quantity` now
-- both mean units still present in that box. Active bindings are informational
-- counters only and are never subtracted a second time.
drop function if exists public.get_fbs_product_locations(uuid, text[]);
create function public.get_fbs_product_locations(
  p_account_id uuid,
  p_barcodes text[]
)
returns table (
  product_barcode text, quantity integer, physical_quantity integer,
  reserved_quantity integer, awaiting_quantity integer, box_item_id uuid,
  batch_id uuid, batch_number bigint, batch_name text, supply_id uuid,
  supply_number integer, box_id uuid, box_number integer, box_barcode text,
  warehouse_name text, rack_name text, side_name text, pallet_address text,
  slot_number integer, address_code text, address_text text, is_addressed boolean,
  fbs_eligible boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    item.barcode,
    item.qty::integer,
    item.qty::integer,
    binding.reserved::integer,
    binding.awaiting::integer,
    item.id,
    batch.id,
    batch.short_id::bigint,
    batch.name,
    supply.id,
    supply.supply_number::integer,
    box.id,
    box.box_number::integer,
    box.barcode,
    placement.warehouse_name,
    placement.rack_name,
    placement.side_name,
    placement.pallet_address,
    placement.slot_number,
    placement.address_code,
    placement.address_text,
    placement.item_id is not null,
    coalesce(stock_warehouse.fbs_enabled, false)
  from public.fulfillment_box_items item
  join public.fulfillment_boxes box on box.id = item.box_id
  join public.fulfillment_supplies supply on supply.id = box.supply_id
  join public.fulfillment_batches batch on batch.id = supply.batch_id
  left join lateral (
    select
      coalesce(sum(allocation.quantity) filter (where allocation.status = 'reserved'), 0)::integer as reserved,
      coalesce(sum(allocation.quantity) filter (where allocation.status = 'awaiting_wb'), 0)::integer as awaiting
    from public.fbs_stock_allocations allocation
    where allocation.box_item_id = item.id
  ) binding on true
  left join lateral (
    select
      cell_item.id as item_id,
      warehouse.id as warehouse_id,
      warehouse.name as warehouse_name,
      warehouse.fbs_enabled,
      rack.name as rack_name,
      side.name as side_name,
      cell.col || cell.row::text as pallet_address,
      cell_item.slot_number,
      format('C%s_W%s_R%s_F%s_%s%s_K%s', account.short_id, warehouse.short_id,
        rack.short_id, side.position + 1, cell.col, cell.row, cell_item.slot_number) as address_code,
      format('%s / %s / %s / %s%s-K%s', warehouse.name, rack.name, side.name,
        cell.col, cell.row, cell_item.slot_number) as address_text
    from public.wms_cell_items cell_item
    join public.wms_cells cell on cell.id = cell_item.cell_id
    join public.wms_zone_sides side on side.id = cell_item.side_id
    join public.wms_zones rack on rack.id = cell.zone_id
    join public.wms_warehouses warehouse on warehouse.id = rack.warehouse_id
    join public.accounts account on account.id = cell_item.account_id
    where cell_item.fulfillment_box_id = box.id
    order by cell_item.updated_at desc, cell_item.created_at desc
    limit 1
  ) placement on true
  left join public.wms_warehouses stock_warehouse
    on stock_warehouse.id = coalesce(placement.warehouse_id, batch.wms_warehouse_id)
   and stock_warehouse.account_id = p_account_id
  where item.account_id = p_account_id
    and item.barcode = any(coalesce(p_barcodes, array[]::text[]))
    and batch.deleted_at is null
    and batch.status <> 'cancelled'
    and not exists (
      select 1 from public.trip_lines shipped_line
      where shipped_line.fulfillment_supply_id = supply.id
        and shipped_line.status = 'Отгружен'
    )
    and exists (
      select 1 from public.stores store
      where store.account_id = p_account_id
        and public.fbs_can_access_store(store.id, 'fbs_view')
    )
  order by item.barcode, placement.item_id is null, batch.short_id, supply.supply_number, box.box_number;
$$;

-- New warehouse-specific source for "Подставить из ELESTET". The legacy RPC
-- is kept untouched for a safe frontend rollout.
create or replace function public.get_fbs_stock_catalog_for_warehouse(
  p_account_id uuid,
  p_store_id uuid,
  p_wms_warehouse_id uuid
)
returns table (
  product_id uuid, nm_id bigint, chrt_id bigint, barcode text, tech_size text,
  product_name text, vendor_code text, brand text, color text, photo_url text,
  physical_quantity integer, reserved_quantity integer, awaiting_quantity integer,
  available_quantity integer, unassigned_quantity integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.stores store
    where store.id = p_store_id
      and store.account_id = p_account_id
      and public.fbs_can_access_store(store.id, 'fbs_view')
  ) then raise exception 'Нет доступа к FBS-остаткам этого магазина'; end if;

  if not exists (
    select 1 from public.wms_warehouses warehouse
    where warehouse.id = p_wms_warehouse_id
      and warehouse.account_id = p_account_id
      and warehouse.fbs_enabled = true
  ) then raise exception 'Выберите склад ELESTET с включённым режимом FBS'; end if;

  return query
  with box_inventory as (
    select item.barcode,
      coalesce(placement.warehouse_id, batch.wms_warehouse_id) as warehouse_id,
      sum(item.qty)::integer as in_boxes
    from public.fulfillment_box_items item
    join public.fulfillment_boxes box on box.id = item.box_id
    join public.fulfillment_supplies supply on supply.id = box.supply_id
    join public.fulfillment_batches batch on batch.id = supply.batch_id
    left join lateral (
      select warehouse.id as warehouse_id
      from public.wms_cell_items cell_item
      join public.wms_cells cell on cell.id = cell_item.cell_id
      join public.wms_zones zone on zone.id = cell.zone_id
      join public.wms_warehouses warehouse on warehouse.id = zone.warehouse_id
      where cell_item.fulfillment_box_id = box.id
      order by cell_item.updated_at desc, cell_item.created_at desc
      limit 1
    ) placement on true
    where batch.account_id = p_account_id
      and batch.deleted_at is null
      and batch.status <> 'cancelled'
      and not exists (
        select 1 from public.trip_lines shipped_line
        where shipped_line.fulfillment_supply_id = supply.id
          and shipped_line.status = 'Отгружен'
      )
    group by item.barcode, coalesce(placement.warehouse_id, batch.wms_warehouse_id)
  ), bindings as (
    select allocation.product_barcode as barcode,
      coalesce(sum(allocation.quantity) filter (where allocation.status = 'reserved'), 0)::integer as reserved,
      coalesce(sum(allocation.quantity) filter (where allocation.status = 'awaiting_wb'), 0)::integer as awaiting
    from public.fbs_stock_allocations allocation
    where allocation.account_id = p_account_id
      and allocation.status in ('reserved', 'awaiting_wb')
    group by allocation.product_barcode
  ), variants as (
    select product.id as product_id, product.nm_id,
      nullif(coalesce(size_item.value ->> 'chrtID', size_item.value ->> 'chrtId'), '')::bigint as chrt_id,
      coalesce(size_item.value ->> 'techSize', '—') as tech_size,
      array(
        select jsonb_array_elements_text(
          case when jsonb_typeof(size_item.value -> 'skus') = 'array'
            then size_item.value -> 'skus' else '[]'::jsonb end
        )
      ) as skus,
      product.name as product_name, product.vendor_code, product.brand, product.color,
      case when jsonb_typeof(product.photos) = 'array' and jsonb_array_length(product.photos) > 0
        then coalesce(product.photos -> 0 ->> 'c246x328', product.photos -> 0 ->> 'big')
        else null end as photo_url
    from public.products product
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(product.sizes) = 'array' then product.sizes else '[]'::jsonb end
    ) size_item
    where product.account_id = p_account_id and product.store_id = p_store_id
  )
  select variant.product_id, variant.nm_id, variant.chrt_id,
    coalesce(variant.skus[1], ''), variant.tech_size, variant.product_name,
    variant.vendor_code, variant.brand, variant.color, variant.photo_url,
    coalesce(inventory.in_boxes, 0)::integer,
    coalesce(binding.reserved, 0)::integer,
    coalesce(binding.awaiting, 0)::integer,
    coalesce(inventory.in_boxes, 0)::integer,
    coalesce(unassigned.in_boxes, 0)::integer
  from variants variant
  left join lateral (
    select sum(stock.in_boxes)::integer as in_boxes
    from box_inventory stock
    where stock.barcode = any(variant.skus)
      and stock.warehouse_id = p_wms_warehouse_id
  ) inventory on true
  left join lateral (
    select sum(stock.in_boxes)::integer as in_boxes
    from box_inventory stock
    where stock.barcode = any(variant.skus)
      and stock.warehouse_id is null
  ) unassigned on true
  left join lateral (
    select sum(active.reserved)::integer as reserved,
      sum(active.awaiting)::integer as awaiting
    from bindings active
    where active.barcode = any(variant.skus)
  ) binding on true
  where variant.chrt_id is not null
  order by variant.product_name, variant.tech_size, variant.chrt_id;
end;
$$;

revoke all on function public.reserve_fbs_order_from_box(uuid, text, uuid) from public, anon;
grant execute on function public.reserve_fbs_order_from_box(uuid, text, uuid) to authenticated;
revoke all on function public.receive_fbs_order_bound_stock(uuid, text, uuid, text) from public, anon;
grant execute on function public.receive_fbs_order_bound_stock(uuid, text, uuid, text) to authenticated;
revoke all on function public.release_fbs_order_box_reservation(uuid, text) from public, anon;
grant execute on function public.release_fbs_order_box_reservation(uuid, text) to authenticated;
revoke all on function public.reconcile_fbs_stock_allocation() from public, anon, authenticated;
revoke all on function public.protect_reserved_fulfillment_stock() from public, anon, authenticated;
revoke all on function public.get_fbs_product_locations(uuid, text[]) from public, anon;
grant execute on function public.get_fbs_product_locations(uuid, text[]) to authenticated;
revoke all on function public.get_fbs_stock_catalog_for_warehouse(uuid, uuid, uuid) from public, anon;
grant execute on function public.get_fbs_stock_catalog_for_warehouse(uuid, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
