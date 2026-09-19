-- Safe WB SKU/size barcode <-> Teksher GTIN links for fulfillment KIZ scans.
-- WB size SKUs (including restricted-circulation numbers beginning with 20)
-- are not required to equal the GTIN stored in AI (01) of a marking code.

begin;

create table if not exists public.fulfillment_product_gtin_links (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  wb_barcode text not null,
  gtin text not null,
  teksher_product_id bigint references public.teksher_products(id) on delete set null,
  wb_product_snapshot jsonb not null default '{}'::jsonb,
  teksher_product_snapshot jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  confirmed_by uuid references auth.users(id) on delete set null default auth.uid(),
  actor_name text,
  actor_email text,
  device_id text,
  device_name text,
  scanner_model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(wb_barcode) between 1 and 100),
  check (gtin ~ '^[0-9]{14}$'),
  unique (store_id, wb_barcode, gtin)
);

create index if not exists fulfillment_product_gtin_links_barcode_idx
  on public.fulfillment_product_gtin_links(store_id, wb_barcode)
  where active;
create index if not exists fulfillment_product_gtin_links_gtin_idx
  on public.fulfillment_product_gtin_links(store_id, gtin)
  where active;

alter table public.fulfillment_product_gtin_links enable row level security;

drop policy if exists "members view fulfillment product gtin links" on public.fulfillment_product_gtin_links;
create policy "members view fulfillment product gtin links"
  on public.fulfillment_product_gtin_links for select
  using (
    exists (
      select 1 from public.account_members member
      where member.account_id = fulfillment_product_gtin_links.account_id
        and member.user_id = auth.uid()
    )
  );

