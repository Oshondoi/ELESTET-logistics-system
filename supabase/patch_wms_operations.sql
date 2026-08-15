-- Reliable WMS operations: derived capacity state, audit trail, search,
-- unaddressed boxes, inventory and automatic address release after shipping.

-- `reserved` was a manually selectable legacy state. WMS now derives free /
-- occupied from actual contents and keeps only `disabled` as a manual state.
alter table public.wms_cells drop constraint if exists wms_cells_status_check;
update public.wms_cells set status = 'disabled' where status = 'reserved';
alter table public.wms_cells
  add constraint wms_cells_status_check
  check (status in ('free', 'occupied', 'disabled'));

create table if not exists public.wms_movements (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  fulfillment_box_id uuid references public.fulfillment_boxes(id) on delete set null,
  action text not null check (action in ('placed', 'moved', 'unassigned', 'released', 'swapped')),
  source text not null default 'manual',
  from_address_code text,
  from_address_text text,
  to_address_code text,
  to_address_text text,
  actor_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists wms_movements_account_created_idx
  on public.wms_movements(account_id, created_at desc);
create index if not exists wms_movements_box_created_idx
  on public.wms_movements(fulfillment_box_id, created_at desc);
alter table public.wms_movements enable row level security;
drop policy if exists wms_movements_member_select on public.wms_movements;
create policy wms_movements_member_select on public.wms_movements for select
  using (exists (
    select 1 from public.account_members am
    where am.account_id = wms_movements.account_id and am.user_id = auth.uid()
  ));

create or replace function public.wms_item_address(p_item public.wms_cell_items)
returns jsonb
language sql
stable
set search_path = public
as $$
  select case when p_item.id is null then null else jsonb_build_object(
    'code', format('C%s_W%s_R%s_S%s_%s%s_K%s',
      a.short_id, w.short_id, z.short_id, s.position + 1, c.col, c.row, p_item.slot_number),
    'text', format('%s · %s · %s · %s%s-K%s',
      w.name, z.name, s.name, c.col, c.row, p_item.slot_number)
  ) end
  from public.wms_cells c
  join public.wms_zones z on z.id = c.zone_id
  join public.wms_warehouses w on w.id = z.warehouse_id
  join public.accounts a on a.id = c.account_id
  join public.wms_zone_sides s on s.id = p_item.side_id
  where c.id = p_item.cell_id;
$$;

create or replace function public.log_wms_item_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_action text;
  v_source text := coalesce(nullif(current_setting('app.wms_source', true), ''), 'manual');
  v_account_id uuid;
  v_box_id uuid;
begin
  if current_setting('app.wms_suppress_history', true) = 'true' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    v_account_id := old.account_id;
    v_box_id := old.fulfillment_box_id;
  else
    v_account_id := new.account_id;
    v_box_id := new.fulfillment_box_id;
  end if;
  if tg_op <> 'INSERT' then v_old := public.wms_item_address(old); end if;
  if tg_op <> 'DELETE' then v_new := public.wms_item_address(new); end if;

  if tg_op = 'INSERT' then
    v_action := 'placed';
  elsif tg_op = 'DELETE' then
    v_action := case when v_source = 'logistics_shipped' then 'released' else 'unassigned' end;
  elsif old.cell_id is distinct from new.cell_id
     or old.side_id is distinct from new.side_id
     or old.slot_number is distinct from new.slot_number then
    v_action := case when v_source = 'swap' then 'swapped' else 'moved' end;
  else
    return new;
  end if;

  insert into public.wms_movements (
    account_id, fulfillment_box_id, action, source,
    from_address_code, from_address_text, to_address_code, to_address_text,
    actor_id
  ) values (
    v_account_id, v_box_id, v_action, v_source,
    v_old->>'code', v_old->>'text', v_new->>'code', v_new->>'text', auth.uid()
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_log_wms_item_movement on public.wms_cell_items;
create trigger trg_log_wms_item_movement
after insert or update of cell_id, side_id, slot_number or delete
on public.wms_cell_items
for each row execute function public.log_wms_item_movement();

-- Every write path (manual UI, scanner and bulk placement) passes through
-- this trigger. A box remains a real fulfillment box, while cancelled
-- batches and supplies already shipped by Logistics cannot be re-addressed.
create or replace function public.validate_new_wms_storage_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_box public.fulfillment_boxes%rowtype;
  v_batch_status text;
  v_is_shipped boolean;
begin
  if new.item_type <> 'box' or new.fulfillment_box_id is null then
    raise exception 'На склад можно разместить только существующий короб из фулфилмента';
  end if;

  select * into v_box from public.fulfillment_boxes where id = new.fulfillment_box_id;
  if v_box.id is null then raise exception 'Короб фулфилмента не найден'; end if;
  if v_box.account_id is distinct from new.account_id then
    raise exception 'Короб относится к другой компании';
  end if;
  select batch.status,
    exists (
      select 1 from public.trip_lines tl
      where tl.fulfillment_supply_id = fs.id and tl.status = 'Отгружен'
    )
  into v_batch_status, v_is_shipped
  from public.fulfillment_supplies fs
  join public.fulfillment_batches batch on batch.id = fs.batch_id
  where fs.id = v_box.supply_id;
  if v_batch_status = 'cancelled' then
    raise exception 'Нельзя разместить короб из отменённой партии';
  end if;
  if v_is_shipped then
    raise exception 'Нельзя разместить короб: его поставка уже отгружена';
  end if;

  new.barcode := v_box.barcode;
  new.box_name := 'Короб №' || v_box.box_number::text;
  new.product_name := '';
  new.qty := 1;
  new.reserved_qty := 0;
  return new;
end;
$$;

-- Replace the older implementation so a swap produces exactly two audit
-- records (one per box), not the temporary technical moves used internally.
create or replace function public.move_or_swap_wms_box(
  p_box_id uuid,
  p_target_cell_id uuid,
  p_target_side_id uuid,
  p_target_slot_number integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.wms_cell_items%rowtype;
  v_target public.wms_cell_items%rowtype;
  v_target_zone_id uuid;
  v_target_side_zone_id uuid;
  v_target_slot_count integer;
  v_source_from jsonb;
  v_target_from jsonb;
  v_source_to jsonb;
  v_target_to jsonb;
begin
  select * into v_source from public.wms_cell_items
  where id = p_box_id and item_type = 'box' for update;
  if v_source.id is null then raise exception 'Короб не найден'; end if;
  if not exists (select 1 from public.account_members am where am.user_id = auth.uid() and am.account_id = v_source.account_id) then
    raise exception 'Нет доступа к компании';
  end if;

  select c.zone_id into v_target_zone_id from public.wms_cells c
  where c.id = p_target_cell_id and c.account_id = v_source.account_id and c.status <> 'disabled';
  select s.zone_id, s.slot_count into v_target_side_zone_id, v_target_slot_count
  from public.wms_zone_sides s where s.id = p_target_side_id and s.account_id = v_source.account_id;
  if v_target_zone_id is null or v_target_side_zone_id is distinct from v_target_zone_id then
    raise exception 'Выбранное место недоступно или относится к другому стеллажу';
  end if;
  if p_target_slot_number < 1 or p_target_slot_number > v_target_slot_count then
    raise exception 'Номер места выходит за границы выбранной стороны';
  end if;
  if v_source.cell_id = p_target_cell_id and v_source.side_id = p_target_side_id and v_source.slot_number = p_target_slot_number then
    return jsonb_build_object('action', 'none', 'box_id', v_source.id);
  end if;

  select * into v_target from public.wms_cell_items
  where cell_id = p_target_cell_id and side_id = p_target_side_id
    and slot_number = p_target_slot_number and item_type = 'box' and id <> v_source.id
  for update;

  v_source_from := public.wms_item_address(v_source);
  perform set_config('app.wms_suppress_history', 'true', true);
  if v_target.id is null then
    update public.wms_cell_items set cell_id = p_target_cell_id, side_id = p_target_side_id,
      slot_number = p_target_slot_number, updated_at = now() where id = v_source.id
    returning * into v_source;
    v_source_to := public.wms_item_address(v_source);
    insert into public.wms_movements(account_id, fulfillment_box_id, action, source,
      from_address_code, from_address_text, to_address_code, to_address_text, actor_id)
    values (v_source.account_id, v_source.fulfillment_box_id, 'moved', 'manual',
      v_source_from->>'code', v_source_from->>'text', v_source_to->>'code', v_source_to->>'text', auth.uid());
    return jsonb_build_object('action', 'move', 'box_id', v_source.id);
  end if;

  if v_source.side_id is null or v_source.slot_number is null then
    raise exception 'Для короба без адреса сначала выберите свободное место';
  end if;
  v_target_from := public.wms_item_address(v_target);
  update public.wms_cell_items set side_id = null, slot_number = null, updated_at = now() where id = v_source.id;
  update public.wms_cell_items set cell_id = v_source.cell_id, side_id = v_source.side_id,
    slot_number = v_source.slot_number, updated_at = now() where id = v_target.id returning * into v_target;
  update public.wms_cell_items set cell_id = p_target_cell_id, side_id = p_target_side_id,
    slot_number = p_target_slot_number, updated_at = now() where id = v_source.id returning * into v_source;
  v_source_to := public.wms_item_address(v_source);
  v_target_to := public.wms_item_address(v_target);
  insert into public.wms_movements(account_id, fulfillment_box_id, action, source,
    from_address_code, from_address_text, to_address_code, to_address_text, actor_id)
  values
    (v_source.account_id, v_source.fulfillment_box_id, 'swapped', 'manual',
      v_source_from->>'code', v_source_from->>'text', v_source_to->>'code', v_source_to->>'text', auth.uid()),
    (v_target.account_id, v_target.fulfillment_box_id, 'swapped', 'manual',
      v_target_from->>'code', v_target_from->>'text', v_target_to->>'code', v_target_to->>'text', auth.uid());
  return jsonb_build_object('action', 'swap', 'box_id', v_source.id, 'target_box_id', v_target.id);
end;
$$;
revoke all on function public.move_or_swap_wms_box(uuid, uuid, uuid, integer) from public;
grant execute on function public.move_or_swap_wms_box(uuid, uuid, uuid, integer) to authenticated;

create or replace function public.sync_wms_cell_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_cell_id uuid;
  v_new_cell_id uuid;
begin
  if tg_op <> 'INSERT' then v_old_cell_id := old.cell_id; end if;
  if tg_op <> 'DELETE' then v_new_cell_id := new.cell_id; end if;

  update public.wms_cells c
  set status = case
    when c.status = 'disabled' then 'disabled'
    when exists (select 1 from public.wms_cell_items i where i.cell_id = c.id) then 'occupied'
    else 'free'
  end,
  updated_at = now()
  where c.id in (v_old_cell_id, v_new_cell_id);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_wms_cell_status on public.wms_cell_items;
create trigger trg_sync_wms_cell_status
after insert or update of cell_id or delete on public.wms_cell_items
for each row execute function public.sync_wms_cell_status();

create or replace function public.set_wms_cell_disabled(
  p_zone_id uuid, p_col text, p_row integer, p_disabled boolean
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_zone public.wms_zones%rowtype;
  v_cell public.wms_cells%rowtype;
begin
  select * into v_zone from public.wms_zones where id = p_zone_id;
  if v_zone.id is null then raise exception 'Стеллаж не найден'; end if;
  if not exists (select 1 from public.account_members am where am.account_id = v_zone.account_id and am.user_id = auth.uid()) then
    raise exception 'Нет доступа к компании';
  end if;
  select * into v_cell from public.wms_cells
  where zone_id = p_zone_id and col = upper(p_col) and row = p_row for update;

  if p_disabled then
    if v_cell.id is not null and exists (select 1 from public.wms_cell_items i where i.cell_id = v_cell.id) then
      raise exception 'Нельзя заглушить паллетоместо с коробами';
    end if;
    if v_cell.id is null then
      insert into public.wms_cells(zone_id, account_id, col, row, status)
      values (p_zone_id, v_zone.account_id, upper(p_col), p_row, 'disabled') returning * into v_cell;
    else
      update public.wms_cells set status = 'disabled', updated_at = now() where id = v_cell.id;
    end if;
  elsif v_cell.id is not null and v_cell.status = 'disabled' then
    delete from public.wms_cells where id = v_cell.id;
  end if;
  return jsonb_build_object('disabled', p_disabled);
end;
$$;
grant execute on function public.set_wms_cell_disabled(uuid, text, integer, boolean) to authenticated;

create or replace function public.get_wms_supply_release_preview(p_supply_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'boxes', count(distinct b.id),
    'addressedBoxes', count(distinct wi.fulfillment_box_id),
    'addresses', coalesce(jsonb_agg(distinct public.wms_item_address(wi))
      filter (where wi.id is not null), '[]'::jsonb)
  )
  from public.fulfillment_supplies fs
  left join public.fulfillment_boxes b on b.supply_id = fs.id
  left join public.wms_cell_items wi on wi.fulfillment_box_id = b.id
  where fs.id = p_supply_id
    and exists (select 1 from public.account_members am where am.account_id = fs.account_id and am.user_id = auth.uid());
$$;
grant execute on function public.get_wms_supply_release_preview(uuid) to authenticated;

create or replace function public.release_wms_addresses_after_shipping()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cell_ids uuid[];
begin
  if new.status = 'Отгружен'
     and old.status is distinct from new.status
     and new.fulfillment_supply_id is not null then
    perform set_config('app.wms_source', 'logistics_shipped', true);
    select array_agg(distinct wi.cell_id) into v_cell_ids
    from public.wms_cell_items wi
    join public.fulfillment_boxes b on b.id = wi.fulfillment_box_id
    where b.supply_id = new.fulfillment_supply_id;

    delete from public.wms_cell_items wi
    using public.fulfillment_boxes b
    where wi.fulfillment_box_id = b.id and b.supply_id = new.fulfillment_supply_id;

    delete from public.wms_cells c
    where c.id = any(coalesce(v_cell_ids, '{}'::uuid[]))
      and c.status <> 'disabled'
      and not exists (select 1 from public.wms_cell_items wi where wi.cell_id = c.id);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_release_wms_addresses_after_shipping on public.trip_lines;
create trigger trg_release_wms_addresses_after_shipping
after update of status on public.trip_lines
for each row execute function public.release_wms_addresses_after_shipping();

-- Bring historical data to the same rule immediately: supplies that had
-- already been marked shipped before this trigger was installed must not
-- keep occupying WMS addresses forever.
do $$
declare
  v_cell_ids uuid[];
begin
  perform set_config('app.wms_source', 'logistics_shipped', true);
  select array_agg(distinct wi.cell_id) into v_cell_ids
  from public.wms_cell_items wi
  join public.fulfillment_boxes fb on fb.id = wi.fulfillment_box_id
  where exists (
    select 1 from public.trip_lines tl
    where tl.fulfillment_supply_id = fb.supply_id and tl.status = 'Отгружен'
  );

  delete from public.wms_cell_items wi
  using public.fulfillment_boxes fb
  where wi.fulfillment_box_id = fb.id
    and exists (
      select 1 from public.trip_lines tl
      where tl.fulfillment_supply_id = fb.supply_id and tl.status = 'Отгружен'
    );

  delete from public.wms_cells c
  where c.id = any(coalesce(v_cell_ids, '{}'::uuid[]))
    and c.status <> 'disabled'
    and not exists (select 1 from public.wms_cell_items wi where wi.cell_id = c.id);
end;
$$;

create or replace function public.search_wms_locations(
  p_account_id uuid, p_query text, p_limit integer default 50
)
returns jsonb
language sql
stable
set search_path = public
as $$
  with found as (
    select
      wi.id as item_id, wi.fulfillment_box_id as box_id, fb.box_number, fb.barcode as box_barcode,
      fs.id as supply_id, fs.supply_number, batch.id as batch_id, batch.short_id as batch_number,
      w.id as warehouse_id, w.name as warehouse_name, z.id as rack_id, z.name as rack_name,
      s.id as side_id, s.name as side_name, c.col, c.row, wi.slot_number,
      format('C%s_W%s_R%s_S%s_%s%s_K%s', a.short_id, w.short_id, z.short_id,
        s.position + 1, c.col, c.row, wi.slot_number) as address_code,
      format('%s · %s · %s · %s%s-K%s', w.name, z.name, s.name, c.col, c.row, wi.slot_number) as address_text,
      coalesce((select sum(bi.qty) from public.fulfillment_box_items bi where bi.box_id = fb.id), 0) as units
    from public.wms_cell_items wi
    join public.fulfillment_boxes fb on fb.id = wi.fulfillment_box_id
    join public.fulfillment_supplies fs on fs.id = fb.supply_id
    join public.fulfillment_batches batch on batch.id = fs.batch_id
    join public.wms_cells c on c.id = wi.cell_id
    join public.wms_zone_sides s on s.id = wi.side_id
    join public.wms_zones z on z.id = c.zone_id
    join public.wms_warehouses w on w.id = z.warehouse_id
    join public.accounts a on a.id = wi.account_id
    where wi.account_id = p_account_id
      and exists (select 1 from public.account_members am where am.account_id = wi.account_id and am.user_id = auth.uid())
      and (
        trim(coalesce(p_query, '')) = ''
        or fb.barcode ilike '%' || trim(p_query) || '%'
        or fb.box_number::text = trim(p_query)
        or fs.supply_number::text = trim(p_query)
        or batch.short_id::text = trim(p_query)
        or format('C%s_W%s_R%s_S%s_%s%s_K%s', a.short_id, w.short_id, z.short_id,
          s.position + 1, c.col, c.row, wi.slot_number) ilike '%' || trim(p_query) || '%'
        or exists (
          select 1 from public.fulfillment_box_items bi
          where bi.box_id = fb.id and (bi.barcode ilike '%' || trim(p_query) || '%'
            or coalesce(bi.product_name, '') ilike '%' || trim(p_query) || '%')
        )
      )
    order by w.name, z.name, s.position, c.row, c.col, wi.slot_number
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  )
  select coalesce(jsonb_agg(to_jsonb(found)), '[]'::jsonb) from found;
$$;
grant execute on function public.search_wms_locations(uuid, text, integer) to authenticated;

create or replace function public.get_unaddressed_fulfillment_boxes(p_account_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  with boxes as (
    select fb.id, fb.box_number, fb.barcode, fs.id as supply_id, fs.supply_number,
      batch.id as batch_id, batch.short_id as batch_number, batch.name as batch_name,
      fs.warehouse_name,
      coalesce((select sum(bi.qty) from public.fulfillment_box_items bi where bi.box_id = fb.id), 0) as units
    from public.fulfillment_boxes fb
    join public.fulfillment_supplies fs on fs.id = fb.supply_id
    join public.fulfillment_batches batch on batch.id = fs.batch_id
    where fb.account_id = p_account_id
      and exists (select 1 from public.account_members am where am.account_id = fb.account_id and am.user_id = auth.uid())
      and batch.status <> 'cancelled'
      and not exists (select 1 from public.wms_cell_items wi where wi.fulfillment_box_id = fb.id)
      and not exists (
        select 1 from public.trip_lines tl
        where tl.fulfillment_supply_id = fs.id and tl.status = 'Отгружен'
      )
    order by batch.short_id desc nulls last, fs.supply_number desc, fb.box_number
  )
  select coalesce(jsonb_agg(to_jsonb(boxes)), '[]'::jsonb) from boxes;
$$;
grant execute on function public.get_unaddressed_fulfillment_boxes(uuid) to authenticated;

create table if not exists public.wms_inventory_sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  warehouse_id uuid not null references public.wms_warehouses(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  started_by uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.wms_inventory_sessions
  add column if not exists expected_box_ids uuid[] not null default '{}'::uuid[],
  add column if not exists expected_addresses jsonb not null default '{}'::jsonb;
create table if not exists public.wms_inventory_scans (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.wms_inventory_sessions(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  fulfillment_box_id uuid not null references public.fulfillment_boxes(id) on delete cascade,
  expected_address text,
  scanned_address text,
  result text not null check (result in ('found', 'wrong_address', 'unexpected')),
  scanned_by uuid references auth.users(id) on delete set null,
  scanned_at timestamptz not null default now(),
  unique(session_id, fulfillment_box_id)
);
alter table public.wms_inventory_sessions enable row level security;
alter table public.wms_inventory_scans enable row level security;
drop policy if exists wms_inventory_sessions_member_all on public.wms_inventory_sessions;
create policy wms_inventory_sessions_member_all on public.wms_inventory_sessions for all
  using (exists (select 1 from public.account_members am where am.account_id = wms_inventory_sessions.account_id and am.user_id = auth.uid()))
  with check (exists (select 1 from public.account_members am where am.account_id = wms_inventory_sessions.account_id and am.user_id = auth.uid()));
drop policy if exists wms_inventory_scans_member_all on public.wms_inventory_scans;
create policy wms_inventory_scans_member_all on public.wms_inventory_scans for all
  using (exists (select 1 from public.account_members am where am.account_id = wms_inventory_scans.account_id and am.user_id = auth.uid()))
  with check (exists (select 1 from public.account_members am where am.account_id = wms_inventory_scans.account_id and am.user_id = auth.uid()));

create or replace function public.start_wms_inventory(p_warehouse_id uuid)
returns uuid
language plpgsql
set search_path = public
as $$
declare v_account_id uuid; v_id uuid; v_box_ids uuid[]; v_addresses jsonb;
begin
  select account_id into v_account_id from public.wms_warehouses where id = p_warehouse_id;
  if v_account_id is null then raise exception 'Склад не найден'; end if;
  if not exists (select 1 from public.account_members am where am.account_id = v_account_id and am.user_id = auth.uid()) then raise exception 'Нет доступа'; end if;
  select
    coalesce(array_agg(wi.fulfillment_box_id order by wi.fulfillment_box_id), '{}'::uuid[]),
    coalesce(jsonb_object_agg(wi.fulfillment_box_id::text, public.wms_item_address(wi)->>'code'), '{}'::jsonb)
  into v_box_ids, v_addresses
  from public.wms_cell_items wi
  join public.wms_cells c on c.id = wi.cell_id
  join public.wms_zones z on z.id = c.zone_id
  where z.warehouse_id = p_warehouse_id and wi.fulfillment_box_id is not null;
  insert into public.wms_inventory_sessions(
    account_id, warehouse_id, started_by, expected_box_ids, expected_addresses
  ) values (
    v_account_id, p_warehouse_id, auth.uid(), v_box_ids, v_addresses
  ) returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.start_wms_inventory(uuid) to authenticated;

create or replace function public.scan_wms_inventory_box(p_session_id uuid, p_box_barcode text, p_location_code text default null)
returns jsonb
language plpgsql
set search_path = public
as $$
declare v_session public.wms_inventory_sessions%rowtype; v_box public.fulfillment_boxes%rowtype;
  v_expected text; v_result text; v_scanned text := nullif(upper(trim(coalesce(p_location_code, ''))), '');
begin
  select * into v_session from public.wms_inventory_sessions where id = p_session_id and status = 'active';
  if v_session.id is null then raise exception 'Активная инвентаризация не найдена'; end if;
  select * into v_box from public.fulfillment_boxes where account_id = v_session.account_id and upper(barcode) = upper(trim(p_box_barcode));
  if v_box.id is null then raise exception 'Короб не найден'; end if;
  v_expected := v_session.expected_addresses->>v_box.id::text;
  v_result := case when not (v_box.id = any(v_session.expected_box_ids)) then 'unexpected'
    when v_scanned is not null and v_scanned <> v_expected then 'wrong_address'
    else 'found' end;
  insert into public.wms_inventory_scans(session_id, account_id, fulfillment_box_id, expected_address, scanned_address, result, scanned_by)
  values (v_session.id, v_session.account_id, v_box.id, v_expected, v_scanned, v_result, auth.uid())
  on conflict (session_id, fulfillment_box_id) do update set
    expected_address = excluded.expected_address, scanned_address = excluded.scanned_address,
    result = excluded.result, scanned_by = auth.uid(), scanned_at = now();
  return jsonb_build_object('result', v_result, 'boxNumber', v_box.box_number, 'expectedAddress', v_expected);
end;
$$;
grant execute on function public.scan_wms_inventory_box(uuid, text, text) to authenticated;

create or replace function public.finish_wms_inventory(p_session_id uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare v_session public.wms_inventory_sessions%rowtype; v_expected integer; v_scanned integer; v_wrong integer; v_unexpected integer;
begin
  select * into v_session from public.wms_inventory_sessions where id = p_session_id for update;
  if v_session.id is null or v_session.status <> 'active' then raise exception 'Активная инвентаризация не найдена'; end if;
  v_expected := cardinality(v_session.expected_box_ids);
  select count(*), count(*) filter (where result = 'wrong_address'), count(*) filter (where result = 'unexpected')
  into v_scanned, v_wrong, v_unexpected from public.wms_inventory_scans where session_id = v_session.id;
  update public.wms_inventory_sessions set status = 'completed', completed_at = now() where id = v_session.id;
  return jsonb_build_object('expected', v_expected, 'scanned', v_scanned,
    'missing', greatest(v_expected - (v_scanned - v_unexpected), 0),
    'wrongAddress', v_wrong, 'unexpected', v_unexpected);
end;
$$;
grant execute on function public.finish_wms_inventory(uuid) to authenticated;
