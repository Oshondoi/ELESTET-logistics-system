-- Persistent sticker-print defaults and links to current WB products.
alter table public.stores
  add column if not exists country text;

alter table public.sticker_templates
  add column if not exists seller_article text,
  add column if not exists store_id uuid references public.stores(id) on delete set null,
  add column if not exists product_id uuid references public.products(id) on delete set null,
  add column if not exists nm_id bigint;

create index if not exists sticker_templates_product_id_idx
  on public.sticker_templates(product_id);

create table if not exists public.sticker_print_settings (
  account_id uuid not null references public.accounts(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (account_id, store_id)
);

alter table public.sticker_print_settings enable row level security;
drop policy if exists "members_view_sticker_print_settings" on public.sticker_print_settings;
create policy "members_view_sticker_print_settings" on public.sticker_print_settings
for select using (exists (select 1 from public.account_members am where am.account_id = sticker_print_settings.account_id and am.user_id = auth.uid()));
drop policy if exists "members_manage_sticker_print_settings" on public.sticker_print_settings;
create policy "members_manage_sticker_print_settings" on public.sticker_print_settings
for all using (exists (select 1 from public.account_members am where am.account_id = sticker_print_settings.account_id and am.user_id = auth.uid() and am.role in ('owner','admin','manager','operator')))
with check (exists (select 1 from public.account_members am where am.account_id = sticker_print_settings.account_id and am.user_id = auth.uid() and am.role in ('owner','admin','manager','operator')));

create table if not exists public.sticker_product_print_overrides (
  account_id uuid not null references public.accounts(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  overrides jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (account_id, store_id, product_id)
);

alter table public.sticker_product_print_overrides enable row level security;
drop policy if exists "members_view_sticker_product_overrides" on public.sticker_product_print_overrides;
create policy "members_view_sticker_product_overrides" on public.sticker_product_print_overrides
for select using (exists (select 1 from public.account_members am where am.account_id = sticker_product_print_overrides.account_id and am.user_id = auth.uid()));
drop policy if exists "members_manage_sticker_product_overrides" on public.sticker_product_print_overrides;
create policy "members_manage_sticker_product_overrides" on public.sticker_product_print_overrides
for all using (exists (select 1 from public.account_members am where am.account_id = sticker_product_print_overrides.account_id and am.user_id = auth.uid() and am.role in ('owner','admin','manager','operator')))
with check (exists (select 1 from public.account_members am where am.account_id = sticker_product_print_overrides.account_id and am.user_id = auth.uid() and am.role in ('owner','admin','manager','operator')));
