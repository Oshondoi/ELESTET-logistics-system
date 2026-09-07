begin;

-- ============================================================
-- FBS roles and scoped outsource access
-- requester_id = client, partner_id = executor
-- ============================================================

alter table public.roles
  add column if not exists fbs_store_ids uuid[] null;

-- Preserve the FBS access existing roles had before granular controls existed.
-- Stock editing keeps its previous setting.
update public.roles
set permissions = permissions
  || case when permissions ? 'fbs_view' then '{}'::jsonb else '{"fbs_view":true}'::jsonb end
  || case when permissions ? 'fbs_sync' then '{}'::jsonb else '{"fbs_sync":true}'::jsonb end
  || case when permissions ? 'fbs_full_sync' then '{}'::jsonb else '{"fbs_full_sync":true}'::jsonb end
  || case when permissions ? 'fbs_assembly' then '{}'::jsonb else '{"fbs_assembly":true}'::jsonb end
  || case when permissions ? 'fbs_dispatch' then '{}'::jsonb else '{"fbs_dispatch":true}'::jsonb end;

create table if not exists public.fbs_outsource_access (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null unique references public.outsource_partners(id) on delete cascade,
  client_account_id uuid not null references public.accounts(id) on delete cascade,
  executor_account_id uuid not null references public.accounts(id) on delete cascade,
  store_ids uuid[] not null default '{}',
  permissions jsonb not null default '{
    "fbs_view": false,
    "fbs_sync": false,
    "fbs_full_sync": false,
    "fbs_assembly": false,
    "fbs_dispatch": false,
    "fbs_stocks_manage": false
  }'::jsonb,
  enabled boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (client_account_id <> executor_account_id)
);

create index if not exists fbs_outsource_access_client_idx
  on public.fbs_outsource_access(client_account_id, enabled);
create index if not exists fbs_outsource_access_executor_idx
  on public.fbs_outsource_access(executor_account_id, enabled);

alter table public.fbs_outsource_access enable row level security;

drop policy if exists "fbs outsource access: participants read" on public.fbs_outsource_access;
create policy "fbs outsource access: participants read"
  on public.fbs_outsource_access for select
  using (
    exists (
      select 1 from public.account_members member
      where member.user_id = auth.uid()
        and member.account_id in (client_account_id, executor_account_id)
    )
  );

grant select on public.fbs_outsource_access to authenticated;

