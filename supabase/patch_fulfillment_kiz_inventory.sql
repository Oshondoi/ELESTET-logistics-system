-- Per-unit KIZ registry for fulfillment packing.
-- Draft pairs are persisted immediately, while aggregate box quantities change
-- only in commit_fulfillment_kiz_box(). Audit rows are immutable and survive
-- removal of a product, box, supply or batch.

begin;

alter table public.fulfillment_supplies
  add column if not exists kiz_enabled boolean not null default false;

create table if not exists public.fulfillment_kiz_pairs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  store_id uuid references public.stores(id) on delete set null,
  batch_id uuid references public.fulfillment_batches(id) on delete set null,
  supply_id uuid references public.fulfillment_supplies(id) on delete set null,
  box_id uuid references public.fulfillment_boxes(id) on delete set null,
  box_item_id uuid references public.fulfillment_box_items(id) on delete set null,
  item_id uuid references public.fulfillment_items(id) on delete set null,
  barcode text not null,
  kiz_raw text not null,
  kiz_normalized text not null,
  gtin text not null,
  serial_number text not null,
  status text not null default 'draft'
    check (status in ('draft', 'committed', 'deleted', 'replaced')),
  product_snapshot jsonb not null default '{}'::jsonb,
  hierarchy_snapshot jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  actor_name text,
  actor_email text,
  device_id text not null,
  device_name text not null,
  scanner_model text,
  created_at timestamptz not null default now(),
  committed_at timestamptz,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (char_length(barcode) between 1 and 100),
  check (char_length(kiz_raw) between 19 and 300),
  check (char_length(kiz_normalized) between 19 and 135),
  check (gtin ~ '^[0-9]{14}$'),
  check (char_length(device_id) between 8 and 200)
);

create unique index if not exists fulfillment_kiz_pairs_account_active_kiz_uidx
  on public.fulfillment_kiz_pairs(account_id, kiz_normalized)
  where status in ('draft', 'committed');
create index if not exists fulfillment_kiz_pairs_supply_status_idx
  on public.fulfillment_kiz_pairs(supply_id, status, created_at);
create index if not exists fulfillment_kiz_pairs_box_barcode_idx
  on public.fulfillment_kiz_pairs(box_id, barcode, status, created_at);

alter table public.fulfillment_kiz_pairs replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'fulfillment_kiz_pairs'
    )
  then
    execute 'alter publication supabase_realtime add table public.fulfillment_kiz_pairs';
  end if;
end;
$$;

create table if not exists public.fulfillment_kiz_events (
  id bigint generated always as identity primary key,
  pair_id uuid,
  account_id uuid not null references public.accounts(id) on delete cascade,
  event_type text not null,
  reason_code text,
  reason_text text,
  old_values jsonb,
  new_values jsonb,
  product_snapshot jsonb not null default '{}'::jsonb,
  hierarchy_snapshot jsonb not null default '{}'::jsonb,
  actor_user_id uuid,
  actor_name text,
  actor_email text,
  device_id text,
  device_name text,
  scanner_model text,
  created_at timestamptz not null default now()
);

create index if not exists fulfillment_kiz_events_pair_idx
  on public.fulfillment_kiz_events(pair_id, created_at desc);
create index if not exists fulfillment_kiz_events_account_idx
  on public.fulfillment_kiz_events(account_id, created_at desc);

alter table public.fulfillment_kiz_pairs enable row level security;
alter table public.fulfillment_kiz_events enable row level security;

drop policy if exists "members view fulfillment kiz pairs" on public.fulfillment_kiz_pairs;
create policy "members view fulfillment kiz pairs"
  on public.fulfillment_kiz_pairs for select
  using (exists (
    select 1 from public.account_members member
    where member.account_id = fulfillment_kiz_pairs.account_id
      and member.user_id = auth.uid()
  ));

drop policy if exists "members view fulfillment kiz events" on public.fulfillment_kiz_events;
create policy "members view fulfillment kiz events"
  on public.fulfillment_kiz_events for select
  using (exists (
    select 1 from public.account_members member
    where member.account_id = fulfillment_kiz_events.account_id
      and member.user_id = auth.uid()
  ));

create or replace function public.fulfillment_kiz_events_are_immutable()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- A full company deletion must still be able to cascade through its data.
  if pg_trigger_depth() > 1 then return old; end if;
  raise exception 'История КИЗ неизменяема';
end;
$$;

