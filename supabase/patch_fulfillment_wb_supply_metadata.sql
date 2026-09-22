-- Cache the WB details needed by the fulfillment/box workflow before a supply
-- is transferred to Logistics. The fulfillment supply is the source of truth
-- for box labels; a linked trip line remains synchronized for Logistics.
begin;

alter table public.fulfillment_supplies
  add column if not exists wb_warehouse_id bigint,
  add column if not exists wb_warehouse_name text,
  add column if not exists wb_planned_delivery_date date,
  add column if not exists wb_cargo_type smallint,
  add column if not exists wb_synced_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fulfillment_supplies_wb_cargo_type_check'
      and conrelid = 'public.fulfillment_supplies'::regclass
  ) then
    alter table public.fulfillment_supplies
      add constraint fulfillment_supplies_wb_cargo_type_check
      check (wb_cargo_type is null or wb_cargo_type in (1, 2));
  end if;
end
$$;

comment on column public.fulfillment_supplies.wb_warehouse_name is
  'Destination warehouseName returned by GET /api/v1/supplies/{ID}';
comment on column public.fulfillment_supplies.wb_planned_delivery_date is
  'Supply date returned by WB for the linked FBW supply';
comment on column public.fulfillment_supplies.wb_cargo_type is
  'ELESTET WB cargo type: 1 = boxes, 2 = pallets';
comment on column public.fulfillment_supplies.wb_synced_at is
  'Timestamp of the latest successful WB supply details synchronization';

-- Existing linked supplies inherit the WB facts that were already synchronized
-- in Logistics, so old labels work without another WB request.
update public.fulfillment_supplies supply
set wb_warehouse_id = coalesce(supply.wb_warehouse_id, line.wb_warehouse_id),
    wb_warehouse_name = coalesce(supply.wb_warehouse_name, line.wb_warehouse_name),
    wb_planned_delivery_date = coalesce(supply.wb_planned_delivery_date, line.planned_marketplace_delivery_date),
    wb_cargo_type = coalesce(supply.wb_cargo_type, line.wb_cargo_type),
    wb_synced_at = coalesce(supply.wb_synced_at, line.wb_synced_at)
from public.trip_lines line
where supply.wb_supply_id is not null
  and (line.id = supply.trip_line_id or line.fulfillment_supply_id = supply.id);

-- When a fulfillment supply and a logistics line are linked later, preserve the
-- most useful already-synchronized side instead of losing it.
create or replace function public.merge_fulfillment_wb_metadata_on_link()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_line public.trip_lines%rowtype;
begin
  if new.trip_line_id is null then return new; end if;

  select * into v_line
  from public.trip_lines
  where id = new.trip_line_id
    and account_id = new.account_id;
  if not found then return new; end if;

  if new.wb_synced_at is not null
     or new.wb_warehouse_name is not null
     or new.wb_cargo_type is not null then
    update public.trip_lines
    set wb_warehouse_id = new.wb_warehouse_id,
        wb_warehouse_name = new.wb_warehouse_name,
        planned_marketplace_delivery_date = new.wb_planned_delivery_date,
        wb_cargo_type = new.wb_cargo_type,
        wb_synced_at = new.wb_synced_at
    where id = new.trip_line_id
      and account_id = new.account_id;
  elsif v_line.wb_synced_at is not null
        or v_line.wb_warehouse_name is not null
        or v_line.wb_cargo_type is not null then
    update public.fulfillment_supplies
    set wb_warehouse_id = v_line.wb_warehouse_id,
        wb_warehouse_name = v_line.wb_warehouse_name,
        wb_planned_delivery_date = v_line.planned_marketplace_delivery_date,
        wb_cargo_type = v_line.wb_cargo_type,
        wb_synced_at = v_line.wb_synced_at
    where id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists fulfillment_wb_metadata_link on public.fulfillment_supplies;
create trigger fulfillment_wb_metadata_link
after insert or update of trip_line_id on public.fulfillment_supplies
for each row execute function public.merge_fulfillment_wb_metadata_on_link();

-- A changed WB supply ID invalidates every cached WB fact and both WB box-code
-- identities. ELESTET barcodes, contents, quantities and KIZ links are untouched.
create or replace function public.set_fulfillment_wb_supply_id(p_supply_id uuid, p_wb_supply_id text)
returns void
language plpgsql
as $$
declare
  v_supply public.fulfillment_supplies%rowtype;
  v_new_id text := nullif(btrim(p_wb_supply_id), '');
begin
  select * into v_supply
  from public.fulfillment_supplies
  where id = p_supply_id
  for update;
  if not found then raise exception 'Поставка не найдена или недоступна'; end if;
  if v_new_id is not null and v_new_id !~ '^[0-9]+$' then
    raise exception 'Для FBO нужен числовой ID поставки WB, а не ID FBS вида WB-GI-…';
  end if;
  if v_supply.wb_supply_id is not distinct from v_new_id then return; end if;

  update public.fulfillment_boxes
  set wb_barcode = null,
      wb_external_barcode = null
  where supply_id = p_supply_id;

  update public.fulfillment_supplies
  set wb_supply_id = v_new_id,
      wb_warehouse_id = null,
      wb_warehouse_name = null,
      wb_planned_delivery_date = null,
      wb_cargo_type = null,
      wb_synced_at = null
  where id = p_supply_id;

  update public.trip_lines
  set wb_status_id = null,
      wb_cargo_type = null,
      wb_created_at = null,
      planned_marketplace_delivery_date = null,
      wb_acceptance_date = null,
      wb_updated_at = null,
      wb_acceptance_coefficient = null,
      wb_acceptance_cost = null,
      wb_reject_reason = null,
      wb_quantity = null,
      wb_ready_for_sale_quantity = null,
      wb_accepted_quantity = null,
      wb_unloading_quantity = null,
      wb_depersonalized_quantity = null,
      wb_warehouse_id = null,
      wb_warehouse_name = null,
      wb_actual_warehouse_id = null,
      wb_actual_warehouse_name = null,
      wb_transit_warehouse_id = null,
      wb_transit_warehouse_name = null,
      wb_package_codes = '{}'::text[],
      wb_goods_snapshot = '[]'::jsonb,
      wb_packages_snapshot = '[]'::jsonb,
      wb_synced_at = null
  where account_id = v_supply.account_id
    and (id = v_supply.trip_line_id or fulfillment_supply_id = p_supply_id);
end;
$$;

revoke all on function public.set_fulfillment_wb_supply_id(uuid, text) from public, anon;
grant execute on function public.set_fulfillment_wb_supply_id(uuid, text) to authenticated, service_role;

commit;
