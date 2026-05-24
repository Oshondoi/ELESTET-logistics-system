-- Separate WB acceptance operation cost from storage for accurate weekly summary parity
alter table public.wb_finance_report_rows
  add column if not exists acceptance_cost numeric not null default 0;
