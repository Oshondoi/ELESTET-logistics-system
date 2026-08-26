-- Строгая типизация четырёх этапов FBS-сканера:
-- короб → товарный баркод → официальный QR WB → GS1 DataMatrix КИЗ.

begin;

create or replace function public.is_valid_fbs_kiz(p_value text)
returns boolean
language plpgsql
immutable
strict
set search_path = public
as $$
declare
  v_code text := regexp_replace(p_value, E'[\\r\\n\\t]+$', '');
  v_gtin text;
  v_tail text;
  v_parts text[];
  v_sum integer := 0;
  v_index integer;
begin
  -- AIM symbology identifier от аппаратного сканера, например ]d2.
  if v_code ~ E'^\\][A-Za-z][0-9]' then v_code := substring(v_code from 4); end if;
  -- Человекочитаемая форма (01)GTIN(21)SERIAL.
  if v_code ~ E'^\\(01\\)[0-9]{14}\\(21\\)' then
    v_code := '01' || substring(v_code from 5 for 14) || '21' || substring(v_code from 23);
  end if;

  if char_length(v_code) not between 19 and 135 or v_code !~ '^01[0-9]{14}21' then return false; end if;
  v_gtin := substring(v_code from 3 for 14);
  for v_index in 1..13 loop
    v_sum := v_sum + substring(v_gtin from v_index for 1)::integer
      * case when mod(v_index, 2) = 1 then 3 else 1 end;
  end loop;
  if mod(10 - mod(v_sum, 10), 10) <> substring(v_gtin from 14 for 1)::integer then return false; end if;

  v_tail := substring(v_code from 19);
  v_parts := string_to_array(v_tail, chr(29));
  if coalesce(array_length(v_parts, 1), 0) < 1
     or char_length(v_parts[1]) not between 1 and 20
     or v_parts[1] !~ '^[!-~]+$' then return false; end if;
  if coalesce(array_length(v_parts, 1), 0) > 1 then
    for v_index in 2..array_length(v_parts, 1) loop
      if v_parts[v_index] !~ '^[0-9]{2,4}[!-~]+$' then return false; end if;
    end loop;
  end if;
  return true;
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

  select coalesce(sum(quantity), 0)::integer into v_reserved
  from public.fbs_stock_allocations
  where box_item_id = v_item.id and status in ('reserved', 'awaiting_wb');
  if v_item.qty - v_reserved < 1 then raise exception 'В активном коробе закончился доступный остаток этого товара'; end if;

  update public.fbs_marking_sessions
  set pending_product_barcode = v_barcode,
      pending_locked_until = now() + interval '2 minutes',
      last_seen_at = now(), updated_at = now()
  where id = v_session.id;
  return jsonb_build_object('barcode', v_barcode, 'available', v_item.qty - v_reserved, 'box_item_id', v_item.id);
end;
$$;

