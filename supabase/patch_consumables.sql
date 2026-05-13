create table if not exists consumables (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts(id) on delete cascade,
  name        text not null,
  price       numeric not null default 0,
  cost        numeric not null default 0,
  currency    text not null default 'RUB',
  created_at  timestamptz not null default now()
);

create index if not exists consumables_account_id_idx on consumables(account_id);

alter table consumables enable row level security;

drop policy if exists "account members can manage consumables" on consumables;
create policy "account members can manage consumables"
  on consumables for all
  using (
    account_id in (
      select account_id from account_members where user_id = auth.uid()
    )
  );
