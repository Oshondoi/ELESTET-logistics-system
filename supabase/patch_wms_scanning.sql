-- Stable WMS address codes and exact, scan-driven placement.
-- Location QR: C1_W1_R1_S1_A1 or C1_W1_R1_S1_A1_K6.

alter table public.wms_warehouses
  add column if not exists short_id integer;

alter table public.wms_zones
  add column if not exists short_id integer;

with numbered as (
  select pending.id,
    coalesce(existing.max_id, 0) + row_number() over (partition by pending.account_id order by pending.created_at, pending.id)::integer as short_id
  from public.wms_warehouses pending
  left join (
    select account_id, max(short_id) as max_id from public.wms_warehouses where short_id is not null group by account_id
  ) existing on existing.account_id = pending.account_id
  where pending.short_id is null
)
update public.wms_warehouses w
set short_id = numbered.short_id
from numbered
where numbered.id = w.id;

with numbered as (
  select pending.id,
    coalesce(existing.max_id, 0) + row_number() over (partition by pending.warehouse_id order by pending.created_at, pending.id)::integer as short_id
  from public.wms_zones pending
  left join (
    select warehouse_id, max(short_id) as max_id from public.wms_zones where short_id is not null group by warehouse_id
  ) existing on existing.warehouse_id = pending.warehouse_id
  where pending.short_id is null
)
update public.wms_zones z
set short_id = numbered.short_id
from numbered
where numbered.id = z.id;

alter table public.wms_warehouses alter column short_id set not null;
alter table public.wms_zones alter column short_id set not null;

create unique index if not exists wms_warehouses_account_short_id_uidx
  on public.wms_warehouses(account_id, short_id);
create unique index if not exists wms_zones_warehouse_short_id_uidx
  on public.wms_zones(warehouse_id, short_id);

create or replace function public.assign_wms_short_id()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'wms_warehouses' then
    if new.short_id is null then
      perform pg_advisory_xact_lock(hashtext('wms-warehouse:' || new.account_id::text));
      select coalesce(max(short_id), 0) + 1 into new.short_id
      from public.wms_warehouses where account_id = new.account_id;
    end if;
  elsif tg_table_name = 'wms_zones' then
    if new.short_id is null then
      perform pg_advisory_xact_lock(hashtext('wms-rack:' || new.warehouse_id::text));
      select coalesce(max(short_id), 0) + 1 into new.short_id
      from public.wms_zones where warehouse_id = new.warehouse_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_wms_warehouse_short_id on public.wms_warehouses;
create trigger trg_assign_wms_warehouse_short_id
before insert on public.wms_warehouses
for each row execute function public.assign_wms_short_id();

drop trigger if exists trg_assign_wms_zone_short_id on public.wms_zones;
create trigger trg_assign_wms_zone_short_id
before insert on public.wms_zones
for each row execute function public.assign_wms_short_id();

create or replace function public.protect_wms_short_id()
returns trigger
language plpgsql
as $$
begin
  if new.short_id is distinct from old.short_id then
    raise exception 'Системный ID адреса нельзя изменять';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_wms_warehouse_short_id on public.wms_warehouses;
create trigger trg_protect_wms_warehouse_short_id
before update of short_id on public.wms_warehouses
for each row execute function public.protect_wms_short_id();

drop trigger if exists trg_protect_wms_zone_short_id on public.wms_zones;
create trigger trg_protect_wms_zone_short_id
before update of short_id on public.wms_zones
for each row execute function public.protect_wms_short_id();

create or replace function public.get_wms_scan_target(p_code text)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_code text := upper(trim(coalesce(p_code, '')));
  v_match text[];
  v_account_id uuid;
  v_warehouse public.wms_warehouses%rowtype;
  v_zone public.wms_zones%rowtype;
  v_side public.wms_zone_sides%rowtype;
  v_cell public.wms_cells%rowtype;
  v_box public.fulfillment_boxes%rowtype;
  v_placement record;
  v_col text;
  v_row integer;
  v_slot integer;
  v_filled integer;
  v_slots jsonb;
