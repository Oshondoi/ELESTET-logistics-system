-- FBS stock reservations by an exact fulfillment box.
-- Physical stock is changed only after WB confirms acceptance of the order.

create table if not exists public.fbs_stock_allocations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  wb_order_id text not null,
  box_item_id uuid references public.fulfillment_box_items(id) on delete set null,
  box_id uuid references public.fulfillment_boxes(id) on delete set null,
  product_barcode text not null,
  quantity integer not null default 1 check (quantity > 0),
  status text not null default 'reserved'
    check (status in ('reserved', 'awaiting_wb', 'consumed', 'released')),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  dispatched_at timestamptz,
  consumed_at timestamptz,
  released_at timestamptz,
  last_supplier_status text,
  last_wb_status text,
  unique (store_id, wb_order_id)
);

create table if not exists public.fbs_stock_allocation_events (
  id bigint generated always as identity primary key,
  allocation_id uuid not null references public.fbs_stock_allocations(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  wb_order_id text not null,
  event_type text not null
    check (event_type in ('reserved', 'moved', 'awaiting_wb', 'consumed', 'released')),
  from_box_item_id uuid,
  to_box_item_id uuid,
  actor_id uuid references auth.users(id) on delete set null,
  supplier_status text,
  wb_status text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_fbs_stock_allocations_box_active
  on public.fbs_stock_allocations(box_item_id, status);
create index if not exists idx_fbs_stock_allocations_store_status
  on public.fbs_stock_allocations(store_id, status);
create index if not exists idx_fbs_stock_events_order
  on public.fbs_stock_allocation_events(store_id, wb_order_id, created_at desc);

alter table public.fbs_stock_allocations enable row level security;
alter table public.fbs_stock_allocation_events enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'fbs_stock_allocations'
  ) then
    alter publication supabase_realtime add table public.fbs_stock_allocations;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'fulfillment_box_items'
  ) then
    alter publication supabase_realtime add table public.fulfillment_box_items;
  end if;
end;
$$;

drop policy if exists "members_view_fbs_stock_allocations" on public.fbs_stock_allocations;
create policy "members_view_fbs_stock_allocations"
  on public.fbs_stock_allocations for select
  using (exists (
    select 1 from public.account_members member
    where member.account_id = fbs_stock_allocations.account_id
      and member.user_id = auth.uid()
  ));

drop policy if exists "members_view_fbs_stock_allocation_events" on public.fbs_stock_allocation_events;
create policy "members_view_fbs_stock_allocation_events"
  on public.fbs_stock_allocation_events for select
  using (exists (
    select 1 from public.account_members member
    where member.account_id = fbs_stock_allocation_events.account_id
      and member.user_id = auth.uid()
  ));

-- Zero is a valid physical balance after the last unit is accepted by WB.
alter table public.fulfillment_box_items
  drop constraint if exists fulfillment_box_items_qty_check;
alter table public.fulfillment_box_items
  add constraint fulfillment_box_items_qty_check check (qty >= 0);

create or replace function public.protect_reserved_fulfillment_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active integer;
begin
  select coalesce(sum(quantity), 0)::integer
  into v_active
  from public.fbs_stock_allocations
  where box_item_id = old.id
    and status in ('reserved', 'awaiting_wb');

  if tg_op = 'DELETE' and v_active > 0 then
    raise exception 'Нельзя удалить товар: % шт. зарезервировано для FBS', v_active;
  end if;
  if tg_op = 'UPDATE' and new.qty < v_active then
    raise exception 'Нельзя уменьшить остаток ниже активного резерва FBS: % шт.', v_active;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists protect_reserved_fulfillment_stock_trigger on public.fulfillment_box_items;
create trigger protect_reserved_fulfillment_stock_trigger
before update of qty or delete on public.fulfillment_box_items
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
  v_active integer;
  v_event text;
  v_scanned_barcode text;
