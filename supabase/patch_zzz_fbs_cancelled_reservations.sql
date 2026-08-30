-- Keep the source-box reservation when an FBS order is cancelled before WB
-- handoff. Calculated stock treats the order as inactive, but box stock is an
-- independent physical ledger and must only change through an explicit user
-- operation. Dispatch events are permanent, so cancellation after handoff is
-- never used to restore calculated stock either.
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
    update public.fbs_stock_allocations
    set updated_at = v_now,
        last_supplier_status = new.supplier_status,
        last_wb_status = new.wb_system_status
    where id = v_allocation.id;
    return new;
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
  else
    update public.fbs_stock_allocations
    set status = 'awaiting_wb', dispatched_at = coalesce(dispatched_at, v_now), updated_at = v_now,
        last_supplier_status = new.supplier_status, last_wb_status = new.wb_system_status
    where id = v_allocation.id and status = 'reserved';
    if not found then return new; end if;
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

revoke all on function public.reconcile_fbs_stock_allocation() from public, anon, authenticated;