begin
  if v_code = 'EL_WMS_RESET_V1' then
    return jsonb_build_object('kind', 'reset', 'code', v_code);
  end if;

  v_match := regexp_match(v_code, '^C([0-9]+)_W([0-9]+)_R([0-9]+)_S([0-9]+)_([A-Z])([0-9]+)_K([0-9]+)$');
  if v_match is null then
    v_match := regexp_match(v_code, '^C([0-9]+)_W([0-9]+)_R([0-9]+)_S([0-9]+)_([A-Z])([0-9]+)$');
  end if;
  if v_match is not null then
    select a.id into v_account_id
    from public.accounts a
    join public.account_members am on am.account_id = a.id and am.user_id = auth.uid()
    where a.short_id = v_match[1]::integer;
    if v_account_id is null then raise exception 'Компания из QR не найдена или недоступна'; end if;

    select * into v_warehouse from public.wms_warehouses
    where account_id = v_account_id and short_id = v_match[2]::integer;
    if v_warehouse.id is null then raise exception 'Склад из QR не найден'; end if;

    select * into v_zone from public.wms_zones
    where warehouse_id = v_warehouse.id and short_id = v_match[3]::integer;
    if v_zone.id is null then raise exception 'Стеллаж из QR не найден'; end if;

    select * into v_side from public.wms_zone_sides
    where zone_id = v_zone.id and position = v_match[4]::integer - 1;
    if v_side.id is null then raise exception 'Сторона стеллажа из QR не найдена'; end if;

    v_col := v_match[5];
    v_row := v_match[6]::integer;
    v_slot := nullif(v_match[7], '')::integer;
    if ascii(v_col) - 64 > v_zone.cols or v_row < 1 or v_row > v_zone.rows then
      raise exception 'Паллетоместо из QR находится за границами стеллажа';
    end if;
    if v_slot is not null and (v_slot < 1 or v_slot > v_side.slot_count) then
      raise exception 'Коробоместо из QR находится за границами паллеты';
    end if;

    select * into v_cell from public.wms_cells
    where zone_id = v_zone.id and col = v_col and row = v_row;

    select count(*)::integer into v_filled
    from public.wms_cell_items i
    where i.cell_id = v_cell.id and i.side_id = v_side.id and i.item_type = 'box';

    select coalesce(jsonb_agg(jsonb_build_object(
      'number', numbers.slot_number,
      'occupied', placed.id is not null,
      'boxId', placed.fulfillment_box_id,
      'boxNumber', fb.box_number,
      'boxBarcode', fb.barcode
    ) order by numbers.slot_number), '[]'::jsonb)
    into v_slots
    from generate_series(1, v_side.slot_count) numbers(slot_number)
    left join public.wms_cell_items placed
      on placed.cell_id = v_cell.id and placed.side_id = v_side.id
      and placed.slot_number = numbers.slot_number and placed.item_type = 'box'
    left join public.fulfillment_boxes fb on fb.id = placed.fulfillment_box_id;

    return jsonb_build_object(
      'kind', case when v_slot is null then 'pallet' else 'slot' end,
      'code', v_code,
      'accountId', v_account_id,
      'accountShortId', v_match[1]::integer,
      'warehouseId', v_warehouse.id,
      'warehouseShortId', v_warehouse.short_id,
      'warehouseName', v_warehouse.name,
      'rackId', v_zone.id,
      'rackShortId', v_zone.short_id,
      'rackName', v_zone.name,
      'sideId', v_side.id,
      'sideNumber', v_side.position + 1,
      'sideName', v_side.name,
      'pallet', v_col || v_row::text,
      'col', v_col,
      'row', v_row,
      'slotNumber', v_slot,
      'slotCount', v_side.slot_count,
      'slotColumns', v_side.slot_columns,
      'slotRows', v_side.slot_rows,
      'filled', v_filled,
      'full', v_filled >= v_side.slot_count,
      'status', coalesce(v_cell.status, 'free'),
      'slots', v_slots
    );
  end if;

  select b.* into v_box
  from public.fulfillment_boxes b
  join public.account_members am on am.account_id = b.account_id and am.user_id = auth.uid()
  where upper(b.barcode) = v_code;
  if v_box.id is null then raise exception 'QR / ШК не распознан'; end if;

  select
    i.id as item_id, c.col, c.row, s.position + 1 as side_number,
    i.slot_number, z.name as rack_name, w.name as warehouse_name,
    a.short_id as account_short_id, w.short_id as warehouse_short_id,
    z.short_id as rack_short_id
  into v_placement
  from public.wms_cell_items i
  join public.wms_cells c on c.id = i.cell_id
  join public.wms_zone_sides s on s.id = i.side_id
  join public.wms_zones z on z.id = c.zone_id
  join public.wms_warehouses w on w.id = z.warehouse_id
  join public.accounts a on a.id = i.account_id
  where i.fulfillment_box_id = v_box.id;

  return jsonb_build_object(
    'kind', 'box',
    'code', v_code,
    'boxId', v_box.id,
    'boxNumber', v_box.box_number,
    'barcode', v_box.barcode,
    'placed', v_placement.item_id is not null,
    'itemId', v_placement.item_id,
    'addressCode', case when v_placement.item_id is null then null else format(
      'C%s_W%s_R%s_S%s_%s%s_K%s', v_placement.account_short_id,
      v_placement.warehouse_short_id, v_placement.rack_short_id,
      v_placement.side_number, v_placement.col, v_placement.row,
      v_placement.slot_number
    ) end,
    'addressText', case when v_placement.item_id is null then null else format(
      '%s · %s · Сторона %s · %s%s-K%s', v_placement.warehouse_name,
      v_placement.rack_name, v_placement.side_number, v_placement.col,
      v_placement.row, v_placement.slot_number
    ) end
  );
