-- Универсальный поиск по адресному складу.
-- Источником являются ВСЕ короба ФФ, а не только уже размещённые wms_cell_items.

create or replace function public.wms_search_key(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select regexp_replace(
    translate(lower(coalesce(p_value, '')), 'ё', 'е'),
    '[^a-zа-я0-9]+',
    '',
    'g'
  );
$$;

create index if not exists fulfillment_boxes_account_barcode_search_idx
  on public.fulfillment_boxes(account_id, barcode);
create index if not exists fulfillment_box_items_account_barcode_search_idx
  on public.fulfillment_box_items(account_id, barcode);
create index if not exists fulfillment_batches_account_store_short_search_idx
  on public.fulfillment_batches(account_id, store_id, short_id);
create index if not exists fulfillment_supplies_account_number_search_idx
  on public.fulfillment_supplies(account_id, supply_number);
create index if not exists products_barcodes_search_idx
  on public.products using gin(barcodes);
create index if not exists stores_name_search_trgm_idx
  on public.stores using gin(lower(name) gin_trgm_ops);
create index if not exists stores_code_search_trgm_idx
  on public.stores using gin(lower(store_code) gin_trgm_ops);
create index if not exists products_name_search_trgm_idx
  on public.products using gin(lower(coalesce(name, '')) gin_trgm_ops);
create index if not exists products_vendor_search_trgm_idx
  on public.products using gin(lower(coalesce(vendor_code, '')) gin_trgm_ops);

create or replace function public.search_wms_locations(
  p_account_id uuid,
  p_query text,
  p_limit integer default 100
)
returns jsonb
language sql
stable
set search_path = public
as $$
  with params as (
    select
      trim(coalesce(p_query, '')) as q_text,
      lower(trim(coalesce(p_query, ''))) as q_lower,
      public.wms_search_key(p_query) as q_key,
      greatest(1, least(coalesce(p_limit, 100), 300)) as row_limit
  ),
  boxes as (
    select
      fb.id as box_id,
      fb.box_number,
      coalesce(fb.barcode, '') as box_barcode,
      fs.id as supply_id,
      fs.supply_number,
      fs.warehouse_name as destination_warehouse,
      batch.id as batch_id,
      batch.short_id as batch_number,
      batch.name as batch_name,
      store.id as store_id,
      store.name as store_name,
      store.store_code,
      store.supplier as store_supplier,
      placement.item_id,
      placement.warehouse_id,
      placement.warehouse_name,
      placement.rack_id,
      placement.rack_name,
      placement.side_id,
      placement.side_name,
      placement.col,
      placement.row,
      placement.slot_number,
      placement.address_code,
      placement.address_text,
      placement.item_id is not null as is_addressed,
      coalesce(content.units, 0) as units,
      coalesce(content.product_barcodes, array[]::text[]) as product_barcodes,
      coalesce(content.product_names, array[]::text[]) as product_names,
      coalesce(content.vendor_articles, array[]::text[]) as vendor_articles,
      coalesce(content.wb_articles, array[]::text[]) as wb_articles,
      coalesce(content.brands, array[]::text[]) as brands,
      coalesce(content.colors, array[]::text[]) as colors,
      coalesce(content.sizes, array[]::text[]) as sizes,
      coalesce(store_stats.total_boxes, 0) as store_total_boxes,
      coalesce(store_stats.addressed_boxes, 0) as store_addressed_boxes,
      coalesce(store_stats.unaddressed_boxes, 0) as store_unaddressed_boxes
    from public.fulfillment_boxes fb
    join public.fulfillment_supplies fs on fs.id = fb.supply_id
    join public.fulfillment_batches batch on batch.id = fs.batch_id
    left join public.stores store on store.id = batch.store_id and store.deleted_at is null
    left join lateral (
      select
        wi.id as item_id,
        w.id as warehouse_id,
        w.name as warehouse_name,
        z.id as rack_id,
        z.name as rack_name,
        side.id as side_id,
        side.name as side_name,
        cell.col,
        cell.row,
        wi.slot_number,
        format(
          'C%s_W%s_R%s_F%s_%s%s_K%s',
          account.short_id,
          w.short_id,
          z.short_id,
          side.position + 1,
          cell.col,
          cell.row,
          wi.slot_number
        ) as address_code,
        format(
          '%s · %s · %s · %s%s-K%s',
          w.name,
          z.name,
          side.name,
          cell.col,
          cell.row,
          wi.slot_number
        ) as address_text
      from public.wms_cell_items wi
      join public.wms_cells cell on cell.id = wi.cell_id
      join public.wms_zone_sides side on side.id = wi.side_id
      join public.wms_zones z on z.id = cell.zone_id
      join public.wms_warehouses w on w.id = z.warehouse_id
      join public.accounts account on account.id = wi.account_id
      where wi.fulfillment_box_id = fb.id
      order by wi.updated_at desc, wi.created_at desc
      limit 1
    ) placement on true
    left join lateral (
      select
        coalesce(sum(bi.qty), 0)::integer as units,
        array_remove(array_agg(distinct nullif(bi.barcode, '')), null) as product_barcodes,
        array_remove(array_agg(distinct coalesce(
          nullif(product.name, ''),
          nullif(fi.product_name, ''),
          nullif(bi.product_name, '')
        )), null) as product_names,
        array_remove(array_agg(distinct coalesce(nullif(product.vendor_code, ''), nullif(fi.article, ''))), null) as vendor_articles,
        array_remove(array_agg(distinct nullif(product.nm_id::text, '')), null) as wb_articles,
        array_remove(array_agg(distinct nullif(product.brand, '')), null) as brands,
        array_remove(array_agg(distinct coalesce(nullif(fi.color, ''), nullif(product.color, ''))), null) as colors,
        array_remove(array_agg(distinct coalesce(nullif(fi.size, ''), nullif(product.tech_size, ''))), null) as sizes
      from public.fulfillment_box_items bi
      left join public.fulfillment_items fi on fi.id = bi.item_id
      left join lateral (
        select
          p.nm_id,
          p.vendor_code,
          p.name,
          p.brand,
          p.color,
          matched_size.tech_size
        from public.products p
        left join lateral (
          select size_item ->> 'techSize' as tech_size
          from jsonb_array_elements(coalesce(p.sizes, '[]'::jsonb)) size_item
          where exists (
            select 1
            from jsonb_array_elements_text(coalesce(size_item -> 'skus', '[]'::jsonb)) sku
            where sku = bi.barcode
          )
          limit 1
        ) matched_size on true
        where p.store_id = batch.store_id
          and (
            bi.barcode = any(coalesce(p.barcodes, array[]::text[]))
            or (fi.article is not null and p.nm_id::text = fi.article)
          )
        order by (bi.barcode = any(coalesce(p.barcodes, array[]::text[]))) desc
        limit 1
      ) product on true
      where bi.box_id = fb.id
    ) content on true
    left join lateral (
      select
        count(*)::integer as total_boxes,
        count(*) filter (where placed.fulfillment_box_id is not null)::integer as addressed_boxes,
        count(*) filter (where placed.fulfillment_box_id is null)::integer as unaddressed_boxes
      from public.fulfillment_batches b2
      join public.fulfillment_supplies fs2 on fs2.batch_id = b2.id
      join public.fulfillment_boxes fb2 on fb2.supply_id = fs2.id
      left join public.wms_cell_items placed on placed.fulfillment_box_id = fb2.id
      where b2.account_id = p_account_id
        and b2.store_id is not distinct from batch.store_id
        and b2.deleted_at is null
        and b2.status <> 'cancelled'
        and not exists (
          select 1
          from public.trip_lines shipped_line
          where shipped_line.fulfillment_supply_id = fs2.id
            and shipped_line.status = 'Отгружен'
        )
    ) store_stats on true
    where fb.account_id = p_account_id
      and batch.deleted_at is null
      and batch.status <> 'cancelled'
      and not exists (
        select 1
        from public.trip_lines shipped_line
        where shipped_line.fulfillment_supply_id = fs.id
          and shipped_line.status = 'Отгружен'
      )
      and exists (
        select 1
        from public.account_members member
        where member.account_id = p_account_id
          and member.user_id = auth.uid()
      )
  ),
  searchable as (
    select
      boxes.*,
      public.wms_search_key(concat_ws(' ',
        box_barcode,
        box_number,
        'B' || box_number,
        supply_number,
        'S' || supply_number,
        batch_number,
        'P' || batch_number,
        batch_name,
        store_name,
        store_code,
        store_supplier,
        destination_warehouse,
        address_code,
        address_text,
        array_to_string(product_barcodes, ' '),
        array_to_string(product_names, ' '),
        array_to_string(vendor_articles, ' '),
        array_to_string(wb_articles, ' '),
        array_to_string(brands, ' '),
        array_to_string(colors, ' '),
        array_to_string(sizes, ' ')
      )) as all_keys,
      lower(concat_ws(' ',
        batch_name,
        store_name,
        store_code,
        store_supplier,
        destination_warehouse,
        address_text,
        array_to_string(product_names, ' '),
        array_to_string(vendor_articles, ' '),
        array_to_string(brands, ' '),
        array_to_string(colors, ' '),
        array_to_string(sizes, ' ')
      )) as words
    from boxes
  ),
  ranked as (
    select
      searchable.*,
      case
        when params.q_key = '' then 1
        when public.wms_search_key(box_barcode) = params.q_key then 1000
        when exists (select 1 from unnest(product_barcodes) value where public.wms_search_key(value) = params.q_key) then 990
        when public.wms_search_key(address_code) = params.q_key then 980
        when public.wms_search_key(store_code) = params.q_key then 970
        when exists (select 1 from unnest(wb_articles) value where public.wms_search_key(value) = params.q_key) then 960
        when exists (select 1 from unnest(vendor_articles) value where public.wms_search_key(value) = params.q_key) then 950
        when public.wms_search_key('P' || batch_number) = params.q_key then 940
        when public.wms_search_key('S' || supply_number) = params.q_key then 930
        when public.wms_search_key('B' || box_number) = params.q_key then 920
        when lower(coalesce(store_name, '')) = params.q_lower then 910
        when lower(coalesce(batch_name, '')) = params.q_lower then 900
        when position(params.q_key in all_keys) > 0 then 700
        when position(params.q_lower in words) > 0 then 650
        when greatest(
          similarity(lower(coalesce(store_name, '')), params.q_lower),
          similarity(lower(coalesce(batch_name, '')), params.q_lower),
          similarity(lower(array_to_string(product_names, ' ')), params.q_lower)
        ) >= 0.28 then 400
        else 0
      end as match_rank,
      case
        when public.wms_search_key(box_barcode) = params.q_key then 'QR / ШК короба'
        when exists (select 1 from unnest(product_barcodes) value where public.wms_search_key(value) = params.q_key) then 'Баркод товара'
        when public.wms_search_key(address_code) = params.q_key then 'QR адреса'
        when public.wms_search_key(store_code) = params.q_key then 'Код магазина'
        when exists (select 1 from unnest(wb_articles) value where public.wms_search_key(value) = params.q_key) then 'Артикул WB'
        when exists (select 1 from unnest(vendor_articles) value where public.wms_search_key(value) = params.q_key) then 'Артикул продавца'
        when public.wms_search_key('P' || batch_number) = params.q_key then 'ID партии'
        when public.wms_search_key('S' || supply_number) = params.q_key then 'ID поставки'
        when public.wms_search_key('B' || box_number) = params.q_key then 'Номер короба'
        when lower(coalesce(store_name, '')) = params.q_lower then 'Название магазина'
        when lower(coalesce(batch_name, '')) = params.q_lower then 'Название партии'
        when position(params.q_key in public.wms_search_key(concat_ws(' ', store_name, store_code, store_supplier))) > 0 then 'Магазин'
        when position(params.q_key in public.wms_search_key(array_to_string(product_names, ' '))) > 0 then 'Название товара'
        when position(params.q_key in public.wms_search_key(concat_ws(' ', address_code, address_text))) > 0 then 'Адрес'
        when position(params.q_key in all_keys) > 0 then 'Частичное совпадение'
        else 'Похожее название'
      end as match_reason
    from searchable
    cross join params
  ),
  matched as (
    select ranked.*, count(*) over()::integer as total_matches
    from ranked
    where match_rank > 0
  ),
  limited as (
    select *
    from matched
    order by match_rank desc, store_name nulls last, batch_number desc nulls last, supply_number, box_number
    limit (select row_limit from params)
  )
  select coalesce(
    jsonb_agg(to_jsonb(limited) - 'all_keys' - 'words' - 'match_rank'),
    '[]'::jsonb
  )
  from limited;
$$;

grant execute on function public.wms_search_key(text) to authenticated;
grant execute on function public.search_wms_locations(uuid, text, integer) to authenticated;
