-- Independent calculated FBS balance for the selected store.
-- This function does not change physical box stock or reservations.

create or replace function public.get_fbs_calculated_stock(
  p_account_id uuid,
  p_store_id uuid
)
returns table (
  barcode text,
  received_quantity bigint,
  active_order_quantity bigint,
  dispatched_quantity bigint,
  calculated_quantity bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.account_members member
    where member.account_id = p_account_id
      and member.user_id = auth.uid()
  ) then
    raise exception 'Нет доступа к остаткам этой компании';
  end if;

  if not exists (
    select 1
    from public.stores store
    where store.id = p_store_id
      and store.account_id = p_account_id
  ) then
    raise exception 'Магазин не принадлежит выбранной компании';
  end if;

  return query
  with received_by_barcode as (
    select
      item.barcode,
      coalesce(sum(item.qty_received), 0)::bigint as quantity
    from public.fulfillment_items item
    join public.fulfillment_batches batch on batch.id = item.batch_id
    where batch.account_id = p_account_id
      and batch.store_id = p_store_id
      and batch.deleted_at is null
      and batch.status <> 'cancelled'
    group by item.barcode
  ),
  active_orders_by_barcode as (
    select
      first_sku.barcode,
      count(*)::bigint as quantity
    from public.fbs_orders order_row
    cross join lateral (
      select sku.value as barcode
      from jsonb_array_elements_text(coalesce(order_row.skus, '[]'::jsonb)) with ordinality sku(value, position)
      order by sku.position
      limit 1
    ) first_sku
    where order_row.account_id = p_account_id
      and order_row.store_id = p_store_id
      and order_row.is_in_latest_snapshot = true
      and order_row.supplier_status in ('new', 'confirm')
      and order_row.wb_system_status = 'waiting'
      and not exists (
        select 1
        from public.fbs_dispatch_events dispatch_event
        where dispatch_event.store_id = order_row.store_id
          and dispatch_event.wb_order_id = order_row.wb_order_id
      )
    group by first_sku.barcode
  ),
  dispatched_by_barcode as (
    select
      event.product_barcode as barcode,
      coalesce(sum(event.quantity), 0)::bigint as quantity
    from public.fbs_dispatch_events event
    where event.account_id = p_account_id
      and event.store_id = p_store_id
      and event.product_barcode <> ''
    group by event.product_barcode
  ),
  all_barcodes as (
    select item.barcode from received_by_barcode item
    union
    select item.barcode from active_orders_by_barcode item
    union
    select item.barcode from dispatched_by_barcode item
  )
  select
    item.barcode,
    coalesce(received.quantity, 0)::bigint,
    coalesce(active_order.quantity, 0)::bigint,
    coalesce(dispatched.quantity, 0)::bigint,
    (
      coalesce(received.quantity, 0)
      - coalesce(active_order.quantity, 0)
      - coalesce(dispatched.quantity, 0)
    )::bigint
  from all_barcodes item
  left join received_by_barcode received on received.barcode = item.barcode
  left join active_orders_by_barcode active_order on active_order.barcode = item.barcode
  left join dispatched_by_barcode dispatched on dispatched.barcode = item.barcode
  order by item.barcode;
end;
$$;

revoke all on function public.get_fbs_calculated_stock(uuid, uuid) from public, anon;
grant execute on function public.get_fbs_calculated_stock(uuid, uuid) to authenticated;