create or replace function public.scan_fbs_wb_qr(
  p_session_id uuid,
  p_device_id text,
  p_order_id text,
  p_wb_qr text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.fbs_marking_sessions%rowtype;
  v_order public.fbs_orders%rowtype;
  v_qr text := regexp_replace(coalesce(p_wb_qr, ''), E'[\\r\\n]+$', '');
  v_existing public.fbs_marking_pairs%rowtype;
  v_blocked public.fbs_marking_sessions%rowtype;
  v_allowed boolean;
begin
  select * into v_session from public.fbs_marking_sessions
  where id = p_session_id and created_by = auth.uid() and device_id = p_device_id
  for update;
  if v_session.id is null or v_session.status not in ('active', 'partial') then raise exception 'Активная сессия устройства не найдена'; end if;
  if char_length(v_qr) not between 1 and 300 then raise exception 'QR WB пустой или некорректный'; end if;
  if v_session.pending_order_id is not null and v_session.pending_locked_until > now() then
    raise exception 'Сначала отсканируйте КИЗ для заказа %', v_session.pending_order_id;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_session.store_id::text || ':order:' || p_order_id, 0));
  perform pg_advisory_xact_lock(hashtextextended(v_session.store_id::text || ':qr:' || v_qr, 0));
  select * into v_order from public.fbs_orders
  where store_id = v_session.store_id and wb_order_id = p_order_id and is_in_latest_snapshot = true;
  if v_order.id is null then raise exception 'Заказ WB не найден в актуальных данных магазина'; end if;
  if v_order.supplier_status <> 'confirm' or coalesce(v_order.wb_system_status, '') <> 'waiting' then
    raise exception 'Заказ уже не находится на сборке';
  end if;
  v_allowed := coalesce(v_order.data->'requiredMeta', '[]'::jsonb) ? 'sgtin'
    or coalesce(v_order.data->'optionalMeta', '[]'::jsonb) ? 'sgtin'
    or exists (
      select 1 from public.fbs_wb_qr_catalog catalog
      where catalog.store_id = v_session.store_id and catalog.order_id = p_order_id and catalog.supports_sgtin = true
    );
  if not v_allowed then raise exception 'Wildberries не разрешает КИЗ для этого заказа'; end if;
  if not exists (
    select 1 from public.fbs_wb_qr_catalog catalog
    where catalog.store_id = v_session.store_id
      and catalog.order_id = p_order_id
      and catalog.qr_value = v_qr
      and catalog.supports_sgtin = true
  ) then raise exception 'Этот код не является официальным QR выбранного FBS-заказа WB'; end if;

  select * into v_existing from public.fbs_marking_pairs
  where store_id = v_session.store_id and (order_id = p_order_id or wb_qr = v_qr) limit 1;
  if v_existing.id is not null then raise exception 'Этот QR WB или заказ уже отсканирован в другой паре'; end if;
  select * into v_blocked from public.fbs_marking_sessions
  where store_id = v_session.store_id and id <> v_session.id
    and status in ('active', 'partial') and pending_locked_until > now()
    and (pending_order_id = p_order_id or pending_wb_qr = v_qr)
  limit 1;
  if v_blocked.id is not null then raise exception 'Этот заказ сейчас сканируется на другом устройстве'; end if;

  update public.fbs_marking_sessions
  set pending_order_id = p_order_id, pending_wb_qr = v_qr,
      pending_locked_until = now() + interval '2 minutes', last_seen_at = now(), updated_at = now()
  where id = v_session.id;
  return jsonb_build_object(
    'order_id', p_order_id, 'wb_qr', v_qr, 'locked_until', now() + interval '2 minutes',
    'product', jsonb_build_object(
      'nm_id', v_order.nm_id, 'article', v_order.article,
      'barcode', coalesce(v_order.skus->>0, ''), 'supply_id', v_order.supply_id
    )
  );
end;
$$;

