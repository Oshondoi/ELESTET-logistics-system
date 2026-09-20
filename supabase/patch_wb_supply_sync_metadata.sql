-- WB FBW supply metadata cached on a logistics line.
-- ELESTET remains the source of truth for the planned contents; these fields
-- are the latest WB-side facts used for status display and reconciliation.

alter table public.trip_lines
  add column if not exists wb_status_id smallint,
  add column if not exists wb_created_at timestamptz,
  add column if not exists wb_updated_at timestamptz,
  add column if not exists wb_acceptance_coefficient numeric,
  add column if not exists wb_acceptance_cost numeric,
  add column if not exists wb_reject_reason text,
  add column if not exists wb_quantity integer,
  add column if not exists wb_ready_for_sale_quantity integer,
  add column if not exists wb_accepted_quantity integer,
  add column if not exists wb_unloading_quantity integer,
  add column if not exists wb_depersonalized_quantity integer,
  add column if not exists wb_warehouse_id bigint,
  add column if not exists wb_warehouse_name text,
  add column if not exists wb_actual_warehouse_id bigint,
  add column if not exists wb_actual_warehouse_name text,
  add column if not exists wb_transit_warehouse_id bigint,
  add column if not exists wb_transit_warehouse_name text,
  add column if not exists wb_goods_snapshot jsonb not null default '[]'::jsonb,
  add column if not exists wb_packages_snapshot jsonb not null default '[]'::jsonb,
  add column if not exists wb_synced_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'trip_lines_wb_status_id_check'
      and conrelid = 'public.trip_lines'::regclass
  ) then
    alter table public.trip_lines
      add constraint trip_lines_wb_status_id_check
      check (wb_status_id is null or wb_status_id between 1 and 6);
  end if;
end $$;

comment on column public.trip_lines.wb_status_id is 'Latest FBW supply statusID returned by Wildberries';
comment on column public.trip_lines.wb_created_at is 'WB FBW supply createDate';
comment on column public.trip_lines.wb_acceptance_coefficient is 'WB paidAcceptanceCoefficient captured at the last sync';
comment on column public.trip_lines.wb_goods_snapshot is 'Latest WB goods response for later ELESTET-vs-WB reconciliation';
comment on column public.trip_lines.wb_packages_snapshot is 'Latest WB package response for later box reconciliation';
comment on column public.trip_lines.wb_synced_at is 'Timestamp of the latest successful WB details synchronization';
