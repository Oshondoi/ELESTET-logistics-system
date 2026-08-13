-- WMS stores only real fulfillment boxes.
-- Existing legacy WMS rows are preserved, but new standalone products/boxes
-- can no longer be created in wms_cell_items.

alter table public.wms_cell_items
  add column if not exists fulfillment_box_id uuid
  references public.fulfillment_boxes(id) on delete restrict;

create unique index if not exists wms_cell_items_fulfillment_box_unique
  on public.wms_cell_items(fulfillment_box_id)
  where fulfillment_box_id is not null;

create index if not exists idx_wms_cell_items_account_fulfillment_box
  on public.wms_cell_items(account_id, fulfillment_box_id)
  where fulfillment_box_id is not null;

create or replace function public.validate_new_wms_storage_item()
returns trigger
language plpgsql
as $$
declare
  v_box public.fulfillment_boxes%rowtype;
begin
  if new.item_type <> 'box' or new.fulfillment_box_id is null then
    raise exception 'На склад можно разместить только существующий короб из фулфилмента';
  end if;

  select * into v_box
  from public.fulfillment_boxes
  where id = new.fulfillment_box_id;

  if v_box.id is null then
    raise exception 'Короб фулфилмента не найден';
  end if;
  if v_box.account_id is distinct from new.account_id then
    raise exception 'Короб относится к другой компании';
  end if;

  -- Identity is always copied from the immutable fulfillment box.
  new.barcode := v_box.barcode;
  new.box_name := 'Короб №' || v_box.box_number::text;
  new.product_name := '';
  new.qty := 1;
  new.reserved_qty := 0;
  return new;
end;
$$;

drop trigger if exists trg_validate_new_wms_storage_item on public.wms_cell_items;
create trigger trg_validate_new_wms_storage_item
before insert or update of
  item_type, fulfillment_box_id, account_id, barcode, box_name,
  product_name, qty, reserved_qty, cell_id, side_id, slot_number
on public.wms_cell_items
for each row execute function public.validate_new_wms_storage_item();

-- Places one or many existing fulfillment boxes in the selected rack.
-- The requested K-place is used first; remaining boxes fill free places from
-- that pallet onward and wrap around the rack. The operation is atomic.
create or replace function public.place_fulfillment_boxes_in_wms(
  p_box_ids uuid[],
  p_zone_id uuid,
  p_col text,
  p_row integer,
  p_target_side_id uuid,
  p_target_slot_number integer
)
returns jsonb
language plpgsql
as $$
declare
  v_account_id uuid;
  v_cell_id uuid;
  v_side_zone_id uuid;
  v_slot_count integer;
  v_zone_cols integer;
  v_zone_rows integer;
  v_requested_count integer;
  v_distinct_count integer;
  v_available_count integer;
  v_side_ids uuid[];
  v_slot_numbers integer[];
  v_cols text[];
  v_rows integer[];
  v_box public.fulfillment_boxes%rowtype;
  v_index integer;
