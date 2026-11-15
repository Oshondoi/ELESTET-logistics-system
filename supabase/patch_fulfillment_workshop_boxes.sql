begin;

-- Workshop boxes: a second packing method on a batch.
-- Shells are virtual until the first scan. issued_count only grows.
-- A confirmed set becomes a normal fulfillment supply. The supply box
-- number is the second number; the workshop number stays here.
-- Safe to run again.

create table if not exists public.fulfillment_workshop_pools (
  batch_id uuid primary key references public.fulfillment_batches(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  issued_count integer not null default 100 check (issued_count >= 0 and issued_count <= 2000),
  active boolean not null default true,
  completed_at timestamptz
);

create table if not exists public.fulfillment_workshop_boxes (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.fulfillment_batches(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  box_number integer not null check (box_number >= 1),
  supply_id uuid references public.fulfillment_supplies(id) on delete set null,
  supply_box_number integer,
  created_at timestamptz not null default timezone('utc', now()),
  unique (batch_id, box_number)
);

create index if not exists fulfillment_workshop_boxes_batch_idx
  on public.fulfillment_workshop_boxes (batch_id, box_number);

create table if not exists public.fulfillment_workshop_box_items (
  id uuid primary key default gen_random_uuid(),
  box_id uuid not null references public.fulfillment_workshop_boxes(id) on delete cascade,
  barcode text not null,
  qty integer not null check (qty > 0),
  product_name text,
  unique (box_id, barcode)
);

create index if not exists fulfillment_workshop_box_items_box_idx
  on public.fulfillment_workshop_box_items (box_id);

alter table public.fulfillment_workshop_pools enable row level security;
alter table public.fulfillment_workshop_boxes enable row level security;
alter table public.fulfillment_workshop_box_items enable row level security;

drop policy if exists fulfillment_workshop_pools_member_all on public.fulfillment_workshop_pools;
create policy fulfillment_workshop_pools_member_all
on public.fulfillment_workshop_pools
for all
to authenticated
using (exists (
  select 1 from public.account_members member
  where member.account_id = fulfillment_workshop_pools.account_id
    and member.user_id = auth.uid()
))
with check (exists (
  select 1 from public.account_members member
  where member.account_id = fulfillment_workshop_pools.account_id
    and member.user_id = auth.uid()
));

drop policy if exists fulfillment_workshop_boxes_member_all on public.fulfillment_workshop_boxes;
create policy fulfillment_workshop_boxes_member_all
on public.fulfillment_workshop_boxes
for all
to authenticated
using (exists (
  select 1 from public.account_members member
  where member.account_id = fulfillment_workshop_boxes.account_id
    and member.user_id = auth.uid()
))
with check (exists (
  select 1 from public.account_members member
  where member.account_id = fulfillment_workshop_boxes.account_id
    and member.user_id = auth.uid()
));

drop policy if exists fulfillment_workshop_box_items_member_all on public.fulfillment_workshop_box_items;
create policy fulfillment_workshop_box_items_member_all
on public.fulfillment_workshop_box_items
for all
to authenticated
using (exists (
  select 1 from public.account_members member
  join public.fulfillment_workshop_boxes box on box.account_id = member.account_id
  where box.id = fulfillment_workshop_box_items.box_id
    and member.user_id = auth.uid()
))
with check (exists (
  select 1 from public.account_members member
  join public.fulfillment_workshop_boxes box on box.account_id = member.account_id
  where box.id = fulfillment_workshop_box_items.box_id
    and member.user_id = auth.uid()
));

grant select, insert, update, delete on public.fulfillment_workshop_pools to authenticated;
grant select, insert, update, delete on public.fulfillment_workshop_boxes to authenticated;
grant select, insert, update, delete on public.fulfillment_workshop_box_items to authenticated;
grant all on public.fulfillment_workshop_pools to service_role;
grant all on public.fulfillment_workshop_boxes to service_role;
grant all on public.fulfillment_workshop_box_items to service_role;

create or replace function public.assert_workshop_member(p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.account_members member
    where member.account_id = p_account_id
      and member.user_id = auth.uid()
  ) then
    raise exception 'Нет доступа';
  end if;
end;
$$;

create or replace function public.start_workshop_boxes(p_batch_id uuid)
returns public.fulfillment_workshop_pools
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid;
  v_pool public.fulfillment_workshop_pools;
begin
  select account_id into v_account
  from public.fulfillment_batches
  where id = p_batch_id;
  if v_account is null then
    raise exception 'Партия не найдена';
  end if;
  perform public.assert_workshop_member(v_account);

  insert into public.fulfillment_workshop_pools (batch_id, account_id, issued_count, active)
  values (p_batch_id, v_account, 100, true)
  on conflict (batch_id) do nothing;

  select * into v_pool
  from public.fulfillment_workshop_pools
  where batch_id = p_batch_id;

  if v_pool.active is distinct from true then
    raise exception 'Сбор уже был. Нажмите «Продолжить».';
  end if;
  return v_pool;
end;
$$;

create or replace function public.add_workshop_boxes(p_batch_id uuid, p_add integer)
returns public.fulfillment_workshop_pools
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pool public.fulfillment_workshop_pools;
begin
  if p_add is distinct from 50 then
    raise exception 'Можно добавить только 50 коробов';
  end if;

  select * into v_pool
  from public.fulfillment_workshop_pools
  where batch_id = p_batch_id
  for update;
  if not found then
    raise exception 'Сначала выдайте короба';
  end if;
  perform public.assert_workshop_member(v_pool.account_id);
  if v_pool.active is distinct from true then
    raise exception 'Сбор сейчас не идёт';
  end if;
  if v_pool.issued_count + p_add > 2000 then
    raise exception 'Слишком много коробов';
  end if;

  update public.fulfillment_workshop_pools
  set issued_count = issued_count + p_add
  where batch_id = p_batch_id
  returning * into v_pool;
  return v_pool;
end;
$$;

create or replace function public.complete_workshop_boxes(p_batch_id uuid)
returns public.fulfillment_workshop_pools
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pool public.fulfillment_workshop_pools;
begin
  select * into v_pool
  from public.fulfillment_workshop_pools
  where batch_id = p_batch_id
  for update;
  if not found or v_pool.active is distinct from true then
    raise exception 'Сбор сейчас не идёт';
  end if;
  perform public.assert_workshop_member(v_pool.account_id);

  update public.fulfillment_workshop_pools
  set active = false,
      completed_at = timezone('utc', now())
  where batch_id = p_batch_id
  returning * into v_pool;
  return v_pool;
end;
$$;

create or replace function public.reopen_workshop_boxes(p_batch_id uuid)
returns public.fulfillment_workshop_pools
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pool public.fulfillment_workshop_pools;
begin
  select * into v_pool
  from public.fulfillment_workshop_pools
  where batch_id = p_batch_id
  for update;
  if not found then
    raise exception 'Сначала выдайте короба';
  end if;
  perform public.assert_workshop_member(v_pool.account_id);

  update public.fulfillment_workshop_pools
  set active = true,
      completed_at = null
  where batch_id = p_batch_id
  returning * into v_pool;
  return v_pool;
end;
$$;

create or replace function public.scan_workshop_box(
  p_batch_id uuid,
  p_box_number integer,
  p_barcode text,
  p_product_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pool public.fulfillment_workshop_pools;
  v_box_id uuid;
  v_barcode text;
begin
  v_barcode := btrim(coalesce(p_barcode, ''));
  if char_length(v_barcode) < 4 then
    raise exception 'Штрихкод слишком короткий';
  end if;

  select * into v_pool
  from public.fulfillment_workshop_pools
  where batch_id = p_batch_id
  for update;
  if not found or v_pool.active is distinct from true then
    raise exception 'Сбор в цехе сейчас не идёт';
  end if;
  perform public.assert_workshop_member(v_pool.account_id);
  if p_box_number < 1 or p_box_number > v_pool.issued_count then
    raise exception 'Такого короба нет';
  end if;
  if exists (
    select 1 from public.fulfillment_workshop_boxes box
    where box.batch_id = p_batch_id
      and box.box_number = p_box_number
      and box.supply_id is not null
  ) then
    raise exception 'Короб уже в поставке';
  end if;

  insert into public.fulfillment_workshop_boxes (batch_id, account_id, box_number)
  values (p_batch_id, v_pool.account_id, p_box_number)
  on conflict (batch_id, box_number) do nothing;

  select id into v_box_id
  from public.fulfillment_workshop_boxes
  where batch_id = p_batch_id
    and box_number = p_box_number;

  insert into public.fulfillment_workshop_box_items (box_id, barcode, qty, product_name)
  values (v_box_id, v_barcode, 1, nullif(btrim(coalesce(p_product_name, '')), ''))
  on conflict (box_id, barcode) do update
    set qty = public.fulfillment_workshop_box_items.qty + 1,
        product_name = coalesce(
          excluded.product_name,
          public.fulfillment_workshop_box_items.product_name
        );
end;
$$;

create or replace function public.confirm_workshop_supply(
  p_batch_id uuid,
  p_box_numbers integer[],
  p_warehouse_id uuid,
  p_warehouse_name text,
  p_pipeline_stage_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid;
  v_name text;
  v_numbers integer[];
  v_found integer;
  v_supply uuid;
  v_box public.fulfillment_workshop_boxes;
  v_new_box uuid;
  v_index integer := 0;
begin
  v_name := btrim(coalesce(p_warehouse_name, ''));
  if p_warehouse_id is null or v_name = '' then
    raise exception 'Выберите склад';
  end if;

  select coalesce(array_agg(n order by n), array[]::integer[])
  into v_numbers
  from (
    select distinct unnest(coalesce(p_box_numbers, array[]::integer[])) as n
  ) numbers
  where n is not null and n > 0;
  if cardinality(v_numbers) = 0 then
    raise exception 'Выберите короба';
  end if;

  select account_id into v_account
  from public.fulfillment_batches
  where id = p_batch_id;
  if v_account is null then
    raise exception 'Партия не найдена';
  end if;
  perform public.assert_workshop_member(v_account);

  if p_pipeline_stage_id is not null and not exists (
    select 1 from public.batch_pipeline_stages stage
    where stage.id = p_pipeline_stage_id
      and stage.batch_id = p_batch_id
  ) then
    raise exception 'Этап не найден';
  end if;

  perform 1
  from public.fulfillment_workshop_pools pool
  where pool.batch_id = p_batch_id
  for update;

  perform 1
  from public.fulfillment_workshop_boxes box
  where box.batch_id = p_batch_id
    and box.box_number = any(v_numbers)
  order by box.box_number
  for update;

  select count(*) into v_found
  from public.fulfillment_workshop_boxes box
  where box.batch_id = p_batch_id
    and box.box_number = any(v_numbers);
  if v_found <> cardinality(v_numbers) then
    raise exception 'Короб не найден или пустой';
  end if;

  if exists (
    select 1 from public.fulfillment_workshop_boxes box
    where box.batch_id = p_batch_id
      and box.box_number = any(v_numbers)
      and box.supply_id is not null
  ) then
    raise exception 'Короб уже в другой поставке';
  end if;

  if exists (
    select 1
    from public.fulfillment_workshop_boxes box
    where box.batch_id = p_batch_id
      and box.box_number = any(v_numbers)
      and not exists (
        select 1 from public.fulfillment_workshop_box_items item
        where item.box_id = box.id
          and item.qty > 0
      )
  ) then
    raise exception 'Пустой короб нельзя отправить';
  end if;

  insert into public.fulfillment_supplies (
    batch_id,
    account_id,
    warehouse_id,
    warehouse_name,
    destination_type,
    destination_wms_warehouse_id,
    trip_id,
    trip_line_id,
    created_by,
    pipeline_stage_id,
    kiz_enabled
  ) values (
    p_batch_id,
    v_account,
    p_warehouse_id,
    v_name,
    'fbo',
    null,
    null,
    null,
    auth.uid(),
    p_pipeline_stage_id,
    false
  )
  returning id into v_supply;

  for v_box in
    select *
    from public.fulfillment_workshop_boxes box
    where box.batch_id = p_batch_id
      and box.box_number = any(v_numbers)
    order by box.box_number
  loop
    v_index := v_index + 1;
    insert into public.fulfillment_boxes (supply_id, account_id, box_number, status)
    values (v_supply, v_account, v_index, 'open')
    returning id into v_new_box;

    insert into public.fulfillment_box_items (box_id, account_id, barcode, product_name, qty)
    select v_new_box, v_account, item.barcode, item.product_name, item.qty
    from public.fulfillment_workshop_box_items item
    where item.box_id = v_box.id
      and item.qty > 0;

    update public.fulfillment_workshop_boxes
    set supply_id = v_supply,
        supply_box_number = v_index
    where id = v_box.id;
  end loop;

  return v_supply;
end;
$$;

grant execute on function public.assert_workshop_member(uuid) to authenticated, service_role;
grant execute on function public.start_workshop_boxes(uuid) to authenticated, service_role;
grant execute on function public.add_workshop_boxes(uuid, integer) to authenticated, service_role;
grant execute on function public.complete_workshop_boxes(uuid) to authenticated, service_role;
grant execute on function public.reopen_workshop_boxes(uuid) to authenticated, service_role;
grant execute on function public.scan_workshop_box(uuid, integer, text, text) to authenticated, service_role;
grant execute on function public.confirm_workshop_supply(uuid, integer[], uuid, text, uuid) to authenticated, service_role;

commit;
