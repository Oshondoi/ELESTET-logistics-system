-- Официальная временная шкала FBS-поставок WB.
-- Добавляется параллельно старому fbs_dispatch_events и не удаляет старые данные.

create table if not exists public.fbs_supplies (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  wb_supply_id text not null,
  name text,
  done boolean not null default false,
  wb_created_at timestamptz,
  wb_closed_at timestamptz,
  wb_scan_at timestamptz,
  destination_office_id bigint,
  cargo_type integer,
  cross_border_type integer,
  is_b2b boolean,
  raw_data jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default timezone('utc', now()),
  last_synced_at timestamptz not null default timezone('utc', now()),
  last_orders_synced_at timestamptz,
  unique (store_id, wb_supply_id)
);

create index if not exists fbs_supplies_store_dates_idx
  on public.fbs_supplies (store_id, wb_closed_at desc, wb_scan_at desc);
create index if not exists fbs_supplies_pending_idx
  on public.fbs_supplies (store_id, done, last_synced_at)
  where wb_closed_at is null or wb_scan_at is null;

create table if not exists public.fbs_supply_orders (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  wb_supply_id text not null,
  wb_order_id text not null,
  is_current boolean not null default true,
  first_seen_at timestamptz not null default timezone('utc', now()),
  last_seen_at timestamptz not null default timezone('utc', now()),
  unique (store_id, wb_supply_id, wb_order_id),
  foreign key (store_id, wb_supply_id)
    references public.fbs_supplies(store_id, wb_supply_id) on delete cascade
);

create index if not exists fbs_supply_orders_order_idx
  on public.fbs_supply_orders (store_id, wb_order_id, last_seen_at desc);
create index if not exists fbs_supply_orders_supply_idx
  on public.fbs_supply_orders (store_id, wb_supply_id, is_current);

create table if not exists public.fbs_dispatch_attempts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  wb_supply_id text not null,
  wb_order_id text not null,
  dispatched_at timestamptz,
  accepted_at timestamptz,
  dispatch_source text check (
    dispatch_source is null or dispatch_source in (
      'wb_closed_at', 'elestet_delivery', 'wb_status_seen', 'legacy_backfill'
    )
  ),
  acceptance_source text check (
    acceptance_source is null or acceptance_source in (
      'wb_scan_dt', 'wb_status_seen', 'legacy_backfill'
    )
  ),
  dispatch_is_estimated boolean not null default true,
  acceptance_is_estimated boolean not null default true,
  is_current_membership boolean not null default true,
  first_seen_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (store_id, wb_supply_id, wb_order_id),
  foreign key (store_id, wb_supply_id, wb_order_id)
    references public.fbs_supply_orders(store_id, wb_supply_id, wb_order_id) on delete cascade
);

create index if not exists fbs_dispatch_attempts_dispatch_idx
  on public.fbs_dispatch_attempts (account_id, store_id, dispatched_at desc)
  where dispatched_at is not null;
create index if not exists fbs_dispatch_attempts_acceptance_idx
  on public.fbs_dispatch_attempts (account_id, store_id, accepted_at desc)
  where accepted_at is not null;
create index if not exists fbs_dispatch_attempts_order_idx
  on public.fbs_dispatch_attempts (store_id, wb_order_id);

create table if not exists public.fbs_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  job_type text not null check (job_type in ('incremental', 'full', 'history')),
  trigger_source text not null check (trigger_source in ('automatic', 'manual', 'store_connected', 'nightly')),
  status text not null default 'running' check (status in ('queued', 'running', 'completed', 'failed', 'skipped')),
  progress_current integer not null default 0,
  progress_total integer not null default 0,
  cursor_data jsonb not null default '{}'::jsonb,
  result_counts jsonb not null default '{}'::jsonb,
  error text,
  retry_count integer not null default 0,
  requested_by uuid references auth.users(id) on delete set null,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists fbs_sync_jobs_one_active_per_store_idx
  on public.fbs_sync_jobs (store_id)
  where status in ('queued', 'running');
create index if not exists fbs_sync_jobs_store_created_idx
  on public.fbs_sync_jobs (store_id, created_at desc);

alter table public.fbs_sync_log
  add column if not exists last_incremental_at timestamptz,
  add column if not exists last_full_at timestamptz,
  add column if not exists supply_last_synced_at timestamptz,
  add column if not exists supply_last_full_at timestamptz,
  add column if not exists incremental_status_counts jsonb not null default '{}'::jsonb;

alter table public.fbs_orders
  add column if not exists last_full_sync_id uuid;

create index if not exists fbs_orders_full_sync_token_idx
  on public.fbs_orders (store_id, last_full_sync_id);

alter table public.fbs_supplies enable row level security;
alter table public.fbs_supply_orders enable row level security;
alter table public.fbs_dispatch_attempts enable row level security;
alter table public.fbs_sync_jobs enable row level security;

grant select on table public.fbs_supplies to authenticated;
grant select on table public.fbs_supply_orders to authenticated;
grant select on table public.fbs_dispatch_attempts to authenticated;
grant select on table public.fbs_sync_jobs to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'fbs_orders'
  ) then alter publication supabase_realtime add table public.fbs_orders; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'fbs_supplies'
  ) then alter publication supabase_realtime add table public.fbs_supplies; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'fbs_dispatch_attempts'
  ) then alter publication supabase_realtime add table public.fbs_dispatch_attempts; end if;
end $$;

drop policy if exists "fbs_supplies: account members" on public.fbs_supplies;
create policy "fbs_supplies: account members"
  on public.fbs_supplies for select
  using (account_id in (
    select member.account_id from public.account_members member where member.user_id = auth.uid()
  ));

