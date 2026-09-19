-- Cross-border marking workflow. FBO/FBW and FBS stay separate sources, while
-- every KIZ keeps an immutable history across all attempts and cancellations.
begin;

create table if not exists public.transgran_shipments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete restrict,
  scheme text not null check (scheme in ('fbo', 'fbs')),
  source_kind text not null check (source_kind in ('fulfillment_supply', 'fbs_supply')),
  fulfillment_supply_id uuid references public.fulfillment_supplies(id) on delete restrict,
  wb_supply_id text,
  document_number text,
  document_date date,
  shipment_date date,
  operation_country_code text not null default 'RU',
  recipient_name text not null default 'ООО «РВБ»',
  recipient_inn text not null default '9714053621',
  recipient_kpp text not null default '507401001',
  destination_city text,
  destination_name text,
  movement_kind text not null default 'border_crossing'
    check (movement_kind in ('border_crossing', 'inside_russia')),
  physical_status text not null default 'preparing'
    check (physical_status in ('preparing', 'awaiting_departure', 'in_transit', 'in_russia', 'handed_to_wb', 'cancelled')),
  product_group_id bigint,
  product_group_code text,
  product_group_alias text not null default 'lp',
  product_group_name text,
  products_payload jsonb not null default '[]'::jsonb,
  file_id text,
  file_gtins text[] not null default '{}'::text[],
  status text not null default 'draft'
    check (status in ('draft', 'checking', 'ready', 'submitting', 'waiting', 'progress', 'completed', 'rejected', 'cancel_requested', 'cancelled', 'error')),
  teksher_operation_id text,
  teksher_status text,
  teksher_process_description text,
  cancellation_document_number text,
  spot_channel text not null default 'wb' check (spot_channel in ('wb', 'cargo', 'direct')),
  spot_status text not null default 'not_started'
    check (spot_status in ('not_started', 'data_ready', 'requested', 'qr_ready', 'crossed', 'revoked')),
  carrier_legal_name text,
  carrier_tax_id text,
  carrier_country text not null default 'Кыргызстан',
  vehicle_number text,
  trailer_number text,
  spot_qr_file_url text,
  customs_declaration_numbers text[] not null default '{}'::text[],
  spot_requested_at timestamptz,
  spot_qr_ready_at timestamptz,
  source_snapshot jsonb not null default '{}'::jsonb,
  response_snapshot jsonb not null default '{}'::jsonb,
  last_error text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  completed_at timestamptz,
  archived_at timestamptz,
  check ((scheme = 'fbo' and source_kind = 'fulfillment_supply' and fulfillment_supply_id is not null)
      or (scheme = 'fbs' and source_kind = 'fbs_supply' and wb_supply_id is not null)),
  check (wb_supply_id is null or char_length(wb_supply_id) between 1 and 100)
);

-- Keep upgrades idempotent when the base workflow was installed before the
-- SPOT fields were added.
alter table public.transgran_shipments add column if not exists spot_channel text not null default 'wb';
alter table public.transgran_shipments add column if not exists spot_status text not null default 'not_started';
alter table public.transgran_shipments add column if not exists carrier_legal_name text;
alter table public.transgran_shipments add column if not exists carrier_tax_id text;
alter table public.transgran_shipments add column if not exists carrier_country text not null default 'Кыргызстан';
alter table public.transgran_shipments add column if not exists vehicle_number text;
alter table public.transgran_shipments add column if not exists trailer_number text;
alter table public.transgran_shipments add column if not exists spot_qr_file_url text;
alter table public.transgran_shipments add column if not exists customs_declaration_numbers text[] not null default '{}'::text[];
alter table public.transgran_shipments add column if not exists spot_requested_at timestamptz;
alter table public.transgran_shipments add column if not exists spot_qr_ready_at timestamptz;
alter table public.transgran_shipments add column if not exists movement_kind text not null default 'border_crossing';
alter table public.transgran_shipments drop constraint if exists transgran_shipments_spot_channel_check;
alter table public.transgran_shipments add constraint transgran_shipments_spot_channel_check
  check (spot_channel in ('wb', 'cargo', 'direct'));
