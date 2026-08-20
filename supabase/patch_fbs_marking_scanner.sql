-- Быстрое многопользовательское сканирование КИЗ для FBS.
-- Каждое устройство работает в своей сессии, а уникальность заказа, QR WB и КИЗ
-- контролируется общей БД внутри одного магазина.

create table if not exists public.fbs_marking_sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  device_id text not null,
  device_name text not null default 'Устройство',
  status text not null default 'active'
    check (status in ('active', 'submitting', 'partial', 'completed', 'cancelled')),
  pending_order_id text,
  pending_wb_qr text,
  pending_locked_until timestamptz,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  submit_started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  check (char_length(device_id) between 8 and 200)
);

create unique index if not exists fbs_marking_one_open_session_per_device
  on public.fbs_marking_sessions(store_id, created_by, device_id)
  where status in ('active', 'submitting', 'partial');
create index if not exists fbs_marking_sessions_store_status
  on public.fbs_marking_sessions(store_id, status, last_seen_at desc);
create index if not exists fbs_marking_sessions_pending_order
  on public.fbs_marking_sessions(store_id, pending_order_id)
  where pending_order_id is not null;

create table if not exists public.fbs_marking_pairs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.fbs_marking_sessions(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  order_id text not null,
  wb_qr text not null,
  sgtin text not null,
  status text not null default 'draft'
    check (status in ('draft', 'sending', 'sent', 'error')),
  product_snapshot jsonb not null default '{}'::jsonb,
  error text,
  created_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  device_id text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  check (char_length(wb_qr) between 1 and 300),
  check (char_length(sgtin) between 16 and 135)
);

-- Три независимые гарантии. Нельзя повторить заказ, считанный QR или КИЗ даже
-- из другой сессии/другого устройства этого же магазина.
create unique index if not exists fbs_marking_pairs_store_order_unique
  on public.fbs_marking_pairs(store_id, order_id);
create unique index if not exists fbs_marking_pairs_store_qr_unique
  on public.fbs_marking_pairs(store_id, wb_qr);
create unique index if not exists fbs_marking_pairs_store_sgtin_unique
  on public.fbs_marking_pairs(store_id, sgtin);
create index if not exists fbs_marking_pairs_session_created
  on public.fbs_marking_pairs(session_id, created_at desc);

-- Кэш соответствия содержимого QR официального стикера конкретному заказу.
-- Заполняется Edge Function при первом запуске сканера или обычной печати.
create table if not exists public.fbs_wb_qr_catalog (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  order_id text not null,
  qr_value text not null,
  part_a text,
  part_b text,
  supports_sgtin boolean not null default false,
  fetched_at timestamptz not null default now(),
  unique(store_id, order_id),
  unique(store_id, qr_value)
);

alter table public.fbs_wb_qr_catalog
  add column if not exists supports_sgtin boolean not null default false;

alter table public.fbs_marking_sessions enable row level security;
alter table public.fbs_marking_pairs enable row level security;
alter table public.fbs_wb_qr_catalog enable row level security;

drop policy if exists "fbs marking sessions: account members read" on public.fbs_marking_sessions;
create policy "fbs marking sessions: account members read"
  on public.fbs_marking_sessions for select
  using (exists (
    select 1 from public.account_members member
    where member.account_id = fbs_marking_sessions.account_id
      and member.user_id = auth.uid()
  ));

drop policy if exists "fbs marking pairs: account members read" on public.fbs_marking_pairs;
create policy "fbs marking pairs: account members read"
  on public.fbs_marking_pairs for select
  using (exists (
    select 1 from public.account_members member
    where member.account_id = fbs_marking_pairs.account_id
      and member.user_id = auth.uid()
  ));