end;
$$;

grant execute on function public.get_wms_scan_target(text) to authenticated;

create or replace function public.place_wms_box_by_scan(
  p_box_barcode text,
  p_location_code text,
  p_confirm_move boolean default false,
  p_confirm_swap boolean default false
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_target jsonb;
  v_box public.fulfillment_boxes%rowtype;
  v_source public.wms_cell_items%rowtype;
  v_target_item public.wms_cell_items%rowtype;
  v_target_cell_id uuid;
  v_source_cell_id uuid;
begin
  v_target := public.get_wms_scan_target(p_location_code);
  if v_target->>'kind' <> 'slot' then
    raise exception 'Для размещения выберите или отсканируйте конкретное место K';
  end if;
  if v_target->>'status' in ('reserved', 'disabled') then
    raise exception 'Паллетоместо недоступно для заполнения';
  end if;

  select * into v_box from public.fulfillment_boxes
  where account_id = (v_target->>'accountId')::uuid
    and upper(barcode) = upper(trim(p_box_barcode))
  for update;
  if v_box.id is null then raise exception 'Короб не найден или относится к другой компании'; end if;

  select * into v_source from public.wms_cell_items
  where fulfillment_box_id = v_box.id for update;
  v_source_cell_id := v_source.cell_id;

  select id into v_target_cell_id from public.wms_cells
  where zone_id = (v_target->>'rackId')::uuid
    and col = v_target->>'col' and row = (v_target->>'row')::integer;

  select * into v_target_item from public.wms_cell_items
  where cell_id = v_target_cell_id
    and side_id = (v_target->>'sideId')::uuid
    and slot_number = (v_target->>'slotNumber')::integer
    and item_type = 'box'
  for update;

  if v_source.id is not null
     and v_source.cell_id = v_target_cell_id
     and v_source.side_id = (v_target->>'sideId')::uuid
     and v_source.slot_number = (v_target->>'slotNumber')::integer then
    return jsonb_build_object('action', 'none', 'message', 'Короб уже находится в этом месте');
  end if;

  if v_source.id is null then
    if v_target_item.id is not null then
      raise exception 'Коробоместо K% уже занято. Выберите другое место', v_target->>'slotNumber';
    end if;
    if (v_target->>'full')::boolean then
      raise exception 'Паллетоместо заполнено. Дальнейшее заполнение заблокировано';
    end if;
    if v_target_cell_id is null then
      insert into public.wms_cells (zone_id, account_id, col, row, status)
      values (
        (v_target->>'rackId')::uuid, (v_target->>'accountId')::uuid,
        v_target->>'col', (v_target->>'row')::integer, 'occupied'
      )
      returning id into v_target_cell_id;
    end if;
    insert into public.wms_cell_items (
      cell_id, account_id, item_type, barcode, product_name, qty,
      reserved_qty, box_name, side_id, slot_number, fulfillment_box_id
    ) values (
      v_target_cell_id, v_box.account_id, 'box', '', '', 1, 0, '',
      (v_target->>'sideId')::uuid, (v_target->>'slotNumber')::integer, v_box.id
    );
    return jsonb_build_object('action', 'placed', 'boxNumber', v_box.box_number);
  end if;

  if v_target_item.id is null and not p_confirm_move then
    return jsonb_build_object(
      'requiresConfirmation', true, 'action', 'move',
      'message', 'Короб уже размещён. Перенести его в выбранное место?'
    );
  end if;
  if v_target_item.id is not null and not p_confirm_swap then
    return jsonb_build_object(
      'requiresConfirmation', true, 'action', 'swap',
      'message', 'Выбранное место занято. Поменять короба местами?'
    );
  end if;

  if v_target_cell_id is null then
    insert into public.wms_cells (zone_id, account_id, col, row, status)
    values (
      (v_target->>'rackId')::uuid, (v_target->>'accountId')::uuid,
      v_target->>'col', (v_target->>'row')::integer, 'occupied'
    )
    returning id into v_target_cell_id;
  end if;

  perform public.move_or_swap_wms_box(
    v_source.id, v_target_cell_id, (v_target->>'sideId')::uuid,
    (v_target->>'slotNumber')::integer
  );

  if v_source_cell_id is distinct from v_target_cell_id
     and not exists (select 1 from public.wms_cell_items where cell_id = v_source_cell_id) then
    delete from public.wms_cells where id = v_source_cell_id and status = 'occupied';
  end if;

  return jsonb_build_object(
    'action', case when v_target_item.id is null then 'moved' else 'swapped' end,
    'boxNumber', v_box.box_number
  );
end;
$$;

grant execute on function public.place_wms_box_by_scan(text, text, boolean, boolean) to authenticated;
