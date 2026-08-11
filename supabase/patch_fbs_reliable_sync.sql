-- Надёжная синхронизация FBS: сохраняем оба официальных статуса WB отдельно,
-- не теряем точность int64 ID и применяем снимок заказов одной транзакцией.

alter table public.fbs_orders
  alter column wb_order_id type text using wb_order_id::text;

alter table public.fbs_orders
  add column if not exists supplier_status text,
  add column if not exists wb_system_status text,
  add column if not exists status_synced_at timestamptz,
  add column if not exists is_in_latest_snapshot boolean not null default true;

update public.fbs_orders
set supplier_status = case
      when wb_status in ('new', 'confirm', 'complete', 'cancel') then wb_status
      else supplier_status
    end
where supplier_status is null;

update public.fbs_orders
set is_in_latest_snapshot = false
where created_at < now() - interval '30 days';

alter table public.fbs_sync_log
  add column if not exists status_counts jsonb not null default '{}'::jsonb,
  add column if not exists snapshot_from timestamptz;

create index if not exists fbs_orders_official_statuses
  on public.fbs_orders(store_id, supplier_status, wb_system_status);

create or replace function public.apply_fbs_sync_snapshot(
  p_store_id uuid,
  p_account_id uuid,
  p_synced_at timestamptz,
  p_snapshot_from timestamptz,
  p_orders jsonb,
  p_statuses jsonb,
  p_status_counts jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_count integer := jsonb_array_length(coalesce(p_statuses, '[]'::jsonb));
begin
  if not exists (
    select 1
    from public.stores
    where id = p_store_id and account_id = p_account_id
  ) then
    raise exception 'Store does not belong to account';
  end if;

  if jsonb_array_length(coalesce(p_orders, '[]'::jsonb)) <> v_order_count then
    raise exception 'Orders and statuses count mismatch';
  end if;

  -- Не даём более старому параллельному запросу затереть свежий снимок.
  perform pg_advisory_xact_lock(hashtextextended(p_store_id::text, 0));
  if exists (
    select 1
    from public.fbs_sync_log
    where store_id = p_store_id and last_synced_at > p_synced_at
  ) then
    return;
  end if;

  update public.fbs_orders
  set is_in_latest_snapshot = false
  where store_id = p_store_id;

  insert into public.fbs_orders (
    account_id,
    store_id,
    wb_order_id,
    wb_status,
    supplier_status,
    wb_system_status,
    supply_id,
    rid,
    article,
    nm_id,
    chrt_id,
    skus,
    price,
    warehouse_id,
    created_at,
    ddate,
    data,
    synced_at,
    status_synced_at,
    is_in_latest_snapshot
  )
  select
    p_account_id,
    p_store_id,
    order_row.wb_order_id,
    coalesce(order_row.supplier_status, 'new'),
    order_row.supplier_status,
    order_row.wb_system_status,
    order_row.supply_id,
    order_row.rid,
    order_row.article,
    order_row.nm_id,
    order_row.chrt_id,
    coalesce(order_row.skus, '[]'::jsonb),
    coalesce(order_row.price, 0),
    coalesce(order_row.warehouse_id, 0),
    order_row.created_at,
    order_row.ddate,
    coalesce(order_row.data, '{}'::jsonb),
    p_synced_at,
    p_synced_at,
    true
  from jsonb_to_recordset(coalesce(p_orders, '[]'::jsonb)) as order_row(
    wb_order_id text,
    supplier_status text,
    wb_system_status text,
    supply_id text,
    rid text,
    article text,
    nm_id bigint,
    chrt_id bigint,
    skus jsonb,
    price integer,
    warehouse_id integer,
    created_at timestamptz,
    ddate timestamptz,
    data jsonb
  )
  on conflict (store_id, wb_order_id) do update set
    account_id = excluded.account_id,
    wb_status = excluded.wb_status,
    supplier_status = excluded.supplier_status,
    wb_system_status = excluded.wb_system_status,
    supply_id = excluded.supply_id,
    rid = excluded.rid,
    article = excluded.article,
    nm_id = excluded.nm_id,
    chrt_id = excluded.chrt_id,
    skus = excluded.skus,
    price = excluded.price,
    warehouse_id = excluded.warehouse_id,
    created_at = excluded.created_at,
    ddate = excluded.ddate,
    data = excluded.data,
    synced_at = excluded.synced_at,
    status_synced_at = excluded.status_synced_at,
    is_in_latest_snapshot = true;

  update public.fbs_orders as existing_order
  set
    wb_status = status_row.supplier_status,
    supplier_status = status_row.supplier_status,
    wb_system_status = status_row.wb_system_status,
    status_synced_at = p_synced_at,
    synced_at = p_synced_at,
    is_in_latest_snapshot = true
  from jsonb_to_recordset(coalesce(p_statuses, '[]'::jsonb)) as status_row(
    wb_order_id text,
    supplier_status text,
    wb_system_status text
  )
  where existing_order.store_id = p_store_id
    and existing_order.wb_order_id = status_row.wb_order_id;

  insert into public.fbs_sync_log (
    store_id,
    last_synced_at,
    orders_count,
    error,
    status_counts,
    snapshot_from
  ) values (
    p_store_id,
    p_synced_at,
    v_order_count,
    null,
    coalesce(p_status_counts, '{}'::jsonb),
    p_snapshot_from
  )
  on conflict (store_id) do update set
    last_synced_at = excluded.last_synced_at,
    orders_count = excluded.orders_count,
    error = null,
    status_counts = excluded.status_counts,
    snapshot_from = excluded.snapshot_from;
end;
$$;

revoke all on function public.apply_fbs_sync_snapshot(uuid, uuid, timestamptz, timestamptz, jsonb, jsonb, jsonb) from public;
revoke all on function public.apply_fbs_sync_snapshot(uuid, uuid, timestamptz, timestamptz, jsonb, jsonb, jsonb) from anon;
revoke all on function public.apply_fbs_sync_snapshot(uuid, uuid, timestamptz, timestamptz, jsonb, jsonb, jsonb) from authenticated;
grant execute on function public.apply_fbs_sync_snapshot(uuid, uuid, timestamptz, timestamptz, jsonb, jsonb, jsonb) to service_role;
