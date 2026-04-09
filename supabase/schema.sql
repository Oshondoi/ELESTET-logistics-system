create extension if not exists pgcrypto;

create or replace function public.generate_store_code()
returns text
language plpgsql
as $$
declare
  generated_code text;
begin
  loop
    generated_code :=
      chr(65 + floor(random() * 26)::int) ||
      lpad((floor(random() * 10000)::int)::text, 4, '0');

    exit when not exists (
      select 1
      from public.stores
      where store_code = generated_code
    );
  end loop;

  return generated_code;
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function public.handle_arrival_date()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'Прибыл' and new.arrival_date is null then
    new.arrival_date = current_date;
  end if;

  return new;
end;
$$;

create or replace function public.set_store_defaults()
returns trigger
language plpgsql
as $$
begin
  if new.store_code is null or btrim(new.store_code) = '' then
    new.store_code = public.generate_store_code();
  end if;

  new.store_code = upper(new.store_code);
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  full_name text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.account_members (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  role text not null check (role in ('owner', 'admin', 'manager', 'operator', 'viewer')),
  created_at timestamptz not null default timezone('utc', now()),
  unique (account_id, user_id)
);

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete restrict,
  store_code text not null,
  name text not null,
  marketplace text not null default 'Wildberries',
  created_at timestamptz not null default timezone('utc', now()),
  constraint stores_store_code_format check (store_code ~ '^[A-Z][0-9]{4}$')
);

create unique index if not exists stores_store_code_key on public.stores (store_code);
create index if not exists stores_account_id_idx on public.stores (account_id);

create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete restrict,
  store_id uuid not null references public.stores (id) on delete restrict,
  tracking_number integer not null,
  tracking_code text generated always as ('TRK-' || tracking_number::text) stored,
  carrier text not null,
  destination_warehouse text not null,
  box_qty integer not null default 0 check (box_qty >= 0),
  units_qty integer not null default 0 check (units_qty >= 0),
  units_total integer not null default 0 check (units_total >= 0),
  arrived_box_qty integer not null default 0 check (arrived_box_qty >= 0),
  planned_marketplace_delivery_date date,
  arrival_date date,
  status text not null check (status in ('Ожидает отправки', 'В пути', 'Прибыл', 'Отгружен')),
  payment_status text not null check (payment_status in ('Не оплачено', 'Частично оплачено', 'Оплачено')),
  comment text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (store_id, tracking_number)
);

create index if not exists shipments_account_id_idx on public.shipments (account_id);
create index if not exists shipments_store_id_idx on public.shipments (store_id);
create index if not exists shipments_status_idx on public.shipments (status);

create table if not exists public.shipment_status_history (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments (id) on delete restrict,
  old_status text check (old_status in ('Ожидает отправки', 'В пути', 'Прибыл', 'Отгружен')),
  new_status text not null check (new_status in ('Ожидает отправки', 'В пути', 'Прибыл', 'Отгружен')),
  changed_at timestamptz not null default timezone('utc', now()),
  changed_by uuid references auth.users (id) on delete set null
);

create index if not exists shipment_status_history_shipment_id_idx
  on public.shipment_status_history (shipment_id, changed_at desc);

create or replace function public.create_shipment(
  p_account_id uuid,
  p_store_id uuid,
  p_carrier text,
  p_destination_warehouse text,
  p_box_qty integer,
  p_units_qty integer,
  p_units_total integer,
  p_arrived_box_qty integer,
  p_planned_marketplace_delivery_date date,
  p_arrival_date date,
  p_status text,
  p_payment_status text,
  p_comment text default ''
)
returns public.shipments
language plpgsql
security definer
as $$
declare
  next_tracking_number integer;
  created_shipment public.shipments;
