create table if not exists public.wb_finance_weekly_reports (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  report_id bigint not null,
  legal_entity text,
  period_from date,
  period_to date,
  report_date date,
  report_type text,
  sale_amount numeric not null default 0,
  loyalty_compensation numeric not null default 0,
  for_pay numeric not null default 0,
  logistics_cost numeric not null default 0,
  storage_cost numeric not null default 0,
  acceptance_cost numeric not null default 0,
  other_amount numeric not null default 0,
  penalties numeric not null default 0,
  to_pay numeric not null default 0,
  currency_name text,
  rows_count integer not null default 0,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  unique (store_id, report_id)
);

create index if not exists wb_fin_weekly_reports_account_store_idx
  on public.wb_finance_weekly_reports(account_id, store_id, report_date desc, report_id desc);

create table if not exists public.wb_finance_weekly_report_rows (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  report_id bigint not null,
  row_number integer not null,
  op_uid text not null,
  realizationreport_id bigint,
  gi_id bigint,
  subject_name text,
  nm_id bigint,
  brand_name text,
  sa_name text,
  ts_name text,
  barcode text,
  doc_type_name text,
  quantity numeric,
  retail_price numeric,
  retail_amount numeric,
  sale_percent numeric,
  commission_percent numeric,
  office_name text,
  supplier_oper_name text,
  order_dt timestamptz,
  sale_dt timestamptz,
  rr_dt timestamptz,
  shk_id text,
  retail_price_withdisc_rub numeric,
  delivery_amount numeric,
  return_amount numeric,
  delivery_rub numeric,
  gi_box_type_name text,
  product_discount_for_report numeric,
  supplier_promo numeric,
  srid text,
  ppvz_spp_prc numeric,
  ppvz_kvw_prc_base numeric,
  ppvz_kvw_prc numeric,
  ppvz_for_pay numeric,
  ppvz_reward numeric,
  acquiring_fee numeric,
  acquiring_bank text,
  ppvz_vw numeric,
  ppvz_vw_nds numeric,
  ppvz_office_id bigint,
  ppvz_office_name text,
  ppvz_supplier_id bigint,
  ppvz_supplier_name text,
  ppvz_inn text,
  declaration_number text,
  sticker_id text,
  site_country text,
  penalty numeric,
  additional_payment numeric,
  rebill_logistic_cost numeric,
  storage_fee numeric,
  deduction numeric,
  acceptance numeric,
  currency_name text,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  unique (store_id, op_uid)
);

create index if not exists wb_fin_weekly_rows_account_store_report_idx
  on public.wb_finance_weekly_report_rows(account_id, store_id, report_id, row_number);

alter table public.wb_finance_weekly_reports enable row level security;
alter table public.wb_finance_weekly_report_rows enable row level security;

drop policy if exists "wb_fin_weekly_reports_member_all" on public.wb_finance_weekly_reports;
create policy "wb_fin_weekly_reports_member_all"
  on public.wb_finance_weekly_reports for all
  using (
    account_id in (
      select account_id from public.account_members where user_id = auth.uid()
    )
  );

drop policy if exists "wb_fin_weekly_rows_member_all" on public.wb_finance_weekly_report_rows;
create policy "wb_fin_weekly_rows_member_all"
  on public.wb_finance_weekly_report_rows for all
  using (
    account_id in (
      select account_id from public.account_members where user_id = auth.uid()
    )
  );
