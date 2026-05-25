-- Настройки порядка складов назначения (per account)
-- Вместо localStorage — хранится в БД, синхронизируется между устройствами

create table if not exists account_warehouse_settings (
  account_id uuid not null primary key references accounts(id) on delete cascade,
  sort_mode  text    not null default 'alpha',
  order_ids  text[]  not null default '{}'
);

-- RLS
alter table account_warehouse_settings enable row level security;

create policy "account_warehouse_settings: members can select"
  on account_warehouse_settings for select
  using (
    account_id in (
      select account_id from account_members where user_id = auth.uid()
    )
  );

create policy "account_warehouse_settings: members can upsert"
  on account_warehouse_settings for insert
  with check (
    account_id in (
      select account_id from account_members where user_id = auth.uid()
    )
  );

create policy "account_warehouse_settings: members can update"
  on account_warehouse_settings for update
  using (
    account_id in (
      select account_id from account_members where user_id = auth.uid()
    )
  );
