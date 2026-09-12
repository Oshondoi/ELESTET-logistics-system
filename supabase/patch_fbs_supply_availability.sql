-- Keep historical FBS supply rows, but never offer a supply that WB no longer
-- returns as an active supply. Deleting the row would also delete its timeline.

alter table public.fbs_supplies
  add column if not exists available_on_wb boolean not null default true,
  add column if not exists unavailable_since timestamptz;

create index if not exists fbs_supplies_available_open_idx
  on public.fbs_supplies (store_id, wb_created_at desc)
  where done = false and available_on_wb = true;

create or replace function public.reconcile_fbs_open_supply_catalog(
  p_store_id uuid,
  p_account_id uuid,
  p_seen_open_supply_ids text[],
  p_synced_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restored integer := 0;
  v_missing integer := 0;
  v_memberships integer := 0;
  v_attempts integer := 0;
begin
  if not exists (
    select 1
    from public.stores store_row
    where store_row.id = p_store_id
      and store_row.account_id = p_account_id
  ) then
    raise exception 'Магазин не принадлежит компании';
  end if;

  update public.fbs_supplies supply_row
  set available_on_wb = true,
      unavailable_since = null
  where supply_row.store_id = p_store_id
    and supply_row.account_id = p_account_id
    and not supply_row.done
    and supply_row.wb_supply_id = any(coalesce(p_seen_open_supply_ids, array[]::text[]))
    and (not supply_row.available_on_wb or supply_row.unavailable_since is not null);
  get diagnostics v_restored = row_count;

  with missing as (
    update public.fbs_supplies supply_row
    set available_on_wb = false,
        unavailable_since = coalesce(supply_row.unavailable_since, p_synced_at)
    where supply_row.store_id = p_store_id
      and supply_row.account_id = p_account_id
      and not supply_row.done
      and supply_row.available_on_wb
      and not (supply_row.wb_supply_id = any(coalesce(p_seen_open_supply_ids, array[]::text[])))
    returning supply_row.wb_supply_id
  )
  select count(*) into v_missing from missing;

  update public.fbs_supply_orders membership
  set is_current = false,
      last_seen_at = p_synced_at
  where membership.store_id = p_store_id
    and membership.is_current
    and exists (
      select 1
      from public.fbs_supplies supply_row
      where supply_row.store_id = p_store_id
        and supply_row.wb_supply_id = membership.wb_supply_id
        and not supply_row.done
        and not supply_row.available_on_wb
    );
  get diagnostics v_memberships = row_count;

  update public.fbs_dispatch_attempts attempt
  set is_current_membership = false,
      updated_at = p_synced_at
  where attempt.store_id = p_store_id
    and attempt.is_current_membership
    and exists (
      select 1
      from public.fbs_supplies supply_row
      where supply_row.store_id = p_store_id
        and supply_row.wb_supply_id = attempt.wb_supply_id
        and not supply_row.done
        and not supply_row.available_on_wb
    );
  get diagnostics v_attempts = row_count;

  return jsonb_build_object(
    'restored', v_restored,
    'missing', v_missing,
    'memberships_cleared', v_memberships,
    'attempts_cleared', v_attempts
  );
end;
$$;

revoke all on function public.reconcile_fbs_open_supply_catalog(uuid, uuid, text[], timestamptz)
  from public, anon, authenticated;
grant execute on function public.reconcile_fbs_open_supply_catalog(uuid, uuid, text[], timestamptz)
  to service_role;

create or replace function public.mark_fbs_supply_unavailable(
  p_store_id uuid,
  p_account_id uuid,
  p_supply_id text,
  p_observed_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.stores store_row
    where store_row.id = p_store_id
      and store_row.account_id = p_account_id
  ) then
    raise exception 'Магазин не принадлежит компании';
  end if;

  update public.fbs_supplies
  set available_on_wb = false,
      unavailable_since = coalesce(unavailable_since, p_observed_at)
  where store_id = p_store_id
    and account_id = p_account_id
    and wb_supply_id = p_supply_id
    and not done;

  update public.fbs_supply_orders
  set is_current = false,
      last_seen_at = p_observed_at
  where store_id = p_store_id
    and wb_supply_id = p_supply_id
    and is_current;

  update public.fbs_dispatch_attempts
  set is_current_membership = false,
      updated_at = p_observed_at
  where store_id = p_store_id
    and wb_supply_id = p_supply_id
    and is_current_membership;
end;
$$;

revoke all on function public.mark_fbs_supply_unavailable(uuid, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.mark_fbs_supply_unavailable(uuid, uuid, text, timestamptz)
  to service_role;