begin
  v_requested_count := coalesce(array_length(p_box_ids, 1), 0);
  if v_requested_count = 0 then
    raise exception 'Выберите хотя бы один короб';
  end if;
  if p_col !~ '^[A-Z]$' or p_row < 1 then
    raise exception 'Некорректное паллетоместо';
  end if;

  select count(distinct box_id) into v_distinct_count
  from unnest(p_box_ids) as selected(box_id);
  if v_distinct_count <> v_requested_count then
    raise exception 'Один короб выбран несколько раз';
  end if;

  select z.account_id, z.cols, z.rows into v_account_id, v_zone_cols, v_zone_rows
  from public.wms_zones z
  where z.id = p_zone_id;

  if v_account_id is null then raise exception 'Стеллаж не найден'; end if;
  if ascii(p_col) - 64 > v_zone_cols or p_row > v_zone_rows then
    raise exception 'Паллетоместо находится за границами стеллажа';
  end if;
  if not exists (
    select 1 from public.account_members am
    where am.account_id = v_account_id and am.user_id = auth.uid()
  ) then
    raise exception 'Нет доступа к компании';
  end if;

  select s.zone_id, s.slot_count into v_side_zone_id, v_slot_count
  from public.wms_zone_sides s
  where s.id = p_target_side_id and s.account_id = v_account_id;

  if v_side_zone_id is distinct from p_zone_id then
    raise exception 'Сторона относится к другому стеллажу';
  end if;
  if p_target_slot_number < 1 or p_target_slot_number > v_slot_count then
    raise exception 'Номер места выходит за границы стороны';
  end if;

  -- Lock every selected box and validate ownership/placement.
  for v_index in 1..v_requested_count loop
    select * into v_box
    from public.fulfillment_boxes
    where id = p_box_ids[v_index]
    for update;

    if v_box.id is null then raise exception 'Короб фулфилмента не найден'; end if;
    if v_box.account_id is distinct from v_account_id then
      raise exception 'Короб относится к другой компании';
    end if;
    if exists (
      select 1 from public.wms_cell_items wi
      where wi.fulfillment_box_id = v_box.id
    ) then
      raise exception 'Короб №% уже размещён на складе', v_box.box_number;
    end if;
  end loop;

  select
    array_agg(free_place.col order by free_place.pallet_sort, free_place.side_position, free_place.slot_number),
    array_agg(free_place.row_number order by free_place.pallet_sort, free_place.side_position, free_place.slot_number),
    array_agg(free_place.side_id order by free_place.pallet_sort, free_place.side_position, free_place.slot_number),
    array_agg(free_place.slot_number order by free_place.pallet_sort, free_place.side_position, free_place.slot_number),
    count(*)
  into v_cols, v_rows, v_side_ids, v_slot_numbers, v_available_count
  from (
    select
      chr(65 + columns.column_index) as col,
      rows.row_number,
      s.id as side_id,
      s.position as side_position,
      slots.slot_number,
      case
        when chr(65 + columns.column_index) = p_col
          and rows.row_number = p_row
          and s.id = p_target_side_id
          and slots.slot_number = p_target_slot_number then 0
        when chr(65 + columns.column_index) = p_col and rows.row_number = p_row then 1
        else 2 + mod(
          (rows.row_number - 1) * v_zone_cols + columns.column_index
          - ((p_row - 1) * v_zone_cols + (ascii(p_col) - 65))
          + (v_zone_cols * v_zone_rows),
          v_zone_cols * v_zone_rows
        )
      end as pallet_sort
    from public.wms_zone_sides s
    cross join generate_series(0, v_zone_cols - 1) as columns(column_index)
    cross join generate_series(1, v_zone_rows) as rows(row_number)
    cross join lateral generate_series(1, s.slot_count) as slots(slot_number)
    left join public.wms_cells existing_cell
      on existing_cell.zone_id = p_zone_id
      and existing_cell.col = chr(65 + columns.column_index)
      and existing_cell.row = rows.row_number
    where s.zone_id = p_zone_id
      and coalesce(existing_cell.status, 'free') not in ('disabled', 'reserved')
      and not exists (
        select 1 from public.wms_cell_items wi
        where wi.cell_id = existing_cell.id
          and wi.side_id = s.id
          and wi.slot_number = slots.slot_number
          and wi.item_type = 'box'
      )
  ) as free_place;

  if coalesce(v_available_count, 0) < v_requested_count then
    raise exception 'Недостаточно свободных мест: нужно %, свободно %', v_requested_count, coalesce(v_available_count, 0);
  end if;

  for v_index in 1..v_requested_count loop
    select c.id into v_cell_id
    from public.wms_cells c
    where c.zone_id = p_zone_id and c.col = v_cols[v_index] and c.row = v_rows[v_index]
    for update;

    if v_cell_id is null then
      insert into public.wms_cells (zone_id, account_id, col, row, status)
      values (p_zone_id, v_account_id, v_cols[v_index], v_rows[v_index], 'occupied')
      returning id into v_cell_id;
    else
      update public.wms_cells
      set status = 'occupied', updated_at = now()
      where id = v_cell_id and status = 'free';
    end if;

    insert into public.wms_cell_items (
      cell_id, account_id, item_type, barcode, product_name, qty,
      reserved_qty, box_name, side_id, slot_number, fulfillment_box_id
    )
    values (
      v_cell_id, v_account_id, 'box', '', '', 1,
      0, '', v_side_ids[v_index], v_slot_numbers[v_index], p_box_ids[v_index]
    );
  end loop;

  return jsonb_build_object(
    'placed', v_requested_count,
    'started_at', p_col || p_row::text
  );
end;
$$;

grant execute on function public.place_fulfillment_boxes_in_wms(
  uuid[], uuid, text, integer, uuid, integer
) to authenticated;
