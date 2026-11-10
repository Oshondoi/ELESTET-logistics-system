-- Full marking codes saved from a Teksher print file.
-- The list API only has the short identity. Printing reads this copy.
create table if not exists public.kiz_print_codes (
  store_id uuid not null references public.stores(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  gtin text not null,
  serial text not null,
  code text not null,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (store_id, gtin, serial)
);

alter table public.kiz_print_codes enable row level security;

drop policy if exists "members_view_kiz_print_codes" on public.kiz_print_codes;
create policy "members_view_kiz_print_codes" on public.kiz_print_codes
for select using (
  exists (
    select 1 from public.account_members am
    where am.account_id = kiz_print_codes.account_id
      and am.user_id = auth.uid()
  )
);

drop policy if exists "members_manage_kiz_print_codes" on public.kiz_print_codes;
create policy "members_manage_kiz_print_codes" on public.kiz_print_codes
for all using (
  exists (
    select 1 from public.account_members am
    where am.account_id = kiz_print_codes.account_id
      and am.user_id = auth.uid()
      and am.role in ('owner', 'admin', 'manager', 'operator')
  )
)
with check (
  exists (
    select 1 from public.account_members am
    where am.account_id = kiz_print_codes.account_id
      and am.user_id = auth.uid()
      and am.role in ('owner', 'admin', 'manager', 'operator')
  )
);

create index if not exists kiz_print_codes_store_serial_idx
  on public.kiz_print_codes (store_id, serial);
