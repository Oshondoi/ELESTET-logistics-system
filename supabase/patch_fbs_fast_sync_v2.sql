-- FBS fast sync v2 is installed disabled. Stores stay on the legacy path until
-- the owner explicitly enables the flag for a single store.

begin;

create table if not exists public.fbs_sync_settings (
  store_id uuid primary key references public.stores(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  fast_sync_v2_enabled boolean not null default false,
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.fbs_sync_settings enable row level security;
grant select on public.fbs_sync_settings to authenticated;

drop policy if exists "fbs_sync_settings: available stores" on public.fbs_sync_settings;
create policy "fbs_sync_settings: available stores"
  on public.fbs_sync_settings for select
  using (public.fbs_can_access_store(store_id, 'fbs_view'));

create or replace function public.set_fbs_fast_sync_v2(
  p_store_id uuid,
  p_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
begin
  if not exists (
    select 1 from public.profiles profile
    where profile.user_id = auth.uid() and profile.platform_role = 'superadmin'
  ) then raise exception 'Доступно только владельцу сервиса'; end if;

  select store.account_id into v_account_id
  from public.stores store where store.id = p_store_id;
  if v_account_id is null then raise exception 'Магазин не найден'; end if;

  insert into public.fbs_sync_settings (
    store_id, account_id, fast_sync_v2_enabled, updated_at, updated_by
  ) values (
    p_store_id, v_account_id, coalesce(p_enabled, false), timezone('utc', now()), auth.uid()
  )
  on conflict (store_id) do update set
    account_id = excluded.account_id,
    fast_sync_v2_enabled = excluded.fast_sync_v2_enabled,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;

  return coalesce(p_enabled, false);
end;
$$;

revoke all on function public.set_fbs_fast_sync_v2(uuid, boolean) from public, anon;
grant execute on function public.set_fbs_fast_sync_v2(uuid, boolean) to authenticated;

-- Separate lanes keep a quick order check independent from supply/full work.
create table if not exists public.fbs_fast_sync_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  lane text not null check (lane in ('orders', 'supplies')),
  trigger_source text not null check (trigger_source in ('manual', 'automatic')),
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  result jsonb not null default '{}'::jsonb,
  error text,
  requested_by uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists fbs_fast_sync_runs_one_active_lane_idx
  on public.fbs_fast_sync_runs(store_id, lane) where status = 'running';
create index if not exists fbs_fast_sync_runs_store_started_idx
  on public.fbs_fast_sync_runs(store_id, lane, started_at desc);

alter table public.fbs_fast_sync_runs enable row level security;
grant select on public.fbs_fast_sync_runs to authenticated;

drop policy if exists "fbs_fast_sync_runs: available stores" on public.fbs_fast_sync_runs;
create policy "fbs_fast_sync_runs: available stores"
  on public.fbs_fast_sync_runs for select
  using (public.fbs_can_access_store(store_id, 'fbs_view'));

create or replace function public.acquire_fbs_fast_sync_lane(
  p_store_id uuid,
  p_lane text,
  p_trigger_source text,
  p_requested_by uuid default null
)
returns table (run_id uuid, acquired boolean, last_completed_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_run_id uuid;
  v_last_completed timestamptz;
  v_min_interval interval;
begin
  if p_lane not in ('orders', 'supplies') then raise exception 'Некорректный контур синхронизации'; end if;
  if p_trigger_source not in ('manual', 'automatic') then raise exception 'Некорректный источник синхронизации'; end if;
  select store.account_id into v_account_id from public.stores store where store.id = p_store_id;
  if v_account_id is null then raise exception 'Магазин не найден'; end if;

  delete from public.fbs_fast_sync_runs
  where store_id = p_store_id and lane = p_lane and status <> 'running'
    and finished_at < timezone('utc', now()) - interval '30 days';

  -- A dead Edge invocation cannot block a store indefinitely.
  update public.fbs_fast_sync_runs
  set status = 'failed', error = coalesce(error, 'Задача не завершилась вовремя'),
      finished_at = timezone('utc', now()), updated_at = timezone('utc', now())
  where store_id = p_store_id and lane = p_lane and status = 'running'
    and updated_at < timezone('utc', now()) - interval '2 minutes';

  select run.id into v_run_id
  from public.fbs_fast_sync_runs run
  where run.store_id = p_store_id and run.lane = p_lane and run.status = 'running'
  order by run.started_at desc limit 1;
  if v_run_id is not null then
    return query select v_run_id, false, null::timestamptz;
    return;
  end if;

  select max(run.finished_at) into v_last_completed
  from public.fbs_fast_sync_runs run
  where run.store_id = p_store_id and run.lane = p_lane and run.status = 'completed';

  v_min_interval := case when p_lane = 'orders' then interval '20 seconds' else interval '45 seconds' end;
  if p_trigger_source = 'automatic' and v_last_completed is not null
     and v_last_completed > timezone('utc', now()) - v_min_interval then
    return query select null::uuid, false, v_last_completed;
    return;
  end if;

  begin
    insert into public.fbs_fast_sync_runs (
      account_id, store_id, lane, trigger_source, status, requested_by
    ) values (
      v_account_id, p_store_id, p_lane, p_trigger_source, 'running', p_requested_by
    ) returning id into v_run_id;
  exception when unique_violation then
    select run.id into v_run_id
    from public.fbs_fast_sync_runs run
    where run.store_id = p_store_id and run.lane = p_lane and run.status = 'running'
    order by run.started_at desc limit 1;
    return query select v_run_id, false, v_last_completed;
    return;
  end;

  return query select v_run_id, true, v_last_completed;
end;
$$;

revoke all on function public.acquire_fbs_fast_sync_lane(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.acquire_fbs_fast_sync_lane(uuid, text, text, uuid) to service_role;

create or replace function public.finish_fbs_fast_sync_lane(
  p_run_id uuid,
  p_status text,
  p_result jsonb default '{}'::jsonb,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('completed', 'failed') then raise exception 'Некорректный итог синхронизации'; end if;
  update public.fbs_fast_sync_runs
  set status = p_status, result = coalesce(p_result, '{}'::jsonb), error = nullif(p_error, ''),
      finished_at = timezone('utc', now()), updated_at = timezone('utc', now())
  where id = p_run_id and status = 'running';
end;
$$;

revoke all on function public.finish_fbs_fast_sync_lane(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.finish_fbs_fast_sync_lane(uuid, text, jsonb, text) to service_role;

-- A successful WB command is reflected immediately and protected from an old
-- eventually-consistent WB response until a later sync confirms it.
create table if not exists public.fbs_pending_transitions (
  store_id uuid not null references public.stores(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  wb_order_id text not null,
  transition text not null check (transition in ('assemble', 'deliver')),
  target_supply_id text not null,
  status_confirmed boolean not null default false,
  membership_confirmed boolean not null default false,
  supply_confirmed boolean not null default false,
  requested_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null default timezone('utc', now()) + interval '10 minutes',
  primary key (store_id, wb_order_id)
);

create index if not exists fbs_pending_transitions_expiry_idx
  on public.fbs_pending_transitions(expires_at);
alter table public.fbs_pending_transitions enable row level security;
grant select on public.fbs_pending_transitions to authenticated;

drop policy if exists "fbs_pending_transitions: available stores" on public.fbs_pending_transitions;
create policy "fbs_pending_transitions: available stores"
  on public.fbs_pending_transitions for select
  using (public.fbs_can_access_store(store_id, 'fbs_view'));

create or replace function public.record_fbs_supply_created_v2(
  p_store_id uuid,
  p_supply_id text,
  p_name text,
  p_raw_data jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_now timestamptz := timezone('utc', now());
begin
  select store.account_id into v_account_id from public.stores store where store.id = p_store_id;
  if v_account_id is null or nullif(trim(p_supply_id), '') is null then raise exception 'Поставка не определена'; end if;
  insert into public.fbs_supplies (
    account_id, store_id, wb_supply_id, name, done, raw_data, first_seen_at, last_synced_at
  ) values (
    v_account_id, p_store_id, p_supply_id, nullif(trim(p_name), ''), false,
    coalesce(p_raw_data, '{}'::jsonb), v_now, v_now
  )
  on conflict (store_id, wb_supply_id) do update set
    name = coalesce(excluded.name, public.fbs_supplies.name),
    raw_data = case when excluded.raw_data = '{}'::jsonb then public.fbs_supplies.raw_data else excluded.raw_data end,
    last_synced_at = greatest(public.fbs_supplies.last_synced_at, excluded.last_synced_at);
end;
$$;

revoke all on function public.record_fbs_supply_created_v2(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_fbs_supply_created_v2(uuid, text, text, jsonb) to service_role;

create or replace function public.record_fbs_order_added_to_supply_v2(
  p_store_id uuid,
  p_order_id text,
  p_supply_id text,
  p_requested_by uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_now timestamptz := timezone('utc', now());
  v_updated integer;
begin
  select store.account_id into v_account_id from public.stores store where store.id = p_store_id;
  if v_account_id is null then raise exception 'Магазин не найден'; end if;

  insert into public.fbs_supplies (
    account_id, store_id, wb_supply_id, name, done, raw_data, first_seen_at, last_synced_at
  ) values (v_account_id, p_store_id, p_supply_id, p_supply_id, false, '{}'::jsonb, v_now, v_now)
  on conflict (store_id, wb_supply_id) do nothing;

  insert into public.fbs_pending_transitions (
    store_id, account_id, wb_order_id, transition, target_supply_id,
    requested_by, created_at, expires_at
  ) values (
    p_store_id, v_account_id, p_order_id, 'assemble', p_supply_id,
    p_requested_by, v_now, v_now + interval '10 minutes'
  )
  on conflict (store_id, wb_order_id) do update set
    account_id = excluded.account_id, transition = excluded.transition,
    target_supply_id = excluded.target_supply_id, status_confirmed = false,
    membership_confirmed = false, supply_confirmed = false,
    requested_by = excluded.requested_by, created_at = excluded.created_at,
    expires_at = excluded.expires_at;

  update public.fbs_supply_orders
  set is_current = false, last_seen_at = v_now
  where store_id = p_store_id and wb_order_id = p_order_id and is_current;

  insert into public.fbs_supply_orders (
    account_id, store_id, wb_supply_id, wb_order_id, is_current, first_seen_at, last_seen_at
  ) values (
    v_account_id, p_store_id, p_supply_id, p_order_id, true, v_now, v_now
  )
  on conflict (store_id, wb_supply_id, wb_order_id) do update set
    account_id = excluded.account_id, is_current = true, last_seen_at = excluded.last_seen_at;

  update public.fbs_orders
  set supplier_status = 'confirm', wb_status = 'confirm', wb_system_status = 'waiting',
      supply_id = p_supply_id, is_in_latest_snapshot = true,
      synced_at = v_now, status_synced_at = v_now
  where store_id = p_store_id and wb_order_id = p_order_id;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then raise exception 'Заказ не найден в локальном снимке'; end if;
end;
$$;

revoke all on function public.record_fbs_order_added_to_supply_v2(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.record_fbs_order_added_to_supply_v2(uuid, text, text, uuid) to service_role;

-- Keep newer/local transition values when an older sync finishes later.
create or replace function public.protect_fbs_order_transition_v2()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pending public.fbs_pending_transitions%rowtype;
begin
  if old.status_synced_at is not null and new.status_synced_at is not null
     and new.status_synced_at < old.status_synced_at then
    new.wb_status := old.wb_status;
    new.supplier_status := old.supplier_status;
    new.wb_system_status := old.wb_system_status;
    new.supply_id := old.supply_id;
    new.status_synced_at := old.status_synced_at;
    new.synced_at := greatest(old.synced_at, new.synced_at);
  end if;

  -- Membership syncs only change supply_id and synced_at. If an older request
  -- finishes after a local command, greatest(...) leaves synced_at unchanged;
  -- in that case the older membership must not move the order backwards.
  if new.supply_id is distinct from old.supply_id
     and old.synced_at is not null and new.synced_at <= old.synced_at then
    new.supply_id := old.supply_id;
    new.synced_at := old.synced_at;
  end if;

  select pending.* into v_pending
  from public.fbs_pending_transitions pending
  where pending.store_id = new.store_id and pending.wb_order_id = new.wb_order_id
    and pending.expires_at > timezone('utc', now());

  if found and v_pending.transition = 'assemble' then
    new.supply_id := v_pending.target_supply_id;
    if coalesce(new.supplier_status, 'new') = 'new' then
      new.supplier_status := case when old.supplier_status in ('confirm', 'complete') then old.supplier_status else 'confirm' end;
      new.wb_status := new.supplier_status;
      new.wb_system_status := coalesce(old.wb_system_status, 'waiting');
      new.status_synced_at := old.status_synced_at;
    end if;
  elsif found and v_pending.transition = 'deliver' then
    new.supply_id := v_pending.target_supply_id;
    if coalesce(new.supplier_status, '') <> 'complete' then
      new.supplier_status := 'complete';
      new.wb_status := 'complete';
      new.status_synced_at := old.status_synced_at;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_fbs_order_transition_v2 on public.fbs_orders;
create trigger protect_fbs_order_transition_v2
before update on public.fbs_orders
for each row execute function public.protect_fbs_order_transition_v2();

create or replace function public.protect_fbs_supply_transition_v2()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.last_synced_at is not null and new.last_synced_at < old.last_synced_at then
    new.name := old.name;
    new.done := old.done;
    new.wb_created_at := old.wb_created_at;
    new.wb_closed_at := old.wb_closed_at;
    new.wb_scan_at := old.wb_scan_at;
    new.destination_office_id := old.destination_office_id;
    new.cargo_type := old.cargo_type;
    new.cross_border_type := old.cross_border_type;
    new.is_b2b := old.is_b2b;
    new.raw_data := old.raw_data;
    new.last_synced_at := old.last_synced_at;
  end if;
  if exists (
    select 1 from public.fbs_pending_transitions pending
    where pending.store_id = new.store_id and pending.target_supply_id = new.wb_supply_id
      and pending.transition = 'deliver' and pending.expires_at > timezone('utc', now())
  ) then
    new.done := true;
    new.wb_closed_at := coalesce(new.wb_closed_at, old.wb_closed_at, timezone('utc', now()));
  end if;
  return new;
end;
$$;

drop trigger if exists protect_fbs_supply_transition_v2 on public.fbs_supplies;
create trigger protect_fbs_supply_transition_v2
before update on public.fbs_supplies
for each row execute function public.protect_fbs_supply_transition_v2();

create or replace function public.mark_fbs_supply_dispatched_v2(
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
  v_account_id uuid;
  v_now timestamptz := timezone('utc', now());
begin
  v_count := public.mark_fbs_supply_dispatched(p_store_id, p_supply_id);
  select store.account_id into v_account_id from public.stores store where store.id = p_store_id;

  insert into public.fbs_pending_transitions (
    store_id, account_id, wb_order_id, transition, target_supply_id,
    requested_by, created_at, expires_at
  )
  select p_store_id, v_account_id, order_row.wb_order_id, 'deliver', p_supply_id,
         auth.uid(), v_now, v_now + interval '10 minutes'
  from public.fbs_orders order_row
  where order_row.store_id = p_store_id and order_row.supply_id = p_supply_id
  on conflict (store_id, wb_order_id) do update set
    account_id = excluded.account_id, transition = excluded.transition,
    target_supply_id = excluded.target_supply_id, status_confirmed = false,
    membership_confirmed = false, supply_confirmed = false,
    requested_by = excluded.requested_by, created_at = excluded.created_at,
    expires_at = excluded.expires_at;

  update public.fbs_orders
  set supplier_status = 'complete', wb_status = 'complete', synced_at = v_now, status_synced_at = v_now
  where store_id = p_store_id and supply_id = p_supply_id;
  update public.fbs_supplies
  set done = true, wb_closed_at = coalesce(wb_closed_at, v_now), last_synced_at = v_now
  where store_id = p_store_id and wb_supply_id = p_supply_id;
  return v_count;
end;
$$;

revoke all on function public.mark_fbs_supply_dispatched_v2(uuid, text) from public, anon;
grant execute on function public.mark_fbs_supply_dispatched_v2(uuid, text) to authenticated;

create or replace function public.reconcile_fbs_pending_transitions_v2(
  p_store_id uuid,
  p_statuses jsonb default '[]'::jsonb,
  p_memberships jsonb default '[]'::jsonb,
  p_closed_supply_ids text[] default array[]::text[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  update public.fbs_pending_transitions pending
  set status_confirmed = true
  from jsonb_to_recordset(coalesce(p_statuses, '[]'::jsonb)) as status_row(
    wb_order_id text, supplier_status text, wb_system_status text
  )
  where pending.store_id = p_store_id and pending.wb_order_id = status_row.wb_order_id
    and ((pending.transition = 'assemble' and status_row.supplier_status in ('confirm', 'complete'))
      or (pending.transition = 'deliver' and status_row.supplier_status = 'complete'));

  update public.fbs_pending_transitions pending
  set membership_confirmed = true
  from jsonb_to_recordset(coalesce(p_memberships, '[]'::jsonb)) as membership_row(
    wb_supply_id text, wb_order_id text
  )
  where pending.store_id = p_store_id and pending.transition = 'assemble'
    and pending.wb_order_id = membership_row.wb_order_id
    and pending.target_supply_id = membership_row.wb_supply_id;

  update public.fbs_pending_transitions pending
  set supply_confirmed = true
  where pending.store_id = p_store_id and pending.transition = 'deliver'
    and pending.target_supply_id = any(coalesce(p_closed_supply_ids, array[]::text[]));

  delete from public.fbs_pending_transitions pending
  where pending.store_id = p_store_id
    and (pending.expires_at <= timezone('utc', now())
      or (pending.transition = 'assemble' and pending.status_confirmed and pending.membership_confirmed)
      or (pending.transition = 'deliver' and pending.status_confirmed and pending.supply_confirmed));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.reconcile_fbs_pending_transitions_v2(uuid, jsonb, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.reconcile_fbs_pending_transitions_v2(uuid, jsonb, jsonb, text[]) to service_role;

commit;
