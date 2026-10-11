-- Requires patch_zzzz_fbs_bound_stock.sql (physical quantity is net of bindings).
-- No inventory, allocation, session or WB data is migrated by this patch.
begin;

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
  v_barcode text := trim(regexp_replace(coalesce(p_barcode, ''), E'[\\r\\n]+$', ''));
begin
  if char_length(v_barcode) not between 1 and 100 then raise exception 'Баркод товара пустой или некорректный'; end if;
  select * into v_session
  from public.fbs_marking_sessions
  where id = p_session_id and created_by = auth.uid() and device_id = p_device_id
  for update;
  if v_session.id is null or v_session.status not in ('active', 'partial') then raise exception 'Активная сессия устройства не найдена'; end if;
  if not v_session.barcode_scan_enabled then raise exception 'Контрольный скан баркода отключён'; end if;
  if v_session.box_scan_enabled and v_session.active_box_id is null then raise exception 'Сначала отсканируйте QR короба'; end if;
  if v_session.pending_order_id is not null or v_session.pending_product_barcode is not null then
    raise exception 'Сначала завершите или сбросьте текущую пару';
  end if;

  -- Принимаем только SKU реального активного FBS-заказа, для которого WB разрешает КИЗ.
  if not exists (
    select 1
    from public.fbs_orders order_row
    where order_row.store_id = v_session.store_id
      and order_row.is_in_latest_snapshot = true
      and order_row.supplier_status = 'confirm'
      and coalesce(order_row.wb_system_status, '') = 'waiting'
      and exists (
        select 1 from jsonb_array_elements_text(coalesce(order_row.skus, '[]'::jsonb)) sku
        where trim(sku) = v_barcode
      )
      and exists (
        select 1 from public.fbs_wb_qr_catalog catalog
        where catalog.store_id = order_row.store_id
          and catalog.order_id = order_row.wb_order_id
          and catalog.supports_sgtin = true
      )
  ) then
    raise exception 'Этот код не является баркодом товара активного FBS-заказа';
  end if;

  if not v_session.box_scan_enabled then
    update public.fbs_marking_sessions
    set pending_product_barcode = v_barcode,
        pending_locked_until = now() + interval '2 minutes',
        last_seen_at = now(), updated_at = now()
    where id = v_session.id;
    return jsonb_build_object('barcode', v_barcode, 'available', null, 'box_item_id', null);
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
  if v_item.id is null then raise exception 'В активном коробе нет товара с этим баркодом'; end if;

  -- qty already excludes units bound to orders; never subtract them twice.
  if v_item.qty < 1 then raise exception 'В активном коробе закончился доступный остаток этого товара'; end if;

  update public.fbs_marking_sessions
  set pending_product_barcode = v_barcode,
      pending_locked_until = now() + interval '2 minutes',
      last_seen_at = now(), updated_at = now()
  where id = v_session.id;
  return jsonb_build_object('barcode', v_barcode, 'available', v_item.qty, 'box_item_id', v_item.id);
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
begin
  if new.pending_order_id is null
     or new.pending_order_id is not distinct from old.pending_order_id then return new; end if;
  if new.box_scan_enabled and new.active_box_id is null then
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

  if new.box_scan_enabled then
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
    -- reserve_fbs_order_from_box already decrements qty atomically.
    if v_item.qty < 1 then
      raise exception 'В активном коробе закончился доступный остаток';
    end if;
  end if;
  return new;
end;
$$;

commit;