create or replace function public.prepare_fulfillment_kiz_link(
  p_box_id uuid,
  p_barcode text,
  p_gtin text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_box public.fulfillment_boxes%rowtype;
  v_supply public.fulfillment_supplies%rowtype;
  v_batch public.fulfillment_batches%rowtype;
  v_teksher public.teksher_products%rowtype;
  v_wb jsonb;
  v_barcode text := trim(coalesce(p_barcode, ''));
  v_gtin text := trim(coalesce(p_gtin, ''));
  v_linked boolean := false;
begin
  select * into v_box from public.fulfillment_boxes where id = p_box_id;
  if v_box.id is null then raise exception 'Короб не найден'; end if;
  select * into v_supply from public.fulfillment_supplies where id = v_box.supply_id;
  perform public.fulfillment_kiz_assert_editable(v_supply.id);
  if not v_supply.kiz_enabled then raise exception 'Режим КИЗ для этой поставки выключен'; end if;
  select * into v_batch from public.fulfillment_batches where id = v_supply.batch_id;
  if v_batch.store_id is null then raise exception 'У партии не выбран магазин WB'; end if;
  if v_barcode = '' then raise exception 'Баркод товара пустой'; end if;
  if v_gtin !~ '^[0-9]{14}$' then raise exception 'В КИЗ не найден корректный GTIN-14'; end if;

  select * into v_teksher
  from public.teksher_products product
  where product.store_id = v_batch.store_id and product.gtin = v_gtin
  limit 1;
  if v_teksher.id is null then
    raise exception 'GTIN % не найден среди синхронизированных товаров TekSher этого магазина. Синхронизируйте TekSher и повторите сканирование.', v_gtin;
  end if;

  select jsonb_build_object(
    'nm_id', product.nm_id,
    'name', product.name,
    'vendor_code', product.vendor_code,
    'brand', product.brand,
    'color', product.color,
    'size', (
      select size_row->>'techSize'
      from jsonb_array_elements(
        case when jsonb_typeof(to_jsonb(product.sizes)) = 'array' then to_jsonb(product.sizes) else '[]'::jsonb end
      ) size_row
      where coalesce(size_row->'skus', '[]'::jsonb) ? v_barcode
      limit 1
    ),
    'chrt_id', (
      select coalesce(size_row->>'chrtID', size_row->>'chrtId')
      from jsonb_array_elements(
        case when jsonb_typeof(to_jsonb(product.sizes)) = 'array' then to_jsonb(product.sizes) else '[]'::jsonb end
      ) size_row
      where coalesce(size_row->'skus', '[]'::jsonb) ? v_barcode
      limit 1
    )
  ) into v_wb
  from public.products product
  where product.account_id = v_supply.account_id
    and product.store_id = v_batch.store_id
    and coalesce(to_jsonb(product.barcodes), '[]'::jsonb) @> jsonb_build_array(v_barcode)
  limit 1;
  if v_wb is null then
    raise exception 'Баркод % не найден в актуальных товарах WB этого магазина. Обновите товары и повторите сканирование.', v_barcode;
  end if;

  select exists (
    select 1 from public.fulfillment_product_gtin_links link
    where link.store_id = v_batch.store_id
      and link.wb_barcode = v_barcode
      and link.gtin = v_gtin
      and link.active
  ) into v_linked;

  return jsonb_build_object(
    'linked', v_linked,
    'barcode', v_barcode,
    'gtin', v_gtin,
    'wb_product', coalesce(v_wb, '{}'::jsonb),
    'teksher_product', jsonb_build_object(
      'id', v_teksher.id,
      'teksher_id', v_teksher.teksher_id,
      'gtin', v_teksher.gtin,
      'name', v_teksher.name,
      'full_name', v_teksher.full_name,
      'trademark', v_teksher.trademark,
      'product_group_code', v_teksher.product_group_code,
      'attributes', coalesce(v_teksher.attributes, '[]'::jsonb)
    )
  );
end;
$$;

create or replace function public.confirm_fulfillment_kiz_link(
  p_box_id uuid,
  p_barcode text,
  p_gtin text,
  p_actor_name text default null,
  p_actor_email text default null,
  p_device_id text default null,
  p_device_name text default null,
  p_scanner_model text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prepared jsonb;
  v_box public.fulfillment_boxes%rowtype;
  v_supply public.fulfillment_supplies%rowtype;
  v_batch public.fulfillment_batches%rowtype;
  v_teksher_id bigint;
  v_link public.fulfillment_product_gtin_links%rowtype;
begin
  v_prepared := public.prepare_fulfillment_kiz_link(p_box_id, p_barcode, p_gtin);
  select * into v_box from public.fulfillment_boxes where id = p_box_id;
  select * into v_supply from public.fulfillment_supplies where id = v_box.supply_id;
  select * into v_batch from public.fulfillment_batches where id = v_supply.batch_id;
  v_teksher_id := nullif(v_prepared->'teksher_product'->>'id', '')::bigint;

  insert into public.fulfillment_product_gtin_links(
    account_id, store_id, wb_barcode, gtin, teksher_product_id,
    wb_product_snapshot, teksher_product_snapshot, active,
    actor_name, actor_email, device_id, device_name, scanner_model,
    confirmed_by, updated_at
  ) values (
    v_supply.account_id, v_batch.store_id, trim(p_barcode), trim(p_gtin), v_teksher_id,
    coalesce(v_prepared->'wb_product', '{}'::jsonb), coalesce(v_prepared->'teksher_product', '{}'::jsonb), true,
    nullif(left(coalesce(p_actor_name, ''), 160), ''),
    nullif(left(coalesce(p_actor_email, ''), 320), ''),
    nullif(left(coalesce(p_device_id, ''), 200), ''),
    nullif(left(coalesce(p_device_name, ''), 160), ''),
    nullif(left(coalesce(p_scanner_model, ''), 200), ''),
    auth.uid(), now()
  )
  on conflict (store_id, wb_barcode, gtin) do update set
    active = true,
    teksher_product_id = excluded.teksher_product_id,
    wb_product_snapshot = excluded.wb_product_snapshot,
    teksher_product_snapshot = excluded.teksher_product_snapshot,
    actor_name = excluded.actor_name,
    actor_email = excluded.actor_email,
    device_id = excluded.device_id,
    device_name = excluded.device_name,
    scanner_model = excluded.scanner_model,
    confirmed_by = auth.uid(),
    updated_at = now()
  returning * into v_link;

  return to_jsonb(v_link) || jsonb_build_object(
    'wb_product', v_prepared->'wb_product',
    'teksher_product', v_prepared->'teksher_product'
  );
end;
$$;

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
  if p_item_id is not null and not exists (
    select 1 from public.fulfillment_items item
    where item.id = p_item_id
      and item.batch_id = v_batch.id
      and trim(item.barcode) = v_barcode
  ) then raise exception 'Товар не относится к этой партии или его баркод не совпадает'; end if;
  if not public.fulfillment_is_valid_kiz(p_kiz_normalized) then raise exception 'Это не корректный КИЗ GS1 DataMatrix'; end if;
  if char_length(coalesce(p_device_id, '')) not between 8 and 200 then raise exception 'Не определено устройство сканирования'; end if;

  v_gtin := substring(p_kiz_normalized from 3 for 14);
  v_serial := split_part(substring(p_kiz_normalized from 19), chr(29), 1);
  if not exists (
    select 1 from public.fulfillment_product_gtin_links link
    where link.store_id = v_batch.store_id
      and link.wb_barcode = v_barcode
      and link.gtin = v_gtin
      and link.active
  ) then
    raise exception 'Связь баркода WB с GTIN TekSher не подтверждена. Проверьте товары и подтвердите связь.';
  end if;

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
  if exists (
    select 1 from public.fulfillment_kiz_pairs pair
    where pair.account_id = v_supply.account_id
      and pair.kiz_normalized = p_kiz_normalized
      and pair.status in ('draft', 'committed')
  ) then raise exception 'Этот КИЗ уже привязан в текущей партии компании'; end if;

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
  v_old jsonb;
  v_gtin text;
begin
  select * into v_pair from public.fulfillment_kiz_pairs where id = p_pair_id for update;
  if v_pair.id is null or v_pair.status not in ('draft', 'committed') then raise exception 'Активная пара КИЗ не найдена'; end if;
  perform public.fulfillment_kiz_assert_editable(v_pair.supply_id);
  if not public.fulfillment_is_valid_kiz(p_kiz_normalized) then raise exception 'Это не корректный КИЗ GS1 DataMatrix'; end if;
  v_gtin := substring(p_kiz_normalized from 3 for 14);
  if v_gtin <> v_pair.gtin and not exists (
    select 1 from public.fulfillment_product_gtin_links link
    where link.store_id = v_pair.store_id
      and link.wb_barcode = v_pair.barcode
      and link.gtin = v_gtin
      and link.active
  ) then
    raise exception 'Новый GTIN ещё не связан с этим баркодом WB. Сначала подтвердите связь в окне сканирования.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_pair.account_id::text || ':fulfillment-kiz:' || p_kiz_normalized, 0));
  if exists (
    select 1 from public.fulfillment_kiz_pairs other
    where other.account_id = v_pair.account_id and other.kiz_normalized = p_kiz_normalized
      and other.status in ('draft', 'committed') and other.id <> v_pair.id
  ) then raise exception 'Этот КИЗ уже привязан к другой единице товара'; end if;

  v_old := to_jsonb(v_pair);
  update public.fulfillment_kiz_pairs set
    kiz_raw = p_kiz_raw, kiz_normalized = p_kiz_normalized, gtin = v_gtin,
    serial_number = split_part(substring(p_kiz_normalized from 19), chr(29), 1),
    updated_at = now(), actor_name = nullif(left(coalesce(p_actor_name, actor_name, ''), 160), ''),
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

revoke all on function public.prepare_fulfillment_kiz_link(uuid,text,text) from public, anon;
revoke all on function public.confirm_fulfillment_kiz_link(uuid,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.prepare_fulfillment_kiz_link(uuid,text,text) to authenticated;
grant execute on function public.confirm_fulfillment_kiz_link(uuid,text,text,text,text,text,text,text) to authenticated;

commit;