create or replace function public.scan_fbs_kiz(
  p_session_id uuid,
  p_device_id text,
  p_sgtin text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.fbs_marking_sessions%rowtype;
  v_order public.fbs_orders%rowtype;
  v_pair public.fbs_marking_pairs%rowtype;
  v_existing public.fbs_marking_pairs%rowtype;
  v_sgtin text := regexp_replace(coalesce(p_sgtin, ''), E'[\\r\\n\\t]+$', '');
  v_gtin text;
begin
  if v_sgtin ~ E'^\\][A-Za-z][0-9]' then v_sgtin := substring(v_sgtin from 4); end if;
  if v_sgtin ~ E'^\\(01\\)[0-9]{14}\\(21\\)' then
    v_sgtin := '01' || substring(v_sgtin from 5 for 14) || '21' || substring(v_sgtin from 23);
  end if;
  if not public.is_valid_fbs_kiz(v_sgtin) then
    raise exception 'Это не КИЗ: отсканируйте GS1 DataMatrix с GTIN и серийным номером';
  end if;
  v_gtin := substring(v_sgtin from 3 for 14);

  select * into v_session from public.fbs_marking_sessions
  where id = p_session_id and created_by = auth.uid() and device_id = p_device_id
  for update;
  if v_session.id is null or v_session.status not in ('active', 'partial') then raise exception 'Активная сессия устройства не найдена'; end if;
  if v_session.pending_order_id is null or v_session.pending_locked_until <= now() then
    update public.fbs_marking_sessions
    set pending_order_id = null, pending_wb_qr = null, pending_locked_until = null, updated_at = now()
    where id = v_session.id;
    raise exception 'Блокировка заказа истекла. Снова отсканируйте QR WB';
  end if;

  select * into v_order from public.fbs_orders
  where store_id = v_session.store_id and wb_order_id = v_session.pending_order_id
  for update;
  if v_order.id is null or v_order.supplier_status <> 'confirm' or coalesce(v_order.wb_system_status, '') <> 'waiting' then
    raise exception 'Заказ уже не находится на сборке';
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(coalesce(v_order.skus, '[]'::jsonb)) sku
    where trim(sku) ~ '^[0-9]{13,14}$'
  ) and not exists (
    select 1 from jsonb_array_elements_text(coalesce(v_order.skus, '[]'::jsonb)) sku
    where (char_length(trim(sku)) = 13 and ('0' || trim(sku)) = v_gtin)
       or (char_length(trim(sku)) = 14 and trim(sku) = v_gtin)
  ) then raise exception 'Этот КИЗ выпущен для другого товара: GTIN не совпадает с баркодом заказа'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_session.store_id::text || ':kiz:' || v_sgtin, 0));
  select * into v_existing from public.fbs_marking_pairs
  where store_id = v_session.store_id and sgtin = v_sgtin limit 1;
  if v_existing.id is not null then raise exception 'Этот КИЗ уже привязан к заказу %', v_existing.order_id; end if;

  insert into public.fbs_marking_pairs(
    session_id, account_id, store_id, order_id, wb_qr, sgtin,
    product_snapshot, created_by, device_id
  ) values (
    v_session.id, v_session.account_id, v_session.store_id,
    v_session.pending_order_id, v_session.pending_wb_qr, v_sgtin,
    jsonb_build_object(
      'nm_id', v_order.nm_id, 'article', v_order.article,
      'barcode', coalesce(v_order.skus->>0, ''), 'supply_id', v_order.supply_id
    ), auth.uid(), p_device_id
  ) returning * into v_pair;

  update public.fbs_marking_sessions
  set status = 'active', pending_order_id = null, pending_wb_qr = null,
      pending_locked_until = null, last_seen_at = now(), updated_at = now()
  where id = v_session.id;
  return to_jsonb(v_pair);
exception
  when unique_violation then raise exception 'Этот заказ, QR WB или КИЗ уже был отсканирован';
end;
$$;

revoke all on function public.is_valid_fbs_kiz(text) from public, anon;
grant execute on function public.is_valid_fbs_kiz(text) to authenticated;
revoke all on function public.scan_fbs_product_barcode(uuid, text, text) from public, anon;
grant execute on function public.scan_fbs_product_barcode(uuid, text, text) to authenticated;
revoke all on function public.scan_fbs_wb_qr(uuid, text, text, text) from public, anon;
grant execute on function public.scan_fbs_wb_qr(uuid, text, text, text) to authenticated;
revoke all on function public.scan_fbs_kiz(uuid, text, text) from public, anon;
grant execute on function public.scan_fbs_kiz(uuid, text, text) to authenticated;

-- Убираем уже сохранённые ошибочные «баркоды» (например, вспомогательный QR со стикера WB)
-- только на незавершённом этапе до выбора заказа. Валидные текущие циклы не затрагиваются.
update public.fbs_marking_sessions session_row
set pending_product_barcode = null,
    pending_locked_until = null,
    updated_at = now()
where session_row.pending_product_barcode is not null
  and session_row.pending_order_id is null
  and not exists (
    select 1
    from public.fbs_orders order_row
    where order_row.store_id = session_row.store_id
      and order_row.is_in_latest_snapshot = true
      and order_row.supplier_status = 'confirm'
      and coalesce(order_row.wb_system_status, '') = 'waiting'
      and exists (
        select 1 from jsonb_array_elements_text(coalesce(order_row.skus, '[]'::jsonb)) sku
        where trim(sku) = session_row.pending_product_barcode
      )
      and exists (
        select 1 from public.fbs_wb_qr_catalog catalog
        where catalog.store_id = order_row.store_id
          and catalog.order_id = order_row.wb_order_id
          and catalog.supports_sgtin = true
      )
  );

commit;
