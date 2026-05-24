-- Добавляет тип и размер расходника в tariffs и отдельную базу расходников.
-- Сидит по умолчанию для всех существующих и новых аккаунтов.

alter table consumables
  add column if not exists kind text,
  add column if not exists size text;

create table if not exists consumable_catalog (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  kind text not null,
  size text not null,
  created_at timestamptz not null default now(),
  unique(account_id, kind, size)
);

create index if not exists consumable_catalog_account_id_idx on consumable_catalog(account_id);

alter table consumable_catalog enable row level security;

drop policy if exists "account members can manage consumable catalog" on consumable_catalog;
create policy "account members can manage consumable catalog"
  on consumable_catalog for all
  using (
    account_id in (
      select account_id from account_members where user_id = auth.uid()
    )
  );

create or replace function seed_default_consumable_catalog(p_account_id uuid)
returns void
language plpgsql
as $$
begin
  insert into consumable_catalog (account_id, kind, size)
  select p_account_id, v.kind, v.size
  from (values
    ('Короб', '60x40x40'),
    ('Короб', '60x40x30'),
    ('Короб', '50x40x40'),
    ('Короб', '40x30x30'),
    ('Короб', '40x30x20'),
    ('ZIP-пакет', '40x35'),
    ('ZIP-пакет', '40x30'),
    ('ZIP-пакет', '35x30'),
    ('ZIP-пакет', '30x25'),
    ('ZIP-пакет', '25x20'),
    ('ZIP-пакет', '20x15')
  ) as v(kind, size)
  on conflict (account_id, kind, size) do nothing;
end;
$$;

do $$
declare
  acc record;
begin
  for acc in select id from accounts loop
    perform seed_default_consumable_catalog(acc.id);
  end loop;
end $$;

create or replace function public.trg_seed_default_consumable_catalog()
returns trigger
language plpgsql
as $$
begin
  perform seed_default_consumable_catalog(new.id);
  return new;
end;
$$;

drop trigger if exists seed_default_consumable_catalog_on_account_insert on accounts;
create trigger seed_default_consumable_catalog_on_account_insert
after insert on accounts
for each row
execute function public.trg_seed_default_consumable_catalog();
