-- Разрешает сканирование и привязку КИЗ для заказов «На сборке» и
-- «В доставке», пока Wildberries ещё не принял заказ (wb_system_status=waiting).

begin;

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
  if v_session.id is null or v_session.status not in ('active', 'partial') then
    raise exception 'Активная сессия устройства не найдена';
  end if;
  if char_length(v_qr) not between 1 and 300 then raise exception 'QR WB пустой или некорректный'; end if;
  if v_session.pending_order_id is not null and v_session.pending_locked_until > now() then
    raise exception 'Сначала отсканируйте КИЗ для заказа %', v_session.pending_order_id;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_session.store_id::text || ':order:' || p_order_id, 0));
  perform pg_advisory_xact_lock(hashtextextended(v_session.store_id::text || ':qr:' || v_qr, 0));

  select * into v_order from public.fbs_orders
  where store_id = v_session.store_id and wb_order_id = p_order_id and is_in_latest_snapshot = true;
  if v_order.id is null then raise exception 'Заказ WB не найден в актуальных данных магазина'; end if;
  if v_order.supplier_status not in ('confirm', 'complete') or coalesce(v_order.wb_system_status, '') <> 'waiting' then
    raise exception 'Заказ уже недоступен для КИЗ: он не находится на сборке или в доставке до приёмки WB';
  end if;
  v_allowed := coalesce(v_order.data->'requiredMeta', '[]'::jsonb) ? 'sgtin'
    or coalesce(v_order.data->'optionalMeta', '[]'::jsonb) ? 'sgtin'
    or exists (
      select 1 from public.fbs_wb_qr_catalog catalog
      where catalog.store_id = v_session.store_id
        and catalog.order_id = p_order_id
        and catalog.supports_sgtin = true
    );
  if not v_allowed then raise exception 'Wildberries не разрешает КИЗ для этого заказа'; end if;

  select * into v_existing from public.fbs_marking_pairs
  where store_id = v_session.store_id and (order_id = p_order_id or wb_qr = v_qr)
  limit 1;
  if v_existing.id is not null then
    raise exception 'Этот QR WB или заказ уже отсканирован в другой паре';
  end if;

  select * into v_blocked from public.fbs_marking_sessions
  where store_id = v_session.store_id and id <> v_session.id
    and status in ('active', 'partial') and pending_locked_until > now()
    and (pending_order_id = p_order_id or pending_wb_qr = v_qr)
  limit 1;
  if v_blocked.id is not null then
    raise exception 'Этот заказ сейчас сканируется на другом устройстве';
  end if;

  update public.fbs_marking_sessions
  set pending_order_id = p_order_id, pending_wb_qr = v_qr,
      pending_locked_until = now() + interval '2 minutes', last_seen_at = now(), updated_at = now()
  where id = v_session.id;

  return jsonb_build_object(
    'order_id', p_order_id,
    'wb_qr', v_qr,
    'locked_until', now() + interval '2 minutes',
    'product', jsonb_build_object(
      'nm_id', v_order.nm_id,
      'article', v_order.article,
      'barcode', coalesce(v_order.skus->>0, ''),
      'supply_id', v_order.supply_id
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
  v_sgtin text := regexp_replace(coalesce(p_sgtin, ''), E'[\\r\\n]+$', '');
begin
  if char_length(v_sgtin) not between 16 and 135 then
    raise exception 'КИЗ должен содержать от 16 до 135 символов';
  end if;
  select * into v_session from public.fbs_marking_sessions
  where id = p_session_id and created_by = auth.uid() and device_id = p_device_id
  for update;
  if v_session.id is null or v_session.status not in ('active', 'partial') then
    raise exception 'Активная сессия устройства не найдена';
  end if;
  if v_session.pending_order_id is null or v_session.pending_locked_until <= now() then
    update public.fbs_marking_sessions
    set pending_order_id = null, pending_wb_qr = null, pending_locked_until = null, updated_at = now()
    where id = v_session.id;
    raise exception 'Блокировка заказа истекла. Снова отсканируйте QR WB';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_session.store_id::text || ':kiz:' || v_sgtin, 0));
  select * into v_existing from public.fbs_marking_pairs
  where store_id = v_session.store_id and sgtin = v_sgtin limit 1;
  if v_existing.id is not null then
    raise exception 'Этот КИЗ уже привязан к заказу %', v_existing.order_id;
  end if;

  select * into v_order from public.fbs_orders
  where store_id = v_session.store_id and wb_order_id = v_session.pending_order_id
    and is_in_latest_snapshot = true
  for update;
  if v_order.id is null or v_order.supplier_status not in ('confirm', 'complete') or coalesce(v_order.wb_system_status, '') <> 'waiting' then
    raise exception 'Заказ уже недоступен для КИЗ: он не находится на сборке или в доставке до приёмки WB';
  end if;

  insert into public.fbs_marking_pairs(
    session_id, account_id, store_id, order_id, wb_qr, sgtin,
    product_snapshot, created_by, device_id
  ) values (
    v_session.id, v_session.account_id, v_session.store_id,
    v_session.pending_order_id, v_session.pending_wb_qr, v_sgtin,
    jsonb_build_object(
      'nm_id', v_order.nm_id,
      'article', v_order.article,
      'barcode', coalesce(v_order.skus->>0, ''),
      'supply_id', v_order.supply_id
    ), auth.uid(), p_device_id
  ) returning * into v_pair;

  update public.fbs_marking_sessions
  set status = 'active', pending_order_id = null, pending_wb_qr = null,
      pending_locked_until = null, last_seen_at = now(), updated_at = now()
  where id = v_session.id;
  return to_jsonb(v_pair);
exception
  when unique_violation then
    raise exception 'Этот заказ, QR WB или КИЗ уже был отсканирован';
end;
$$;

revoke all on function public.scan_fbs_wb_qr(uuid, text, text, text) from public, anon;
revoke all on function public.scan_fbs_kiz(uuid, text, text) from public, anon;
grant execute on function public.scan_fbs_wb_qr(uuid, text, text, text) to authenticated;
grant execute on function public.scan_fbs_kiz(uuid, text, text) to authenticated;

commit;