begin
  select * into v_order
  from public.fbs_orders
  where store_id = p_store_id and wb_order_id = p_order_id
  for update;

  if not found then raise exception 'Заказ FBS не найден'; end if;
  if not exists (
    select 1 from public.account_members member
    where member.account_id = v_order.account_id and member.user_id = auth.uid()
  ) then raise exception 'Нет доступа к магазину'; end if;
  if coalesce(v_order.supplier_status, '') <> 'confirm'
     or coalesce(v_order.wb_system_status, '') <> 'waiting' then
    raise exception 'Выбрать короб можно только для заказа на сборке';
  end if;

  -- During marking the session already knows the exact product barcode.
  -- Outside the scanner this remains null and the ordinary box selection
  -- behaviour is unchanged.
  select session.pending_product_barcode into v_scanned_barcode
  from public.fbs_marking_sessions session
  where session.store_id = p_store_id
    and session.pending_order_id = p_order_id
    and session.active_box_id = p_box_id
    and session.created_by = auth.uid()
    and session.status in ('active', 'partial')
  order by session.last_seen_at desc
  limit 1;

  select item.* into v_item
  from public.fulfillment_box_items item
  join public.fulfillment_boxes box on box.id = item.box_id
  join public.fulfillment_supplies supply on supply.id = box.supply_id
  join public.fulfillment_batches batch on batch.id = supply.batch_id
  where box.id = p_box_id
    and item.account_id = v_order.account_id
    and batch.deleted_at is null
    and batch.status <> 'cancelled'
    and not exists (
      select 1
      from public.trip_lines shipped_line
      where shipped_line.fulfillment_supply_id = supply.id
        and shipped_line.status = 'Отгружен'
    )
    and item.barcode in (
      select value from jsonb_array_elements_text(coalesce(v_order.skus, '[]'::jsonb)) value
    )
    and (v_scanned_barcode is null or item.barcode = v_scanned_barcode)
  for update of item;

  if not found then raise exception 'В выбранном коробе нет товара этого заказа'; end if;

  select * into v_existing
  from public.fbs_stock_allocations
  where store_id = p_store_id and wb_order_id = p_order_id
  for update;

  if found and v_existing.status = 'consumed' then
    raise exception 'Остаток по этому заказу уже списан';
  end if;
  if found and v_existing.status = 'awaiting_wb' then
    raise exception 'Заказ уже передан в WB, менять короб нельзя';
  end if;

  select coalesce(sum(quantity), 0)::integer into v_active
  from public.fbs_stock_allocations
  where box_item_id = v_item.id
    and status in ('reserved', 'awaiting_wb')
    and (v_existing.id is null or id <> v_existing.id);

  if v_item.qty - v_active < 1 then
    raise exception 'В этом коробе нет доступного остатка';
  end if;

  v_event := case
    when v_existing.id is not null and v_existing.box_item_id is distinct from v_item.id then 'moved'
    else 'reserved'
  end;

  insert into public.fbs_stock_allocations (
    account_id, store_id, wb_order_id, box_item_id, box_id, product_barcode,
    quantity, status, created_by, updated_by, updated_at,
    dispatched_at, consumed_at, released_at, last_supplier_status, last_wb_status
  ) values (
    v_order.account_id, p_store_id, p_order_id, v_item.id, p_box_id, v_item.barcode,
    1, 'reserved', auth.uid(), auth.uid(), timezone('utc', now()),
    null, null, null, v_order.supplier_status, v_order.wb_system_status
  )
  on conflict (store_id, wb_order_id) do update set
    box_item_id = excluded.box_item_id,
    box_id = excluded.box_id,
    product_barcode = excluded.product_barcode,
    quantity = 1,
    status = 'reserved',
    updated_by = auth.uid(),
    updated_at = timezone('utc', now()),
    dispatched_at = null,
    consumed_at = null,
    released_at = null,
    last_supplier_status = excluded.last_supplier_status,
    last_wb_status = excluded.last_wb_status
  returning * into v_result;

  insert into public.fbs_stock_allocation_events (
    allocation_id, account_id, store_id, wb_order_id, event_type,
    from_box_item_id, to_box_item_id, actor_id, supplier_status, wb_status
  ) values (
    v_result.id, v_result.account_id, v_result.store_id, v_result.wb_order_id, v_event,
    v_existing.box_item_id, v_item.id, auth.uid(), v_order.supplier_status, v_order.wb_system_status
  );

  return v_result;
end;
$$;