alter table public.transgran_shipments drop constraint if exists transgran_shipments_spot_status_check;
alter table public.transgran_shipments add constraint transgran_shipments_spot_status_check
  check (spot_status in ('not_started', 'data_ready', 'requested', 'qr_ready', 'crossed', 'revoked'));
alter table public.transgran_shipments drop constraint if exists transgran_shipments_movement_kind_check;
alter table public.transgran_shipments add constraint transgran_shipments_movement_kind_check
  check (movement_kind in ('border_crossing', 'inside_russia'));

drop index if exists public.transgran_active_fbo_source_uidx;
create unique index transgran_active_fbo_source_uidx
  on public.transgran_shipments(fulfillment_supply_id)
  where archived_at is null and status in ('draft', 'checking', 'ready', 'submitting', 'waiting', 'progress', 'cancel_requested', 'error');
drop index if exists public.transgran_active_fbs_source_uidx;
create unique index transgran_active_fbs_source_uidx
  on public.transgran_shipments(store_id, wb_supply_id)
  where scheme = 'fbs' and archived_at is null and status in ('draft', 'checking', 'ready', 'submitting', 'waiting', 'progress', 'cancel_requested', 'error');
create unique index if not exists transgran_teksher_operation_uidx
  on public.transgran_shipments(store_id, teksher_operation_id)
  where teksher_operation_id is not null;
create index if not exists transgran_shipments_account_created_idx
  on public.transgran_shipments(account_id, created_at desc);

