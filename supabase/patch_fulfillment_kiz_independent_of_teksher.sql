-- Fulfillment intake records the physical barcode -> KIZ scan made by the
-- operator. A live TekSher cabinet and a pre-confirmed WB barcode -> GTIN link
-- are not prerequisites for receiving and packing the unit.

begin;

create or replace function public.create_fulfillment_kiz_draft(
  p_box_id uuid,
  p_barcode text,
  p_item_id uuid,
  p_product_name text,
  p_kiz_raw text,
  p_kiz_normalized text,
  p_product_snapshot jsonb default '{}'::jsonb,
  p_actor_name text default null,
  p_actor_email text default null,
  p_device_id text default null,
  p_device_name text default null,
  p_scanner_model text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_box public.fulfillment_boxes%rowtype;
  v_supply public.fulfillment_supplies%rowtype;
  v_batch public.fulfillment_batches%rowtype;
  v_pair public.fulfillment_kiz_pairs%rowtype;
  v_duplicate public.fulfillment_kiz_pairs%rowtype;
  v_gtin text;
  v_serial text;
  v_barcode text := trim(coalesce(p_barcode, ''));
  v_chz jsonb := '{}'::jsonb;
  v_chz_article text;
begin
  select * into v_box from public.fulfillment_boxes where id = p_box_id;
  if v_box.id is null then raise exception 'Короб не найден'; end if;
  select * into v_supply from public.fulfillment_supplies where id = v_box.supply_id;
  perform public.fulfillment_kiz_assert_editable(v_supply.id);
  if not v_supply.kiz_enabled then raise exception 'Режим КИЗ для этой поставки выключен'; end if;
  select * into v_batch from public.fulfillment_batches where id = v_supply.batch_id;
  if v_barcode = '' then raise exception 'Баркод товара пустой'; end if;
  if p_item_id is not null and not exists (
    select 1 from public.fulfillment_items item
    where item.id = p_item_id
      and item.batch_id = v_batch.id
      and trim(item.barcode) = v_barcode
  ) then raise exception 'Товар не относится к этой партии или его баркод не совпадает'; end if;
  if not public.fulfillment_is_valid_kiz(p_kiz_normalized) then
    raise exception 'Это не корректный КИЗ GS1 DataMatrix';
  end if;
  if char_length(coalesce(p_device_id, '')) not between 8 and 200 then
    raise exception 'Не определено устройство сканирования';
  end if;

  v_gtin := substring(p_kiz_normalized from 3 for 14);
  v_serial := split_part(substring(p_kiz_normalized from 19), chr(29), 1);

  -- Cached TekSher data can enrich a card, but its absence never blocks intake.
  if v_batch.store_id is not null then
    select jsonb_build_object(
      'honest_sign_name', product.name,
      'honest_sign_full_name', product.full_name,
      'honest_sign_article', coalesce(
        (select attribute->>'value'
         from jsonb_array_elements(case when jsonb_typeof(product.attributes) = 'array' then product.attributes else '[]'::jsonb end) attribute
         where lower(coalesce(attribute->>'name', '')) like '%артикул%'
            or lower(coalesce(attribute->>'attributeTypeCode', '')) like '%article%'
         limit 1),
        substring(product.full_name from '(?i)арт\.?[[:space:]]*([^,;[:space:]]+)'),
        null
      )
    ) into v_chz
    from public.teksher_products product
    where product.store_id = v_batch.store_id and product.gtin = v_gtin
    limit 1;
  end if;
  v_chz := coalesce(v_chz, '{}'::jsonb);
  v_chz_article := v_chz->>'honest_sign_article';

  perform pg_advisory_xact_lock(hashtextextended(v_supply.account_id::text || ':fulfillment-kiz:' || p_kiz_normalized, 0));
  select * into v_duplicate
  from public.fulfillment_kiz_pairs pair
  where pair.account_id = v_supply.account_id
    and pair.kiz_normalized = p_kiz_normalized
    and pair.status in ('draft', 'committed')
  limit 1;
  if v_duplicate.id is not null then
    raise exception 'Этот КИЗ уже сохранён: партия %, поставка %, короб №%',
      coalesce(v_duplicate.hierarchy_snapshot->>'batch_short_id', v_duplicate.batch_id::text, '—'),
      coalesce(v_duplicate.hierarchy_snapshot->>'supply_number', v_duplicate.supply_id::text, '—'),
      coalesce(v_duplicate.hierarchy_snapshot->>'box_number', v_duplicate.box_id::text, '—');
  end if;

  insert into public.fulfillment_kiz_pairs(
    account_id, store_id, batch_id, supply_id, box_id, item_id,
    barcode, kiz_raw, kiz_normalized, gtin, serial_number,
    product_snapshot, hierarchy_snapshot, actor_name, actor_email,
    device_id, device_name, scanner_model
  ) values (
    v_supply.account_id, v_batch.store_id, v_batch.id, v_supply.id, v_box.id, p_item_id,
    v_barcode, p_kiz_raw, p_kiz_normalized, v_gtin, v_serial,
    coalesce(p_product_snapshot, '{}'::jsonb) || v_chz || jsonb_build_object(
      'barcode', v_barcode, 'product_name', p_product_name, 'honest_sign_article', v_chz_article
    ),
    jsonb_build_object(
      'batch_id', v_batch.id, 'batch_short_id', v_batch.short_id, 'batch_name', v_batch.name,
      'supply_id', v_supply.id, 'supply_number', v_supply.supply_number,
      'box_id', v_box.id, 'box_number', v_box.box_number, 'box_barcode', v_box.barcode
    ),
    nullif(left(coalesce(p_actor_name, ''), 160), ''),
    nullif(left(coalesce(p_actor_email, ''), 320), ''),
    p_device_id, left(coalesce(nullif(p_device_name, ''), 'Устройство без имени'), 160),
    nullif(left(coalesce(p_scanner_model, ''), 200), '')
  ) returning * into v_pair;

  perform public.fulfillment_kiz_event(
    v_pair, 'draft_created', 'scan', null, null, to_jsonb(v_pair),
    p_actor_name, p_actor_email, p_device_id, p_device_name, p_scanner_model
  );
  return to_jsonb(v_pair);
end;
$$;

create or replace function public.relink_fulfillment_kiz_pair(
  p_pair_id uuid,
  p_kiz_raw text,
  p_kiz_normalized text,
  p_actor_name text default null,
  p_actor_email text default null,
  p_device_id text default null,
  p_device_name text default null,
  p_scanner_model text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_pair public.fulfillment_kiz_pairs%rowtype;
  v_duplicate public.fulfillment_kiz_pairs%rowtype;
  v_old jsonb;
  v_gtin text;
begin
  select * into v_pair from public.fulfillment_kiz_pairs where id = p_pair_id for update;
  if v_pair.id is null or v_pair.status not in ('draft', 'committed') then
    raise exception 'Активная пара КИЗ не найдена';
  end if;
  perform public.fulfillment_kiz_assert_editable(v_pair.supply_id);
  if not public.fulfillment_is_valid_kiz(p_kiz_normalized) then
    raise exception 'Это не корректный КИЗ GS1 DataMatrix';
  end if;
  v_gtin := substring(p_kiz_normalized from 3 for 14);

  perform pg_advisory_xact_lock(hashtextextended(v_pair.account_id::text || ':fulfillment-kiz:' || p_kiz_normalized, 0));
  select * into v_duplicate
  from public.fulfillment_kiz_pairs other
  where other.account_id = v_pair.account_id
    and other.kiz_normalized = p_kiz_normalized
    and other.status in ('draft', 'committed')
    and other.id <> v_pair.id
  limit 1;
  if v_duplicate.id is not null then
    raise exception 'Этот КИЗ уже сохранён: партия %, поставка %, короб №%',
      coalesce(v_duplicate.hierarchy_snapshot->>'batch_short_id', v_duplicate.batch_id::text, '—'),
      coalesce(v_duplicate.hierarchy_snapshot->>'supply_number', v_duplicate.supply_id::text, '—'),
      coalesce(v_duplicate.hierarchy_snapshot->>'box_number', v_duplicate.box_id::text, '—');
  end if;

  v_old := to_jsonb(v_pair);
  update public.fulfillment_kiz_pairs set
    kiz_raw = p_kiz_raw,
    kiz_normalized = p_kiz_normalized,
    gtin = v_gtin,
    serial_number = split_part(substring(p_kiz_normalized from 19), chr(29), 1),
    updated_at = now(),
    actor_name = nullif(left(coalesce(p_actor_name, actor_name, ''), 160), ''),
    actor_email = nullif(left(coalesce(p_actor_email, actor_email, ''), 320), ''),
    device_id = coalesce(nullif(p_device_id, ''), device_id),
    device_name = coalesce(nullif(p_device_name, ''), device_name),
    scanner_model = coalesce(nullif(p_scanner_model, ''), scanner_model)
  where id = v_pair.id returning * into v_pair;
  perform public.fulfillment_kiz_event(
    v_pair, 'pair_relinked', 'operator', 'КИЗ пары заменён', v_old, to_jsonb(v_pair),
    p_actor_name, p_actor_email, p_device_id, p_device_name, p_scanner_model
  );
  return to_jsonb(v_pair);
end;
$$;

revoke all on function public.create_fulfillment_kiz_draft(uuid,text,uuid,text,text,text,jsonb,text,text,text,text,text) from public, anon;
grant execute on function public.create_fulfillment_kiz_draft(uuid,text,uuid,text,text,text,jsonb,text,text,text,text,text) to authenticated;
revoke all on function public.relink_fulfillment_kiz_pair(uuid,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.relink_fulfillment_kiz_pair(uuid,text,text,text,text,text,text,text) to authenticated;

commit;
