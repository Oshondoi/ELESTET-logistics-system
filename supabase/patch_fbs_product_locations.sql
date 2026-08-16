-- FBS: пакетный поиск товара по точному баркоду во всех актуальных коробах компании.
-- Возвращает и размещённые, и ещё не размещённые fulfillment-короба.

create or replace function public.get_fbs_product_locations(
  p_account_id uuid,
  p_barcodes text[]
)
returns table (
  product_barcode text,
  quantity integer,
  batch_id uuid,
  batch_number bigint,
  batch_name text,
  supply_id uuid,
  supply_number integer,
  box_id uuid,
  box_number integer,
  box_barcode text,
  warehouse_name text,
  rack_name text,
  side_name text,
  pallet_address text,
  slot_number integer,
  address_code text,
  address_text text,
  is_addressed boolean
)
language sql
stable
set search_path = public
as $$
  select
    bi.barcode as product_barcode,
    bi.qty::integer as quantity,
    batch.id as batch_id,
    batch.short_id::bigint as batch_number,
    batch.name as batch_name,
    supply.id as supply_id,
    supply.supply_number::integer as supply_number,
    box.id as box_id,
    box.box_number::integer as box_number,
    box.barcode as box_barcode,
    placement.warehouse_name,
    placement.rack_name,
    placement.side_name,
    placement.pallet_address,
    placement.slot_number,
    placement.address_code,
    placement.address_text,
    placement.item_id is not null as is_addressed
  from public.fulfillment_box_items bi
  join public.fulfillment_boxes box on box.id = bi.box_id
  join public.fulfillment_supplies supply on supply.id = box.supply_id
  join public.fulfillment_batches batch on batch.id = supply.batch_id
  left join lateral (
    select
      item.id as item_id,
      warehouse.name as warehouse_name,
      rack.name as rack_name,
      side.name as side_name,
      cell.col || cell.row::text as pallet_address,
      item.slot_number,
      format(
        'C%s_W%s_R%s_F%s_%s%s_K%s',
        account.short_id,
        warehouse.short_id,
        rack.short_id,
        side.position + 1,
        cell.col,
        cell.row,
        item.slot_number
      ) as address_code,
      format(
        '%s · %s · %s · %s%s-K%s',
        warehouse.name,
        rack.name,
        side.name,
        cell.col,
        cell.row,
        item.slot_number
      ) as address_text
    from public.wms_cell_items item
    join public.wms_cells cell on cell.id = item.cell_id
    join public.wms_zone_sides side on side.id = item.side_id
    join public.wms_zones rack on rack.id = cell.zone_id
    join public.wms_warehouses warehouse on warehouse.id = rack.warehouse_id
    join public.accounts account on account.id = item.account_id
    where item.fulfillment_box_id = box.id
    order by item.updated_at desc, item.created_at desc
    limit 1
  ) placement on true
  where bi.account_id = p_account_id
    and bi.barcode = any(coalesce(p_barcodes, array[]::text[]))
    and batch.deleted_at is null
    and batch.status <> 'cancelled'
    and not exists (
      select 1
      from public.trip_lines shipped_line
      where shipped_line.fulfillment_supply_id = supply.id
        and shipped_line.status = 'Отгружен'
    )
    and exists (
      select 1
      from public.account_members member
      where member.account_id = p_account_id
        and member.user_id = auth.uid()
    )
  order by bi.barcode, placement.item_id is null, batch.short_id, supply.supply_number, box.box_number;
$$;

revoke all on function public.get_fbs_product_locations(uuid, text[]) from public;
grant execute on function public.get_fbs_product_locations(uuid, text[]) to authenticated;