drop trigger if exists protect_fulfillment_kiz_events on public.fulfillment_kiz_events;
create trigger protect_fulfillment_kiz_events
before update or delete on public.fulfillment_kiz_events
for each row execute function public.fulfillment_kiz_events_are_immutable();

create or replace function public.fulfillment_is_valid_kiz(p_value text)
returns boolean language plpgsql immutable strict set search_path = public as $$
declare
  v_gtin text;
  v_sum integer := 0;
  v_index integer;
begin
  if char_length(p_value) not between 19 and 135 or p_value !~ '^01[0-9]{14}21' then return false; end if;
  v_gtin := substring(p_value from 3 for 14);
  for v_index in 1..13 loop
    v_sum := v_sum + substring(v_gtin from v_index for 1)::integer
      * case when mod(v_index, 2) = 1 then 3 else 1 end;
  end loop;
  if mod(10 - mod(v_sum, 10), 10) <> substring(v_gtin from 14 for 1)::integer then return false; end if;
  return char_length(split_part(substring(p_value from 19), chr(29), 1)) between 1 and 20;
end;
$$;

create or replace function public.fulfillment_kiz_assert_member(p_account_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.account_members member
    where member.account_id = p_account_id and member.user_id = auth.uid()
  ) then raise exception 'Нет доступа к данным этой компании'; end if;
end;
$$;

