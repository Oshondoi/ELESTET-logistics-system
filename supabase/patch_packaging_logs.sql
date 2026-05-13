-- ──────────────────────────────────────────────────────────────
-- patch_packaging_logs.sql
-- Создаёт таблицу логов работы этапа Упаковки
-- (аналог fulfillment_otk_logs, без barcode/item_id)
-- ──────────────────────────────────────────────────────────────

create table if not exists fulfillment_packaging_logs (
  id                uuid        primary key default gen_random_uuid(),
  batch_id          uuid        not null references fulfillment_batches(id) on delete cascade,
  account_id        uuid        not null references accounts(id) on delete cascade,
  user_id           uuid        not null,
  user_email        text        not null,
  user_name         text,
  performer_user_id uuid,
  performer_name    text        not null default '',
  tariff            text        not null default 'standard',
  qty               integer     not null default 0,
  qty_defect        integer     not null default 0,
  notes             text,
  photo_urls        text[]      not null default '{}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz,
  deleted_at        timestamptz
);

alter table fulfillment_packaging_logs enable row level security;

drop policy if exists "account members can do all on packaging_logs" on fulfillment_packaging_logs;
create policy "account members can do all on packaging_logs"
  on fulfillment_packaging_logs for all
  using (
    account_id in (
      select account_id from account_members where user_id = auth.uid()
    )
  );