drop policy if exists "fbs qr catalog: account members read" on public.fbs_wb_qr_catalog;
create policy "fbs qr catalog: account members read"
  on public.fbs_wb_qr_catalog for select
  using (exists (
    select 1 from public.account_members member
    where member.account_id = fbs_wb_qr_catalog.account_id
      and member.user_id = auth.uid()
  ));

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
  if v_user_id is null then raise exception 'Не авторизован'; end if;
  if char_length(coalesce(p_device_id, '')) not between 8 and 200 then
    raise exception 'Некорректный идентификатор устройства';
  end if;
  if not exists (
    select 1 from public.stores store
    join public.account_members member on member.account_id = store.account_id
    where store.id = p_store_id and store.account_id = p_account_id and member.user_id = v_user_id
  ) then raise exception 'Нет доступа к магазину'; end if;

  select * into v_session
  from public.fbs_marking_sessions
  where store_id = p_store_id and created_by = v_user_id and device_id = p_device_id
    and status in ('active', 'submitting', 'partial')
  order by started_at desc limit 1
  for update;

  if v_session.id is null then
    insert into public.fbs_marking_sessions(account_id, store_id, created_by, device_id, device_name)
    values (p_account_id, p_store_id, v_user_id, p_device_id, left(coalesce(nullif(p_device_name, ''), 'Устройство'), 120))
    returning * into v_session;
  else
    update public.fbs_marking_sessions
    set last_seen_at = now(), updated_at = now(), device_name = left(coalesce(nullif(p_device_name, ''), device_name), 120),
        pending_order_id = case when pending_locked_until <= now() then null else pending_order_id end,
        pending_wb_qr = case when pending_locked_until <= now() then null else pending_wb_qr end,
        pending_locked_until = case when pending_locked_until <= now() then null else pending_locked_until end
    where id = v_session.id
    returning * into v_session;
  end if;
  return to_jsonb(v_session);
end;
$$;

create or replace function public.touch_fbs_marking_session(
  p_session_id uuid,
  p_device_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_session public.fbs_marking_sessions%rowtype;
begin
  update public.fbs_marking_sessions
  set last_seen_at = now(), updated_at = now(),
      pending_locked_until = case when pending_order_id is null then null else now() + interval '2 minutes' end
  where id = p_session_id and created_by = auth.uid() and device_id = p_device_id
    and status in ('active', 'partial')
  returning * into v_session;
  if v_session.id is null then raise exception 'Активная сессия устройства не найдена'; end if;
  return to_jsonb(v_session);
end;
$$;

create or replace function public.scan_fbs_wb_qr(
  p_session_id uuid,
  p_device_id text,
  p_order_id text,
  p_wb_qr text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.fbs_marking_sessions%rowtype;
  v_order public.fbs_orders%rowtype;
  v_qr text := regexp_replace(coalesce(p_wb_qr, ''), E'[\\r\\n]+$', '');
  v_existing public.fbs_marking_pairs%rowtype;
  v_blocked public.fbs_marking_sessions%rowtype;
  v_allowed boolean;
begin
  select * into v_session from public.fbs_marking_sessions
  where id = p_session_id and created_by = auth.uid() and device_id = p_device_id
  for update;
  if v_session.id is null or v_session.status not in ('active', 'partial') then
    raise exception 'Активная сессия устройства не найдена';
  end if;
  if char_length(v_qr) not between 1 and 300 then raise exception 'QR WB пустой или некорректный'; end if;
  if v_session.pending_order_id is not null and v_session.pending_locked_until > now() then
    raise exception 'Сначала отсканируйте КИЗ для заказа %', v_session.pending_order_id;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_session.store_id::text || ':order:' || p_order_id, 0));
  perform pg_advisory_xact_lock(hashtextextended(v_session.store_id::text || ':qr:' || v_qr, 0));

  select * into v_order from public.fbs_orders
  where store_id = v_session.store_id and wb_order_id = p_order_id and is_in_latest_snapshot = true;
  if v_order.id is null then raise exception 'Заказ WB не найден в актуальных данных магазина'; end if;
  if v_order.supplier_status <> 'confirm' or coalesce(v_order.wb_system_status, '') <> 'waiting' then
    raise exception 'Заказ уже не находится на сборке';
  end if;
  v_allowed := coalesce(v_order.data->'requiredMeta', '[]'::jsonb) ? 'sgtin'
    or coalesce(v_order.data->'optionalMeta', '[]'::jsonb) ? 'sgtin'
    or exists (
      select 1 from public.fbs_wb_qr_catalog catalog
      where catalog.store_id = v_session.store_id
        and catalog.order_id = p_order_id
        and catalog.supports_sgtin = true
    );
  if not v_allowed then raise exception 'Wildberries не разрешает КИЗ для этого заказа'; end if;

  select * into v_existing from public.fbs_marking_pairs
  where store_id = v_session.store_id and (order_id = p_order_id or wb_qr = v_qr)
  limit 1;
  if v_existing.id is not null then
    raise exception 'Этот QR WB или заказ уже отсканирован в другой паре';
  end if;

  select * into v_blocked from public.fbs_marking_sessions
  where store_id = v_session.store_id and id <> v_session.id
    and status in ('active', 'partial') and pending_locked_until > now()
    and (pending_order_id = p_order_id or pending_wb_qr = v_qr)
  limit 1;
  if v_blocked.id is not null then
    raise exception 'Этот заказ сейчас сканируется на другом устройстве';
  end if;

  update public.fbs_marking_sessions
  set pending_order_id = p_order_id, pending_wb_qr = v_qr,
      pending_locked_until = now() + interval '2 minutes', last_seen_at = now(), updated_at = now()
  where id = v_session.id;

  return jsonb_build_object(
    'order_id', p_order_id,
    'wb_qr', v_qr,
    'locked_until', now() + interval '2 minutes',
    'product', jsonb_build_object(
      'nm_id', v_order.nm_id,
      'article', v_order.article,
      'barcode', coalesce(v_order.skus->>0, ''),
      'supply_id', v_order.supply_id
    )
  );
