-- FBS КИЗ: распознавание реального GS1 DataMatrix без связи с товаром/GTIN.
-- Связь товара с GTIN не является частью сканирования и здесь не хранится.

begin;

create or replace function public.is_valid_fbs_gtin14(p_gtin text)
returns boolean language plpgsql immutable strict set search_path = public
as $$
declare v_sum integer := 0; v_index integer;
begin
  if p_gtin !~ '^[0-9]{14}$' then return false; end if;
  for v_index in 1..13 loop
    v_sum := v_sum + substring(p_gtin from v_index for 1)::integer
      * case when mod(v_index, 2) = 1 then 3 else 1 end;
  end loop;
  return mod(10 - mod(v_sum, 10), 10) = substring(p_gtin from 14 for 1)::integer;
end;
$$;

create or replace function public.normalize_fbs_kiz(p_value text)
returns text language plpgsql immutable strict set search_path = public
as $$
declare
  v_code text := regexp_replace(p_value, E'[\r\n\t]+$', '');
  v_match text[];
begin
  v_code := replace(replace(replace(replace(
    v_code, chr(8203), ''), chr(8204), ''), chr(8205), ''), chr(65279), '');
  if v_code ~ E'^\][A-Za-z][0-9]' then v_code := substring(v_code from 4); end if;
  while left(v_code, 1) = chr(29) loop v_code := substring(v_code from 2); end loop;
  v_match := regexp_match(v_code, E'^\\(01\\)([0-9]{14})\\(21\\)(.+)$');
  if v_match is not null then v_code := '01' || v_match[1] || '21' || v_match[2]; end if;
  -- Аппаратный сканер может удалить внутренние GS и вернуть российский КМ
  -- плоской строкой: serial(13) + 91 + key(4) + 92 + crypto.
  v_match := regexp_match(v_code, E'^01([0-9]{14})21([!-~]{13})91([!-~]{4})92([!-~]+)$');
  if v_match is not null then
    v_code := '01' || v_match[1] || '21' || v_match[2]
      || chr(29) || '91' || v_match[3] || chr(29) || '92' || v_match[4];
  end if;
  v_match := regexp_match(v_code, E'^([0-9]{14})([!-~]{13})$');
  if v_match is not null then v_code := '01' || v_match[1] || '21' || v_match[2]; end if;
  return v_code;
end;
$$;

create or replace function public.is_valid_fbs_kiz(p_value text)
returns boolean language plpgsql immutable strict set search_path = public
as $$
declare
  v_code text := public.normalize_fbs_kiz(p_value);
  v_parts text[];
  v_index integer;
begin
  if char_length(v_code) not between 19 and 135 or v_code !~ '^01[0-9]{14}21' then return false; end if;
  if not public.is_valid_fbs_gtin14(substring(v_code from 3 for 14)) then return false; end if;
  v_parts := string_to_array(substring(v_code from 19), chr(29));
  if coalesce(array_length(v_parts, 1), 0) < 1
     or char_length(v_parts[1]) not between 1 and 20
     or v_parts[1] !~ '^[!-~]+$' then return false; end if;
  if coalesce(array_length(v_parts, 1), 0) > 1 then
    for v_index in 2..array_length(v_parts, 1) loop
      -- The cryptographic tail is verified by Wildberries. Here we only reject
      -- an empty section or scanner control garbage after a GS separator.
      if v_parts[v_index] = '' or v_parts[v_index] !~ '^[!-~]+$' then return false; end if;
    end loop;
  end if;
  return true;
end;
$$;

