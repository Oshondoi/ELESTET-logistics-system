-- Keep fbs_orders.supply_id aligned with the authoritative composition of every
-- supply whose order list was successfully returned by WB during quick/full sync.
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

  -- A successfully loaded supply no longer containing an order is authoritative:
  -- clear the old link before applying its current membership list.
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

-- When a child order first reaches an accepted WB status, prefer the already
-- stored official supply scanDt over the later moment when we noticed status.
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

-- Repair already saved rows immediately; users should not have to wait for the
-- next nightly full pass before the growing timer becomes a fixed duration.
update public.fbs_dispatch_attempts attempt
set accepted_at = supply.wb_scan_at,
    acceptance_source = 'wb_scan_dt',
    acceptance_is_estimated = false,
    updated_at = timezone('utc', now())
from public.fbs_supplies supply
join public.fbs_orders order_row
  on order_row.store_id = supply.store_id
where attempt.store_id = supply.store_id
  and attempt.wb_supply_id = supply.wb_supply_id
  and order_row.wb_order_id = attempt.wb_order_id
  and supply.wb_scan_at is not null
  and coalesce(order_row.supplier_status, '') = 'complete'
  and coalesce(order_row.wb_system_status, '') in (
    'sorted', 'accepted_by_carrier', 'sent_to_carrier',
    'ready_for_pickup', 'postponed_delivery', 'sold',
    'canceled_by_client', 'defect'
  )
  and (
    attempt.accepted_at is distinct from supply.wb_scan_at
    or attempt.acceptance_source is distinct from 'wb_scan_dt'
    or attempt.acceptance_is_estimated
  );

notify pgrst, 'reload schema';
