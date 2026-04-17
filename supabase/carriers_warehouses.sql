-- Таблица перевозчиков, привязанных к аккаунту
create table if not exists public.carriers (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete restrict,
  name text not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (account_id, name)
);

create index if not exists carriers_account_id_idx on public.carriers (account_id);

-- Таблица складов назначения, привязанных к аккаунту
create table if not exists public.warehouses (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete restrict,
  name text not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (account_id, name)
);

create index if not exists warehouses_account_id_idx on public.warehouses (account_id);

-- RLS
alter table public.carriers enable row level security;
alter table public.warehouses enable row level security;

-- Просмотр: любой член аккаунта
create policy "members_can_view_carriers"
on public.carriers
for select
using (
  exists (
    select 1
    from public.account_members am
    where am.account_id = carriers.account_id
      and am.user_id = auth.uid()
  )
);

-- Управление (создание, изменение, удаление): owner / admin / manager / operator
create policy "members_manage_carriers"
on public.carriers
for all
using (
  exists (
    select 1
    from public.account_members am
    where am.account_id = carriers.account_id
      and am.user_id = auth.uid()
      and am.role in ('owner', 'admin', 'manager', 'operator')
  )
)
with check (
  exists (
    select 1
    from public.account_members am
    where am.account_id = carriers.account_id
      and am.user_id = auth.uid()
      and am.role in ('owner', 'admin', 'manager', 'operator')
  )
);

-- Просмотр: любой член аккаунта
create policy "members_can_view_warehouses"
on public.warehouses
for select
using (
  exists (
    select 1
    from public.account_members am
    where am.account_id = warehouses.account_id
      and am.user_id = auth.uid()
  )
);

-- Управление: owner / admin / manager / operator
create policy "members_manage_warehouses"
on public.warehouses
for all
using (
  exists (
    select 1
    from public.account_members am
    where am.account_id = warehouses.account_id
      and am.user_id = auth.uid()
      and am.role in ('owner', 'admin', 'manager', 'operator')
  )
)
with check (
  exists (
    select 1
    from public.account_members am
    where am.account_id = warehouses.account_id
      and am.user_id = auth.uid()
      and am.role in ('owner', 'admin', 'manager', 'operator')
  )
);