create or replace function public.fulfillment_kiz_assert_editable(p_supply_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_supply public.fulfillment_supplies%rowtype;
begin
  select * into v_supply from public.fulfillment_supplies where id = p_supply_id;
  if v_supply.id is null then raise exception 'Поставка не найдена'; end if;
  perform public.fulfillment_kiz_assert_member(v_supply.account_id);
  if v_supply.destination_type = 'fbo' and exists (
    select 1 from public.trip_lines line
    where (line.id = v_supply.trip_line_id or line.fulfillment_supply_id = v_supply.id)
      and line.status = 'Отгружен'
      and line.deleted_at is null
  ) then raise exception 'Поставка уже отгружена в FBO. Корректировка КИЗ заблокирована'; end if;
end;
$$;

create or replace function public.fulfillment_kiz_event(
  p_pair public.fulfillment_kiz_pairs,
  p_event_type text,
  p_reason_code text,
  p_reason_text text,
  p_old_values jsonb,
  p_new_values jsonb,
  p_actor_name text,
  p_actor_email text,
  p_device_id text,
  p_device_name text,
  p_scanner_model text
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.fulfillment_kiz_events(
    pair_id, account_id, event_type, reason_code, reason_text,
    old_values, new_values, product_snapshot, hierarchy_snapshot,
    actor_user_id, actor_name, actor_email, device_id, device_name, scanner_model
  ) values (
    p_pair.id, p_pair.account_id, p_event_type, p_reason_code, p_reason_text,
    p_old_values, p_new_values, p_pair.product_snapshot, p_pair.hierarchy_snapshot,
    auth.uid(), nullif(left(coalesce(p_actor_name, ''), 160), ''),
    nullif(left(coalesce(p_actor_email, ''), 320), ''),
    nullif(left(coalesce(p_device_id, ''), 200), ''),
    nullif(left(coalesce(p_device_name, ''), 160), ''),
    nullif(left(coalesce(p_scanner_model, ''), 200), '')
  );
end;
$$;

create or replace function public.set_fulfillment_supply_kiz_mode(
  p_supply_id uuid,
  p_enabled boolean,
  p_actor_name text default null,
  p_actor_email text default null,
  p_device_id text default null,
  p_device_name text default null,
  p_scanner_model text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_supply public.fulfillment_supplies%rowtype;
  v_pair public.fulfillment_kiz_pairs%rowtype;
begin
  perform public.fulfillment_kiz_assert_editable(p_supply_id);
  select * into v_supply from public.fulfillment_supplies where id = p_supply_id for update;
  if not p_enabled and exists (
    select 1 from public.fulfillment_kiz_pairs
    where supply_id = p_supply_id and status = 'draft'
  ) then raise exception 'Сначала запишите в короба или удалите все незаписанные пары КИЗ'; end if;

  update public.fulfillment_supplies set kiz_enabled = p_enabled where id = p_supply_id;
  select * into v_pair from public.fulfillment_kiz_pairs
    where supply_id = p_supply_id order by created_at desc limit 1;
  if v_pair.id is not null then
    perform public.fulfillment_kiz_event(
      v_pair, case when p_enabled then 'mode_enabled' else 'mode_disabled' end,
      'supply_mode', null, jsonb_build_object('kiz_enabled', v_supply.kiz_enabled),
      jsonb_build_object('kiz_enabled', p_enabled), p_actor_name, p_actor_email,
      p_device_id, p_device_name, p_scanner_model
    );
  end if;
end;
$$;

create or replace function public.create_fulfillment_kiz_draft(
  p_box_id uuid,
  p_barcode text,
  p_item_id uuid,
  p_product_name text,
  p_kiz_raw text,
  p_kiz_normalized text,
  p_product_snapshot jsonb default '{}'::jsonb,
  p_actor_name text default null,
  p_actor_email text default null,
  p_device_id text default null,
  p_device_name text default null,
  p_scanner_model text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_box public.fulfillment_boxes%rowtype;
  v_supply public.fulfillment_supplies%rowtype;
  v_batch public.fulfillment_batches%rowtype;
  v_pair public.fulfillment_kiz_pairs%rowtype;
  v_gtin text;
  v_serial text;
  v_barcode text := trim(coalesce(p_barcode, ''));
  v_chz jsonb := '{}'::jsonb;
  v_chz_article text;
begin
  select * into v_box from public.fulfillment_boxes where id = p_box_id;
  if v_box.id is null then raise exception 'Короб не найден'; end if;
  select * into v_supply from public.fulfillment_supplies where id = v_box.supply_id;
  perform public.fulfillment_kiz_assert_editable(v_supply.id);
  if not v_supply.kiz_enabled then raise exception 'Режим КИЗ для этой поставки выключен'; end if;
  select * into v_batch from public.fulfillment_batches where id = v_supply.batch_id;
  if p_item_id is not null and not exists (
    select 1 from public.fulfillment_items item
    where item.id = p_item_id
      and item.batch_id = v_batch.id
      and trim(item.barcode) = v_barcode
  ) then raise exception 'Товар не относится к этой партии или его баркод не совпадает'; end if;
  if not public.fulfillment_is_valid_kiz(p_kiz_normalized) then raise exception 'Это не корректный КИЗ GS1 DataMatrix'; end if;
  if char_length(coalesce(p_device_id, '')) not between 8 and 200 then raise exception 'Не определено устройство сканирования'; end if;

  v_gtin := substring(p_kiz_normalized from 3 for 14);
  v_serial := split_part(substring(p_kiz_normalized from 19), chr(29), 1);
  if not (v_barcode = v_gtin or (char_length(v_barcode) = 13 and '0' || v_barcode = v_gtin)) then
    raise exception 'GTIN КИЗа не соответствует отсканированному баркоду товара';
  end if;

  if v_batch.store_id is not null then
    select jsonb_build_object(
      'honest_sign_name', product.name,
      'honest_sign_full_name', product.full_name,
      'honest_sign_article', coalesce(
        (select attribute->>'value'
         from jsonb_array_elements(case when jsonb_typeof(product.attributes) = 'array' then product.attributes else '[]'::jsonb end) attribute
         where lower(coalesce(attribute->>'name', '')) like '%артикул%'
            or lower(coalesce(attribute->>'attributeTypeCode', '')) like '%article%'
         limit 1),
        substring(product.full_name from '(?i)арт\.?[[:space:]]*([^,;[:space:]]+)'),
        null
      )
    ) into v_chz
    from public.teksher_products product
    where product.store_id = v_batch.store_id and product.gtin = v_gtin
    limit 1;
  end if;
  v_chz := coalesce(v_chz, '{}'::jsonb);
  v_chz_article := v_chz->>'honest_sign_article';

  perform pg_advisory_xact_lock(hashtextextended(v_supply.account_id::text || ':fulfillment-kiz:' || p_kiz_normalized, 0));
  if exists (
    select 1 from public.fulfillment_kiz_pairs pair
    where pair.account_id = v_supply.account_id
      and pair.kiz_normalized = p_kiz_normalized
      and pair.status in ('draft', 'committed')
  ) then raise exception 'Этот КИЗ уже привязан в текущей партии компании'; end if;

  insert into public.fulfillment_kiz_pairs(
    account_id, store_id, batch_id, supply_id, box_id, item_id,
    barcode, kiz_raw, kiz_normalized, gtin, serial_number,
    product_snapshot, hierarchy_snapshot, actor_name, actor_email,
    device_id, device_name, scanner_model
  ) values (
    v_supply.account_id, v_batch.store_id, v_batch.id, v_supply.id, v_box.id, p_item_id,
    v_barcode, p_kiz_raw, p_kiz_normalized, v_gtin, v_serial,
    coalesce(p_product_snapshot, '{}'::jsonb) || v_chz || jsonb_build_object(
      'barcode', v_barcode, 'product_name', p_product_name, 'honest_sign_article', v_chz_article
    ),
    jsonb_build_object(
      'batch_id', v_batch.id, 'batch_short_id', v_batch.short_id, 'batch_name', v_batch.name,
      'supply_id', v_supply.id, 'supply_number', v_supply.supply_number,
      'box_id', v_box.id, 'box_number', v_box.box_number, 'box_barcode', v_box.barcode
    ),
    nullif(left(coalesce(p_actor_name, ''), 160), ''),
    nullif(left(coalesce(p_actor_email, ''), 320), ''),
    p_device_id, left(coalesce(nullif(p_device_name, ''), 'Устройство без имени'), 160),
    nullif(left(coalesce(p_scanner_model, ''), 200), '')
  ) returning * into v_pair;

  perform public.fulfillment_kiz_event(
    v_pair, 'draft_created', 'scan', null, null, to_jsonb(v_pair),
    p_actor_name, p_actor_email, p_device_id, p_device_name, p_scanner_model
  );
  return to_jsonb(v_pair);
end;
$$;

create or replace function public.commit_fulfillment_kiz_box(
  p_box_id uuid,
  p_actor_name text default null,
  p_actor_email text default null,
  p_device_id text default null,
  p_device_name text default null,
  p_scanner_model text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_box public.fulfillment_boxes%rowtype;
  v_pair public.fulfillment_kiz_pairs%rowtype;
  v_item public.fulfillment_box_items%rowtype;
  v_count integer := 0;
begin
  select * into v_box from public.fulfillment_boxes where id = p_box_id for update;
  if v_box.id is null then raise exception 'Короб не найден'; end if;
  perform public.fulfillment_kiz_assert_editable(v_box.supply_id);

  for v_pair in
    select * from public.fulfillment_kiz_pairs
    where box_id = p_box_id and status = 'draft'
    order by created_at for update
  loop
    insert into public.fulfillment_box_items(box_id, account_id, barcode, item_id, product_name, qty)
    values (
      v_box.id, v_box.account_id, v_pair.barcode, v_pair.item_id,
      v_pair.product_snapshot->>'product_name', 1
    )
    on conflict (box_id, barcode) do update set
      qty = fulfillment_box_items.qty + 1,
      item_id = coalesce(fulfillment_box_items.item_id, excluded.item_id),
      product_name = coalesce(fulfillment_box_items.product_name, excluded.product_name)
    returning * into v_item;

    update public.fulfillment_kiz_pairs set
      status = 'committed', box_item_id = v_item.id, committed_at = now(), updated_at = now(),
      actor_name = nullif(left(coalesce(p_actor_name, actor_name, ''), 160), ''),
      actor_email = nullif(left(coalesce(p_actor_email, actor_email, ''), 320), ''),
      device_id = coalesce(nullif(p_device_id, ''), device_id),
      device_name = coalesce(nullif(p_device_name, ''), device_name),
      scanner_model = coalesce(nullif(p_scanner_model, ''), scanner_model)
    where id = v_pair.id returning * into v_pair;
    perform public.fulfillment_kiz_event(
      v_pair, 'committed', 'box_commit', 'Записана в короб',
      jsonb_build_object('status', 'draft'), to_jsonb(v_pair),
      p_actor_name, p_actor_email, p_device_id, p_device_name, p_scanner_model
    );
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then raise exception 'В этом коробе нет незаписанных пар КИЗ'; end if;
  return jsonb_build_object(
    'committed_count', v_count,
    'items', coalesce((select jsonb_agg(item order by item.created_at) from public.fulfillment_box_items item where item.box_id = p_box_id), '[]'::jsonb),
    'pairs', coalesce((select jsonb_agg(pair order by pair.created_at) from public.fulfillment_kiz_pairs pair where pair.box_id = p_box_id and pair.status in ('draft', 'committed')), '[]'::jsonb)
  );
end;
$$;

create or replace function public.delete_fulfillment_kiz_pair(
  p_pair_id uuid,
  p_reason text default 'Удалена оператором',
  p_actor_name text default null,
  p_actor_email text default null,
  p_device_id text default null,
  p_device_name text default null,
  p_scanner_model text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_pair public.fulfillment_kiz_pairs%rowtype;
  v_old jsonb;
  v_item public.fulfillment_box_items%rowtype;
begin
  select * into v_pair from public.fulfillment_kiz_pairs where id = p_pair_id for update;
  if v_pair.id is null or v_pair.status not in ('draft', 'committed') then raise exception 'Активная пара КИЗ не найдена'; end if;
  perform public.fulfillment_kiz_assert_editable(v_pair.supply_id);
  v_old := to_jsonb(v_pair);

  update public.fulfillment_kiz_pairs set status = 'deleted', deleted_at = now(), updated_at = now()
  where id = v_pair.id returning * into v_pair;

  if v_old->>'status' = 'committed' and v_pair.box_item_id is not null then
    select * into v_item from public.fulfillment_box_items where id = v_pair.box_item_id for update;
    if v_item.id is not null and v_item.qty > 1 then
      update public.fulfillment_box_items set qty = qty - 1 where id = v_item.id returning * into v_item;
    elsif v_item.id is not null then
      delete from public.fulfillment_box_items where id = v_item.id;
      v_item := null;
    end if;
  end if;

  perform public.fulfillment_kiz_event(
    v_pair, 'pair_deleted', 'operator', coalesce(nullif(trim(p_reason), ''), 'Удалена оператором'),
    v_old, to_jsonb(v_pair), p_actor_name, p_actor_email, p_device_id, p_device_name, p_scanner_model
  );
  return jsonb_build_object('pair', to_jsonb(v_pair), 'item', case when v_item.id is null then null else to_jsonb(v_item) end);
end;
$$;

create or replace function public.relink_fulfillment_kiz_pair(
  p_pair_id uuid,
  p_kiz_raw text,
  p_kiz_normalized text,
  p_actor_name text default null,
  p_actor_email text default null,
  p_device_id text default null,
  p_device_name text default null,
  p_scanner_model text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_pair public.fulfillment_kiz_pairs%rowtype;
  v_old jsonb;
  v_gtin text;
begin
  select * into v_pair from public.fulfillment_kiz_pairs where id = p_pair_id for update;
  if v_pair.id is null or v_pair.status not in ('draft', 'committed') then raise exception 'Активная пара КИЗ не найдена'; end if;
  perform public.fulfillment_kiz_assert_editable(v_pair.supply_id);
  if not public.fulfillment_is_valid_kiz(p_kiz_normalized) then raise exception 'Это не корректный КИЗ GS1 DataMatrix'; end if;
  v_gtin := substring(p_kiz_normalized from 3 for 14);
  if not (v_pair.barcode = v_gtin or (char_length(v_pair.barcode) = 13 and '0' || v_pair.barcode = v_gtin)) then
    raise exception 'GTIN нового КИЗа не соответствует товару';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_pair.account_id::text || ':fulfillment-kiz:' || p_kiz_normalized, 0));
  if exists (
    select 1 from public.fulfillment_kiz_pairs other
    where other.account_id = v_pair.account_id and other.kiz_normalized = p_kiz_normalized
      and other.status in ('draft', 'committed') and other.id <> v_pair.id
  ) then raise exception 'Этот КИЗ уже привязан к другой единице товара'; end if;

  v_old := to_jsonb(v_pair);
  update public.fulfillment_kiz_pairs set
    kiz_raw = p_kiz_raw, kiz_normalized = p_kiz_normalized, gtin = v_gtin,
    serial_number = split_part(substring(p_kiz_normalized from 19), chr(29), 1),
    updated_at = now(), actor_name = nullif(left(coalesce(p_actor_name, actor_name, ''), 160), ''),
    actor_email = nullif(left(coalesce(p_actor_email, actor_email, ''), 320), ''),
    device_id = coalesce(nullif(p_device_id, ''), device_id),
    device_name = coalesce(nullif(p_device_name, ''), device_name),
    scanner_model = coalesce(nullif(p_scanner_model, ''), scanner_model)
  where id = v_pair.id returning * into v_pair;
  perform public.fulfillment_kiz_event(
    v_pair, 'pair_relinked', 'operator', 'КИЗ пары заменён', v_old, to_jsonb(v_pair),
    p_actor_name, p_actor_email, p_device_id, p_device_name, p_scanner_model
  );
  return to_jsonb(v_pair);
end;
$$;

create or replace function public.archive_fulfillment_kiz_parent_removal()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_pair public.fulfillment_kiz_pairs%rowtype;
  v_reason_code text;
  v_reason text;
begin
  if tg_table_name = 'fulfillment_supplies' then
    v_reason_code := 'cascade_supply';
    v_reason := format('Удалена вместе с поставкой ID %s (S-%s)', old.id, old.supply_number);
    for v_pair in update public.fulfillment_kiz_pairs set status='deleted', deleted_at=now(), updated_at=now()
      where supply_id=old.id and status in ('draft','committed') returning * loop
      perform public.fulfillment_kiz_event(v_pair, 'cascade_deleted', v_reason_code, v_reason, null, to_jsonb(v_pair), null, null, null, null, null);
    end loop;
  elsif tg_table_name = 'fulfillment_boxes' then
    v_reason_code := 'cascade_box';
    v_reason := format('Удалена вместе с коробом №%s, ID %s', old.box_number, old.id);
    for v_pair in update public.fulfillment_kiz_pairs set status='deleted', deleted_at=now(), updated_at=now()
      where box_id=old.id and status in ('draft','committed') returning * loop
      perform public.fulfillment_kiz_event(v_pair, 'cascade_deleted', v_reason_code, v_reason, null, to_jsonb(v_pair), null, null, null, null, null);
    end loop;
  elsif tg_table_name = 'fulfillment_box_items' then
    v_reason_code := 'cascade_product';
    v_reason := format('Удалена вместе с товаром %s из короба, ID строки %s', old.barcode, old.id);
    for v_pair in update public.fulfillment_kiz_pairs set status='deleted', deleted_at=now(), updated_at=now()
      where box_item_id=old.id and status in ('draft','committed') returning * loop
      perform public.fulfillment_kiz_event(v_pair, 'cascade_deleted', v_reason_code, v_reason, null, to_jsonb(v_pair), null, null, null, null, null);
    end loop;
  elsif tg_table_name = 'fulfillment_batches' then
    v_reason_code := 'cascade_batch';
    v_reason := format('Удалена вместе с партией P-%s, ID %s', old.short_id, old.id);
    for v_pair in update public.fulfillment_kiz_pairs set status='deleted', deleted_at=now(), updated_at=now()
      where batch_id=old.id and status in ('draft','committed') returning * loop
      perform public.fulfillment_kiz_event(v_pair, 'cascade_deleted', v_reason_code, v_reason, null, to_jsonb(v_pair), null, null, null, null, null);
    end loop;
  end if;
  return old;
end;
$$;

create or replace function public.fulfillment_archive_kiz_scope(
  p_scope text,
  p_id uuid,
  p_actor_name text,
  p_actor_email text,
  p_device_id text,
  p_device_name text,
  p_scanner_model text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_pair public.fulfillment_kiz_pairs%rowtype;
  v_reason_code text;
  v_reason text;
  v_number integer;
  v_barcode text;
begin
  if p_scope = 'supply' then
    select supply_number into v_number from public.fulfillment_supplies where id = p_id;
    v_reason_code := 'cascade_supply';
    v_reason := format('Удалена вместе с поставкой ID %s (S-%s)', p_id, v_number);
  elsif p_scope = 'box' then
    select box_number into v_number from public.fulfillment_boxes where id = p_id;
    v_reason_code := 'cascade_box';
    v_reason := format('Удалена вместе с коробом №%s, ID %s', v_number, p_id);
  elsif p_scope = 'product' then
    select barcode into v_barcode from public.fulfillment_box_items where id = p_id;
    v_reason_code := 'cascade_product';
    v_reason := format('Удалена вместе с товаром %s из короба, ID строки %s', v_barcode, p_id);
  elsif p_scope = 'batch' then
    select short_id into v_number from public.fulfillment_batches where id = p_id;
    v_reason_code := 'cascade_batch';
    v_reason := format('Удалена вместе с партией P-%s, ID %s', v_number, p_id);
  else
    raise exception 'Неизвестный уровень удаления КИЗ';
  end if;

  for v_pair in
    update public.fulfillment_kiz_pairs set status='deleted', deleted_at=now(), updated_at=now()
    where status in ('draft','committed') and (
      (p_scope='supply' and supply_id=p_id) or
      (p_scope='box' and box_id=p_id) or
      (p_scope='product' and box_item_id=p_id) or
      (p_scope='batch' and batch_id=p_id)
    ) returning *
  loop
    perform public.fulfillment_kiz_event(
      v_pair, 'cascade_deleted', v_reason_code, v_reason, null, to_jsonb(v_pair),
      p_actor_name, p_actor_email, p_device_id, p_device_name, p_scanner_model
    );
  end loop;
end;
$$;

create or replace function public.delete_fulfillment_supply_with_kiz_audit(
  p_supply_id uuid, p_actor_name text default null, p_actor_email text default null,
  p_device_id text default null, p_device_name text default null, p_scanner_model text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_account_id uuid;
begin
  select account_id into v_account_id from public.fulfillment_supplies where id=p_supply_id;
  if v_account_id is null then raise exception 'Поставка не найдена'; end if;
  perform public.fulfillment_kiz_assert_member(v_account_id);
  perform public.fulfillment_archive_kiz_scope('supply', p_supply_id, p_actor_name, p_actor_email, p_device_id, p_device_name, p_scanner_model);
  delete from public.fulfillment_supplies where id=p_supply_id;
end;
$$;

create or replace function public.delete_fulfillment_box_with_kiz_audit(
  p_box_id uuid, p_actor_name text default null, p_actor_email text default null,
  p_device_id text default null, p_device_name text default null, p_scanner_model text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_account_id uuid;
begin
  select account_id into v_account_id from public.fulfillment_boxes where id=p_box_id;
  if v_account_id is null then raise exception 'Короб не найден'; end if;
  perform public.fulfillment_kiz_assert_member(v_account_id);
  perform public.fulfillment_archive_kiz_scope('box', p_box_id, p_actor_name, p_actor_email, p_device_id, p_device_name, p_scanner_model);
  delete from public.fulfillment_boxes where id=p_box_id;
end;
$$;

create or replace function public.delete_fulfillment_box_item_with_kiz_audit(
  p_item_id uuid, p_actor_name text default null, p_actor_email text default null,
  p_device_id text default null, p_device_name text default null, p_scanner_model text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_account_id uuid;
begin
  select account_id into v_account_id from public.fulfillment_box_items where id=p_item_id;
  if v_account_id is null then raise exception 'Товар в коробе не найден'; end if;
  perform public.fulfillment_kiz_assert_member(v_account_id);
  perform public.fulfillment_archive_kiz_scope('product', p_item_id, p_actor_name, p_actor_email, p_device_id, p_device_name, p_scanner_model);
  delete from public.fulfillment_box_items where id=p_item_id;
end;
$$;

create or replace function public.delete_fulfillment_batch_with_kiz_audit(
  p_batch_id uuid, p_actor_name text default null, p_actor_email text default null,
  p_device_id text default null, p_device_name text default null, p_scanner_model text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_account_id uuid;
begin
  select account_id into v_account_id from public.fulfillment_batches where id=p_batch_id;
  if v_account_id is null then raise exception 'Партия не найдена'; end if;
  perform public.fulfillment_kiz_assert_member(v_account_id);
  perform public.fulfillment_archive_kiz_scope('batch', p_batch_id, p_actor_name, p_actor_email, p_device_id, p_device_name, p_scanner_model);
  update public.fulfillment_batches set deleted_at=now(), updated_at=now() where id=p_batch_id;
end;
$$;

drop trigger if exists archive_kiz_before_supply_delete on public.fulfillment_supplies;
create trigger archive_kiz_before_supply_delete before delete on public.fulfillment_supplies
for each row execute function public.archive_fulfillment_kiz_parent_removal();
drop trigger if exists archive_kiz_before_box_delete on public.fulfillment_boxes;
create trigger archive_kiz_before_box_delete before delete on public.fulfillment_boxes
for each row execute function public.archive_fulfillment_kiz_parent_removal();
drop trigger if exists archive_kiz_before_box_item_delete on public.fulfillment_box_items;
create trigger archive_kiz_before_box_item_delete before delete on public.fulfillment_box_items
for each row execute function public.archive_fulfillment_kiz_parent_removal();
drop trigger if exists archive_kiz_before_batch_delete on public.fulfillment_batches;
create trigger archive_kiz_before_batch_delete before delete on public.fulfillment_batches
for each row execute function public.archive_fulfillment_kiz_parent_removal();

-- Soft deletion needs NEW/OLD handling separate from hard-delete trigger.
create or replace function public.archive_fulfillment_kiz_batch_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_pair public.fulfillment_kiz_pairs%rowtype; v_reason text;
begin
  if old.deleted_at is null and new.deleted_at is not null then
    v_reason := format('Удалена вместе с партией P-%s, ID %s', old.short_id, old.id);
    for v_pair in update public.fulfillment_kiz_pairs set status='deleted', deleted_at=now(), updated_at=now()
      where batch_id=old.id and status in ('draft','committed') returning * loop
      perform public.fulfillment_kiz_event(v_pair, 'cascade_deleted', 'cascade_batch', v_reason, null, to_jsonb(v_pair), null, null, null, null, null);
    end loop;
  end if;
  return new;
end;
$$;
drop trigger if exists archive_kiz_after_batch_soft_delete on public.fulfillment_batches;
create trigger archive_kiz_after_batch_soft_delete after update of deleted_at on public.fulfillment_batches
for each row execute function public.archive_fulfillment_kiz_batch_update();

create or replace function public.guard_fulfillment_kiz_shipping()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'Отгружен' and old.status is distinct from new.status and exists (
    select 1 from public.fulfillment_supplies supply
    join public.fulfillment_kiz_pairs pair on pair.supply_id = supply.id and pair.status = 'draft'
    where supply.destination_type = 'fbo'
      and (supply.trip_line_id = new.id or new.fulfillment_supply_id = supply.id)
  ) then raise exception 'Нельзя отгрузить FBO: в поставке есть незаписанные пары КИЗ'; end if;
  return new;
end;
$$;
drop trigger if exists guard_fulfillment_kiz_before_shipping on public.trip_lines;
create trigger guard_fulfillment_kiz_before_shipping before update of status on public.trip_lines
for each row execute function public.guard_fulfillment_kiz_shipping();

revoke all on function public.set_fulfillment_supply_kiz_mode(uuid,boolean,text,text,text,text,text) from public, anon;
revoke all on function public.fulfillment_kiz_event(public.fulfillment_kiz_pairs,text,text,text,jsonb,jsonb,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.fulfillment_archive_kiz_scope(text,uuid,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.fulfillment_kiz_assert_member(uuid) from public, anon;
revoke all on function public.fulfillment_kiz_assert_editable(uuid) from public, anon;
revoke all on function public.fulfillment_kiz_events_are_immutable() from public, anon, authenticated;
revoke all on function public.archive_fulfillment_kiz_parent_removal() from public, anon, authenticated;
revoke all on function public.archive_fulfillment_kiz_batch_update() from public, anon, authenticated;
revoke all on function public.guard_fulfillment_kiz_shipping() from public, anon, authenticated;
revoke all on function public.create_fulfillment_kiz_draft(uuid,text,uuid,text,text,text,jsonb,text,text,text,text,text) from public, anon;
revoke all on function public.commit_fulfillment_kiz_box(uuid,text,text,text,text,text) from public, anon;
revoke all on function public.delete_fulfillment_kiz_pair(uuid,text,text,text,text,text,text) from public, anon;
revoke all on function public.relink_fulfillment_kiz_pair(uuid,text,text,text,text,text,text,text) from public, anon;
revoke all on function public.delete_fulfillment_supply_with_kiz_audit(uuid,text,text,text,text,text) from public, anon;
revoke all on function public.delete_fulfillment_box_with_kiz_audit(uuid,text,text,text,text,text) from public, anon;
revoke all on function public.delete_fulfillment_box_item_with_kiz_audit(uuid,text,text,text,text,text) from public, anon;
revoke all on function public.delete_fulfillment_batch_with_kiz_audit(uuid,text,text,text,text,text) from public, anon;
grant execute on function public.set_fulfillment_supply_kiz_mode(uuid,boolean,text,text,text,text,text) to authenticated;
grant execute on function public.create_fulfillment_kiz_draft(uuid,text,uuid,text,text,text,jsonb,text,text,text,text,text) to authenticated;
grant execute on function public.commit_fulfillment_kiz_box(uuid,text,text,text,text,text) to authenticated;
grant execute on function public.delete_fulfillment_kiz_pair(uuid,text,text,text,text,text,text) to authenticated;
grant execute on function public.relink_fulfillment_kiz_pair(uuid,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.delete_fulfillment_supply_with_kiz_audit(uuid,text,text,text,text,text) to authenticated;
grant execute on function public.delete_fulfillment_box_with_kiz_audit(uuid,text,text,text,text,text) to authenticated;
grant execute on function public.delete_fulfillment_box_item_with_kiz_audit(uuid,text,text,text,text,text) to authenticated;
grant execute on function public.delete_fulfillment_batch_with_kiz_audit(uuid,text,text,text,text,text) to authenticated;

commit;
