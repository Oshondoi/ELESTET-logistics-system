-- Phone fulfillment camera.
-- Any signed-in user can look up one box by its exact QR (system barcode,
-- WB box barcode, or the print barcode). Writes stay on the existing
-- increment function plus a subtract that the increment function rejects.
begin;

create or replace function public.lookup_phone_fulfillment_box(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_code text := btrim(coalesce(p_code, ''));
  v_box public.fulfillment_boxes%rowtype;
  v_supply public.fulfillment_supplies%rowtype;
  v_batch public.fulfillment_batches%rowtype;
  v_stage public.batch_pipeline_stages%rowtype;
  v_store_name text;
  v_supplier text;
  v_current text;
  v_packing_done boolean := false;
  v_has_stage boolean := false;
  v_block text;
  v_items jsonb;
begin
  if auth.uid() is null then
    raise exception 'Нужно войти';
  end if;
  if v_code = '' then
    return jsonb_build_object('found', false);
  end if;

  select box.*
  into v_box
  from public.fulfillment_boxes box
  join public.fulfillment_supplies supply on supply.id = box.supply_id
  join public.fulfillment_batches batch on batch.id = supply.batch_id
  where batch.deleted_at is null
    and (
      box.barcode = v_code
      or box.wb_barcode = v_code
      or box.wb_external_barcode = v_code
    )
  order by public.can_manage_fulfillment_box(box.id) desc, box.created_at desc
  limit 1;

  if v_box.id is null then
    return jsonb_build_object('found', false);
  end if;

  select * into v_supply from public.fulfillment_supplies where id = v_box.supply_id;
  select * into v_batch from public.fulfillment_batches where id = v_supply.batch_id;
  if v_supply.pipeline_stage_id is not null then
    select * into v_stage
    from public.batch_pipeline_stages
    where id = v_supply.pipeline_stage_id;
    v_has_stage := found;
  end if;

  select store.name, store.supplier
  into v_store_name, v_supplier
  from public.stores store
  where store.id = v_batch.store_id;

  v_current := case when v_has_stage then v_stage.current_stage else v_batch.current_stage end;
  v_packing_done := coalesce(case when v_has_stage then v_stage.stage_packing end, v_batch.stage_packing, true)
    and (
      v_batch.status = 'done'
      or (v_has_stage and v_stage.status = 'done')
      or v_current in ('logistics', 'done')
    );

  if v_batch.status = 'cancelled' then
    v_block := 'cancelled';
  elsif v_has_stage and v_stage.status = 'pending' then
    v_block := 'not_started';
  elsif not public.can_manage_fulfillment_box(v_box.id) then
    v_block := 'no_access';
  else
    v_block := null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', item.id,
    'barcode', item.barcode,
    'qty', item.qty,
    'product_name', item.product_name,
    'vendor_code', prod.vendor_code,
    'nm_id', prod.nm_id,
    'in_catalog', prod.found
  ) order by item.created_at, item.barcode), '[]'::jsonb)
  into v_items
  from public.fulfillment_box_items item
  left join lateral (
    select p.vendor_code, p.nm_id::text as nm_id, true as found
    from public.products p
    where v_batch.store_id is not null
      and p.store_id = v_batch.store_id
      and exists (
        select 1
        from unnest(coalesce(p.barcodes, array[]::text[])) sku
        where btrim(sku) = btrim(item.barcode)
      )
    order by p.synced_at desc nulls last
    limit 1
  ) prod on true
  where item.box_id = v_box.id;

  return jsonb_build_object(
    'found', true,
    'box_id', v_box.id,
    'box_number', v_box.box_number,
    'barcode', v_box.barcode,
    'wb_barcode', v_box.wb_barcode,
    'wb_external_barcode', v_box.wb_external_barcode,
    'supply_id', v_supply.id,
    'supply_number', v_supply.supply_number,
    'batch_id', v_batch.id,
    'batch_short_id', v_batch.short_id,
    'batch_name', v_batch.name,
    'pipeline_stage_id', v_supply.pipeline_stage_id,
    'store_id', v_batch.store_id,
    'supplier', v_supplier,
    'store_name', v_store_name,
    'can_write', v_block is null,
    'packing_completed', v_packing_done,
    'block_reason', v_block,
    'items', v_items
  );
end;
$$;