drop policy if exists "fbs_supply_orders: account members" on public.fbs_supply_orders;
create policy "fbs_supply_orders: account members"
  on public.fbs_supply_orders for select
  using (account_id in (
    select member.account_id from public.account_members member where member.user_id = auth.uid()
  ));

drop policy if exists "fbs_dispatch_attempts: account members" on public.fbs_dispatch_attempts;
create policy "fbs_dispatch_attempts: account members"
  on public.fbs_dispatch_attempts for select
  using (account_id in (
    select member.account_id from public.account_members member where member.user_id = auth.uid()
  ));

drop policy if exists "fbs_sync_jobs: account members" on public.fbs_sync_jobs;
create policy "fbs_sync_jobs: account members"
  on public.fbs_sync_jobs for select
  using (account_id in (
    select member.account_id from public.account_members member where member.user_id = auth.uid()
  ));

-- Запуск задачи с межпроцессной блокировкой на магазин. Зависшие задачи старше
-- 5 минут автоматически освобождаются перед новым запуском. Это больше
-- предельного HTTP-времени Edge Function и не оставляет магазин заблокированным.
create or replace function public.start_fbs_sync_job(
  p_store_id uuid,
  p_job_type text,
  p_trigger_source text,
  p_requested_by uuid default null
)
returns table (job_id uuid, acquired boolean, active_job_type text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_job_id uuid;
  v_active_type text;
begin
  select store.account_id into v_account_id
  from public.stores store
  where store.id = p_store_id;
  if v_account_id is null then raise exception 'Магазин не найден'; end if;
  if p_job_type not in ('incremental', 'full', 'history') then raise exception 'Некорректный тип синхронизации'; end if;
  if p_trigger_source not in ('automatic', 'manual', 'store_connected', 'nightly') then raise exception 'Некорректный источник синхронизации'; end if;

  update public.fbs_sync_jobs
  set status = 'failed',
      error = coalesce(error, 'Задача превысила допустимое время выполнения'),
      finished_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where store_id = p_store_id
    and status in ('queued', 'running')
    and updated_at < timezone('utc', now()) - interval '5 minutes';

  select job.id, job.job_type into v_job_id, v_active_type
  from public.fbs_sync_jobs job
  where job.store_id = p_store_id and job.status in ('queued', 'running')
  order by job.created_at desc
  limit 1;
  if v_job_id is not null then
    return query select v_job_id, false, v_active_type;
    return;
  end if;

  begin
    insert into public.fbs_sync_jobs (
      account_id, store_id, job_type, trigger_source, status,
      requested_by, started_at, updated_at
    ) values (
      v_account_id, p_store_id, p_job_type, p_trigger_source, 'running',
      p_requested_by, timezone('utc', now()), timezone('utc', now())
    ) returning id into v_job_id;
  exception when unique_violation then
    select job.id, job.job_type into v_job_id, v_active_type
    from public.fbs_sync_jobs job
    where job.store_id = p_store_id and job.status in ('queued', 'running')
    order by job.created_at desc
    limit 1;
    return query select v_job_id, false, v_active_type;
    return;
  end;

  return query select v_job_id, true, p_job_type;
end;
$$;

revoke all on function public.start_fbs_sync_job(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.start_fbs_sync_job(uuid, text, text, uuid) to service_role;

create or replace function public.finish_fbs_sync_job(
  p_job_id uuid,
  p_status text,
  p_result_counts jsonb default '{}'::jsonb,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('completed', 'failed', 'skipped') then raise exception 'Некорректный итог задачи'; end if;
  update public.fbs_sync_jobs
  set status = p_status,
      result_counts = coalesce(p_result_counts, '{}'::jsonb),
      error = nullif(p_error, ''),
      progress_current = case when p_status = 'completed' then greatest(progress_total, progress_current) else progress_current end,
      finished_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = p_job_id;
end;
$$;

revoke all on function public.finish_fbs_sync_job(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.finish_fbs_sync_job(uuid, text, jsonb, text) to service_role;

-- Лёгкое обновление: добавляет новые заказы и обновляет статусы уже известных,
-- не помечая старую историю отсутствующей в полном снимке.
create or replace function public.apply_fbs_incremental_sync(
  p_store_id uuid,
  p_account_id uuid,
  p_synced_at timestamptz,
  p_new_orders jsonb,
  p_statuses jsonb,
  p_status_counts jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.stores store where store.id = p_store_id and store.account_id = p_account_id
  ) then raise exception 'Магазин не принадлежит компании'; end if;

  insert into public.fbs_orders (
    account_id, store_id, wb_order_id, wb_status, supplier_status, wb_system_status,
    supply_id, rid, article, nm_id, chrt_id, skus, price, warehouse_id,
    created_at, ddate, data, synced_at, status_synced_at, is_in_latest_snapshot
  )
  select
    p_account_id, p_store_id, order_row.wb_order_id,
    coalesce(order_row.supplier_status, 'new'), order_row.supplier_status, order_row.wb_system_status,
    order_row.supply_id, order_row.rid, order_row.article, order_row.nm_id,
    order_row.chrt_id, coalesce(order_row.skus, '[]'::jsonb), coalesce(order_row.price, 0),
    coalesce(order_row.warehouse_id, 0), order_row.created_at, order_row.ddate,
    coalesce(order_row.data, '{}'::jsonb), p_synced_at, p_synced_at, true
  from jsonb_to_recordset(coalesce(p_new_orders, '[]'::jsonb)) as order_row(
    wb_order_id text, supplier_status text, wb_system_status text, supply_id text,
    rid text, article text, nm_id bigint, chrt_id bigint, skus jsonb, price integer,
    warehouse_id integer, created_at timestamptz, ddate timestamptz, data jsonb
  )
  on conflict (store_id, wb_order_id) do update set
    account_id = excluded.account_id,
    wb_status = excluded.wb_status,
    supplier_status = excluded.supplier_status,
    wb_system_status = excluded.wb_system_status,
    supply_id = coalesce(excluded.supply_id, fbs_orders.supply_id),
    rid = coalesce(excluded.rid, fbs_orders.rid),
    article = coalesce(excluded.article, fbs_orders.article),
    nm_id = coalesce(excluded.nm_id, fbs_orders.nm_id),
    chrt_id = coalesce(excluded.chrt_id, fbs_orders.chrt_id),
    skus = case when excluded.skus = '[]'::jsonb then fbs_orders.skus else excluded.skus end,
    price = excluded.price,
    warehouse_id = excluded.warehouse_id,
    created_at = coalesce(excluded.created_at, fbs_orders.created_at),
    ddate = coalesce(excluded.ddate, fbs_orders.ddate),
    data = case when excluded.data = '{}'::jsonb then fbs_orders.data else excluded.data end,
    synced_at = excluded.synced_at,
    status_synced_at = excluded.status_synced_at,
    is_in_latest_snapshot = true;

  update public.fbs_orders existing_order
  set wb_status = status_row.supplier_status,
      supplier_status = status_row.supplier_status,
      wb_system_status = status_row.wb_system_status,
      status_synced_at = p_synced_at,
      synced_at = p_synced_at,
      is_in_latest_snapshot = true
  from jsonb_to_recordset(coalesce(p_statuses, '[]'::jsonb)) as status_row(
    wb_order_id text, supplier_status text, wb_system_status text
  )
  where existing_order.store_id = p_store_id
    and existing_order.wb_order_id = status_row.wb_order_id;

  insert into public.fbs_sync_log (
    store_id, last_synced_at, error, last_incremental_at, incremental_status_counts
  ) values (
    p_store_id, p_synced_at, null, p_synced_at, coalesce(p_status_counts, '{}'::jsonb)
  )
  on conflict (store_id) do update set
    last_synced_at = excluded.last_synced_at,
    error = null,
    last_incremental_at = excluded.last_incremental_at,
    incremental_status_counts = excluded.incremental_status_counts;
end;
$$;

revoke all on function public.apply_fbs_incremental_sync(uuid, uuid, timestamptz, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_fbs_incremental_sync(uuid, uuid, timestamptz, jsonb, jsonb, jsonb)
  to service_role;

-- Большой полный снимок записывается ограниченными порциями. До финального RPC
-- старые строки остаются актуальными, поэтому таймаут или ошибка WB не очищают
-- рабочий список заказов.
create or replace function public.apply_fbs_full_sync_batch(
  p_store_id uuid,
  p_account_id uuid,
  p_sync_id uuid,
  p_synced_at timestamptz,
  p_orders jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  if not exists (
    select 1 from public.stores store
    where store.id = p_store_id and store.account_id = p_account_id
  ) then raise exception 'Магазин не принадлежит компании'; end if;

  insert into public.fbs_orders (
    account_id, store_id, wb_order_id, wb_status, supplier_status, wb_system_status,
    supply_id, rid, article, nm_id, chrt_id, skus, price, warehouse_id,
    created_at, ddate, data, synced_at, status_synced_at,
    is_in_latest_snapshot, last_full_sync_id
  )
  select
    p_account_id, p_store_id, order_row.wb_order_id,
    coalesce(order_row.supplier_status, 'new'), order_row.supplier_status,
    order_row.wb_system_status, order_row.supply_id, order_row.rid,
    order_row.article, order_row.nm_id, order_row.chrt_id,
    coalesce(order_row.skus, '[]'::jsonb), coalesce(order_row.price, 0),
    coalesce(order_row.warehouse_id, 0), order_row.created_at, order_row.ddate,
    coalesce(order_row.data, '{}'::jsonb), p_synced_at, p_synced_at,
    true, p_sync_id
  from jsonb_to_recordset(coalesce(p_orders, '[]'::jsonb)) as order_row(
    wb_order_id text, supplier_status text, wb_system_status text, supply_id text,
    rid text, article text, nm_id bigint, chrt_id bigint, skus jsonb, price integer,
    warehouse_id integer, created_at timestamptz, ddate timestamptz, data jsonb
  )
  on conflict (store_id, wb_order_id) do update set
    account_id = excluded.account_id,
    wb_status = excluded.wb_status,
    supplier_status = excluded.supplier_status,
    wb_system_status = excluded.wb_system_status,
    supply_id = coalesce(excluded.supply_id, fbs_orders.supply_id),
    rid = coalesce(excluded.rid, fbs_orders.rid),
    article = coalesce(excluded.article, fbs_orders.article),
    nm_id = coalesce(excluded.nm_id, fbs_orders.nm_id),
    chrt_id = coalesce(excluded.chrt_id, fbs_orders.chrt_id),
    skus = case when excluded.skus = '[]'::jsonb then fbs_orders.skus else excluded.skus end,
    price = excluded.price,
    warehouse_id = excluded.warehouse_id,
    created_at = coalesce(excluded.created_at, fbs_orders.created_at),
    ddate = coalesce(excluded.ddate, fbs_orders.ddate),
    data = case when excluded.data = '{}'::jsonb then fbs_orders.data else excluded.data end,
    synced_at = excluded.synced_at,
    status_synced_at = excluded.status_synced_at,
    is_in_latest_snapshot = true,
    last_full_sync_id = excluded.last_full_sync_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.apply_fbs_full_sync_batch(uuid, uuid, uuid, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_fbs_full_sync_batch(uuid, uuid, uuid, timestamptz, jsonb)
  to service_role;

create or replace function public.finish_fbs_full_sync(
  p_store_id uuid,
  p_sync_id uuid,
  p_synced_at timestamptz,
  p_snapshot_from timestamptz,
  p_orders_count integer,
  p_status_counts jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_store_id::text, 0));
  if exists (
    select 1 from public.fbs_sync_log sync_log
    where sync_log.store_id = p_store_id and sync_log.last_synced_at > p_synced_at
  ) then return; end if;

  update public.fbs_orders order_row
  set is_in_latest_snapshot = false
  where order_row.store_id = p_store_id
    and order_row.is_in_latest_snapshot
    and order_row.last_full_sync_id is distinct from p_sync_id;

  insert into public.fbs_sync_log (
    store_id, last_synced_at, orders_count, error, status_counts,
    snapshot_from, last_full_at
  ) values (
    p_store_id, p_synced_at, p_orders_count, null,
    coalesce(p_status_counts, '{}'::jsonb), p_snapshot_from, p_synced_at
  )
  on conflict (store_id) do update set
    last_synced_at = excluded.last_synced_at,
    orders_count = excluded.orders_count,
    error = null,
    status_counts = excluded.status_counts,
    snapshot_from = excluded.snapshot_from,
    last_full_at = excluded.last_full_at;
end;
$$;

revoke all on function public.finish_fbs_full_sync(uuid, uuid, timestamptz, timestamptz, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.finish_fbs_full_sync(uuid, uuid, timestamptz, timestamptz, integer, jsonb)
  to service_role;

-- Записывает поставки и загруженные связи одной транзакцией. Пустой массив
-- связей для поставки корректно означает, что текущих заказов в ней нет.
create or replace function public.apply_fbs_supply_sync_batch(
  p_store_id uuid,
  p_account_id uuid,
  p_synced_at timestamptz,
  p_supplies jsonb,
  p_memberships jsonb,
  p_loaded_supply_ids text[],
  p_is_full boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_supplies integer := 0;
  v_memberships integer := 0;
  v_attempts integer := 0;
begin
  if not exists (
    select 1 from public.stores store where store.id = p_store_id and store.account_id = p_account_id
  ) then raise exception 'Магазин не принадлежит компании'; end if;

  insert into public.fbs_supplies (
    account_id, store_id, wb_supply_id, name, done,
    wb_created_at, wb_closed_at, wb_scan_at, destination_office_id,
    cargo_type, cross_border_type, is_b2b, raw_data, last_synced_at,
    last_orders_synced_at
  )
  select
    p_account_id, p_store_id, supply_row.wb_supply_id, supply_row.name,
    coalesce(supply_row.done, false), supply_row.wb_created_at,
    supply_row.wb_closed_at, supply_row.wb_scan_at,
    supply_row.destination_office_id, supply_row.cargo_type,
    supply_row.cross_border_type, supply_row.is_b2b,
    coalesce(supply_row.raw_data, '{}'::jsonb), p_synced_at,
    case when supply_row.wb_supply_id = any(coalesce(p_loaded_supply_ids, array[]::text[]))
      then p_synced_at else null end
  from jsonb_to_recordset(coalesce(p_supplies, '[]'::jsonb)) as supply_row(
    wb_supply_id text, name text, done boolean,
    wb_created_at timestamptz, wb_closed_at timestamptz, wb_scan_at timestamptz,
    destination_office_id bigint, cargo_type integer, cross_border_type integer,
    is_b2b boolean, raw_data jsonb
  )
  on conflict (store_id, wb_supply_id) do update set
    account_id = excluded.account_id,
    name = coalesce(excluded.name, fbs_supplies.name),
    done = excluded.done,
    wb_created_at = coalesce(excluded.wb_created_at, fbs_supplies.wb_created_at),
    wb_closed_at = coalesce(excluded.wb_closed_at, fbs_supplies.wb_closed_at),
    wb_scan_at = coalesce(excluded.wb_scan_at, fbs_supplies.wb_scan_at),
    destination_office_id = coalesce(excluded.destination_office_id, fbs_supplies.destination_office_id),
    cargo_type = coalesce(excluded.cargo_type, fbs_supplies.cargo_type),
    cross_border_type = coalesce(excluded.cross_border_type, fbs_supplies.cross_border_type),
    is_b2b = coalesce(excluded.is_b2b, fbs_supplies.is_b2b),
    raw_data = excluded.raw_data,
    last_synced_at = excluded.last_synced_at,
    last_orders_synced_at = coalesce(excluded.last_orders_synced_at, fbs_supplies.last_orders_synced_at);
  get diagnostics v_supplies = row_count;

  update public.fbs_supply_orders membership
  set is_current = false, last_seen_at = p_synced_at
  where membership.store_id = p_store_id
    and membership.wb_supply_id = any(coalesce(p_loaded_supply_ids, array[]::text[]));

  update public.fbs_dispatch_attempts attempt
  set is_current_membership = false, updated_at = p_synced_at
  where attempt.store_id = p_store_id
    and attempt.wb_supply_id = any(coalesce(p_loaded_supply_ids, array[]::text[]));

  insert into public.fbs_supply_orders (
    account_id, store_id, wb_supply_id, wb_order_id,
    is_current, first_seen_at, last_seen_at
  )
  select p_account_id, p_store_id, membership_row.wb_supply_id,
         membership_row.wb_order_id, true, p_synced_at, p_synced_at
  from jsonb_to_recordset(coalesce(p_memberships, '[]'::jsonb)) as membership_row(
    wb_supply_id text, wb_order_id text
  )
  on conflict (store_id, wb_supply_id, wb_order_id) do update set
    account_id = excluded.account_id,
    is_current = true,
    last_seen_at = excluded.last_seen_at;
  get diagnostics v_memberships = row_count;

  insert into public.fbs_dispatch_attempts (
    account_id, store_id, wb_supply_id, wb_order_id,
    dispatched_at, accepted_at, dispatch_source, acceptance_source,
    dispatch_is_estimated, acceptance_is_estimated,
    is_current_membership, first_seen_at, updated_at
  )
  select
    p_account_id,
    p_store_id,
    membership_row.wb_supply_id,
    membership_row.wb_order_id,
    coalesce(supply.wb_closed_at, legacy.dispatched_at),
    case
      when supply.wb_scan_at is not null
        and coalesce(order_row.supplier_status, '') = 'complete'
        and coalesce(order_row.wb_system_status, '') in (
          'sorted', 'accepted_by_carrier', 'sent_to_carrier',
          'ready_for_pickup', 'postponed_delivery', 'sold',
          'canceled_by_client', 'defect'
        ) then supply.wb_scan_at
      else legacy.accepted_at
    end,
    case
      when supply.wb_closed_at is not null then 'wb_closed_at'
      when legacy.dispatched_at is not null and legacy.source = 'elestet_delivery' then 'elestet_delivery'
      when legacy.dispatched_at is not null and legacy.source = 'wb_sync' then 'wb_status_seen'
      when legacy.dispatched_at is not null then 'legacy_backfill'
      else null
    end,
    case
      when supply.wb_scan_at is not null
        and coalesce(order_row.supplier_status, '') = 'complete'
        and coalesce(order_row.wb_system_status, '') in (
          'sorted', 'accepted_by_carrier', 'sent_to_carrier',
          'ready_for_pickup', 'postponed_delivery', 'sold',
          'canceled_by_client', 'defect'
        ) then 'wb_scan_dt'
      when legacy.accepted_at is not null and not legacy.is_estimated_acceptance_time then 'wb_status_seen'
      when legacy.accepted_at is not null then 'legacy_backfill'
      else null
    end,
    case
      when supply.wb_closed_at is not null then false
      else coalesce(legacy.is_estimated_time, true)
    end,
    case
      when supply.wb_scan_at is not null
        and coalesce(order_row.supplier_status, '') = 'complete'
        and coalesce(order_row.wb_system_status, '') in (
          'sorted', 'accepted_by_carrier', 'sent_to_carrier',
          'ready_for_pickup', 'postponed_delivery', 'sold',
          'canceled_by_client', 'defect'
        ) then false
      else coalesce(legacy.is_estimated_acceptance_time, true)
    end,
    true,
    p_synced_at,
    p_synced_at
  from jsonb_to_recordset(coalesce(p_memberships, '[]'::jsonb)) as membership_row(
    wb_supply_id text, wb_order_id text
  )
  join public.fbs_supplies supply
    on supply.store_id = p_store_id and supply.wb_supply_id = membership_row.wb_supply_id
  left join public.fbs_orders order_row
    on order_row.store_id = p_store_id and order_row.wb_order_id = membership_row.wb_order_id
  left join public.fbs_dispatch_events legacy
    on legacy.store_id = p_store_id
   and legacy.wb_order_id = membership_row.wb_order_id
   and (legacy.supply_id is null or legacy.supply_id = membership_row.wb_supply_id)
  on conflict (store_id, wb_supply_id, wb_order_id) do update set
    account_id = excluded.account_id,
    dispatched_at = case
      when excluded.dispatch_source = 'wb_closed_at' then excluded.dispatched_at
      when fbs_dispatch_attempts.dispatched_at is null then excluded.dispatched_at
      when fbs_dispatch_attempts.dispatch_is_estimated and not excluded.dispatch_is_estimated then excluded.dispatched_at
      else fbs_dispatch_attempts.dispatched_at
    end,
    dispatch_source = case
      when excluded.dispatch_source = 'wb_closed_at' then excluded.dispatch_source
      when fbs_dispatch_attempts.dispatched_at is null then excluded.dispatch_source
      when fbs_dispatch_attempts.dispatch_is_estimated and not excluded.dispatch_is_estimated then excluded.dispatch_source
      else fbs_dispatch_attempts.dispatch_source
    end,
    dispatch_is_estimated = case
      when excluded.dispatch_source = 'wb_closed_at' then false
      when fbs_dispatch_attempts.dispatched_at is null then excluded.dispatch_is_estimated
      when fbs_dispatch_attempts.dispatch_is_estimated and not excluded.dispatch_is_estimated then false
      else fbs_dispatch_attempts.dispatch_is_estimated
    end,
    accepted_at = case
      when excluded.acceptance_source = 'wb_scan_dt' then excluded.accepted_at
      when fbs_dispatch_attempts.accepted_at is null then excluded.accepted_at
      when fbs_dispatch_attempts.acceptance_is_estimated and not excluded.acceptance_is_estimated then excluded.accepted_at
      else fbs_dispatch_attempts.accepted_at
    end,
    acceptance_source = case
      when excluded.acceptance_source = 'wb_scan_dt' then excluded.acceptance_source
      when fbs_dispatch_attempts.accepted_at is null then excluded.acceptance_source
      when fbs_dispatch_attempts.acceptance_is_estimated and not excluded.acceptance_is_estimated then excluded.acceptance_source
      else fbs_dispatch_attempts.acceptance_source
    end,
    acceptance_is_estimated = case
      when excluded.acceptance_source = 'wb_scan_dt' then false
      when fbs_dispatch_attempts.accepted_at is null then excluded.acceptance_is_estimated
      when fbs_dispatch_attempts.acceptance_is_estimated and not excluded.acceptance_is_estimated then false
      else fbs_dispatch_attempts.acceptance_is_estimated
    end,
    is_current_membership = true,
    updated_at = excluded.updated_at;
  get diagnostics v_attempts = row_count;

  insert into public.fbs_sync_log (
    store_id, supply_last_synced_at, supply_last_full_at, error
  ) values (
    p_store_id, p_synced_at, case when p_is_full then p_synced_at else null end, null
  )
  on conflict (store_id) do update set
    supply_last_synced_at = excluded.supply_last_synced_at,
    supply_last_full_at = case when p_is_full then excluded.supply_last_synced_at else fbs_sync_log.supply_last_full_at end,
    error = null;

  return jsonb_build_object(
    'supplies', v_supplies,
    'memberships', v_memberships,
    'attempts', v_attempts
  );
end;
$$;

revoke all on function public.apply_fbs_supply_sync_batch(uuid, uuid, timestamptz, jsonb, jsonb, text[], boolean)
  from public, anon, authenticated;
grant execute on function public.apply_fbs_supply_sync_batch(uuid, uuid, timestamptz, jsonb, jsonb, text[], boolean)
  to service_role;

-- Переносим подтверждённый WB состав поставок и в рабочую строку заказа.
-- Иначе статус заказа обновляется, но группировка «На сборке»/«В доставке»
-- на другом устройстве может остаться привязанной к старой поставке.
create or replace function public.apply_fbs_order_supply_memberships(
  p_store_id uuid,
  p_account_id uuid,
  p_synced_at timestamptz,
  p_memberships jsonb,
  p_loaded_supply_ids text[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed integer := 0;
  v_count integer := 0;
begin
  if not exists (
    select 1 from public.stores store
    where store.id = p_store_id and store.account_id = p_account_id
  ) then raise exception 'Магазин не принадлежит компании'; end if;

  update public.fbs_orders order_row
  set supply_id = null,
      synced_at = greatest(coalesce(order_row.synced_at, p_synced_at), p_synced_at)
  where order_row.store_id = p_store_id
    and order_row.supply_id = any(coalesce(p_loaded_supply_ids, array[]::text[]))
    and not exists (
      select 1
      from jsonb_to_recordset(coalesce(p_memberships, '[]'::jsonb)) as membership_row(
        wb_supply_id text, wb_order_id text
      )
      where membership_row.wb_order_id = order_row.wb_order_id
        and membership_row.wb_supply_id = order_row.supply_id
    );
  get diagnostics v_count = row_count;
  v_changed := v_changed + v_count;

  update public.fbs_orders order_row
  set supply_id = membership_row.wb_supply_id,
      synced_at = greatest(coalesce(order_row.synced_at, p_synced_at), p_synced_at)
  from (
    select distinct on (parsed.wb_order_id) parsed.wb_order_id, parsed.wb_supply_id
    from jsonb_to_recordset(coalesce(p_memberships, '[]'::jsonb)) as parsed(
      wb_supply_id text, wb_order_id text
    )
    order by parsed.wb_order_id, parsed.wb_supply_id
  ) membership_row
  where order_row.store_id = p_store_id
    and order_row.wb_order_id = membership_row.wb_order_id
    and order_row.supply_id is distinct from membership_row.wb_supply_id;
  get diagnostics v_count = row_count;
  v_changed := v_changed + v_count;

  return v_changed;
end;
$$;

revoke all on function public.apply_fbs_order_supply_memberships(uuid, uuid, timestamptz, jsonb, text[])
  from public, anon, authenticated;
grant execute on function public.apply_fbs_order_supply_memberships(uuid, uuid, timestamptz, jsonb, text[])
  to service_role;

-- Единый помощник для немедленной локальной фиксации и резервного обнаружения
-- статуса. Позднее официальный closedAt безопасно заменит эту дату.
create or replace function public.capture_fbs_dispatch_attempt(
  p_order_row_id uuid,
  p_dispatched_at timestamptz,
  p_source text,
  p_is_estimated boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_source not in ('elestet_delivery', 'wb_status_seen', 'legacy_backfill') then
    raise exception 'Некорректный источник даты передачи';
  end if;

  insert into public.fbs_supplies (
    account_id, store_id, wb_supply_id, done, last_synced_at
  )
  select order_row.account_id, order_row.store_id, order_row.supply_id,
         coalesce(order_row.supplier_status, '') = 'complete',
         timezone('utc', now())
  from public.fbs_orders order_row
  where order_row.id = p_order_row_id and coalesce(order_row.supply_id, '') <> ''
  on conflict (store_id, wb_supply_id) do update set
    done = excluded.done,
    last_synced_at = excluded.last_synced_at;

  insert into public.fbs_supply_orders (
    account_id, store_id, wb_supply_id, wb_order_id, is_current, last_seen_at
  )
  select order_row.account_id, order_row.store_id, order_row.supply_id,
         order_row.wb_order_id, true, timezone('utc', now())
  from public.fbs_orders order_row
  where order_row.id = p_order_row_id and coalesce(order_row.supply_id, '') <> ''
  on conflict (store_id, wb_supply_id, wb_order_id) do update set
    account_id = excluded.account_id,
    is_current = true,
    last_seen_at = excluded.last_seen_at;

  insert into public.fbs_dispatch_attempts (
    account_id, store_id, wb_supply_id, wb_order_id,
    dispatched_at, dispatch_source, dispatch_is_estimated,
    is_current_membership, updated_at
  )
  select order_row.account_id, order_row.store_id, order_row.supply_id,
         order_row.wb_order_id, coalesce(p_dispatched_at, timezone('utc', now())),
         p_source, coalesce(p_is_estimated, true), true, timezone('utc', now())
  from public.fbs_orders order_row
  where order_row.id = p_order_row_id and coalesce(order_row.supply_id, '') <> ''
  on conflict (store_id, wb_supply_id, wb_order_id) do update set
    dispatched_at = case
      when fbs_dispatch_attempts.dispatched_at is null then excluded.dispatched_at
      when fbs_dispatch_attempts.dispatch_is_estimated and not excluded.dispatch_is_estimated then excluded.dispatched_at
      else fbs_dispatch_attempts.dispatched_at
    end,
    dispatch_source = case
      when fbs_dispatch_attempts.dispatched_at is null then excluded.dispatch_source
      when fbs_dispatch_attempts.dispatch_is_estimated and not excluded.dispatch_is_estimated then excluded.dispatch_source
      else fbs_dispatch_attempts.dispatch_source
    end,
    dispatch_is_estimated = case
      when fbs_dispatch_attempts.dispatched_at is null then excluded.dispatch_is_estimated
      when fbs_dispatch_attempts.dispatch_is_estimated and not excluded.dispatch_is_estimated then false
      else fbs_dispatch_attempts.dispatch_is_estimated
    end,
    is_current_membership = true,
    updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.capture_fbs_dispatch_attempt(uuid, timestamptz, text, boolean)
  from public, anon, authenticated;

-- Сохраняем старый журнал и одновременно заполняем новую временную шкалу.
create or replace function public.capture_fbs_dispatch_from_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.supplier_status, '') = 'complete' then
    if tg_op = 'INSERT' or coalesce(old.supplier_status, '') <> 'complete' then
      perform public.capture_fbs_dispatch_event(
        new.id,
        coalesce(new.status_synced_at, new.synced_at, timezone('utc', now())),
        'wb_sync',
        true
      );
      perform public.capture_fbs_dispatch_attempt(
        new.id,
        coalesce(new.status_synced_at, new.synced_at, timezone('utc', now())),
        'wb_status_seen',
        true
      );
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.capture_fbs_wb_acceptance_from_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_accepted boolean;
  v_was_accepted boolean := false;
  v_seen_at timestamptz;
  v_scan_at timestamptz;
  v_supply_id text;
begin
  v_is_accepted := coalesce(new.supplier_status, '') = 'complete'
    and coalesce(new.wb_system_status, '') in (
      'sorted', 'accepted_by_carrier', 'sent_to_carrier',
      'ready_for_pickup', 'postponed_delivery', 'sold',
      'canceled_by_client', 'defect'
    );
  if tg_op = 'UPDATE' then
    v_was_accepted := coalesce(old.supplier_status, '') = 'complete'
      and coalesce(old.wb_system_status, '') in (
        'sorted', 'accepted_by_carrier', 'sent_to_carrier',
        'ready_for_pickup', 'postponed_delivery', 'sold',
        'canceled_by_client', 'defect'
      );
  end if;

  if v_is_accepted and not v_was_accepted then
    v_seen_at := coalesce(new.status_synced_at, new.synced_at, timezone('utc', now()));
    v_supply_id := nullif(new.supply_id, '');
    if v_supply_id is null then
      select membership.wb_supply_id into v_supply_id
      from public.fbs_supply_orders membership
      where membership.store_id = new.store_id
        and membership.wb_order_id = new.wb_order_id
        and membership.is_current
      order by membership.last_seen_at desc
      limit 1;
    end if;
    select supply.wb_scan_at into v_scan_at
    from public.fbs_supplies supply
    where supply.store_id = new.store_id and supply.wb_supply_id = v_supply_id;

    perform public.capture_fbs_dispatch_event(new.id, v_seen_at, 'wb_sync', true);
    perform public.capture_fbs_dispatch_attempt(new.id, v_seen_at, 'wb_status_seen', true);

    update public.fbs_dispatch_events event
    set accepted_at = case when v_scan_at is not null then v_scan_at else coalesce(event.accepted_at, v_seen_at) end,
        is_estimated_acceptance_time = v_scan_at is null,
        supplier_status = new.supplier_status,
        wb_system_status = new.wb_system_status
    where event.store_id = new.store_id and event.wb_order_id = new.wb_order_id;

    update public.fbs_dispatch_attempts attempt
    set accepted_at = case when v_scan_at is not null then v_scan_at else coalesce(attempt.accepted_at, v_seen_at) end,
        acceptance_source = case when v_scan_at is not null then 'wb_scan_dt' else coalesce(attempt.acceptance_source, 'wb_status_seen') end,
        acceptance_is_estimated = case when v_scan_at is not null then false when attempt.accepted_at is null then true else attempt.acceptance_is_estimated end,
        updated_at = timezone('utc', now())
    where attempt.store_id = new.store_id
      and attempt.wb_order_id = new.wb_order_id
      and attempt.wb_supply_id = v_supply_id;
  else
    update public.fbs_dispatch_events event
    set supplier_status = coalesce(new.supplier_status, event.supplier_status),
        wb_system_status = coalesce(new.wb_system_status, event.wb_system_status)
    where event.store_id = new.store_id and event.wb_order_id = new.wb_order_id;
  end if;
  return new;
end;
$$;

-- После успешной команды WB сразу фиксируем время в обеих версиях журнала.
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
begin
  if not exists (
    select 1 from public.stores store
    join public.account_members member on member.account_id = store.account_id
    where store.id = p_store_id and member.user_id = auth.uid()
  ) then raise exception 'Нет доступа к магазину'; end if;

  perform public.capture_fbs_dispatch_event(order_row.id, v_now, 'elestet_delivery', false)
  from public.fbs_orders order_row
  where order_row.store_id = p_store_id and order_row.supply_id = p_supply_id;

  perform public.capture_fbs_dispatch_attempt(order_row.id, v_now, 'elestet_delivery', false)
  from public.fbs_orders order_row
  where order_row.store_id = p_store_id and order_row.supply_id = p_supply_id;

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
    from changed
    returning 1
  )
  select count(*)::integer into v_count from events;
  return v_count;
end;
$$;

revoke all on function public.mark_fbs_supply_dispatched(uuid, text) from public, anon;
grant execute on function public.mark_fbs_supply_dispatched(uuid, text) to authenticated;

-- Новый отчёт: официальные попытки имеют приоритет, старый журнал остаётся
-- резервом для ещё не восстановленных заказов.
create or replace function public.get_fbs_dispatch_report_v2(
  p_account_id uuid,
  p_store_id uuid,
  p_period_from date,
  p_period_to date,
  p_timezone text default 'Asia/Bishkek',
  p_internal_warehouse_id uuid default null,
  p_wb_office_id bigint default null
)
returns table (
  product_barcode text,
  nm_id bigint,
  article text,
  vendor_code text,
  product_name text,
  brand text,
  color text,
  tech_size text,
  photo_url text,
  dispatched_quantity bigint,
  accepted_quantity bigint,
  orders_count bigint,
  supplies_count bigint,
  first_dispatched_at timestamptz,
  last_dispatched_at timestamptz,
  first_accepted_at timestamptz,
  last_accepted_at timestamptz,
  estimated_dispatched_quantity bigint,
  estimated_accepted_quantity bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_period_from is null or p_period_to is null or p_period_from > p_period_to then
    raise exception 'Укажите корректный период отчёта';
  end if;
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'Некорректный часовой пояс отчёта';
  end if;
  if not exists (
    select 1 from public.stores store
    join public.account_members member on member.account_id = store.account_id
    where store.id = p_store_id and store.account_id = p_account_id
      and member.user_id = auth.uid()
  ) then raise exception 'Нет доступа к магазину'; end if;

  return query
  with canonical as (
    select
      attempt.account_id,
      attempt.store_id,
      attempt.wb_order_id,
      attempt.wb_supply_id as supply_id,
      internal_warehouse.id as internal_warehouse_id,
      nullif(order_row.warehouse_id, 0)::bigint as seller_warehouse_id,
      case when coalesce(order_row.data ->> 'officeId', '') ~ '^\d+$'
        then (order_row.data ->> 'officeId')::bigint else null end as wb_office_id,
      coalesce(barcode.value, '') as product_barcode,
      order_row.nm_id,
      order_row.article,
      product.vendor_code,
      product.name as product_name,
      product.brand,
      product.color,
      matched_size.tech_size,
      coalesce(product.photos -> 0 ->> 'c246x328', product.photos -> 0 ->> 'big') as photo_url,
      1::integer as quantity,
      attempt.dispatched_at,
      attempt.accepted_at,
      attempt.dispatch_is_estimated as is_estimated_time,
      attempt.acceptance_is_estimated as is_estimated_acceptance_time
    from public.fbs_dispatch_attempts attempt
    left join public.fbs_orders order_row
      on order_row.store_id = attempt.store_id and order_row.wb_order_id = attempt.wb_order_id
    left join public.products product
      on product.store_id = order_row.store_id and product.nm_id = order_row.nm_id
    left join lateral (
      select warehouse.id
      from public.wms_warehouses warehouse
      where warehouse.account_id = attempt.account_id
        and warehouse.fbs_enabled = true
        and warehouse.wb_warehouse_id::text = order_row.warehouse_id::text
      order by warehouse.created_at
      limit 1
    ) internal_warehouse on true
    left join lateral (
      select sku.value
      from jsonb_array_elements_text(coalesce(order_row.skus, '[]'::jsonb)) with ordinality sku(value, position)
      order by sku.position
      limit 1
    ) barcode on true
    left join lateral (
      select nullif(size_row.value ->> 'techSize', '') as tech_size
      from jsonb_array_elements(coalesce(product.sizes, '[]'::jsonb)) size_row(value)
      where exists (
        select 1
        from jsonb_array_elements_text(coalesce(size_row.value -> 'skus', '[]'::jsonb)) size_sku(value)
        where size_sku.value = barcode.value
      )
      limit 1
    ) matched_size on true
    where attempt.account_id = p_account_id and attempt.store_id = p_store_id
  ), legacy as (
    select
      event.account_id, event.store_id, event.wb_order_id, event.supply_id,
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
    select * from canonical
    union all
    select * from legacy
  )
  select
    event.product_barcode,
    max(event.nm_id),
    max(event.article),
    max(event.vendor_code),
    max(event.product_name),
    max(event.brand),
    max(event.color),
    max(event.tech_size),
    max(event.photo_url),
    coalesce(sum(event.quantity) filter (
      where event.dispatched_at >= (p_period_from::timestamp at time zone p_timezone)
        and event.dispatched_at < ((p_period_to + 1)::timestamp at time zone p_timezone)
    ), 0)::bigint,
    coalesce(sum(event.quantity) filter (
      where event.accepted_at >= (p_period_from::timestamp at time zone p_timezone)
        and event.accepted_at < ((p_period_to + 1)::timestamp at time zone p_timezone)
    ), 0)::bigint,
    count(*)::bigint,
    count(distinct event.supply_id)::bigint,
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

revoke all on function public.get_fbs_dispatch_report_v2(uuid, uuid, date, date, text, uuid, bigint)
  from public, anon;
grant execute on function public.get_fbs_dispatch_report_v2(uuid, uuid, date, date, text, uuid, bigint)
  to authenticated;
