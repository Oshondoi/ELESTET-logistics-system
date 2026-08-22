-- Independent optional box and product-barcode checks for the FBS KIZ scanner.

alter table public.fbs_marking_sessions
  add column if not exists box_scan_enabled boolean not null default true;

create or replace function public.set_fbs_marking_box_mode(
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
  set box_scan_enabled = coalesce(p_enabled, false),
      active_box_id = case when coalesce(p_enabled, false) then active_box_id else null end,
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
  if v_session.box_scan_enabled and v_session.active_box_id is null then
    raise exception 'Сначала отсканируйте QR короба';
  end if;
  if v_session.pending_order_id is not null or v_session.pending_product_barcode is not null then
    raise exception 'Сначала завершите или сбросьте текущую пару';
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
    select coalesce(sum(quantity), 0)::integer into v_active
    from public.fbs_stock_allocations
    where box_item_id = v_item.id and status in ('reserved', 'awaiting_wb');
    if v_item.qty - v_active < 1 then
      raise exception 'В активном коробе закончился доступный остаток';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.reserve_fbs_marking_pair_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_box_id uuid;
  v_product_barcode text;
  v_box_scan_enabled boolean;
begin
  select active_box_id, pending_product_barcode, box_scan_enabled
  into v_box_id, v_product_barcode, v_box_scan_enabled
  from public.fbs_marking_sessions
  where id = new.session_id for update;
  if v_box_scan_enabled and v_box_id is null then
    raise exception 'Сначала отсканируйте QR короба';
  end if;
  if new.sgtin = new.wb_qr or (v_product_barcode is not null and new.sgtin = v_product_barcode) then
    raise exception 'В одном цикле баркод, QR WB и КИЗ должны отличаться';
  end if;
  if v_box_scan_enabled then
    perform public.reserve_fbs_order_from_box(new.store_id, new.order_id, v_box_id);
    new.product_snapshot := coalesce(new.product_snapshot, '{}'::jsonb)
      || jsonb_build_object('source_box_id', v_box_id);
  end if;
  return new;
end;
$$;

revoke all on function public.set_fbs_marking_box_mode(uuid, text, boolean) from public, anon;
grant execute on function public.set_fbs_marking_box_mode(uuid, text, boolean) to authenticated;
revoke all on function public.scan_fbs_product_barcode(uuid, text, text) from public, anon;
grant execute on function public.scan_fbs_product_barcode(uuid, text, text) to authenticated;
revoke all on function public.validate_fbs_marking_active_box() from public, anon, authenticated;
revoke all on function public.reserve_fbs_marking_pair_stock() from public, anon, authenticated;
