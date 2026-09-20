-- Preserve the product-group extension used for every Teksher emission order.
-- The mapping is server-only (RLS has no client policies) and prevents a later
-- utilisation request from incorrectly falling back to the `lp` extension.

create table if not exists public.teksher_emission_operations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  operation_id text not null,
  gtin text not null,
  extension text not null,
  product_group_code text,
  product_group_name text,
  quantity integer not null check (quantity between 1 and 5000),
  created_by uuid references auth.users(id) on delete set null,
  response_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, operation_id)
);

alter table public.teksher_emission_operations enable row level security;

create index if not exists teksher_emission_operations_store_created_idx
  on public.teksher_emission_operations (store_id, created_at desc);

comment on table public.teksher_emission_operations is
  'Server-side mapping of Teksher emission operations to their product-group extension';