end;
$$;

create or replace function public.scan_fbs_kiz(
  p_session_id uuid,
  p_device_id text,
  p_sgtin text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.fbs_marking_sessions%rowtype;
  v_order public.fbs_orders%rowtype;
  v_pair public.fbs_marking_pairs%rowtype;
  v_existing public.fbs_marking_pairs%rowtype;
  v_sgtin text := regexp_replace(coalesce(p_sgtin, ''), E'[\\r\\n]+$', '');
begin
  if char_length(v_sgtin) not between 16 and 135 then
    raise exception 'КИЗ должен содержать от 16 до 135 символов';
  end if;
  select * into v_session from public.fbs_marking_sessions
  where id = p_session_id and created_by = auth.uid() and device_id = p_device_id
  for update;
  if v_session.id is null or v_session.status not in ('active', 'partial') then
    raise exception 'Активная сессия устройства не найдена';
  end if;
  if v_session.pending_order_id is null or v_session.pending_locked_until <= now() then
    update public.fbs_marking_sessions
    set pending_order_id = null, pending_wb_qr = null, pending_locked_until = null, updated_at = now()
    where id = v_session.id;
    raise exception 'Блокировка заказа истекла. Снова отсканируйте QR WB';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_session.store_id::text || ':kiz:' || v_sgtin, 0));
  select * into v_existing from public.fbs_marking_pairs
  where store_id = v_session.store_id and sgtin = v_sgtin limit 1;
  if v_existing.id is not null then
    raise exception 'Этот КИЗ уже привязан к заказу %', v_existing.order_id;
  end if;

  select * into v_order from public.fbs_orders
  where store_id = v_session.store_id and wb_order_id = v_session.pending_order_id
  for update;
  if v_order.id is null or v_order.supplier_status <> 'confirm' or coalesce(v_order.wb_system_status, '') <> 'waiting' then
    raise exception 'Заказ уже не находится на сборке';
  end if;

  insert into public.fbs_marking_pairs(
    session_id, account_id, store_id, order_id, wb_qr, sgtin,
    product_snapshot, created_by, device_id
  ) values (
    v_session.id, v_session.account_id, v_session.store_id,
    v_session.pending_order_id, v_session.pending_wb_qr, v_sgtin,
    jsonb_build_object(
      'nm_id', v_order.nm_id,
      'article', v_order.article,
      'barcode', coalesce(v_order.skus->>0, ''),
      'supply_id', v_order.supply_id
    ), auth.uid(), p_device_id
  ) returning * into v_pair;

  update public.fbs_marking_sessions
  set status = 'active', pending_order_id = null, pending_wb_qr = null,
      pending_locked_until = null, last_seen_at = now(), updated_at = now()
  where id = v_session.id;
  return to_jsonb(v_pair);
exception
  when unique_violation then
    raise exception 'Этот заказ, QR WB или КИЗ уже был отсканирован';
end;
$$;