create table if not exists public.fbs_action_audit (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  executor_account_id uuid references public.accounts(id) on delete set null,
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists fbs_action_audit_store_created_idx
  on public.fbs_action_audit(store_id, created_at desc);
alter table public.fbs_action_audit enable row level security;

-- Returns action permissions inside one company. Store scope is checked separately.
create or replace function public.fbs_account_permissions(
  p_user_id uuid,
  p_account_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_result jsonb;
begin
  select member.role into v_role
  from public.account_members member
  where member.account_id = p_account_id and member.user_id = p_user_id
  limit 1;

  if v_role is null then
    return jsonb_build_object(
      'fbs_view', false, 'fbs_sync', false, 'fbs_full_sync', false,
      'fbs_assembly', false, 'fbs_dispatch', false, 'fbs_stocks_manage', false
    );
  end if;

  if v_role in ('owner', 'admin') then
    return jsonb_build_object(
      'fbs_view', true, 'fbs_sync', true, 'fbs_full_sync', true,
      'fbs_assembly', true, 'fbs_dispatch', true, 'fbs_stocks_manage', true
    );
  end if;

  select jsonb_build_object(
    'fbs_view', coalesce(bool_or(coalesce((role_row.permissions->>'fbs_view')::boolean, false)), false),
    'fbs_sync', coalesce(bool_or(coalesce((role_row.permissions->>'fbs_sync')::boolean, false)), false),
    'fbs_full_sync', coalesce(bool_or(coalesce((role_row.permissions->>'fbs_full_sync')::boolean, false)), false),
    'fbs_assembly', coalesce(bool_or(coalesce((role_row.permissions->>'fbs_assembly')::boolean, false)), false),
    'fbs_dispatch', coalesce(bool_or(coalesce((role_row.permissions->>'fbs_dispatch')::boolean, false)), false),
    'fbs_stocks_manage', coalesce(bool_or(coalesce((role_row.permissions->>'fbs_stocks_manage')::boolean, false)), false)
  ) into v_result
  from public.role_assignments assignment
  join public.roles role_row on role_row.id = assignment.role_id
  where assignment.account_id = p_account_id
    and assignment.user_id = p_user_id;

  return coalesce(v_result, jsonb_build_object(
    'fbs_view', false, 'fbs_sync', false, 'fbs_full_sync', false,
    'fbs_assembly', false, 'fbs_dispatch', false, 'fbs_stocks_manage', false
  ));
end;
$$;

create or replace function public.fbs_user_has_account_permission(
  p_user_id uuid,
  p_account_id uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((public.fbs_account_permissions(p_user_id, p_account_id)->>p_permission)::boolean, false);
$$;

create or replace function public.fbs_user_can_access_store(
  p_user_id uuid,
  p_store_id uuid,
  p_permission text default 'fbs_view'
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_member_role text;
begin
  if p_permission not in (
    'fbs_view', 'fbs_sync', 'fbs_full_sync', 'fbs_assembly', 'fbs_dispatch', 'fbs_stocks_manage'
  ) then return false; end if;

  select store.account_id into v_account_id
  from public.stores store
  where store.id = p_store_id and store.deleted_at is null;
  if v_account_id is null then return false; end if;

  select member.role into v_member_role
  from public.account_members member
  where member.account_id = v_account_id and member.user_id = p_user_id
  limit 1;

  if v_member_role in ('owner', 'admin') then return true; end if;

  if v_member_role is not null and exists (
    select 1
    from public.role_assignments assignment
    join public.roles role_row on role_row.id = assignment.role_id
    where assignment.account_id = v_account_id
      and assignment.user_id = p_user_id
      and coalesce((role_row.permissions->>p_permission)::boolean, false)
      and (role_row.fbs_store_ids is null or p_store_id = any(role_row.fbs_store_ids))
  ) then return true; end if;

  return exists (
    select 1
    from public.fbs_outsource_access access_row
    join public.outsource_partners connection on connection.id = access_row.connection_id
    join public.account_members executor_member
      on executor_member.account_id = access_row.executor_account_id
     and executor_member.user_id = p_user_id
    where access_row.client_account_id = v_account_id
      and access_row.enabled
      and p_store_id = any(access_row.store_ids)
      and coalesce((access_row.permissions->>p_permission)::boolean, false)
      and connection.status = 'accepted'
      and connection.requester_id = access_row.client_account_id
      and connection.partner_id = access_row.executor_account_id
      and public.fbs_user_has_account_permission(
        p_user_id, access_row.executor_account_id, p_permission
      )
  );
end;
$$;

create or replace function public.fbs_can_access_store(
  p_store_id uuid,
  p_permission text default 'fbs_view'
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and public.fbs_user_can_access_store(auth.uid(), p_store_id, p_permission);
$$;

revoke all on function public.fbs_account_permissions(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fbs_user_has_account_permission(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.fbs_user_can_access_store(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.fbs_can_access_store(uuid, text) from public, anon;
grant execute on function public.fbs_account_permissions(uuid, uuid) to service_role;
grant execute on function public.fbs_user_has_account_permission(uuid, uuid, text) to service_role;
grant execute on function public.fbs_user_can_access_store(uuid, uuid, text) to service_role;
grant execute on function public.fbs_can_access_store(uuid, text) to authenticated;

-- Safe list for the FBS company/store selectors. API keys never leave the server.
create or replace function public.get_fbs_work_contexts(p_home_account_id uuid)
returns table(
  company_id uuid,
  company_name text,
  is_outsource boolean,
  connection_id uuid,
  permissions jsonb,
  stores jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not exists (
    select 1 from public.account_members member
    where member.account_id = p_home_account_id and member.user_id = v_user_id
  ) then raise exception 'Нет доступа к компании'; end if;

  return query
  select account_row.id,
         account_row.name,
         false,
         null::uuid,
         public.fbs_account_permissions(v_user_id, account_row.id),
         coalesce((
           select jsonb_agg(jsonb_build_object(
             'id', store.id,
             'account_id', store.account_id,
             'name', store.name,
             'store_code', store.store_code,
             'marketplace', store.marketplace,
             'supplier', store.supplier,
             'supplier_full', store.supplier_full,
             'address', store.address
           ) order by store.name)
           from public.stores store
           where store.account_id = account_row.id
             and store.deleted_at is null
             and store.api_key is not null
             and public.fbs_user_can_access_store(v_user_id, store.id, 'fbs_view')
         ), '[]'::jsonb)
  from public.accounts account_row
  where account_row.id = p_home_account_id
    and account_row.deleted_at is null
    and public.fbs_user_has_account_permission(v_user_id, account_row.id, 'fbs_view')

  union all

  select client.id,
         client.name,
         true,
         connection.id,
         jsonb_build_object(
           'fbs_view', coalesce((access_row.permissions->>'fbs_view')::boolean, false)
             and public.fbs_user_has_account_permission(v_user_id, p_home_account_id, 'fbs_view'),
           'fbs_sync', coalesce((access_row.permissions->>'fbs_sync')::boolean, false)
             and public.fbs_user_has_account_permission(v_user_id, p_home_account_id, 'fbs_sync'),
           'fbs_full_sync', coalesce((access_row.permissions->>'fbs_full_sync')::boolean, false)
             and public.fbs_user_has_account_permission(v_user_id, p_home_account_id, 'fbs_full_sync'),
           'fbs_assembly', coalesce((access_row.permissions->>'fbs_assembly')::boolean, false)
             and public.fbs_user_has_account_permission(v_user_id, p_home_account_id, 'fbs_assembly'),
           'fbs_dispatch', coalesce((access_row.permissions->>'fbs_dispatch')::boolean, false)
             and public.fbs_user_has_account_permission(v_user_id, p_home_account_id, 'fbs_dispatch'),
           'fbs_stocks_manage', coalesce((access_row.permissions->>'fbs_stocks_manage')::boolean, false)
             and public.fbs_user_has_account_permission(v_user_id, p_home_account_id, 'fbs_stocks_manage')
         ),
         coalesce((
           select jsonb_agg(jsonb_build_object(
             'id', store.id,
             'account_id', store.account_id,
             'name', store.name,
             'store_code', store.store_code,
             'marketplace', store.marketplace,
             'supplier', store.supplier,
             'supplier_full', store.supplier_full,
             'address', store.address
           ) order by store.name)
           from public.stores store
           where store.account_id = client.id
             and store.deleted_at is null
             and store.api_key is not null
             and store.id = any(access_row.store_ids)
             and public.fbs_user_can_access_store(v_user_id, store.id, 'fbs_view')
         ), '[]'::jsonb)
  from public.fbs_outsource_access access_row
  join public.outsource_partners connection on connection.id = access_row.connection_id
  join public.accounts client on client.id = access_row.client_account_id
  where access_row.executor_account_id = p_home_account_id
    and access_row.enabled
    and connection.status = 'accepted'
    and connection.requester_id = access_row.client_account_id
    and connection.partner_id = access_row.executor_account_id
    and client.deleted_at is null
    and coalesce((access_row.permissions->>'fbs_view')::boolean, false)
    and public.fbs_user_has_account_permission(v_user_id, p_home_account_id, 'fbs_view')
  order by 3, 2;
end;
$$;

revoke all on function public.get_fbs_work_contexts(uuid) from public, anon;
grant execute on function public.get_fbs_work_contexts(uuid) to authenticated;

create or replace function public.get_fbs_outsource_access(p_connection_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_connection public.outsource_partners%rowtype;
  v_access public.fbs_outsource_access%rowtype;
  v_stores jsonb;
begin
  select * into v_connection from public.outsource_partners where id = p_connection_id;
  if not found or v_connection.status <> 'accepted' then raise exception 'Связь с исполнителем не найдена'; end if;
  if not exists (
    select 1 from public.account_members member
    where member.account_id = v_connection.requester_id and member.user_id = auth.uid()
  ) then raise exception 'Нет доступа'; end if;

  select * into v_access from public.fbs_outsource_access where connection_id = p_connection_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', store.id, 'name', store.name, 'store_code', store.store_code,
    'supplier', store.supplier, 'supplier_full', store.supplier_full
  ) order by store.name), '[]'::jsonb)
  into v_stores
  from public.stores store
  where store.account_id = v_connection.requester_id
    and store.deleted_at is null
    and store.api_key is not null;

  return jsonb_build_object(
    'client_account_id', v_connection.requester_id,
    'executor_account_id', v_connection.partner_id,
    'enabled', coalesce(v_access.enabled, false),
    'store_ids', coalesce(to_jsonb(v_access.store_ids), '[]'::jsonb),
    'permissions', coalesce(v_access.permissions, '{}'::jsonb),
    'stores', v_stores
  );
end;
$$;

create or replace function public.save_fbs_outsource_access(
  p_connection_id uuid,
  p_store_ids uuid[],
  p_permissions jsonb,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_connection public.outsource_partners%rowtype;
  v_store_ids uuid[];
  v_permissions jsonb;
begin
  select * into v_connection from public.outsource_partners where id = p_connection_id for update;
  if not found or v_connection.status <> 'accepted' then raise exception 'Связь с исполнителем не найдена'; end if;
  if not exists (
    select 1 from public.account_members member
    where member.account_id = v_connection.requester_id
      and member.user_id = auth.uid()
      and member.role in ('owner', 'admin')
  ) then raise exception 'Настраивать аутсорс-доступ может только владелец или администратор'; end if;

  select coalesce(array_agg(distinct selected.value), '{}'::uuid[]) into v_store_ids
  from unnest(coalesce(p_store_ids, '{}'::uuid[])) selected(value)
  where exists (
    select 1 from public.stores store
    where store.id = selected.value
      and store.account_id = v_connection.requester_id
      and store.deleted_at is null
      and store.api_key is not null
  );

  v_permissions := jsonb_build_object(
    'fbs_view', coalesce((p_permissions->>'fbs_view')::boolean, false),
    'fbs_sync', coalesce((p_permissions->>'fbs_sync')::boolean, false),
    'fbs_full_sync', coalesce((p_permissions->>'fbs_full_sync')::boolean, false),
    'fbs_assembly', coalesce((p_permissions->>'fbs_assembly')::boolean, false),
    'fbs_dispatch', coalesce((p_permissions->>'fbs_dispatch')::boolean, false),
    'fbs_stocks_manage', coalesce((p_permissions->>'fbs_stocks_manage')::boolean, false)
  );
  if exists (select 1 from jsonb_each_text(v_permissions) entry where entry.value = 'true') then
    v_permissions := jsonb_set(v_permissions, '{fbs_view}', 'true'::jsonb);
  end if;

  insert into public.fbs_outsource_access(
    connection_id, client_account_id, executor_account_id,
    store_ids, permissions, enabled, created_by, updated_at
  ) values (
    p_connection_id, v_connection.requester_id, v_connection.partner_id,
    v_store_ids, v_permissions, coalesce(p_enabled, false), auth.uid(), now()
  )
  on conflict (connection_id) do update set
    store_ids = excluded.store_ids,
    permissions = excluded.permissions,
    enabled = excluded.enabled,
    updated_at = now();

  return public.get_fbs_outsource_access(p_connection_id);
end;
$$;

revoke all on function public.get_fbs_outsource_access(uuid) from public, anon;
revoke all on function public.save_fbs_outsource_access(uuid, uuid[], jsonb, boolean) from public, anon;
grant execute on function public.get_fbs_outsource_access(uuid) to authenticated;
grant execute on function public.save_fbs_outsource_access(uuid, uuid[], jsonb, boolean) to authenticated;

-- Picking locations for a permitted FBS store. Inventory stays inside the
-- client company; the API key is never returned.
create or replace function public.get_fbs_product_locations(
  p_account_id uuid,
  p_barcodes text[]
)
returns table (
  product_barcode text, quantity integer, physical_quantity integer,
  reserved_quantity integer, awaiting_quantity integer, box_item_id uuid,
  batch_id uuid, batch_number bigint, batch_name text, supply_id uuid,
  supply_number integer, box_id uuid, box_number integer, box_barcode text,
  warehouse_name text, rack_name text, side_name text, pallet_address text,
  slot_number integer, address_code text, address_text text, is_addressed boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    item.barcode,
    greatest(item.qty - reservation.reserved - reservation.awaiting, 0)::integer,
    item.qty::integer,
    reservation.reserved::integer,
    reservation.awaiting::integer,
    item.id,
    batch.id,
    batch.short_id::bigint,
    batch.name,
    supply.id,
    supply.supply_number::integer,
    box.id,
    box.box_number::integer,
    box.barcode,
    placement.warehouse_name,
    placement.rack_name,
    placement.side_name,
    placement.pallet_address,
    placement.slot_number,
    placement.address_code,
    placement.address_text,
    placement.item_id is not null
  from public.fulfillment_box_items item
  join public.fulfillment_boxes box on box.id = item.box_id
  join public.fulfillment_supplies supply on supply.id = box.supply_id
  join public.fulfillment_batches batch on batch.id = supply.batch_id
  left join lateral (
    select
      coalesce(sum(allocation.quantity) filter (where allocation.status = 'reserved'), 0)::integer as reserved,
      coalesce(sum(allocation.quantity) filter (where allocation.status = 'awaiting_wb'), 0)::integer as awaiting
    from public.fbs_stock_allocations allocation
    where allocation.box_item_id = item.id
  ) reservation on true
  left join lateral (
    select
      cell_item.id as item_id,
      warehouse.name as warehouse_name,
      rack.name as rack_name,
      side.name as side_name,
      cell.col || cell.row::text as pallet_address,
      cell_item.slot_number,
      format('C%s_W%s_R%s_F%s_%s%s_K%s', account.short_id, warehouse.short_id,
        rack.short_id, side.position + 1, cell.col, cell.row, cell_item.slot_number) as address_code,
      format('%s / %s / %s / %s%s-K%s', warehouse.name, rack.name, side.name,
        cell.col, cell.row, cell_item.slot_number) as address_text
    from public.wms_cell_items cell_item
    join public.wms_cells cell on cell.id = cell_item.cell_id
    join public.wms_zone_sides side on side.id = cell_item.side_id
    join public.wms_zones rack on rack.id = cell.zone_id
    join public.wms_warehouses warehouse on warehouse.id = rack.warehouse_id
    join public.accounts account on account.id = cell_item.account_id
    where cell_item.fulfillment_box_id = box.id
    order by cell_item.updated_at desc, cell_item.created_at desc
    limit 1
  ) placement on true
  where item.account_id = p_account_id
    and item.barcode = any(coalesce(p_barcodes, array[]::text[]))
    and batch.deleted_at is null
    and batch.status <> 'cancelled'
    and not exists (
      select 1 from public.trip_lines shipped_line
      where shipped_line.fulfillment_supply_id = supply.id
        and shipped_line.status = 'Отгружен'
    )
    and exists (
      select 1 from public.stores store
      where store.account_id = p_account_id
        and public.fbs_can_access_store(store.id, 'fbs_view')
    )
  order by item.barcode, placement.item_id is null, batch.short_id, supply.supply_number, box.box_number;
$$;

revoke all on function public.get_fbs_product_locations(uuid, text[]) from public, anon;
grant execute on function public.get_fbs_product_locations(uuid, text[]) to authenticated;

create or replace function public.reserve_fbs_order_from_box(
  p_store_id uuid,
  p_order_id text,
  p_box_id uuid
)
returns public.fbs_stock_allocations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.fbs_orders%rowtype;
  v_item public.fulfillment_box_items%rowtype;
  v_existing public.fbs_stock_allocations%rowtype;
  v_result public.fbs_stock_allocations%rowtype;
  v_active integer;
  v_event text;
  v_scanned_barcode text;
begin
  if not public.fbs_can_access_store(p_store_id, 'fbs_assembly') then
    raise exception 'No permission to assemble orders in this store';
  end if;

  select * into v_order from public.fbs_orders
  where store_id = p_store_id and wb_order_id = p_order_id for update;
  if not found then raise exception 'FBS order not found'; end if;
  if coalesce(v_order.supplier_status, '') <> 'confirm'
     or coalesce(v_order.wb_system_status, '') <> 'waiting' then
    raise exception 'A source box can be selected only while the order is assembling';
  end if;

  select session.pending_product_barcode into v_scanned_barcode
  from public.fbs_marking_sessions session
  where session.store_id = p_store_id
    and session.pending_order_id = p_order_id
    and session.active_box_id = p_box_id
    and session.created_by = auth.uid()
    and session.status in ('active', 'partial')
  order by session.last_seen_at desc limit 1;

  select item.* into v_item
  from public.fulfillment_box_items item
  join public.fulfillment_boxes box on box.id = item.box_id
  join public.fulfillment_supplies supply on supply.id = box.supply_id
  join public.fulfillment_batches batch on batch.id = supply.batch_id
  where box.id = p_box_id
    and item.account_id = v_order.account_id
    and batch.deleted_at is null
    and batch.status <> 'cancelled'
    and not exists (
      select 1 from public.trip_lines shipped_line
      where shipped_line.fulfillment_supply_id = supply.id
        and shipped_line.status = 'Отгружен'
    )
    and item.barcode in (
      select value from jsonb_array_elements_text(coalesce(v_order.skus, '[]'::jsonb)) value
    )
    and (v_scanned_barcode is null or item.barcode = v_scanned_barcode)
  for update of item;
  if not found then raise exception 'The selected box does not contain this order product'; end if;

  select * into v_existing from public.fbs_stock_allocations
  where store_id = p_store_id and wb_order_id = p_order_id for update;
  if found and v_existing.status = 'consumed' then raise exception 'Stock for this order is already consumed'; end if;
  if found and v_existing.status = 'awaiting_wb' then raise exception 'Order is already handed to WB'; end if;

  select coalesce(sum(quantity), 0)::integer into v_active
  from public.fbs_stock_allocations
  where box_item_id = v_item.id
    and status in ('reserved', 'awaiting_wb')
    and (v_existing.id is null or id <> v_existing.id);
  if v_item.qty - v_active < 1 then raise exception 'No available stock in this box'; end if;

  v_event := case
    when v_existing.id is not null and v_existing.box_item_id is distinct from v_item.id then 'moved'
    else 'reserved'
  end;

  insert into public.fbs_stock_allocations (
    account_id, store_id, wb_order_id, box_item_id, box_id, product_barcode,
    quantity, status, created_by, updated_by, updated_at,
    dispatched_at, consumed_at, released_at, last_supplier_status, last_wb_status
  ) values (
    v_order.account_id, p_store_id, p_order_id, v_item.id, p_box_id, v_item.barcode,
    1, 'reserved', auth.uid(), auth.uid(), timezone('utc', now()),
    null, null, null, v_order.supplier_status, v_order.wb_system_status
  )
  on conflict (store_id, wb_order_id) do update set
    box_item_id = excluded.box_item_id,
    box_id = excluded.box_id,
    product_barcode = excluded.product_barcode,
    quantity = 1,
    status = 'reserved',
    updated_by = auth.uid(),
    updated_at = timezone('utc', now()),
    dispatched_at = null,
    consumed_at = null,
    released_at = null,
    last_supplier_status = excluded.last_supplier_status,
    last_wb_status = excluded.last_wb_status
  returning * into v_result;

  insert into public.fbs_stock_allocation_events (
    allocation_id, account_id, store_id, wb_order_id, event_type,
    from_box_item_id, to_box_item_id, actor_id, supplier_status, wb_status
  ) values (
    v_result.id, v_result.account_id, v_result.store_id, v_result.wb_order_id, v_event,
    v_existing.box_item_id, v_item.id, auth.uid(), v_order.supplier_status, v_order.wb_system_status
  );

  insert into public.fbs_action_audit(account_id, store_id, user_id, action, details)
  values (v_order.account_id, p_store_id, auth.uid(), 'reserve_order_box', jsonb_build_object('order_id', p_order_id));
  return v_result;
end;
$$;

create or replace function public.release_fbs_order_box_reservation(
  p_store_id uuid,
  p_order_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.fbs_orders%rowtype;
  v_allocation public.fbs_stock_allocations%rowtype;
begin
  if not public.fbs_can_access_store(p_store_id, 'fbs_assembly') then
    raise exception 'No permission to assemble orders in this store';
  end if;
  select * into v_order from public.fbs_orders
  where store_id = p_store_id and wb_order_id = p_order_id for update;
  if not found then raise exception 'FBS order not found'; end if;
  if coalesce(v_order.supplier_status, '') <> 'confirm'
     or coalesce(v_order.wb_system_status, '') <> 'waiting' then
    raise exception 'Reservation can be released only before WB handoff';
  end if;

  update public.fbs_stock_allocations
  set status = 'released', released_at = timezone('utc', now()),
      updated_at = timezone('utc', now()), updated_by = auth.uid(),
      last_supplier_status = v_order.supplier_status, last_wb_status = v_order.wb_system_status
  where store_id = p_store_id and wb_order_id = p_order_id and status = 'reserved'
  returning * into v_allocation;
  if not found then raise exception 'Active reservation not found'; end if;

  insert into public.fbs_stock_allocation_events (
    allocation_id, account_id, store_id, wb_order_id, event_type,
    from_box_item_id, to_box_item_id, actor_id, supplier_status, wb_status
  ) values (
    v_allocation.id, v_allocation.account_id, v_allocation.store_id,
    v_allocation.wb_order_id, 'released', v_allocation.box_item_id, null,
    auth.uid(), v_order.supplier_status, v_order.wb_system_status
  );
  insert into public.fbs_action_audit(account_id, store_id, user_id, action, details)
  values (v_order.account_id, p_store_id, auth.uid(), 'release_order_box', jsonb_build_object('order_id', p_order_id));
  return true;
end;
$$;

revoke all on function public.reserve_fbs_order_from_box(uuid, text, uuid) from public, anon;
grant execute on function public.reserve_fbs_order_from_box(uuid, text, uuid) to authenticated;
revoke all on function public.release_fbs_order_box_reservation(uuid, text) from public, anon;
grant execute on function public.release_fbs_order_box_reservation(uuid, text) to authenticated;

create or replace function public.mark_fbs_supply_dispatched(
  p_store_id uuid,
  p_supply_id text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_now timestamptz := timezone('utc', now());
  v_account_id uuid;
begin
  if not public.fbs_can_access_store(p_store_id, 'fbs_dispatch') then
    raise exception 'No permission to dispatch this store';
  end if;
  select store.account_id into v_account_id from public.stores store where store.id = p_store_id;

  perform public.capture_fbs_dispatch_event(order_row.id, v_now, 'elestet_delivery', false)
  from public.fbs_orders order_row
  where order_row.store_id = p_store_id and order_row.supply_id = p_supply_id;

  perform public.capture_fbs_dispatch_attempt(order_row.id, v_now, 'elestet_delivery', false)
  from public.fbs_orders order_row
  where order_row.store_id = p_store_id and order_row.supply_id = p_supply_id;

  update public.fbs_supplies
  set done = true,
      wb_closed_at = coalesce(wb_closed_at, v_now),
      last_synced_at = v_now
  where store_id = p_store_id and wb_supply_id = p_supply_id;

  update public.fbs_orders
  set supplier_status = 'complete'
  where store_id = p_store_id and supply_id = p_supply_id
    and supplier_status = 'confirm';

  with changed as (
    update public.fbs_stock_allocations allocation
    set status = 'awaiting_wb', dispatched_at = coalesce(dispatched_at, v_now),
        updated_at = v_now, updated_by = auth.uid(),
        last_supplier_status = 'complete', last_wb_status = 'waiting'
    from public.fbs_orders order_row
    where order_row.store_id = p_store_id
      and order_row.supply_id = p_supply_id
      and allocation.store_id = order_row.store_id
      and allocation.wb_order_id = order_row.wb_order_id
      and allocation.status = 'reserved'
    returning allocation.*
  ), events as (
    insert into public.fbs_stock_allocation_events (
      allocation_id, account_id, store_id, wb_order_id, event_type,
      from_box_item_id, to_box_item_id, actor_id, supplier_status, wb_status
    )
    select id, account_id, store_id, wb_order_id, 'awaiting_wb',
           box_item_id, box_item_id, auth.uid(), 'complete', 'waiting'
    from changed returning 1
  )
  select count(*)::integer into v_count from events;

  insert into public.fbs_action_audit(account_id, store_id, user_id, action, details)
  values (v_account_id, p_store_id, auth.uid(), 'mark_supply_dispatched', jsonb_build_object('supply_id', p_supply_id));
  return v_count;
end;
$$;

revoke all on function public.mark_fbs_supply_dispatched(uuid, text) from public, anon;
grant execute on function public.mark_fbs_supply_dispatched(uuid, text) to authenticated;

create or replace function public.start_fbs_marking_session(
  p_account_id uuid,
  p_store_id uuid,
  p_device_id text,
  p_device_name text default 'Устройство'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.fbs_marking_sessions%rowtype;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if char_length(coalesce(p_device_id, '')) not between 8 and 200 then
    raise exception 'Invalid device identifier';
  end if;
  if not exists (
    select 1 from public.stores store
    where store.id = p_store_id and store.account_id = p_account_id
      and public.fbs_can_access_store(store.id, 'fbs_assembly')
  ) then raise exception 'No permission to scan this store'; end if;

  select * into v_session
  from public.fbs_marking_sessions
  where store_id = p_store_id and created_by = v_user_id and device_id = p_device_id
    and status in ('active', 'submitting', 'partial')
  order by started_at desc limit 1 for update;

  if v_session.id is null then
    insert into public.fbs_marking_sessions(account_id, store_id, created_by, device_id, device_name)
    values (p_account_id, p_store_id, v_user_id, p_device_id, left(coalesce(nullif(p_device_name, ''), 'Устройство'), 120))
    returning * into v_session;
  else
    update public.fbs_marking_sessions
    set last_seen_at = now(), updated_at = now(),
        device_name = left(coalesce(nullif(p_device_name, ''), device_name), 120),
        pending_order_id = case when pending_locked_until <= now() then null else pending_order_id end,
        pending_wb_qr = case when pending_locked_until <= now() then null else pending_wb_qr end,
        pending_locked_until = case when pending_locked_until <= now() then null else pending_locked_until end
    where id = v_session.id returning * into v_session;
  end if;
  return to_jsonb(v_session);
end;
$$;

revoke all on function public.start_fbs_marking_session(uuid, uuid, text, text) from public, anon;
grant execute on function public.start_fbs_marking_session(uuid, uuid, text, text) to authenticated;

create or replace function public.get_fbs_stock_catalog(
  p_account_id uuid,
  p_store_id uuid
)
returns table (
  product_id uuid, nm_id bigint, chrt_id bigint, barcode text, tech_size text,
  product_name text, vendor_code text, brand text, color text, photo_url text,
  physical_quantity integer, reserved_quantity integer, awaiting_quantity integer,
  available_quantity integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.stores store
    where store.id = p_store_id and store.account_id = p_account_id
      and public.fbs_can_access_store(store.id, 'fbs_view')
  ) then raise exception 'No access to FBS stock for this store'; end if;

  return query
  with reservation_totals as (
    select allocation.box_item_id,
      coalesce(sum(allocation.quantity) filter (where allocation.status = 'reserved'), 0)::integer as reserved,
      coalesce(sum(allocation.quantity) filter (where allocation.status = 'awaiting_wb'), 0)::integer as awaiting
    from public.fbs_stock_allocations allocation group by allocation.box_item_id
  ), inventory as (
    select item.barcode,
      coalesce(sum(item.qty), 0)::integer as physical,
      coalesce(sum(reservation.reserved), 0)::integer as reserved,
      coalesce(sum(reservation.awaiting), 0)::integer as awaiting
    from public.fulfillment_box_items item
    join public.fulfillment_boxes box on box.id = item.box_id
    join public.fulfillment_supplies supply on supply.id = box.supply_id
    join public.fulfillment_batches batch on batch.id = supply.batch_id
    left join reservation_totals reservation on reservation.box_item_id = item.id
    where batch.account_id = p_account_id group by item.barcode
  ), variants as (
    select product.id as product_id, product.nm_id,
      nullif(coalesce(size_item.value ->> 'chrtID', size_item.value ->> 'chrtId'), '')::bigint as chrt_id,
      coalesce(size_item.value ->> 'techSize', '—') as tech_size,
      array(
        select jsonb_array_elements_text(
          case when jsonb_typeof(size_item.value -> 'skus') = 'array'
            then size_item.value -> 'skus' else '[]'::jsonb end
        )
      ) as skus,
      product.name as product_name, product.vendor_code, product.brand, product.color,
      case when jsonb_typeof(product.photos) = 'array' and jsonb_array_length(product.photos) > 0
        then coalesce(product.photos -> 0 ->> 'c246x328', product.photos -> 0 ->> 'big')
        else null end as photo_url
    from public.products product
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(product.sizes) = 'array' then product.sizes else '[]'::jsonb end
    ) size_item
    where product.account_id = p_account_id and product.store_id = p_store_id
  )
  select variant.product_id, variant.nm_id, variant.chrt_id,
    coalesce(variant.skus[1], ''), variant.tech_size, variant.product_name,
    variant.vendor_code, variant.brand, variant.color, variant.photo_url,
    coalesce(sum(stock.physical), 0)::integer,
    coalesce(sum(stock.reserved), 0)::integer,
    coalesce(sum(stock.awaiting), 0)::integer,
    greatest(coalesce(sum(stock.physical), 0) - coalesce(sum(stock.reserved), 0)
      - coalesce(sum(stock.awaiting), 0), 0)::integer
  from variants variant
  left join inventory stock on stock.barcode = any(variant.skus)
  where variant.chrt_id is not null
  group by variant.product_id, variant.nm_id, variant.chrt_id, variant.skus,
    variant.tech_size, variant.product_name, variant.vendor_code, variant.brand,
    variant.color, variant.photo_url
  order by variant.product_name, variant.tech_size, variant.chrt_id;
end;
$$;

revoke all on function public.get_fbs_stock_catalog(uuid, uuid) from public, anon;
grant execute on function public.get_fbs_stock_catalog(uuid, uuid) to authenticated;

create or replace function public.get_fbs_calculated_stock(
  p_account_id uuid,
  p_store_id uuid
)
returns table (
  barcode text, received_quantity bigint, active_order_quantity bigint,
  dispatched_quantity bigint, calculated_quantity bigint
)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.stores store
    where store.id = p_store_id and store.account_id = p_account_id
      and public.fbs_can_access_store(store.id, 'fbs_view')
  ) then raise exception 'No access to calculated FBS stock for this store'; end if;

  return query
  with legacy_received as (
    select item.barcode, sum(item.qty_received + item.qty_defect)::bigint as quantity
    from public.fulfillment_items item
    join public.fulfillment_batches batch on batch.id = item.batch_id
    where batch.account_id = p_account_id and batch.store_id = p_store_id
      and batch.status = 'done' and batch.deleted_at is null
      and item.pipeline_stage_id is null and not item.is_excluded
    group by item.barcode
  ), pipeline_received as (
    select stock.barcode, sum(stock.quantity)::bigint as quantity
    from public.fulfillment_stage_stock stock
    join public.fulfillment_batches batch on batch.id = stock.batch_id
    where stock.account_id = p_account_id and batch.store_id = p_store_id
      and stock.status = 'active'
    group by stock.barcode
  ), received_by_barcode as (
    select source.barcode, sum(source.quantity)::bigint as quantity
    from (
      select * from legacy_received
      union all
      select * from pipeline_received
    ) source group by source.barcode
  ), active_orders_by_barcode as (
    select first_sku.barcode, count(*)::bigint as quantity
    from public.fbs_orders order_row
    cross join lateral (
      select sku.value as barcode
      from jsonb_array_elements_text(coalesce(order_row.skus, '[]'::jsonb))
        with ordinality sku(value, position)
      order by sku.position limit 1
    ) first_sku
    where order_row.account_id = p_account_id and order_row.store_id = p_store_id
      and order_row.is_in_latest_snapshot = true
      and order_row.supplier_status in ('new', 'confirm')
      and order_row.wb_system_status = 'waiting'
      and not exists (
        select 1 from public.fbs_dispatch_events dispatch_event
        where dispatch_event.store_id = order_row.store_id
          and dispatch_event.wb_order_id = order_row.wb_order_id
      )
    group by first_sku.barcode
  ), dispatched_by_barcode as (
    select event.product_barcode as barcode, sum(event.quantity)::bigint as quantity
    from public.fbs_dispatch_events event
    where event.account_id = p_account_id and event.store_id = p_store_id
      and event.product_barcode <> ''
    group by event.product_barcode
  ), all_barcodes as (
    select value.barcode from received_by_barcode value
    union select value.barcode from active_orders_by_barcode value
    union select value.barcode from dispatched_by_barcode value
  )
  select value.barcode,
    coalesce(received.quantity, 0)::bigint,
    coalesce(active_order.quantity, 0)::bigint,
    coalesce(dispatched.quantity, 0)::bigint,
    (coalesce(received.quantity, 0) - coalesce(active_order.quantity, 0)
      - coalesce(dispatched.quantity, 0))::bigint
  from all_barcodes value
  left join received_by_barcode received on received.barcode = value.barcode
  left join active_orders_by_barcode active_order on active_order.barcode = value.barcode
  left join dispatched_by_barcode dispatched on dispatched.barcode = value.barcode
  order by value.barcode;
end;
$$;

revoke all on function public.get_fbs_calculated_stock(uuid, uuid) from public, anon;
grant execute on function public.get_fbs_calculated_stock(uuid, uuid) to authenticated;

create or replace function public.get_fbs_dispatch_report_v2(
  p_account_id uuid, p_store_id uuid, p_period_from date, p_period_to date,
  p_timezone text default 'Asia/Bishkek', p_internal_warehouse_id uuid default null,
  p_wb_office_id bigint default null
)
returns table (
  product_barcode text, nm_id bigint, article text, vendor_code text,
  product_name text, brand text, color text, tech_size text, photo_url text,
  dispatched_quantity bigint, accepted_quantity bigint, orders_count bigint,
  supplies_count bigint, first_dispatched_at timestamptz, last_dispatched_at timestamptz,
  first_accepted_at timestamptz, last_accepted_at timestamptz,
  estimated_dispatched_quantity bigint, estimated_accepted_quantity bigint
)
language plpgsql security definer
set search_path = public
as $$
begin
  if p_period_from is null or p_period_to is null or p_period_from > p_period_to then
    raise exception 'Invalid report period';
  end if;
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'Invalid report timezone';
  end if;
  if not exists (
    select 1 from public.stores store
    where store.id = p_store_id and store.account_id = p_account_id
      and public.fbs_can_access_store(store.id, 'fbs_view')
  ) then raise exception 'No access to FBS report for this store'; end if;

  return query
  with canonical as (
    select attempt.account_id, attempt.store_id, attempt.wb_order_id,
      attempt.wb_supply_id as supply_id,
      internal_warehouse.id as internal_warehouse_id,
      nullif(order_row.warehouse_id, 0)::bigint as seller_warehouse_id,
      case when coalesce(order_row.data ->> 'officeId', '') ~ '^\d+$'
        then (order_row.data ->> 'officeId')::bigint else null end as wb_office_id,
      coalesce(barcode.value, '') as product_barcode,
      order_row.nm_id, order_row.article, product.vendor_code,
      product.name as product_name, product.brand, product.color,
      matched_size.tech_size,
      coalesce(product.photos -> 0 ->> 'c246x328', product.photos -> 0 ->> 'big') as photo_url,
      1::integer as quantity, attempt.dispatched_at, attempt.accepted_at,
      attempt.dispatch_is_estimated as is_estimated_time,
      attempt.acceptance_is_estimated as is_estimated_acceptance_time
    from public.fbs_dispatch_attempts attempt
    left join public.fbs_orders order_row
      on order_row.store_id = attempt.store_id and order_row.wb_order_id = attempt.wb_order_id
    left join public.products product
      on product.store_id = order_row.store_id and product.nm_id = order_row.nm_id
    left join lateral (
      select warehouse.id from public.wms_warehouses warehouse
      where warehouse.account_id = attempt.account_id and warehouse.fbs_enabled = true
        and warehouse.wb_warehouse_id::text = order_row.warehouse_id::text
      order by warehouse.created_at limit 1
    ) internal_warehouse on true
    left join lateral (
      select sku.value
      from jsonb_array_elements_text(coalesce(order_row.skus, '[]'::jsonb))
        with ordinality sku(value, position)
      order by sku.position limit 1
    ) barcode on true
    left join lateral (
      select nullif(size_row.value ->> 'techSize', '') as tech_size
      from jsonb_array_elements(coalesce(product.sizes, '[]'::jsonb)) size_row(value)
      where exists (
        select 1 from jsonb_array_elements_text(coalesce(size_row.value -> 'skus', '[]'::jsonb)) size_sku(value)
        where size_sku.value = barcode.value
      ) limit 1
    ) matched_size on true
    where attempt.account_id = p_account_id and attempt.store_id = p_store_id
  ), legacy as (
    select event.account_id, event.store_id, event.wb_order_id, event.supply_id,
      event.internal_warehouse_id, event.seller_warehouse_id, event.wb_office_id,
      event.product_barcode, event.nm_id, event.article, event.vendor_code,
      event.product_name, event.brand, event.color, event.tech_size, event.photo_url,
      event.quantity, event.dispatched_at, event.accepted_at,
      event.is_estimated_time, event.is_estimated_acceptance_time
    from public.fbs_dispatch_events event
    where event.account_id = p_account_id and event.store_id = p_store_id
      and not exists (
        select 1 from public.fbs_dispatch_attempts attempt
        where attempt.store_id = event.store_id
          and attempt.wb_order_id = event.wb_order_id
          and (event.supply_id is null or attempt.wb_supply_id = event.supply_id)
      )
  ), report_events as (
    select * from canonical union all select * from legacy
  )
  select event.product_barcode, max(event.nm_id), max(event.article),
    max(event.vendor_code), max(event.product_name), max(event.brand), max(event.color),
    max(event.tech_size), max(event.photo_url),
    coalesce(sum(event.quantity) filter (
      where event.dispatched_at >= (p_period_from::timestamp at time zone p_timezone)
        and event.dispatched_at < ((p_period_to + 1)::timestamp at time zone p_timezone)
    ), 0)::bigint,
    coalesce(sum(event.quantity) filter (
      where event.accepted_at >= (p_period_from::timestamp at time zone p_timezone)
        and event.accepted_at < ((p_period_to + 1)::timestamp at time zone p_timezone)
    ), 0)::bigint,
    count(*)::bigint, count(distinct event.supply_id)::bigint,
    min(event.dispatched_at) filter (
      where event.dispatched_at >= (p_period_from::timestamp at time zone p_timezone)
        and event.dispatched_at < ((p_period_to + 1)::timestamp at time zone p_timezone)
    ),
    max(event.dispatched_at) filter (
      where event.dispatched_at >= (p_period_from::timestamp at time zone p_timezone)
        and event.dispatched_at < ((p_period_to + 1)::timestamp at time zone p_timezone)
    ),
    min(event.accepted_at) filter (
      where event.accepted_at >= (p_period_from::timestamp at time zone p_timezone)
        and event.accepted_at < ((p_period_to + 1)::timestamp at time zone p_timezone)
    ),
    max(event.accepted_at) filter (
      where event.accepted_at >= (p_period_from::timestamp at time zone p_timezone)
        and event.accepted_at < ((p_period_to + 1)::timestamp at time zone p_timezone)
    ),
    coalesce(sum(event.quantity) filter (
      where event.is_estimated_time
        and event.dispatched_at >= (p_period_from::timestamp at time zone p_timezone)
        and event.dispatched_at < ((p_period_to + 1)::timestamp at time zone p_timezone)
    ), 0)::bigint,
    coalesce(sum(event.quantity) filter (
      where event.is_estimated_acceptance_time
        and event.accepted_at >= (p_period_from::timestamp at time zone p_timezone)
        and event.accepted_at < ((p_period_to + 1)::timestamp at time zone p_timezone)
    ), 0)::bigint
  from report_events event
  where (
      (event.dispatched_at >= (p_period_from::timestamp at time zone p_timezone)
       and event.dispatched_at < ((p_period_to + 1)::timestamp at time zone p_timezone))
      or
      (event.accepted_at >= (p_period_from::timestamp at time zone p_timezone)
       and event.accepted_at < ((p_period_to + 1)::timestamp at time zone p_timezone))
    )
    and (p_internal_warehouse_id is null or event.internal_warehouse_id = p_internal_warehouse_id)
    and (p_wb_office_id is null or event.wb_office_id = p_wb_office_id)
  group by event.product_barcode
  order by (
    coalesce(sum(event.quantity) filter (
      where event.dispatched_at >= (p_period_from::timestamp at time zone p_timezone)
        and event.dispatched_at < ((p_period_to + 1)::timestamp at time zone p_timezone)
    ), 0)
    + coalesce(sum(event.quantity) filter (
      where event.accepted_at >= (p_period_from::timestamp at time zone p_timezone)
        and event.accepted_at < ((p_period_to + 1)::timestamp at time zone p_timezone)
    ), 0)
  ) desc, event.product_barcode;
end;
$$;

revoke all on function public.get_fbs_dispatch_report_v2(uuid, uuid, date, date, text, uuid, bigint) from public, anon;
grant execute on function public.get_fbs_dispatch_report_v2(uuid, uuid, date, date, text, uuid, bigint) to authenticated;

drop policy if exists "fbs action audit: scoped read" on public.fbs_action_audit;
create policy "fbs action audit: scoped read"
  on public.fbs_action_audit for select
  using (public.fbs_can_access_store(store_id, 'fbs_view'));
grant select on public.fbs_action_audit to authenticated;

-- Replace broad account-member FBS reads with permission + store scope.
drop policy if exists "fbs_orders: account members" on public.fbs_orders;
drop policy if exists "fbs orders: scoped read" on public.fbs_orders;
create policy "fbs orders: scoped read" on public.fbs_orders for select
  using (public.fbs_can_access_store(store_id, 'fbs_view'));

drop policy if exists "fbs_sync_log: account members" on public.fbs_sync_log;
drop policy if exists "fbs sync log: scoped read" on public.fbs_sync_log;
create policy "fbs sync log: scoped read" on public.fbs_sync_log for select
  using (public.fbs_can_access_store(store_id, 'fbs_view'));

drop policy if exists "fbs_supplies: account members" on public.fbs_supplies;
drop policy if exists "fbs supplies: scoped read" on public.fbs_supplies;
create policy "fbs supplies: scoped read" on public.fbs_supplies for select
  using (public.fbs_can_access_store(store_id, 'fbs_view'));

drop policy if exists "fbs_supply_orders: account members" on public.fbs_supply_orders;
drop policy if exists "fbs supply orders: scoped read" on public.fbs_supply_orders;
create policy "fbs supply orders: scoped read" on public.fbs_supply_orders for select
  using (public.fbs_can_access_store(store_id, 'fbs_view'));

drop policy if exists "fbs_dispatch_attempts: account members" on public.fbs_dispatch_attempts;
drop policy if exists "fbs dispatch attempts: scoped read" on public.fbs_dispatch_attempts;
create policy "fbs dispatch attempts: scoped read" on public.fbs_dispatch_attempts for select
  using (public.fbs_can_access_store(store_id, 'fbs_view'));

drop policy if exists "fbs_sync_jobs: account members" on public.fbs_sync_jobs;
drop policy if exists "fbs sync jobs: scoped read" on public.fbs_sync_jobs;
create policy "fbs sync jobs: scoped read" on public.fbs_sync_jobs for select
  using (public.fbs_can_access_store(store_id, 'fbs_view'));

drop policy if exists "fbs_dispatch_events: account members" on public.fbs_dispatch_events;
drop policy if exists "fbs dispatch events: scoped read" on public.fbs_dispatch_events;
create policy "fbs dispatch events: scoped read" on public.fbs_dispatch_events for select
  using (public.fbs_can_access_store(store_id, 'fbs_view'));

drop policy if exists "members_view_fbs_stock_allocations" on public.fbs_stock_allocations;
drop policy if exists "fbs stock allocations: scoped read" on public.fbs_stock_allocations;
create policy "fbs stock allocations: scoped read" on public.fbs_stock_allocations for select
  using (public.fbs_can_access_store(store_id, 'fbs_view'));

drop policy if exists "members_view_fbs_stock_allocation_events" on public.fbs_stock_allocation_events;
drop policy if exists "fbs stock allocation events: scoped read" on public.fbs_stock_allocation_events;
create policy "fbs stock allocation events: scoped read" on public.fbs_stock_allocation_events for select
  using (public.fbs_can_access_store(store_id, 'fbs_view'));

drop policy if exists "members view fbs stock updates" on public.fbs_stock_updates;
drop policy if exists "fbs stock updates: scoped read" on public.fbs_stock_updates;
create policy "fbs stock updates: scoped read" on public.fbs_stock_updates for select
  using (public.fbs_can_access_store(store_id, 'fbs_view'));

drop policy if exists "fbs kiz states: account members read" on public.fbs_kiz_order_states;
drop policy if exists "fbs kiz states: scoped read" on public.fbs_kiz_order_states;
create policy "fbs kiz states: scoped read" on public.fbs_kiz_order_states for select
  using (public.fbs_can_access_store(store_id, 'fbs_view'));

drop policy if exists "fbs marking sessions: account members read" on public.fbs_marking_sessions;
drop policy if exists "fbs marking sessions: scoped read" on public.fbs_marking_sessions;
create policy "fbs marking sessions: scoped read" on public.fbs_marking_sessions for select
  using (public.fbs_can_access_store(store_id, 'fbs_view'));

drop policy if exists "fbs marking pairs: account members read" on public.fbs_marking_pairs;
drop policy if exists "fbs marking pairs: scoped read" on public.fbs_marking_pairs;
create policy "fbs marking pairs: scoped read" on public.fbs_marking_pairs for select
  using (public.fbs_can_access_store(store_id, 'fbs_view'));

drop policy if exists "fbs qr catalog: account members read" on public.fbs_wb_qr_catalog;
drop policy if exists "fbs qr catalog: scoped read" on public.fbs_wb_qr_catalog;
create policy "fbs qr catalog: scoped read" on public.fbs_wb_qr_catalog for select
  using (public.fbs_can_access_store(store_id, 'fbs_view'));

drop policy if exists "fbs_archive_reports: account members" on public.fbs_archive_reports;
drop policy if exists "fbs archive reports: scoped read" on public.fbs_archive_reports;
drop policy if exists "fbs archive reports: scoped insert" on public.fbs_archive_reports;
drop policy if exists "fbs archive reports: scoped delete" on public.fbs_archive_reports;
create policy "fbs archive reports: scoped read" on public.fbs_archive_reports for select
  using (public.fbs_can_access_store(store_id, 'fbs_view'));
create policy "fbs archive reports: scoped insert" on public.fbs_archive_reports for insert
  with check (
    public.fbs_can_access_store(store_id, 'fbs_assembly')
    and exists (select 1 from public.stores store where store.id = store_id and store.account_id = account_id)
  );
create policy "fbs archive reports: scoped delete" on public.fbs_archive_reports for delete
  using (public.fbs_can_access_store(store_id, 'fbs_assembly'));

-- Outsource workers need product details for the granted FBS stores only.
drop policy if exists "fbs outsource products read" on public.products;
create policy "fbs outsource products read" on public.products for select
  using (public.fbs_can_access_store(store_id, 'fbs_view'));

commit;