create or replace function public.mark_fbs_supply_dispatched(
  p_store_id uuid,
  p_supply_id text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not exists (
    select 1
    from public.stores store
    join public.account_members member on member.account_id = store.account_id
    where store.id = p_store_id and member.user_id = auth.uid()
  ) then raise exception 'Нет доступа к магазину'; end if;

  with changed as (
    update public.fbs_stock_allocations allocation
    set status = 'awaiting_wb',
        dispatched_at = coalesce(dispatched_at, timezone('utc', now())),
        updated_at = timezone('utc', now()),
        updated_by = auth.uid(),
        last_supplier_status = 'complete',
        last_wb_status = 'waiting'
    from public.fbs_orders order_row
    where order_row.store_id = p_store_id
      and order_row.supply_id = p_supply_id
      and allocation.store_id = order_row.store_id
      and allocation.wb_order_id = order_row.wb_order_id
      and allocation.status = 'reserved'
    returning allocation.*
  ), events as (
    insert into public.fbs_stock_allocation_events (
      allocation_id, account_id, store_id, wb_order_id, event_type,
      from_box_item_id, to_box_item_id, actor_id, supplier_status, wb_status
    )
    select id, account_id, store_id, wb_order_id, 'awaiting_wb',
           box_item_id, box_item_id, auth.uid(), 'complete', 'waiting'
    from changed
    returning 1
  )
  select count(*)::integer into v_count from events;
  return v_count;
end;
$$;

create or replace function public.release_fbs_order_box_reservation(
  p_store_id uuid,
  p_order_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.fbs_orders%rowtype;
  v_allocation public.fbs_stock_allocations%rowtype;
begin
  select * into v_order
  from public.fbs_orders
  where store_id = p_store_id and wb_order_id = p_order_id
  for update;

  if not found then raise exception 'Заказ FBS не найден'; end if;
  if not exists (
    select 1 from public.account_members member
    where member.account_id = v_order.account_id and member.user_id = auth.uid()
  ) then raise exception 'Нет доступа к магазину'; end if;
  if coalesce(v_order.supplier_status, '') <> 'confirm'
     or coalesce(v_order.wb_system_status, '') <> 'waiting' then
    raise exception 'Снять резерв можно только до передачи заказа в WB';
  end if;

  update public.fbs_stock_allocations
  set status = 'released',
      released_at = timezone('utc', now()),
      updated_at = timezone('utc', now()),
      updated_by = auth.uid(),
      last_supplier_status = v_order.supplier_status,
      last_wb_status = v_order.wb_system_status
  where store_id = p_store_id
    and wb_order_id = p_order_id
    and status = 'reserved'
  returning * into v_allocation;

  if not found then raise exception 'Активный резерв для этого заказа не найден'; end if;

  insert into public.fbs_stock_allocation_events (
    allocation_id, account_id, store_id, wb_order_id, event_type,
    from_box_item_id, to_box_item_id, actor_id, supplier_status, wb_status
  ) values (
    v_allocation.id, v_allocation.account_id, v_allocation.store_id,
    v_allocation.wb_order_id, 'released', v_allocation.box_item_id, null,
    auth.uid(), v_order.supplier_status, v_order.wb_system_status
  );
  return true;
end;
$$;

-- The Edge Function calls this immediately before WB delivery. Orders without
-- internal fulfillment stock are allowed; every tracked order must have a
-- reservation from a source box that is still available to the company.
create or replace function public.count_fbs_supply_orders_missing_stock_reservation(
  p_store_id uuid,
  p_supply_id text
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.fbs_orders order_row
  where order_row.store_id = p_store_id
    and order_row.supply_id = p_supply_id
    and exists (
      select 1
      from public.fulfillment_box_items item
      join public.fulfillment_boxes box on box.id = item.box_id
      join public.fulfillment_supplies supply on supply.id = box.supply_id
      join public.fulfillment_batches batch on batch.id = supply.batch_id
      where item.account_id = order_row.account_id
        and item.barcode in (
          select value
          from jsonb_array_elements_text(coalesce(order_row.skus, '[]'::jsonb)) value
        )
        and batch.deleted_at is null
        and batch.status <> 'cancelled'
        and not exists (
          select 1
          from public.trip_lines shipped_line
          where shipped_line.fulfillment_supply_id = supply.id
            and shipped_line.status = 'Отгружен'
        )
    )
    and not exists (
      select 1
      from public.fbs_stock_allocations allocation
      join public.fulfillment_box_items item on item.id = allocation.box_item_id
      join public.fulfillment_boxes box on box.id = item.box_id
      join public.fulfillment_supplies supply on supply.id = box.supply_id
      join public.fulfillment_batches batch on batch.id = supply.batch_id
      where allocation.store_id = order_row.store_id
        and allocation.wb_order_id = order_row.wb_order_id
        and allocation.status = 'reserved'
        and batch.deleted_at is null
        and batch.status <> 'cancelled'
        and not exists (
          select 1
          from public.trip_lines shipped_line
          where shipped_line.fulfillment_supply_id = supply.id
            and shipped_line.status = 'Отгружен'
        )
    );
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
begin
  select * into v_allocation
  from public.fbs_stock_allocations
  where store_id = new.store_id and wb_order_id = new.wb_order_id
  for update;
  if not found or v_allocation.status in ('consumed', 'released') then return new; end if;

  if coalesce(new.supplier_status, '') = 'cancel'
     or coalesce(new.wb_system_status, '') in ('canceled', 'declined_by_client') then
    v_next_status := 'released';
  elsif coalesce(new.wb_system_status, '') in (
    'sorted', 'ready_for_pickup', 'postponed_delivery', 'sold', 'canceled_by_client', 'defect'
  ) then
    v_next_status := 'consumed';
  elsif coalesce(new.supplier_status, '') = 'complete'
        and coalesce(new.wb_system_status, '') = 'waiting' then
    v_next_status := 'awaiting_wb';
  else
    return new;
  end if;

  if v_next_status = 'consumed' then
    if v_allocation.box_item_id is null then
      raise exception 'Не найден исходный товар короба для списания FBS заказа %', new.wb_order_id;
    end if;
    update public.fbs_stock_allocations
    set status = 'consumed', consumed_at = coalesce(consumed_at, v_now), updated_at = v_now,
        last_supplier_status = new.supplier_status, last_wb_status = new.wb_system_status
    where id = v_allocation.id;
    update public.fulfillment_box_items
    set qty = qty - v_allocation.quantity
    where id = v_allocation.box_item_id and qty >= v_allocation.quantity;
    if not found then
      raise exception 'Недостаточно физического остатка для списания FBS заказа %', new.wb_order_id;
    end if;
  elsif v_next_status = 'awaiting_wb' then
    update public.fbs_stock_allocations
    set status = 'awaiting_wb', dispatched_at = coalesce(dispatched_at, v_now), updated_at = v_now,
        last_supplier_status = new.supplier_status, last_wb_status = new.wb_system_status
    where id = v_allocation.id and status = 'reserved';
    if not found then return new; end if;
  else
    update public.fbs_stock_allocations
    set status = 'released', released_at = coalesce(released_at, v_now), updated_at = v_now,
        last_supplier_status = new.supplier_status, last_wb_status = new.wb_system_status
    where id = v_allocation.id;
  end if;

  insert into public.fbs_stock_allocation_events (
    allocation_id, account_id, store_id, wb_order_id, event_type,
    from_box_item_id, to_box_item_id, supplier_status, wb_status
  ) values (
    v_allocation.id, v_allocation.account_id, v_allocation.store_id, v_allocation.wb_order_id,
    v_next_status, v_allocation.box_item_id, v_allocation.box_item_id,
    new.supplier_status, new.wb_system_status
  );
  return new;
end;
$$;

drop trigger if exists reconcile_fbs_stock_allocation_trigger on public.fbs_orders;
create trigger reconcile_fbs_stock_allocation_trigger
after insert or update of supplier_status, wb_system_status on public.fbs_orders
for each row execute function public.reconcile_fbs_stock_allocation();

revoke all on function public.reserve_fbs_order_from_box(uuid, text, uuid) from public, anon;
grant execute on function public.reserve_fbs_order_from_box(uuid, text, uuid) to authenticated;
revoke all on function public.mark_fbs_supply_dispatched(uuid, text) from public, anon;
grant execute on function public.mark_fbs_supply_dispatched(uuid, text) to authenticated;
revoke all on function public.release_fbs_order_box_reservation(uuid, text) from public, anon;
grant execute on function public.release_fbs_order_box_reservation(uuid, text) to authenticated;
revoke all on function public.count_fbs_supply_orders_missing_stock_reservation(uuid, text) from public, anon, authenticated;
grant execute on function public.count_fbs_supply_orders_missing_stock_reservation(uuid, text) to service_role;
revoke all on function public.reconcile_fbs_stock_allocation() from public, anon, authenticated;
revoke all on function public.protect_reserved_fulfillment_stock() from public, anon, authenticated;

-- Locations expose available stock to picking UI and keep reservation totals for the Qty column.
drop function if exists public.get_fbs_product_locations(uuid, text[]);
create function public.get_fbs_product_locations(
  p_account_id uuid,
  p_barcodes text[]
)
returns table (
  product_barcode text,
  quantity integer,
  physical_quantity integer,
  reserved_quantity integer,
  awaiting_quantity integer,
  box_item_id uuid,
  batch_id uuid,
  batch_number bigint,
  batch_name text,
  supply_id uuid,
  supply_number integer,
  box_id uuid,
  box_number integer,
  box_barcode text,
  warehouse_name text,
  rack_name text,
  side_name text,
  pallet_address text,
  slot_number integer,
  address_code text,
  address_text text,
  is_addressed boolean
)
language sql
stable
set search_path = public
as $$
  select
    bi.barcode,
    greatest(bi.qty - reservation.reserved - reservation.awaiting, 0)::integer,
    bi.qty::integer,
    reservation.reserved::integer,
    reservation.awaiting::integer,
    bi.id,
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
    placement.item_id is not null
  from public.fulfillment_box_items bi
  join public.fulfillment_boxes box on box.id = bi.box_id
  join public.fulfillment_supplies supply on supply.id = box.supply_id
  join public.fulfillment_batches batch on batch.id = supply.batch_id
  left join lateral (
    select
      coalesce(sum(allocation.quantity) filter (where allocation.status = 'reserved'), 0)::integer as reserved,
      coalesce(sum(allocation.quantity) filter (where allocation.status = 'awaiting_wb'), 0)::integer as awaiting
    from public.fbs_stock_allocations allocation
    where allocation.box_item_id = bi.id
  ) reservation on true
  left join lateral (
    select
      item.id as item_id,
      warehouse.name as warehouse_name,
      rack.name as rack_name,
      side.name as side_name,
      cell.col || cell.row::text as pallet_address,
      item.slot_number,
      format('C%s_W%s_R%s_F%s_%s%s_K%s', account.short_id, warehouse.short_id,
        rack.short_id, side.position + 1, cell.col, cell.row, item.slot_number) as address_code,
      format('%s / %s / %s / %s%s-K%s', warehouse.name, rack.name, side.name,
        cell.col, cell.row, item.slot_number) as address_text
    from public.wms_cell_items item
    join public.wms_cells cell on cell.id = item.cell_id
    join public.wms_zone_sides side on side.id = item.side_id
    join public.wms_zones rack on rack.id = cell.zone_id
    join public.wms_warehouses warehouse on warehouse.id = rack.warehouse_id
    join public.accounts account on account.id = item.account_id
    where item.fulfillment_box_id = box.id
    order by item.updated_at desc, item.created_at desc
    limit 1
  ) placement on true
  where bi.account_id = p_account_id
    and bi.barcode = any(coalesce(p_barcodes, array[]::text[]))
    and batch.deleted_at is null
    and batch.status <> 'cancelled'
    and not exists (
      select 1 from public.trip_lines shipped_line
      where shipped_line.fulfillment_supply_id = supply.id
        and shipped_line.status = 'Отгружен'
    )
    and exists (
      select 1 from public.account_members member
      where member.account_id = p_account_id and member.user_id = auth.uid()
    )
  order by bi.barcode, placement.item_id is null, batch.short_id, supply.supply_number, box.box_number;
$$;

revoke all on function public.get_fbs_product_locations(uuid, text[]) from public, anon;
grant execute on function public.get_fbs_product_locations(uuid, text[]) to authenticated;

-- A marking session has one active source box per device. The box must be
-- selected before WB QR / KIZ scanning and remains active until explicitly
-- replaced by another box.
alter table public.fbs_marking_sessions
  add column if not exists active_box_id uuid references public.fulfillment_boxes(id) on delete set null;

alter table public.fbs_marking_sessions
  add column if not exists barcode_scan_enabled boolean not null default false,
  add column if not exists pending_product_barcode text;

create or replace function public.fbs_marking_box_info(
  p_session_id uuid,
  p_device_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'boxId', box.id,
    'barcode', box.barcode,
    'boxNumber', box.box_number,
    'supplyNumber', supply.supply_number,
    'batchNumber', batch.short_id,
    'batchName', batch.name
  ) into v_result
  from public.fbs_marking_sessions session
  join public.fulfillment_boxes box on box.id = session.active_box_id
  join public.fulfillment_supplies supply on supply.id = box.supply_id
  join public.fulfillment_batches batch on batch.id = supply.batch_id
  where session.id = p_session_id
    and session.created_by = auth.uid()
    and session.device_id = p_device_id
    and session.status in ('active', 'partial')
    and batch.deleted_at is null
    and batch.status <> 'cancelled'
    and not exists (
      select 1 from public.trip_lines shipped_line
      where shipped_line.fulfillment_supply_id = supply.id
        and shipped_line.status = 'Отгружен'
    );
  return v_result;
end;
$$;

create or replace function public.set_fbs_marking_active_box(
  p_session_id uuid,
  p_device_id text,
  p_box_barcode text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.fbs_marking_sessions%rowtype;
  v_box_id uuid;
  v_barcode text := trim(regexp_replace(coalesce(p_box_barcode, ''), E'[\\r\\n]+$', ''));
begin
  select * into v_session
  from public.fbs_marking_sessions
  where id = p_session_id and created_by = auth.uid() and device_id = p_device_id
  for update;
  if v_session.id is null or v_session.status not in ('active', 'partial') then
    raise exception 'Активная сессия устройства не найдена';
  end if;
  if v_session.pending_order_id is not null or v_session.pending_product_barcode is not null then
    raise exception 'Сначала завершите или сбросьте текущую пару';
  end if;

  select box.id into v_box_id
  from public.fulfillment_boxes box
  join public.fulfillment_supplies supply on supply.id = box.supply_id
  join public.fulfillment_batches batch on batch.id = supply.batch_id
  where box.barcode = v_barcode
    and batch.account_id = v_session.account_id
    and batch.deleted_at is null
    and batch.status <> 'cancelled'
    and not exists (
      select 1 from public.trip_lines shipped_line
      where shipped_line.fulfillment_supply_id = supply.id
        and shipped_line.status = 'Отгружен'
    )
  limit 1;
  if v_box_id is null then
    raise exception 'Короб не найден или уже отгружен';
  end if;

  update public.fbs_marking_sessions
  set active_box_id = v_box_id, last_seen_at = now(), updated_at = now()
  where id = v_session.id;
  return public.fbs_marking_box_info(v_session.id, p_device_id);
end;
$$;

create or replace function public.set_fbs_marking_barcode_mode(
  p_session_id uuid,
  p_device_id text,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.fbs_marking_sessions%rowtype;
begin
  select * into v_session
  from public.fbs_marking_sessions
  where id = p_session_id and created_by = auth.uid() and device_id = p_device_id
  for update;
  if v_session.id is null or v_session.status not in ('active', 'partial') then
    raise exception 'Активная сессия устройства не найдена';
  end if;
  if v_session.pending_order_id is not null or v_session.pending_product_barcode is not null then
    raise exception 'Настройку нельзя менять внутри незавершённой пары';
  end if;

  update public.fbs_marking_sessions
  set barcode_scan_enabled = coalesce(p_enabled, false),
      last_seen_at = now(), updated_at = now()
  where id = v_session.id
  returning * into v_session;
  return to_jsonb(v_session);
end;
$$;

create or replace function public.scan_fbs_product_barcode(
  p_session_id uuid,
  p_device_id text,
  p_barcode text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.fbs_marking_sessions%rowtype;
  v_item public.fulfillment_box_items%rowtype;
  v_reserved integer;
  v_barcode text := trim(regexp_replace(coalesce(p_barcode, ''), E'[\\r\\n]+$', ''));
begin
  if char_length(v_barcode) not between 1 and 100 then
    raise exception 'Баркод товара пустой или некорректный';
  end if;
  select * into v_session
  from public.fbs_marking_sessions
  where id = p_session_id and created_by = auth.uid() and device_id = p_device_id
  for update;
  if v_session.id is null or v_session.status not in ('active', 'partial') then
    raise exception 'Активная сессия устройства не найдена';
  end if;
  if not v_session.barcode_scan_enabled then
    raise exception 'Контрольный скан баркода отключён';
  end if;
  if v_session.active_box_id is null then
    raise exception 'Сначала отсканируйте QR короба';
  end if;
  if v_session.pending_order_id is not null or v_session.pending_product_barcode is not null then
    raise exception 'Сначала завершите или сбросьте текущую пару';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_session.active_box_id::text || ':barcode:' || v_barcode, 0));
  select * into v_item
  from public.fulfillment_box_items item
  where item.box_id = v_session.active_box_id
    and item.account_id = v_session.account_id
    and item.barcode = v_barcode
  order by item.created_at
  limit 1
  for update;
  if v_item.id is null then
    raise exception 'В активном коробе нет товара с этим баркодом';
  end if;

  select coalesce(sum(quantity), 0)::integer into v_reserved
  from public.fbs_stock_allocations
  where box_item_id = v_item.id and status in ('reserved', 'awaiting_wb');
  if v_item.qty - v_reserved < 1 then
    raise exception 'В активном коробе закончился доступный остаток этого товара';
  end if;

  update public.fbs_marking_sessions
  set pending_product_barcode = v_barcode,
      pending_locked_until = now() + interval '2 minutes',
      last_seen_at = now(), updated_at = now()
  where id = v_session.id;
  return jsonb_build_object(
    'barcode', v_barcode,
    'available', v_item.qty - v_reserved,
    'box_item_id', v_item.id
  );
end;
$$;

create or replace function public.validate_fbs_marking_active_box()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.fulfillment_box_items%rowtype;
  v_order public.fbs_orders%rowtype;
  v_active integer;
begin
  if new.pending_order_id is null
     or new.pending_order_id is not distinct from old.pending_order_id then return new; end if;
  if new.active_box_id is null then
    raise exception 'Сначала отсканируйте QR короба';
  end if;

  select * into v_order
  from public.fbs_orders order_row
  where order_row.store_id = new.store_id and order_row.wb_order_id = new.pending_order_id;
  if v_order.id is null then
    raise exception 'Заказ WB не найден в актуальных данных магазина';
  end if;
  if new.barcode_scan_enabled and nullif(trim(new.pending_product_barcode), '') is null then
    raise exception 'Сначала отсканируйте баркод товара';
  end if;
  if new.barcode_scan_enabled and not exists (
    select 1 from jsonb_array_elements_text(coalesce(v_order.skus, '[]'::jsonb)) sku
    where sku = new.pending_product_barcode
  ) then
    raise exception 'Баркод товара не совпадает с товаром в QR-заказе WB';
  end if;
  if new.barcode_scan_enabled and new.pending_wb_qr = new.pending_product_barcode then
    raise exception 'В одном цикле баркод товара и QR WB не могут совпадать';
  end if;

  select item.* into v_item
  from public.fulfillment_box_items item
  where item.account_id = v_order.account_id
    and item.box_id = new.active_box_id
    and item.barcode in (
      select value from jsonb_array_elements_text(coalesce(v_order.skus, '[]'::jsonb)) value
    )
    and (not new.barcode_scan_enabled or item.barcode = new.pending_product_barcode)
  order by item.created_at
  limit 1
  for update;
  if not found then
    raise exception 'В активном коробе нет товара этого FBS-заказа';
  end if;
  select coalesce(sum(quantity), 0)::integer into v_active
  from public.fbs_stock_allocations
  where box_item_id = v_item.id and status in ('reserved', 'awaiting_wb');
  if v_item.qty - v_active < 1 then
    raise exception 'В активном коробе закончился доступный остаток';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_fbs_marking_active_box_trigger on public.fbs_marking_sessions;
create trigger validate_fbs_marking_active_box_trigger
before update of pending_order_id on public.fbs_marking_sessions
for each row execute function public.validate_fbs_marking_active_box();

create or replace function public.reserve_fbs_marking_pair_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_box_id uuid;
  v_product_barcode text;
begin
  select active_box_id, pending_product_barcode into v_box_id, v_product_barcode
  from public.fbs_marking_sessions
  where id = new.session_id for update;
  if v_box_id is null then raise exception 'Сначала отсканируйте QR короба'; end if;
  if new.sgtin = new.wb_qr or (v_product_barcode is not null and new.sgtin = v_product_barcode) then
    raise exception 'В одном цикле баркод, QR WB и КИЗ должны отличаться';
  end if;
  perform public.reserve_fbs_order_from_box(new.store_id, new.order_id, v_box_id);
  new.product_snapshot := coalesce(new.product_snapshot, '{}'::jsonb)
    || jsonb_build_object('source_box_id', v_box_id);
  return new;
end;
$$;

drop trigger if exists reserve_fbs_marking_pair_stock_trigger on public.fbs_marking_pairs;
create trigger reserve_fbs_marking_pair_stock_trigger
before insert on public.fbs_marking_pairs
for each row execute function public.reserve_fbs_marking_pair_stock();

create or replace function public.clear_fbs_marking_cycle_barcode()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.fbs_marking_sessions
  set pending_product_barcode = null, updated_at = now()
  where id = new.session_id;
  return new;
end;
$$;

drop trigger if exists clear_fbs_marking_cycle_barcode_trigger on public.fbs_marking_pairs;
create trigger clear_fbs_marking_cycle_barcode_trigger
after insert on public.fbs_marking_pairs
for each row execute function public.clear_fbs_marking_cycle_barcode();

create or replace function public.clear_fbs_marking_cancelled_cycle()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status in ('completed', 'cancelled') then
    new.pending_product_barcode := null;
  end if;
  return new;
end;
$$;

drop trigger if exists clear_fbs_marking_cancelled_cycle_trigger on public.fbs_marking_sessions;
create trigger clear_fbs_marking_cancelled_cycle_trigger
before update of status on public.fbs_marking_sessions
for each row execute function public.clear_fbs_marking_cancelled_cycle();

create or replace function public.touch_fbs_marking_session(
  p_session_id uuid,
  p_device_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_session public.fbs_marking_sessions%rowtype;
begin
  update public.fbs_marking_sessions
  set last_seen_at = now(), updated_at = now(),
      pending_locked_until = case
        when pending_order_id is null and pending_product_barcode is null then null
        else now() + interval '2 minutes'
      end
  where id = p_session_id and created_by = auth.uid() and device_id = p_device_id
    and status in ('active', 'partial')
  returning * into v_session;
  if v_session.id is null then raise exception 'Активная сессия устройства не найдена'; end if;
  return to_jsonb(v_session);
end;
$$;

create or replace function public.release_fbs_marking_pending(
  p_session_id uuid,
  p_device_id text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.fbs_marking_sessions
  set pending_order_id = null, pending_wb_qr = null,
      pending_product_barcode = null, pending_locked_until = null,
      last_seen_at = now(), updated_at = now()
  where id = p_session_id and created_by = auth.uid() and device_id = p_device_id
    and status in ('active', 'partial');
  if not found then raise exception 'Активная сессия устройства не найдена'; end if;
end;
$$;

create or replace function public.release_deleted_fbs_marking_pair_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status in ('draft', 'error') then
    perform public.release_fbs_order_box_reservation(old.store_id, old.order_id);
  end if;
  return old;
end;
$$;

drop trigger if exists release_deleted_fbs_marking_pair_stock_trigger on public.fbs_marking_pairs;
create trigger release_deleted_fbs_marking_pair_stock_trigger
after delete on public.fbs_marking_pairs
for each row execute function public.release_deleted_fbs_marking_pair_stock();

revoke all on function public.fbs_marking_box_info(uuid, text) from public, anon;
grant execute on function public.fbs_marking_box_info(uuid, text) to authenticated;
revoke all on function public.set_fbs_marking_active_box(uuid, text, text) from public, anon;
grant execute on function public.set_fbs_marking_active_box(uuid, text, text) to authenticated;
revoke all on function public.set_fbs_marking_barcode_mode(uuid, text, boolean) from public, anon;
grant execute on function public.set_fbs_marking_barcode_mode(uuid, text, boolean) to authenticated;
revoke all on function public.scan_fbs_product_barcode(uuid, text, text) from public, anon;
grant execute on function public.scan_fbs_product_barcode(uuid, text, text) to authenticated;
revoke all on function public.validate_fbs_marking_active_box() from public, anon, authenticated;
revoke all on function public.reserve_fbs_marking_pair_stock() from public, anon, authenticated;
revoke all on function public.clear_fbs_marking_cycle_barcode() from public, anon, authenticated;
revoke all on function public.clear_fbs_marking_cancelled_cycle() from public, anon, authenticated;
revoke all on function public.release_deleted_fbs_marking_pair_stock() from public, anon, authenticated;
