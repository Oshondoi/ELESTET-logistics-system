-- ═══════════════════════════════════════════════════════════════
-- patch_marking_logs.sql
-- Журнал работ Маркировки: кто, сколько, по какому тарифу
-- Структура идентична fulfillment_otk_logs
-- ═══════════════════════════════════════════════════════════════

create table if not exists fulfillment_marking_logs (
  id                  uuid primary key default gen_random_uuid(),
  batch_id            uuid references fulfillment_batches(id) on delete cascade not null,
  user_id             uuid references auth.users(id) not null,
  user_email          text not null,
  user_name           text,
  performer_user_id   uuid references auth.users(id),
  performer_name      text not null,
  tariff              text not null,
  qty                 integer not null check (qty > 0),
  qty_defect          integer not null default 0 check (qty_defect >= 0),
  notes               text,
  photo_urls          text[] not null default '{}',
  created_at          timestamptz default now(),
  updated_at          timestamptz,
  deleted_at          timestamptz
);

alter table fulfillment_marking_logs enable row level security;

create policy "marking_logs_select" on fulfillment_marking_logs
  for select using (
    exists (
      select 1 from fulfillment_batches fb
      join account_members am on am.account_id = fb.account_id
      where fb.id = fulfillment_marking_logs.batch_id
        and am.user_id = auth.uid()
    )
  );

create policy "marking_logs_insert" on fulfillment_marking_logs
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from fulfillment_batches fb
      join account_members am on am.account_id = fb.account_id
      where fb.id = fulfillment_marking_logs.batch_id
        and am.user_id = auth.uid()
    )
  );

create policy "marking_logs_update" on fulfillment_marking_logs
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "marking_logs_delete" on fulfillment_marking_logs
  for delete using (auth.uid() = user_id);

create index if not exists idx_marking_logs_batch_id on fulfillment_marking_logs(batch_id);