create table if not exists public.transgran_items (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.transgran_shipments(id) on delete restrict,
  account_id uuid not null references public.accounts(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete restrict,
  source_pair_kind text not null check (source_pair_kind in ('fulfillment', 'fbs')),
  source_pair_id uuid not null,
  wb_order_id text,
  barcode text,
  kiz_raw text not null,
  kiz_normalized text not null,
  gtin text,
  serial_number text,
  product_snapshot jsonb not null default '{}'::jsonb,
  source_snapshot jsonb not null default '{}'::jsonb,
  validation_level text not null default 'unchecked'
    check (validation_level in ('unchecked', 'ok', 'warning', 'error')),
  issues jsonb not null default '[]'::jsonb,
  teksher_code_id text,
  teksher_status text,
  teksher_history jsonb not null default '[]'::jsonb,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (shipment_id, kiz_normalized)
);

create index if not exists transgran_items_kiz_history_idx
  on public.transgran_items(account_id, kiz_normalized, created_at desc);
create index if not exists transgran_items_shipment_idx
  on public.transgran_items(shipment_id, created_at);

create table if not exists public.transgran_events (
  id bigint generated always as identity primary key,
  shipment_id uuid not null references public.transgran_shipments(id) on delete restrict,
  account_id uuid not null references public.accounts(id) on delete cascade,
  event_type text not null,
  old_status text,
  new_status text,
  details jsonb not null default '{}'::jsonb,
  actor_user_id uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists transgran_events_shipment_idx
  on public.transgran_events(shipment_id, created_at desc);

create or replace function public.touch_transgran_shipment()
returns trigger language plpgsql as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists touch_transgran_shipment on public.transgran_shipments;
create trigger touch_transgran_shipment before update on public.transgran_shipments
for each row execute function public.touch_transgran_shipment();

alter table public.transgran_shipments enable row level security;
alter table public.transgran_items enable row level security;
alter table public.transgran_events enable row level security;

drop policy if exists "members read transgran shipments" on public.transgran_shipments;
create policy "members read transgran shipments" on public.transgran_shipments for select
using (exists (select 1 from public.account_members member
  where member.account_id = transgran_shipments.account_id and member.user_id = auth.uid()));

drop policy if exists "members create transgran shipments" on public.transgran_shipments;
create policy "members create transgran shipments" on public.transgran_shipments for insert
with check (exists (select 1 from public.account_members member
  where member.account_id = transgran_shipments.account_id and member.user_id = auth.uid()));

drop policy if exists "members update transgran drafts" on public.transgran_shipments;
create policy "members update transgran drafts" on public.transgran_shipments for update
using (status in ('draft', 'ready', 'error') and exists (select 1 from public.account_members member
  where member.account_id = transgran_shipments.account_id and member.user_id = auth.uid()))
with check (exists (select 1 from public.account_members member
  where member.account_id = transgran_shipments.account_id and member.user_id = auth.uid()));

drop policy if exists "members read transgran items" on public.transgran_items;
create policy "members read transgran items" on public.transgran_items for select
using (exists (select 1 from public.account_members member
  where member.account_id = transgran_items.account_id and member.user_id = auth.uid()));

drop policy if exists "members read transgran events" on public.transgran_events;
create policy "members read transgran events" on public.transgran_events for select
using (exists (select 1 from public.account_members member
  where member.account_id = transgran_events.account_id and member.user_id = auth.uid()));

create or replace function public.transgran_events_are_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'История трансграна неизменяема';
end;
$$;

drop trigger if exists protect_transgran_events on public.transgran_events;
create trigger protect_transgran_events before update or delete on public.transgran_events
for each row execute function public.transgran_events_are_immutable();

create or replace function public.transgran_assert_member(p_account_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.account_members member
    where member.account_id = p_account_id and member.user_id = auth.uid()
  ) then raise exception 'Нет доступа к данным этой компании'; end if;
end;
$$;

create or replace function public.create_transgran_from_fbo(p_supply_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_source record;
  v_shipment_id uuid;
  v_item_count integer;
begin
  select supply.*, batch.store_id, batch.short_id as batch_short_id,
         line.status as logistics_status, line.shipment_number
  into v_source
  from public.fulfillment_supplies supply
  join public.fulfillment_batches batch on batch.id = supply.batch_id
  left join public.trip_lines line on line.id = supply.trip_line_id and line.deleted_at is null
  where supply.id = p_supply_id;
  if not found then raise exception 'FBO-поставка не найдена'; end if;
  perform public.transgran_assert_member(v_source.account_id);
  if v_source.store_id is null then raise exception 'У партии не выбран магазин WB'; end if;
  if v_source.destination_type <> 'fbo' then raise exception 'Выбрана не FBO-поставка'; end if;

  select id into v_shipment_id from public.transgran_shipments
  where fulfillment_supply_id = p_supply_id and archived_at is null
    and status in ('draft', 'checking', 'ready', 'submitting', 'waiting', 'progress', 'cancel_requested', 'error')
  order by created_at desc limit 1;
  if v_shipment_id is not null then return v_shipment_id; end if;

  insert into public.transgran_shipments(
    account_id, store_id, scheme, source_kind, fulfillment_supply_id, wb_supply_id,
    document_number, destination_name, physical_status, source_snapshot
  ) values (
    v_source.account_id, v_source.store_id, 'fbo', 'fulfillment_supply', v_source.id,
    nullif(btrim(v_source.wb_supply_id), ''), nullif(btrim(v_source.wb_supply_id), ''),
    v_source.warehouse_name,
    case v_source.logistics_status
      when 'Ожидает отправки' then 'awaiting_departure'
      when 'В пути' then 'in_transit'
      when 'Прибыл' then 'in_russia'
      when 'Отгружен' then 'handed_to_wb'
      else 'preparing'
    end,
    jsonb_build_object(
      'batch_id', v_source.batch_id, 'batch_short_id', v_source.batch_short_id,
      'supply_number', v_source.supply_number, 'warehouse_name', v_source.warehouse_name,
      'logistics_status', v_source.logistics_status, 'shipment_number', v_source.shipment_number
    )
  ) returning id into v_shipment_id;

  insert into public.transgran_items(
    shipment_id, account_id, store_id, source_pair_kind, source_pair_id,
    barcode, kiz_raw, kiz_normalized, gtin, serial_number, product_snapshot, source_snapshot
  )
  select v_shipment_id, pair.account_id, v_source.store_id, 'fulfillment', pair.id,
         pair.barcode, pair.kiz_raw, pair.kiz_normalized, pair.gtin, pair.serial_number,
         pair.product_snapshot,
         pair.hierarchy_snapshot || jsonb_build_object('box_id', pair.box_id, 'box_item_id', pair.box_item_id)
  from public.fulfillment_kiz_pairs pair
  where pair.supply_id = p_supply_id and pair.status = 'committed'
  order by pair.created_at;

  get diagnostics v_item_count = row_count;
  if v_item_count = 0 then
    raise exception 'В поставке нет подтверждённых КИЗ. Приём товара в партию сам по себе не создаёт состав трансграна';
  end if;
  insert into public.transgran_events(shipment_id, account_id, event_type, new_status, details)
  values (v_shipment_id, v_source.account_id, 'created_from_fbo', 'draft', jsonb_build_object('items', v_item_count));
  return v_shipment_id;
end;
$$;

create or replace function public.create_transgran_from_fbs(p_store_id uuid, p_wb_supply_id text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_source record;
  v_shipment_id uuid;
  v_item_count integer;
  v_supply_id text := nullif(btrim(p_wb_supply_id), '');
begin
  if v_supply_id is null then raise exception 'ID FBS-поставки обязателен'; end if;
  select supply.*, store.account_id into v_source
  from public.fbs_supplies supply
  join public.stores store on store.id = supply.store_id and store.account_id = supply.account_id
  where supply.store_id = p_store_id and supply.wb_supply_id = v_supply_id;
  if not found then raise exception 'FBS-поставка не найдена. Сначала синхронизируйте FBS'; end if;
  perform public.transgran_assert_member(v_source.account_id);

  select id into v_shipment_id from public.transgran_shipments
  where store_id = p_store_id and scheme = 'fbs' and wb_supply_id = v_supply_id
    and archived_at is null
    and status in ('draft', 'checking', 'ready', 'submitting', 'waiting', 'progress', 'cancel_requested', 'error')
  order by created_at desc limit 1;
  if v_shipment_id is not null then return v_shipment_id; end if;

  insert into public.transgran_shipments(
    account_id, store_id, scheme, source_kind, wb_supply_id, document_number,
    destination_name, physical_status, source_snapshot
  ) values (
    v_source.account_id, p_store_id, 'fbs', 'fbs_supply', v_supply_id, v_supply_id,
    coalesce(v_source.raw_data->>'destinationOfficeName', v_source.raw_data->>'destinationName'),
    'preparing',
    jsonb_build_object(
      'name', v_source.name, 'done', v_source.done, 'created_at', v_source.wb_created_at,
      'closed_at', v_source.wb_closed_at, 'scan_at', v_source.wb_scan_at,
      'destination_office_id', v_source.destination_office_id,
      'cross_border_type', v_source.cross_border_type
    )
  ) returning id into v_shipment_id;

  insert into public.transgran_items(
    shipment_id, account_id, store_id, source_pair_kind, source_pair_id, wb_order_id,
    barcode, kiz_raw, kiz_normalized, gtin, serial_number, product_snapshot, source_snapshot,
    validation_level, issues
  )
  select v_shipment_id, pair.account_id, pair.store_id, 'fbs', pair.id, pair.order_id,
         coalesce(order_row.skus->>0, pair.product_snapshot->>'barcode'), pair.sgtin, pair.sgtin,
         case when pair.sgtin like '01%' then substring(pair.sgtin from 3 for 14) else null end,
         case when pair.sgtin like '01%' then split_part(substring(pair.sgtin from 19), chr(29), 1) else null end,
         pair.product_snapshot,
         jsonb_build_object('pair_status', pair.status, 'pair_error', pair.error, 'wb_status', order_row.wb_status,
           'supplier_status', order_row.supplier_status, 'supply_id', order_row.supply_id),
         case when pair.status = 'error' then 'warning' else 'unchecked' end,
         case when pair.status = 'error'
           then jsonb_build_array(jsonb_build_object('code', 'fbs_send_error', 'level', 'warning', 'message', coalesce(pair.error, 'КИЗ не передан в WB')))
           else '[]'::jsonb end
  from public.fbs_marking_pairs pair
  join public.fbs_orders order_row on order_row.store_id = pair.store_id and order_row.wb_order_id = pair.order_id
  where pair.store_id = p_store_id and order_row.supply_id = v_supply_id
  order by pair.created_at;

  get diagnostics v_item_count = row_count;
  if v_item_count = 0 then
    raise exception 'В FBS-поставке пока нет считанных КИЗ. Одного наличия сборочных заданий недостаточно';
  end if;
  insert into public.transgran_events(shipment_id, account_id, event_type, new_status, details)
  values (v_shipment_id, v_source.account_id, 'created_from_fbs', 'draft', jsonb_build_object('items', v_item_count));
  return v_shipment_id;
end;
$$;

create or replace function public.save_transgran_spot(
  p_shipment_id uuid,
  p_channel text,
  p_status text,
  p_carrier_legal_name text,
  p_carrier_tax_id text,
  p_carrier_country text,
  p_vehicle_number text,
  p_trailer_number text,
  p_qr_file_url text,
  p_customs_declaration_numbers text[]
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_shipment public.transgran_shipments%rowtype;
begin
  select * into v_shipment from public.transgran_shipments where id = p_shipment_id for update;
  if not found then raise exception 'Документ трансграна не найден'; end if;
  perform public.transgran_assert_member(v_shipment.account_id);
  if p_channel not in ('wb', 'cargo', 'direct') then raise exception 'Неизвестный способ оформления СПОТ'; end if;
  if p_status not in ('not_started', 'data_ready', 'requested', 'qr_ready', 'crossed', 'revoked') then raise exception 'Неизвестный статус СПОТ'; end if;
  update public.transgran_shipments set
    spot_channel = p_channel,
    spot_status = p_status,
    carrier_legal_name = nullif(btrim(p_carrier_legal_name), ''),
    carrier_tax_id = nullif(btrim(p_carrier_tax_id), ''),
    carrier_country = coalesce(nullif(btrim(p_carrier_country), ''), 'Кыргызстан'),
    vehicle_number = nullif(btrim(p_vehicle_number), ''),
    trailer_number = nullif(btrim(p_trailer_number), ''),
    spot_qr_file_url = nullif(btrim(p_qr_file_url), ''),
    customs_declaration_numbers = coalesce(p_customs_declaration_numbers, '{}'::text[]),
    spot_requested_at = case when p_status in ('requested', 'qr_ready', 'crossed') then coalesce(spot_requested_at, now()) else spot_requested_at end,
    spot_qr_ready_at = case when p_status in ('qr_ready', 'crossed') then coalesce(spot_qr_ready_at, now()) when p_status = 'revoked' then null else spot_qr_ready_at end
  where id = p_shipment_id;

  insert into public.transgran_events(shipment_id, account_id, event_type, old_status, new_status, details)
  values (p_shipment_id, v_shipment.account_id, 'spot_updated', v_shipment.spot_status, p_status,
    jsonb_build_object('channel', p_channel, 'carrier', nullif(btrim(p_carrier_legal_name), ''),
      'vehicle', nullif(btrim(p_vehicle_number), ''), 'has_qr', nullif(btrim(p_qr_file_url), '') is not null));
end;
$$;

revoke all on function public.transgran_assert_member(uuid) from public, anon;
revoke all on function public.transgran_events_are_immutable() from public, anon, authenticated;
revoke all on function public.touch_transgran_shipment() from public, anon, authenticated;
revoke all on function public.create_transgran_from_fbo(uuid) from public, anon;
revoke all on function public.create_transgran_from_fbs(uuid, text) from public, anon;
revoke all on function public.save_transgran_spot(uuid, text, text, text, text, text, text, text, text, text[]) from public, anon;
grant execute on function public.create_transgran_from_fbo(uuid) to authenticated;
grant execute on function public.create_transgran_from_fbs(uuid, text) to authenticated;
grant execute on function public.save_transgran_spot(uuid, text, text, text, text, text, text, text, text, text[]) to authenticated;

commit;
