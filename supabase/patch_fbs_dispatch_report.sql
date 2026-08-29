-- Независимый журнал фактической передачи FBS-заказов в доставку Wildberries.
-- Не зависит от резервирования и списания товара из коробов фулфилмента.

create table if not exists public.fbs_dispatch_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  wb_order_id text not null,
  supply_id text,
  internal_warehouse_id uuid,
  seller_warehouse_id bigint,
  wb_office_id bigint,
  product_barcode text not null default '',
  nm_id bigint,
  chrt_id bigint,
  article text,
  product_name text,
  vendor_code text,
  brand text,
  color text,
  tech_size text,
  photo_url text,
  quantity integer not null default 1 check (quantity > 0),
  dispatched_at timestamptz not null,
  source text not null check (source in ('elestet_delivery', 'wb_sync', 'history_backfill')),
  is_estimated_time boolean not null default false,
  supplier_status text,
  wb_system_status text,
  created_at timestamptz not null default now(),
  unique (store_id, wb_order_id)
);

alter table public.fbs_dispatch_events
  add column if not exists internal_warehouse_id uuid,
  add column if not exists seller_warehouse_id bigint,
  add column if not exists wb_office_id bigint;

create index if not exists fbs_dispatch_events_period_idx
  on public.fbs_dispatch_events (account_id, store_id, dispatched_at desc);
create index if not exists fbs_dispatch_events_barcode_idx
  on public.fbs_dispatch_events (store_id, product_barcode);
create index if not exists fbs_dispatch_events_warehouses_idx
  on public.fbs_dispatch_events (store_id, internal_warehouse_id, wb_office_id, dispatched_at desc);

alter table public.fbs_dispatch_events enable row level security;

drop policy if exists "fbs_dispatch_events: account members" on public.fbs_dispatch_events;
create policy "fbs_dispatch_events: account members"
  on public.fbs_dispatch_events for select
  using (
    account_id in (
      select am.account_id from public.account_members am where am.user_id = auth.uid()
    )
  );