create or replace function public.scan_fbs_wb_qr(
  p_session_id uuid, p_device_id text, p_order_id text, p_wb_qr text
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_session public.fbs_marking_sessions%rowtype;
  v_order public.fbs_orders%rowtype;
  v_qr text := regexp_replace(coalesce(p_wb_qr, ''), E'[\r\n]+$', '');
  v_existing public.fbs_marking_pairs%rowtype;
  v_blocked public.fbs_marking_sessions%rowtype;
  v_allowed boolean;
begin
  select * into v_session from public.fbs_marking_sessions
  where id = p_session_id and created_by = auth.uid() and device_id = p_device_id for update;
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
  if v_order.supplier_status <> 'confirm' or coalesce(v_order.wb_system_status, '') <> 'waiting' then raise exception 'Заказ уже не находится на сборке'; end if;
  v_allowed := coalesce(v_order.data->'requiredMeta', '[]'::jsonb) ? 'sgtin'
    or coalesce(v_order.data->'optionalMeta', '[]'::jsonb) ? 'sgtin'
    or exists (select 1 from public.fbs_wb_qr_catalog catalog
      where catalog.store_id = v_session.store_id and catalog.order_id = p_order_id and catalog.supports_sgtin = true);
  if not v_allowed then raise exception 'Wildberries не разрешает КИЗ для этого заказа'; end if;
  if not exists (select 1 from public.fbs_wb_qr_catalog catalog
    where catalog.store_id = v_session.store_id and catalog.order_id = p_order_id
      and catalog.qr_value = v_qr and catalog.supports_sgtin = true) then
    raise exception 'Этот код не является официальным QR выбранного FBS-заказа WB';
  end if;

  select * into v_existing from public.fbs_marking_pairs
  where store_id = v_session.store_id and (order_id = p_order_id or wb_qr = v_qr) limit 1;
  if v_existing.id is not null then raise exception 'Этот QR WB или заказ уже отсканирован в другой паре'; end if;
  select * into v_blocked from public.fbs_marking_sessions
  where store_id = v_session.store_id and id <> v_session.id and status in ('active', 'partial')
    and pending_locked_until > now() and (pending_order_id = p_order_id or pending_wb_qr = v_qr) limit 1;
  if v_blocked.id is not null then raise exception 'Этот заказ сейчас сканируется на другом устройстве'; end if;

  update public.fbs_marking_sessions
  set pending_order_id = p_order_id, pending_wb_qr = v_qr,
      pending_locked_until = now() + interval '2 minutes', last_seen_at = now(), updated_at = now()
  where id = v_session.id;
  return jsonb_build_object(
    'order_id', p_order_id, 'wb_qr', v_qr, 'locked_until', now() + interval '2 minutes',
    'product', jsonb_build_object(
      'nm_id', v_order.nm_id, 'chrt_id', v_order.chrt_id, 'article', v_order.article,
      'barcode', coalesce(v_order.skus->>0, ''), 'supply_id', v_order.supply_id
    )
  );
end;
$$;

create or replace function public.scan_fbs_kiz(
  p_session_id uuid, p_device_id text, p_sgtin text
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_session public.fbs_marking_sessions%rowtype;
  v_order public.fbs_orders%rowtype;
  v_pair public.fbs_marking_pairs%rowtype;
  v_existing public.fbs_marking_pairs%rowtype;
  v_sgtin text := public.normalize_fbs_kiz(coalesce(p_sgtin, ''));
begin
  if not public.is_valid_fbs_kiz(v_sgtin) then
    raise exception 'Это не КИЗ: отсканируйте GS1 DataMatrix с GTIN и серийным номером';
  end if;
  select * into v_session from public.fbs_marking_sessions
  where id = p_session_id and created_by = auth.uid() and device_id = p_device_id for update;
  if v_session.id is null or v_session.status not in ('active', 'partial') then raise exception 'Активная сессия устройства не найдена'; end if;
  if v_session.pending_order_id is null or v_session.pending_locked_until <= now() then
    update public.fbs_marking_sessions set pending_order_id = null, pending_wb_qr = null,
      pending_locked_until = null, updated_at = now() where id = v_session.id;
    raise exception 'Блокировка заказа истекла. Снова отсканируйте QR WB';
  end if;
  select * into v_order from public.fbs_orders
  where store_id = v_session.store_id and wb_order_id = v_session.pending_order_id for update;
  if v_order.id is null or v_order.supplier_status <> 'confirm' or coalesce(v_order.wb_system_status, '') <> 'waiting' then
    raise exception 'Заказ уже не находится на сборке';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_session.account_id::text || ':kiz:' || v_sgtin, 0));
  select * into v_existing from public.fbs_marking_pairs
  where account_id = v_session.account_id and sgtin = v_sgtin limit 1;
  if v_existing.id is not null then raise exception 'Этот КИЗ уже использован в заказе %', v_existing.order_id; end if;

  insert into public.fbs_marking_pairs(
    session_id, account_id, store_id, order_id, wb_qr, sgtin,
    product_snapshot, created_by, device_id
  ) values (
    v_session.id, v_session.account_id, v_session.store_id,
    v_session.pending_order_id, v_session.pending_wb_qr, v_sgtin,
    jsonb_build_object(
      'nm_id', v_order.nm_id, 'chrt_id', v_order.chrt_id, 'article', v_order.article,
      'barcode', coalesce(v_session.pending_product_barcode, v_order.skus->>0, ''),
      'supply_id', v_order.supply_id
    ), auth.uid(), p_device_id
  ) returning * into v_pair;
  update public.fbs_marking_sessions
  set status = 'active', pending_order_id = null, pending_wb_qr = null,
      pending_locked_until = null, last_seen_at = now(), updated_at = now()
  where id = v_session.id;
  return to_jsonb(v_pair);
exception when unique_violation then raise exception 'Этот заказ, QR WB или КИЗ уже был отсканирован';
end;
$$;

drop function if exists public.get_fbs_product_gtin_link(uuid, text, text);
drop function if exists public.set_fbs_product_gtin_link(uuid, text, text, text);
drop table if exists public.fbs_product_gtin_links;

revoke all on function public.is_valid_fbs_gtin14(text) from public, anon;
grant execute on function public.is_valid_fbs_gtin14(text) to authenticated;
revoke all on function public.normalize_fbs_kiz(text) from public, anon;
grant execute on function public.normalize_fbs_kiz(text) to authenticated;
revoke all on function public.is_valid_fbs_kiz(text) from public, anon;
grant execute on function public.is_valid_fbs_kiz(text) to authenticated;
revoke all on function public.scan_fbs_wb_qr(uuid, text, text, text) from public, anon;
grant execute on function public.scan_fbs_wb_qr(uuid, text, text, text) to authenticated;
revoke all on function public.scan_fbs_kiz(uuid, text, text) from public, anon;
grant execute on function public.scan_fbs_kiz(uuid, text, text) to authenticated;

commit;
