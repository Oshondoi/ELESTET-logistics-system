alter table public.kiz_print_codes
  add column if not exists operation_id text not null default '';

alter table public.kiz_print_codes drop constraint if exists kiz_print_codes_pkey;

alter table public.kiz_print_codes
  add constraint kiz_print_codes_pkey primary key (store_id, operation_id, gtin, serial);

create index if not exists kiz_print_codes_store_operation_idx
  on public.kiz_print_codes (store_id, operation_id);

notify pgrst, 'reload schema';
