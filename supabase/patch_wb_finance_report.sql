-- WB finance rows (reportDetailByPeriod) cached in Supabase
create table if not exists public.wb_finance_report_rows (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  period_from date not null,
  period_to date not null,
  report_date date,
  nm_id bigint,
  barcode text,
  vendor_code text,
  operation_name text,
  quantity numeric not null default 0,
  retail_amount numeric not null default 0,
  for_pay numeric not null default 0,
  commission numeric not null default 0,
  logistics_cost numeric not null default 0,
  storage_cost numeric not null default 0,
  penalties numeric not null default 0,
  deduction numeric not null default 0,
  op_uid text not null,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  unique (store_id, op_uid)
);

create index if not exists wb_fin_rows_account_store_date_idx
  on public.wb_finance_report_rows(account_id, store_id, report_date);

create index if not exists wb_fin_rows_store_nm_idx
  on public.wb_finance_report_rows(store_id, nm_id);

alter table public.wb_finance_report_rows enable row level security;

drop policy if exists "wb_finance_rows_member_all" on public.wb_finance_report_rows;
create policy "wb_finance_rows_member_all"
  on public.wb_finance_report_rows for all
  using (
    account_id in (
      select account_id from public.account_members where user_id = auth.uid()
    )
  );