create or replace function public.phone_store_barcode_lookup(p_store_id uuid, p_barcode text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_barcode text := btrim(coalesce(p_barcode, ''));
  v_vendor text;
  v_nm text;
  v_name text;
  v_found boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Нужно войти';
  end if;
  if p_store_id is null or v_barcode = '' then
    return jsonb_build_object('found', false);
  end if;

  if not (
    exists (
      select 1
      from public.stores store
      join public.account_members member on member.account_id = store.account_id
      where store.id = p_store_id
        and member.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.fulfillment_batches batch
      join public.fulfillment_supplies supply on supply.batch_id = batch.id
      where batch.store_id = p_store_id
        and batch.deleted_at is null
        and public.can_manage_fulfillment_supply(supply.id)
    )
  ) then
    raise exception 'Нет доступа к товарам магазина';
  end if;

  select p.vendor_code, p.nm_id::text, p.name, true
  into v_vendor, v_nm, v_name, v_found
  from public.products p
  where p.store_id = p_store_id
    and exists (
      select 1
      from unnest(coalesce(p.barcodes, array[]::text[])) sku
      where btrim(sku) = v_barcode
    )
  order by p.synced_at desc nulls last
  limit 1;

  return jsonb_build_object(
    'found', coalesce(v_found, false),
    'vendor_code', v_vendor,
    'nm_id', v_nm,
    'name', v_name
  );
end;
$$;

create or replace function public.remove_fulfillment_box_item_qty(
  p_box_id uuid,
  p_barcode text,
  p_qty integer,
  p_remove_all boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_barcode text := btrim(coalesce(p_barcode, ''));
  v_box public.fulfillment_boxes%rowtype;
  v_item public.fulfillment_box_items%rowtype;
  v_batch_status text;
begin
  if auth.uid() is null then
    raise exception 'Нужно войти';
  end if;
  if v_barcode = '' then
    raise exception 'Баркод не указан';
  end if;
  if not p_remove_all and coalesce(p_qty, 0) < 1 then
    raise exception 'Количество должно быть не меньше 1';
  end if;

  select * into v_box from public.fulfillment_boxes where id = p_box_id;
  if not found then
    raise exception 'Короб не найден';
  end if;
  if not public.can_manage_fulfillment_box(v_box.id) then
    raise exception 'Нет доступа к коробу';
  end if;

  select batch.status
  into v_batch_status
  from public.fulfillment_supplies supply
  join public.fulfillment_batches batch on batch.id = supply.batch_id
  where supply.id = v_box.supply_id;
  if v_batch_status = 'cancelled' then
    raise exception 'Партия отменена';
  end if;

  select *
  into v_item
  from public.fulfillment_box_items
  where box_id = v_box.id
    and btrim(barcode) = v_barcode
  for update;
  if not found then
    raise exception 'В коробе нет этого баркода';
  end if;

  if p_remove_all or p_qty >= v_item.qty then
    if not p_remove_all and p_qty > v_item.qty then
      raise exception 'Количество больше, чем в коробе';
    end if;
    delete from public.fulfillment_box_items where id = v_item.id;
    return jsonb_build_object('deleted', true, 'barcode', v_item.barcode);
  end if;

  update public.fulfillment_box_items
  set qty = qty - p_qty
  where id = v_item.id
  returning * into v_item;

  return jsonb_build_object(
    'deleted', false,
    'id', v_item.id,
    'barcode', v_item.barcode,
    'qty', v_item.qty
  );
end;
$$;

create index if not exists fulfillment_boxes_phone_barcode_idx
  on public.fulfillment_boxes (barcode) where barcode is not null;
create index if not exists fulfillment_boxes_phone_wb_barcode_idx
  on public.fulfillment_boxes (wb_barcode) where wb_barcode is not null;
create index if not exists fulfillment_boxes_phone_wb_external_barcode_idx
  on public.fulfillment_boxes (wb_external_barcode) where wb_external_barcode is not null;

revoke all on function public.lookup_phone_fulfillment_box(text) from public, anon;
revoke all on function public.phone_store_barcode_lookup(uuid, text) from public, anon;
revoke all on function public.remove_fulfillment_box_item_qty(uuid, text, integer, boolean) from public, anon;
grant execute on function public.lookup_phone_fulfillment_box(text) to authenticated;
grant execute on function public.phone_store_barcode_lookup(uuid, text) to authenticated;
grant execute on function public.remove_fulfillment_box_item_qty(uuid, text, integer, boolean) to authenticated;

commit;
