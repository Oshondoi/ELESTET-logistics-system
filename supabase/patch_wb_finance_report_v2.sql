-- v2: separate additional_payment from deduction; add doc_type for operation filtering
alter table public.wb_finance_report_rows
  add column if not exists additional_payment numeric not null default 0,
  add column if not exists doc_type text;

-- Back-fill: move any previously merged additional_payment out of deduction
-- (existing rows had deduction = raw_deduction + raw_additional_payment, we can't
-- un-mix them retrospectively — clear all rows for re-sync after applying this patch)
delete from public.wb_finance_report_rows;
