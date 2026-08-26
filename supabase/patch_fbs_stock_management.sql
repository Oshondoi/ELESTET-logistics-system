-- Safe manual management of seller-warehouse FBS stocks.

update public.roles
set permissions = permissions || '{"fbs_stocks_manage": false}'::jsonb
where not (permissions ? 'fbs_stocks_manage');

create table if not exists public.fbs_stock_updates (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null,
  account_id uuid not null references public.accounts(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  wb_warehouse_id bigint not null,
  chrt_id bigint not null,
  product_barcode text,
  previous_amount integer,
  requested_amount integer not null check (requested_amount >= 0),
  confirmed_amount integer,
  status text not null check (status in ('confirmed', 'mismatch', 'failed')),
  error_message text,
  changed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists fbs_stock_updates_store_created_idx
  on public.fbs_stock_updates(store_id, created_at desc);
create index if not exists fbs_stock_updates_operation_idx
  on public.fbs_stock_updates(operation_id);

alter table public.fbs_stock_updates enable row level security;
grant select on public.fbs_stock_updates to authenticated;

drop policy if exists "members view fbs stock updates" on public.fbs_stock_updates;
create policy "members view fbs stock updates"
  on public.fbs_stock_updates for select
  using (
    exists (
      select 1
      from public.account_members member
      where member.account_id = fbs_stock_updates.account_id
        and member.user_id = auth.uid()
    )
  );

create or replace function public.get_fbs_stock_catalog(
  p_account_id uuid,
  p_store_id uuid
)
returns table (
  product_id uuid,
  nm_id bigint,
  chrt_id bigint,
  barcode text,
  tech_size text,
  product_name text,
  vendor_code text,
  brand text,
  color text,
  photo_url text,
  physical_quantity integer,
  reserved_quantity integer,
  awaiting_quantity integer,
  available_quantity integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.account_members member
    where member.account_id = p_account_id
      and member.user_id = auth.uid()
  ) then
    raise exception 'Нет доступа к остаткам этой компании';
  end if;

  if not exists (
    select 1
    from public.stores store
    where store.id = p_store_id
      and store.account_id = p_account_id
  ) then
    raise exception 'Магазин не принадлежит выбранной компании';
  end if;

  return query
  with reservation_totals as (
    select
      allocation.box_item_id,
      coalesce(sum(allocation.quantity) filter (where allocation.status = 'reserved'), 0)::integer as reserved,
      coalesce(sum(allocation.quantity) filter (where allocation.status = 'awaiting_wb'), 0)::integer as awaiting
    from public.fbs_stock_allocations allocation
    group by allocation.box_item_id
  ),
  inventory as (
    select
      item.barcode,
      coalesce(sum(item.qty), 0)::integer as physical,
      coalesce(sum(reservation.reserved), 0)::integer as reserved,
      coalesce(sum(reservation.awaiting), 0)::integer as awaiting
    from public.fulfillment_box_items item
    join public.fulfillment_boxes box on box.id = item.box_id
    join public.fulfillment_supplies supply on supply.id = box.supply_id
    join public.fulfillment_batches batch on batch.id = supply.batch_id
    left join reservation_totals reservation on reservation.box_item_id = item.id
    where batch.account_id = p_account_id
    group by item.barcode
  ),
  variants as (
    select
      product.id as product_id,
      product.nm_id,
      nullif(coalesce(size_item.value ->> 'chrtID', size_item.value ->> 'chrtId'), '')::bigint as chrt_id,
      coalesce(size_item.value ->> 'techSize', '—') as tech_size,
      array(
        select jsonb_array_elements_text(
          case
            when jsonb_typeof(size_item.value -> 'skus') = 'array' then size_item.value -> 'skus'
            else '[]'::jsonb
          end
        )
      ) as skus,
      product.name as product_name,
      product.vendor_code,
      product.brand,
      product.color,
      case
        when jsonb_typeof(product.photos) = 'array' and jsonb_array_length(product.photos) > 0
          then coalesce(product.photos -> 0 ->> 'c246x328', product.photos -> 0 ->> 'big')
        else null
      end as photo_url
    from public.products product
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(product.sizes) = 'array' then product.sizes else '[]'::jsonb end
    ) size_item
    where product.account_id = p_account_id
      and product.store_id = p_store_id
  )
  select
    variant.product_id,
    variant.nm_id,
    variant.chrt_id,
    coalesce(variant.skus[1], ''),
    variant.tech_size,
    variant.product_name,
    variant.vendor_code,
    variant.brand,
    variant.color,
    variant.photo_url,
    coalesce(sum(stock.physical), 0)::integer,
    coalesce(sum(stock.reserved), 0)::integer,
    coalesce(sum(stock.awaiting), 0)::integer,
    greatest(
      coalesce(sum(stock.physical), 0)
      - coalesce(sum(stock.reserved), 0)
      - coalesce(sum(stock.awaiting), 0),
      0
    )::integer
  from variants variant
  left join inventory stock on stock.barcode = any(variant.skus)
  where variant.chrt_id is not null
  group by
    variant.product_id,
    variant.nm_id,
    variant.chrt_id,
    variant.skus,
    variant.tech_size,
    variant.product_name,
    variant.vendor_code,
    variant.brand,
    variant.color,
    variant.photo_url
  order by variant.product_name, variant.tech_size, variant.chrt_id;
end;
$$;

revoke all on function public.get_fbs_stock_catalog(uuid, uuid) from public, anon;
grant execute on function public.get_fbs_stock_catalog(uuid, uuid) to authenticated;

create or replace function public.get_store_fbs_chrt_ids(
  p_store_id uuid,
  p_chrt_ids bigint[]
)
returns table (chrt_id bigint)
language sql
stable
security definer
set search_path = public
as $$
  select distinct nullif(coalesce(size_item.value ->> 'chrtID', size_item.value ->> 'chrtId'), '')::bigint
  from public.products product
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(product.sizes) = 'array' then product.sizes else '[]'::jsonb end
  ) size_item
  where product.store_id = p_store_id
    and nullif(coalesce(size_item.value ->> 'chrtID', size_item.value ->> 'chrtId'), '')::bigint = any(p_chrt_ids);
$$;

revoke all on function public.get_store_fbs_chrt_ids(uuid, bigint[]) from public, anon, authenticated;
grant execute on function public.get_store_fbs_chrt_ids(uuid, bigint[]) to service_role;