begin
  select coalesce(max(tracking_number), 0) + 1
    into next_tracking_number
  from public.shipments
  where store_id = p_store_id
  for update;

  insert into public.shipments (
    account_id,
    store_id,
    tracking_number,
    carrier,
    destination_warehouse,
    box_qty,
    units_qty,
    units_total,
    arrived_box_qty,
    planned_marketplace_delivery_date,
    arrival_date,
    status,
    payment_status,
    comment
  )
  values (
    p_account_id,
    p_store_id,
    next_tracking_number,
    p_carrier,
    p_destination_warehouse,
    p_box_qty,
    p_units_qty,
    p_units_total,
    p_arrived_box_qty,
    p_planned_marketplace_delivery_date,
    p_arrival_date,
    p_status,
    p_payment_status,
    coalesce(p_comment, '')
  )
  returning * into created_shipment;

  insert into public.shipment_status_history (
    shipment_id,
    old_status,
    new_status,
    changed_by
  )
  values (
    created_shipment.id,
    null,
    created_shipment.status,
    auth.uid()
  );

  return created_shipment;
end;
$$;

create or replace function public.log_shipment_status_change()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    insert into public.shipment_status_history (
      shipment_id,
      old_status,
      new_status,
      changed_by
    )
    values (
      new.id,
      old.status,
      new.status,
      auth.uid()
    );
  end if;

  return new;
end;
$$;

drop trigger if exists stores_set_defaults on public.stores;
create trigger stores_set_defaults
before insert on public.stores
for each row
execute function public.set_store_defaults();

drop trigger if exists shipments_set_updated_at on public.shipments;
create trigger shipments_set_updated_at
before update on public.shipments
for each row
execute function public.set_updated_at();

drop trigger if exists shipments_handle_arrival_date_insert on public.shipments;
create trigger shipments_handle_arrival_date_insert
before insert on public.shipments
for each row
execute function public.handle_arrival_date();

drop trigger if exists shipments_handle_arrival_date_update on public.shipments;
create trigger shipments_handle_arrival_date_update
before update on public.shipments
for each row
execute function public.handle_arrival_date();

drop trigger if exists shipments_log_status_change on public.shipments;
create trigger shipments_log_status_change
after update on public.shipments
for each row
execute function public.log_shipment_status_change();

alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.account_members enable row level security;
alter table public.stores enable row level security;
alter table public.shipments enable row level security;
alter table public.shipment_status_history enable row level security;

create policy "profiles_select_own"
on public.profiles
for select
using (user_id = auth.uid());

create policy "profiles_insert_own"
on public.profiles
for insert
with check (user_id = auth.uid());

create policy "profiles_update_own"
on public.profiles
for update
using (user_id = auth.uid());

create policy "members_can_view_accounts"
on public.accounts
for select
using (
  exists (
    select 1
    from public.account_members am
    where am.account_id = accounts.id
      and am.user_id = auth.uid()
  )
);

create policy "members_can_view_account_members"
on public.account_members
for select
using (
  exists (
    select 1
    from public.account_members am
    where am.account_id = account_members.account_id
      and am.user_id = auth.uid()
  )
);

create policy "members_can_view_stores"
on public.stores
for select
using (
  exists (
    select 1
    from public.account_members am
    where am.account_id = stores.account_id
      and am.user_id = auth.uid()
  )
);

create policy "members_manage_stores"
on public.stores
for all
using (
  exists (
    select 1
    from public.account_members am
    where am.account_id = stores.account_id
      and am.user_id = auth.uid()
      and am.role in ('owner', 'admin', 'manager', 'operator')
  )
)
with check (
  exists (
    select 1
    from public.account_members am
    where am.account_id = stores.account_id
      and am.user_id = auth.uid()
      and am.role in ('owner', 'admin', 'manager', 'operator')
  )
);

create policy "members_can_view_shipments"
on public.shipments
for select
using (
  exists (
    select 1
    from public.account_members am
    where am.account_id = shipments.account_id
      and am.user_id = auth.uid()
  )
);

create policy "members_manage_shipments"
on public.shipments
for all
using (
  exists (
    select 1
    from public.account_members am
    where am.account_id = shipments.account_id
      and am.user_id = auth.uid()
      and am.role in ('owner', 'admin', 'manager', 'operator')
  )
)
with check (
  exists (
    select 1
    from public.account_members am
    where am.account_id = shipments.account_id
      and am.user_id = auth.uid()
      and am.role in ('owner', 'admin', 'manager', 'operator')
  )
);

create policy "members_can_view_status_history"
on public.shipment_status_history
for select
using (
  exists (
    select 1
    from public.shipments s
    join public.account_members am on am.account_id = s.account_id
    where s.id = shipment_status_history.shipment_id
      and am.user_id = auth.uid()
  )
);