create or replace function public.release_fbs_marking_pending(
  p_session_id uuid,
  p_device_id text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.fbs_marking_sessions
  set pending_order_id = null, pending_wb_qr = null, pending_locked_until = null,
      last_seen_at = now(), updated_at = now()
  where id = p_session_id and created_by = auth.uid() and device_id = p_device_id
    and status in ('active', 'partial');
  if not found then raise exception 'Активная сессия устройства не найдена'; end if;
end;
$$;

create or replace function public.delete_fbs_marking_pair(
  p_pair_id uuid,
  p_device_id text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.fbs_marking_pairs pair
  using public.fbs_marking_sessions session
  where pair.id = p_pair_id and session.id = pair.session_id
    and session.created_by = auth.uid() and session.device_id = p_device_id
    and session.status in ('active', 'partial') and pair.status in ('draft', 'error');
  if not found then raise exception 'Можно удалить только неотправленную пару своего устройства'; end if;
end;
$$;

create or replace function public.recover_fbs_marking_session(
  p_target_session_id uuid,
  p_source_session_id uuid,
  p_device_id text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.fbs_marking_sessions%rowtype;
  v_source public.fbs_marking_sessions%rowtype;
  v_moved integer := 0;
begin
  -- Блокируем всегда в порядке UUID, чтобы два одновременных восстановления
  -- не могли создать взаимную блокировку.
  perform 1 from public.fbs_marking_sessions
  where id in (p_target_session_id, p_source_session_id)
  order by id for update;

  select * into v_target from public.fbs_marking_sessions where id = p_target_session_id;
  select * into v_source from public.fbs_marking_sessions where id = p_source_session_id;
  if v_target.id is null or v_target.created_by <> auth.uid() or v_target.device_id <> p_device_id
     or v_target.status not in ('active', 'partial') then
    raise exception 'Активная сессия текущего устройства не найдена';
  end if;
  if v_source.id is null or v_source.id = v_target.id
     or v_source.store_id <> v_target.store_id or v_source.account_id <> v_target.account_id
     or v_source.status not in ('active', 'partial') then
    raise exception 'Прерванная сессия не найдена';
  end if;
  if v_source.last_seen_at > now() - interval '2 minutes' then
    raise exception 'Другое устройство ещё активно';
  end if;
  if not exists (
    select 1 from public.account_members member
    where member.account_id = v_source.account_id and member.user_id = auth.uid()
  ) then raise exception 'Нет доступа к сессии'; end if;

  update public.fbs_marking_pairs
  set session_id = v_target.id, updated_at = now()
  where session_id = v_source.id and status in ('draft', 'error');
  get diagnostics v_moved = row_count;

  update public.fbs_marking_sessions
  set status = 'cancelled', pending_order_id = null, pending_wb_qr = null,
      pending_locked_until = null, completed_at = now(), updated_at = now()
  where id = v_source.id;
  update public.fbs_marking_sessions
  set last_seen_at = now(), updated_at = now()
  where id = v_target.id;
  return v_moved;
end;
$$;

revoke all on function public.start_fbs_marking_session(uuid, uuid, text, text) from public, anon;
revoke all on function public.touch_fbs_marking_session(uuid, text) from public, anon;
revoke all on function public.scan_fbs_wb_qr(uuid, text, text, text) from public, anon;
revoke all on function public.scan_fbs_kiz(uuid, text, text) from public, anon;
revoke all on function public.release_fbs_marking_pending(uuid, text) from public, anon;
revoke all on function public.delete_fbs_marking_pair(uuid, text) from public, anon;
revoke all on function public.recover_fbs_marking_session(uuid, uuid, text) from public, anon;
grant execute on function public.start_fbs_marking_session(uuid, uuid, text, text) to authenticated;
grant execute on function public.touch_fbs_marking_session(uuid, text) to authenticated;
grant execute on function public.scan_fbs_wb_qr(uuid, text, text, text) to authenticated;
grant execute on function public.scan_fbs_kiz(uuid, text, text) to authenticated;
grant execute on function public.release_fbs_marking_pending(uuid, text) to authenticated;
grant execute on function public.delete_fbs_marking_pair(uuid, text) to authenticated;
grant execute on function public.recover_fbs_marking_session(uuid, uuid, text) to authenticated;

-- Supabase Realtime используется только для синхронизации экранов. Если таблицы
-- уже добавлены в публикацию, duplicate_object безопасно игнорируется.
do $$
begin
  alter publication supabase_realtime add table public.fbs_marking_sessions;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.fbs_marking_pairs;
exception when duplicate_object then null;
end $$;
