-- ─── Этап Упаковка в партии ──────────────────────────────────────────────────
alter table fulfillment_batches
  add column if not exists stage_packaging boolean not null default false,
  add column if not exists packaging_qty   integer;            -- null = использовать qty_received_sum

alter table fulfillment_settings
  add column if not exists stage_packaging boolean not null default false;

-- ─── Расходники в партии ─────────────────────────────────────────────────────
create table if not exists batch_consumables (
  id             uuid primary key default gen_random_uuid(),
  batch_id       uuid not null references fulfillment_batches(id) on delete cascade,
  consumable_id  uuid not null references consumables(id)         on delete cascade,
  qty            integer not null default 0,
  created_at     timestamptz not null default now(),
  unique(batch_id, consumable_id)
);

create index if not exists batch_consumables_batch_id_idx on batch_consumables(batch_id);

alter table batch_consumables enable row level security;

drop policy if exists "account members can manage batch_consumables" on batch_consumables;
create policy "account members can manage batch_consumables"
  on batch_consumables for all
  using (
    batch_id in (
      select id from fulfillment_batches
      where account_id in (
        select account_id from account_members where user_id = auth.uid()
      )
    )
  );