create or replace function public.capture_fbs_dispatch_event(
  p_order_row_id uuid,
  p_dispatched_at timestamptz,
  p_source text,
  p_is_estimated_time boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.fbs_dispatch_events (
    account_id, store_id, wb_order_id, supply_id,
    internal_warehouse_id, seller_warehouse_id, wb_office_id, product_barcode,
    nm_id, chrt_id, article, product_name, vendor_code, brand, color,
    tech_size, photo_url, quantity, dispatched_at, source,
    is_estimated_time, supplier_status, wb_system_status
  )
  select
    order_row.account_id,
    order_row.store_id,
    order_row.wb_order_id,
    order_row.supply_id,
    internal_warehouse.id,
    nullif(order_row.warehouse_id, 0)::bigint,
    case
      when coalesce(order_row.data ->> 'officeId', '') ~ '^\d+$'
        then (order_row.data ->> 'officeId')::bigint
      else null
    end,
    coalesce(barcode.value, ''),
    order_row.nm_id,
    order_row.chrt_id,
    order_row.article,
    product.name,
    product.vendor_code,
    product.brand,
    product.color,
    matched_size.tech_size,
    coalesce(product.photos -> 0 ->> 'c246x328', product.photos -> 0 ->> 'big'),
    1,
    coalesce(p_dispatched_at, timezone('utc', now())),
    p_source,
    coalesce(p_is_estimated_time, false),
    case when p_source = 'elestet_delivery' then 'complete' else order_row.supplier_status end,
    coalesce(order_row.wb_system_status, 'waiting')
  from public.fbs_orders order_row
  left join public.products product
    on product.store_id = order_row.store_id and product.nm_id = order_row.nm_id
  left join lateral (
    select warehouse.id
    from public.wms_warehouses warehouse
    where warehouse.account_id = order_row.account_id
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
  where order_row.id = p_order_row_id
  on conflict (store_id, wb_order_id) do update set
    supply_id = coalesce(excluded.supply_id, fbs_dispatch_events.supply_id),
    internal_warehouse_id = coalesce(excluded.internal_warehouse_id, fbs_dispatch_events.internal_warehouse_id),
    seller_warehouse_id = coalesce(excluded.seller_warehouse_id, fbs_dispatch_events.seller_warehouse_id),
    wb_office_id = coalesce(excluded.wb_office_id, fbs_dispatch_events.wb_office_id),
    product_barcode = coalesce(nullif(excluded.product_barcode, ''), fbs_dispatch_events.product_barcode),
    nm_id = coalesce(excluded.nm_id, fbs_dispatch_events.nm_id),
    chrt_id = coalesce(excluded.chrt_id, fbs_dispatch_events.chrt_id),
    article = coalesce(excluded.article, fbs_dispatch_events.article),
    product_name = coalesce(excluded.product_name, fbs_dispatch_events.product_name),
    vendor_code = coalesce(excluded.vendor_code, fbs_dispatch_events.vendor_code),
    brand = coalesce(excluded.brand, fbs_dispatch_events.brand),
    color = coalesce(excluded.color, fbs_dispatch_events.color),
    tech_size = coalesce(excluded.tech_size, fbs_dispatch_events.tech_size),
    photo_url = coalesce(excluded.photo_url, fbs_dispatch_events.photo_url),
    dispatched_at = case
      when fbs_dispatch_events.is_estimated_time and not excluded.is_estimated_time
        then excluded.dispatched_at
      else fbs_dispatch_events.dispatched_at
    end,
    source = case
      when fbs_dispatch_events.is_estimated_time and not excluded.is_estimated_time
        then excluded.source
      else fbs_dispatch_events.source
    end,
    is_estimated_time = fbs_dispatch_events.is_estimated_time and excluded.is_estimated_time,
    supplier_status = coalesce(excluded.supplier_status, fbs_dispatch_events.supplier_status),
    wb_system_status = coalesce(excluded.wb_system_status, fbs_dispatch_events.wb_system_status);
end;
$$;

revoke all on function public.capture_fbs_dispatch_event(uuid, timestamptz, text, boolean)
  from public, anon, authenticated;

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
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists capture_fbs_dispatch_from_status_trigger on public.fbs_orders;
create trigger capture_fbs_dispatch_from_status_trigger
after insert or update of supplier_status on public.fbs_orders
for each row execute function public.capture_fbs_dispatch_from_status();

-- Расширяем существующую операцию: после успешной команды WB фиксируем все
-- заказы поставки, даже если ни один из них не был зарезервирован из короба.
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
    select 1
    from public.stores store
    join public.account_members member on member.account_id = store.account_id
    where store.id = p_store_id and member.user_id = auth.uid()
  ) then raise exception 'Нет доступа к магазину'; end if;

  perform public.capture_fbs_dispatch_event(order_row.id, v_now, 'elestet_delivery', false)
  from public.fbs_orders order_row
  where order_row.store_id = p_store_id
    and order_row.supply_id = p_supply_id;

  with changed as (
    update public.fbs_stock_allocations allocation
    set status = 'awaiting_wb',
        dispatched_at = coalesce(dispatched_at, v_now),
        updated_at = v_now,
        updated_by = auth.uid(),
        last_supplier_status = 'complete',
        last_wb_status = 'waiting'
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

-- История до установки журнала. Для заказов с резервом время берём из
-- фактической передачи резерва; иначе используем время последней фиксации
-- статуса и явно отмечаем его как приблизительное.
do $$
declare
  order_record record;
begin
  for order_record in
    select
      order_row.id,
      coalesce(allocation_time.dispatched_at, order_row.status_synced_at,
               order_row.synced_at, order_row.created_at, timezone('utc', now())) as dispatched_at,
      allocation_time.dispatched_at is null as is_estimated
    from public.fbs_orders order_row
    left join lateral (
      select min(allocation.dispatched_at) as dispatched_at
      from public.fbs_stock_allocations allocation
      where allocation.store_id = order_row.store_id
        and allocation.wb_order_id = order_row.wb_order_id
        and allocation.dispatched_at is not null
    ) allocation_time on true
    where order_row.supplier_status = 'complete'
  loop
    perform public.capture_fbs_dispatch_event(
      order_record.id,
      order_record.dispatched_at,
      'history_backfill',
      order_record.is_estimated
    );
  end loop;
end;
$$;

drop function if exists public.get_fbs_dispatch_report(uuid, uuid, date, date, text);

create or replace function public.get_fbs_dispatch_report(
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
  quantity bigint,
  orders_count bigint,
  supplies_count bigint,
  first_dispatched_at timestamptz,
  last_dispatched_at timestamptz,
  estimated_quantity bigint
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
    select 1
    from public.stores store
    join public.account_members member on member.account_id = store.account_id
    where store.id = p_store_id
      and store.account_id = p_account_id
      and member.user_id = auth.uid()
  ) then
    raise exception 'Нет доступа к магазину';
  end if;

  return query
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
    sum(event.quantity)::bigint,
    count(*)::bigint,
    count(distinct event.supply_id)::bigint,
    min(event.dispatched_at),
    max(event.dispatched_at),
    sum(case when event.is_estimated_time then event.quantity else 0 end)::bigint
  from public.fbs_dispatch_events event
  where event.account_id = p_account_id
    and event.store_id = p_store_id
    and event.dispatched_at >= (p_period_from::timestamp at time zone p_timezone)
    and event.dispatched_at < ((p_period_to + 1)::timestamp at time zone p_timezone)
    and (p_internal_warehouse_id is null or event.internal_warehouse_id = p_internal_warehouse_id)
    and (p_wb_office_id is null or event.wb_office_id = p_wb_office_id)
  group by event.product_barcode
  order by sum(event.quantity) desc, event.product_barcode;
end;
$$;

revoke all on function public.get_fbs_dispatch_report(uuid, uuid, date, date, text, uuid, bigint) from public, anon;
grant execute on function public.get_fbs_dispatch_report(uuid, uuid, date, date, text, uuid, bigint) to authenticated;
