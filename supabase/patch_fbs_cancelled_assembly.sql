-- Cancellation during FBS assembly is handled from our synchronized database.
-- A scanned physical unit leaves its source box immediately. Cancelling the
-- assembly closes the reservation but never guesses a return box: the unit is
-- received later by an operator through the normal fulfillment workflow.

begin;

alter table public.fbs_marking_pairs
  drop constraint if exists fbs_marking_pairs_status_check;
alter table public.fbs_marking_pairs
  add constraint fbs_marking_pairs_status_check
  check (status in ('draft', 'sending', 'sent', 'error', 'cancelled'));

-- Keep cancelled pairs as immutable history without permanently locking the
-- physical KIZ. After manual receipt that item may be sold by a later order.
drop index if exists public.fbs_marking_pairs_store_order_unique;
drop index if exists public.fbs_marking_pairs_store_qr_unique;
drop index if exists public.fbs_marking_pairs_store_sgtin_unique;
create unique index fbs_marking_pairs_store_order_unique
  on public.fbs_marking_pairs(store_id, order_id)
  where status <> 'cancelled';
create unique index fbs_marking_pairs_store_qr_unique
  on public.fbs_marking_pairs(store_id, wb_qr)
  where status <> 'cancelled';
create unique index fbs_marking_pairs_store_sgtin_unique
  on public.fbs_marking_pairs(store_id, sgtin)
  where status <> 'cancelled';

alter table public.fbs_stock_allocations
  drop constraint if exists fbs_stock_allocations_status_check;
alter table public.fbs_stock_allocations
  add constraint fbs_stock_allocations_status_check
  check (status in ('reserved', 'awaiting_wb', 'consumed', 'released', 'cancelled_manual_receipt'));

alter table public.fbs_stock_allocation_events
  drop constraint if exists fbs_stock_allocation_events_event_type_check;
alter table public.fbs_stock_allocation_events
  add constraint fbs_stock_allocation_events_event_type_check
  check (event_type in ('reserved', 'moved', 'awaiting_wb', 'consumed', 'released', 'cancelled_manual_receipt'));

