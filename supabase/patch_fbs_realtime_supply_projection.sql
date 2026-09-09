-- Make confirmed WB supply changes visible to every open ELESTET session at
-- once while keeping genuinely older reconciliation runs from moving orders
-- backwards.

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

  -- Equal timestamps are two phases of one sync run. Only a strictly older
  -- membership observation is stale.
  if new.supply_id is distinct from old.supply_id
     and old.synced_at is not null and new.synced_at < old.synced_at then
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
      synced_at = p_synced_at
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
      synced_at = p_synced_at
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