create or replace function public.cancel_fbs_marking_assembly(
  p_pair_id uuid,
  p_device_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pair public.fbs_marking_pairs%rowtype;
  v_session public.fbs_marking_sessions%rowtype;
  v_order public.fbs_orders%rowtype;
  v_allocation public.fbs_stock_allocations%rowtype;
  v_reserve_closed boolean := false;
  v_now timestamptz := timezone('utc', now());
begin
  select * into v_pair
  from public.fbs_marking_pairs
  where id = p_pair_id
  for update;
  if not found then raise exception 'Пара КИЗ не найдена'; end if;

  select * into v_session
  from public.fbs_marking_sessions
  where id = v_pair.session_id
  for update;
  if not found
     or v_session.created_by <> auth.uid()
     or v_session.device_id <> p_device_id then
    raise exception 'Пара принадлежит другой сессии или другому устройству';
  end if;

  if not public.fbs_can_access_store(v_pair.store_id, 'fbs_assembly') then
    raise exception 'Нет права отменять сборку FBS этого магазина';
  end if;

  select * into v_order
  from public.fbs_orders
  where store_id = v_pair.store_id and wb_order_id = v_pair.order_id
  for update;
  if not found then raise exception 'FBS-заказ не найден'; end if;
  if not (
    coalesce(v_order.supplier_status, '') in ('cancel', 'canceled', 'cancelled')
    or coalesce(v_order.wb_system_status, '') in ('canceled', 'cancelled', 'declined_by_client')
  ) then
    raise exception 'По данным синхронизации заказ не отменён';
  end if;
  if v_pair.status = 'sending' then
    raise exception 'Пара сейчас отправляется. Дождитесь завершения операции';
  end if;

  select * into v_allocation
  from public.fbs_stock_allocations
  where store_id = v_pair.store_id and wb_order_id = v_pair.order_id
  for update;

  if found and v_allocation.status in ('reserved', 'awaiting_wb') then
    update public.fbs_stock_allocations
    set status = 'cancelled_manual_receipt',
        released_at = v_now,
        updated_at = v_now,
        updated_by = auth.uid(),
        return_note = 'Заказ отменён во время сборки. Требуется ручная приёмка товара.',
        last_supplier_status = v_order.supplier_status,
        last_wb_status = v_order.wb_system_status
    where id = v_allocation.id
      and status in ('reserved', 'awaiting_wb')
    returning * into v_allocation;
    v_reserve_closed := found;

    if v_reserve_closed then
      insert into public.fbs_stock_allocation_events (
        allocation_id, account_id, store_id, wb_order_id, event_type,
        from_box_item_id, to_box_item_id, actor_id, supplier_status, wb_status
      ) values (
        v_allocation.id, v_allocation.account_id, v_allocation.store_id,
        v_allocation.wb_order_id, 'cancelled_manual_receipt',
        v_allocation.box_item_id, null, auth.uid(),
        v_order.supplier_status, v_order.wb_system_status
      );
    end if;
  elsif found and v_allocation.status not in ('cancelled_manual_receipt', 'released') then
    raise exception 'Резерв уже закрыт статусом «%»', v_allocation.status;
  end if;

  if v_pair.status <> 'cancelled' then
    update public.fbs_marking_pairs
    set status = 'cancelled',
        error = 'Заказ отменён. Товар требует ручной приёмки.',
        updated_at = v_now
    where id = v_pair.id
    returning * into v_pair;
  end if;

  update public.fbs_marking_sessions
  set pending_order_id = case when pending_order_id = v_pair.order_id then null else pending_order_id end,
      pending_wb_qr = case when pending_order_id = v_pair.order_id then null else pending_wb_qr end,
      pending_product_barcode = case when pending_order_id = v_pair.order_id then null else pending_product_barcode end,
      pending_locked_until = case when pending_order_id = v_pair.order_id then null else pending_locked_until end,
      last_seen_at = v_now,
      updated_at = v_now
  where id = v_session.id;

  if v_session.status in ('active', 'partial')
     and not exists (
       select 1 from public.fbs_marking_pairs pair_row
       where pair_row.session_id = v_session.id and pair_row.status in ('draft', 'error', 'sending')
     )
     and not exists (
       select 1 from public.fbs_marking_sessions session_row
       where session_row.id = v_session.id
         and (session_row.pending_order_id is not null or session_row.pending_product_barcode is not null)
     ) then
    update public.fbs_marking_sessions
    set status = 'completed', completed_at = coalesce(completed_at, v_now), updated_at = v_now
    where id = v_session.id;
  end if;

  insert into public.fbs_action_audit(account_id, store_id, user_id, action, details)
  values (
    v_pair.account_id, v_pair.store_id, auth.uid(), 'cancel_fbs_marking_assembly',
    jsonb_build_object(
      'pair_id', v_pair.id,
      'order_id', v_pair.order_id,
      'kiz', v_pair.sgtin,
      'source_box_id', case when v_allocation.id is null then null else v_allocation.box_id end,
      'allocation_id', case when v_allocation.id is null then null else v_allocation.id end,
      'reserve_closed', v_reserve_closed,
      'stock_returned_to_box', false,
      'reason', 'WB order cancelled during assembly',
      'supplier_status', v_order.supplier_status,
      'wb_status', v_order.wb_system_status,
      'device_id', v_session.device_id,
      'device_name', v_session.device_name
    )
  );

  return jsonb_build_object(
    'pair_id', v_pair.id,
    'pair_status', v_pair.status,
    'allocation_status', case when v_allocation.id is null then null else v_allocation.status end,
    'reserve_closed', v_reserve_closed,
    'stock_returned_to_box', false
  );
end;
$$;

revoke all on function public.cancel_fbs_marking_assembly(uuid, text) from public, anon;
grant execute on function public.cancel_fbs_marking_assembly(uuid, text) to authenticated;

-- WB removes a cancelled order from the live supply composition. Preserve the
-- last supply link while that supply is open so the red row remains visible on
-- the assembly screen. The UI stops showing it there as soon as the supply is
-- closed, while the order remains available in the Cancelled tab.
create or replace function public.apply_fbs_order_supply_memberships(
  p_store_id uuid,
  p_account_id uuid,
  p_synced_at timestamptz,
  p_memberships jsonb,
  p_loaded_supply_ids text[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed integer := 0;
  v_count integer := 0;
begin
  if not exists (
    select 1 from public.stores store
    where store.id = p_store_id and store.account_id = p_account_id
  ) then raise exception 'Магазин не принадлежит компании'; end if;

  update public.fbs_orders order_row
  set supply_id = null,
      synced_at = p_synced_at
  where order_row.store_id = p_store_id
    and order_row.supply_id = any(coalesce(p_loaded_supply_ids, array[]::text[]))
    and not (
      coalesce(order_row.supplier_status, '') in ('cancel', 'canceled', 'cancelled')
      or coalesce(order_row.wb_system_status, '') in ('canceled', 'cancelled', 'declined_by_client')
    )
    and not exists (
      select 1
      from jsonb_to_recordset(coalesce(p_memberships, '[]'::jsonb)) as membership_row(
        wb_supply_id text, wb_order_id text
      )
      where membership_row.wb_order_id = order_row.wb_order_id
        and membership_row.wb_supply_id = order_row.supply_id
    );
  get diagnostics v_count = row_count;
  v_changed := v_changed + v_count;

  update public.fbs_orders order_row
  set supply_id = membership_row.wb_supply_id,
      synced_at = p_synced_at
  from (
    select distinct on (parsed.wb_order_id) parsed.wb_order_id, parsed.wb_supply_id
    from jsonb_to_recordset(coalesce(p_memberships, '[]'::jsonb)) as parsed(
      wb_supply_id text, wb_order_id text
    )
    order by parsed.wb_order_id, parsed.wb_supply_id
  ) membership_row
  where order_row.store_id = p_store_id
    and order_row.wb_order_id = membership_row.wb_order_id
    and order_row.supply_id is distinct from membership_row.wb_supply_id;
  get diagnostics v_count = row_count;
  v_changed := v_changed + v_count;

  return v_changed;
end;
$$;

revoke all on function public.apply_fbs_order_supply_memberships(uuid, uuid, timestamptz, jsonb, text[])
  from public, anon, authenticated;
grant execute on function public.apply_fbs_order_supply_memberships(uuid, uuid, timestamptz, jsonb, text[])
  to service_role;

commit;
