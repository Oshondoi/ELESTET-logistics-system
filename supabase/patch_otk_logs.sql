-- ═══════════════════════════════════════════════════════════════
-- patch_otk_logs.sql
-- Журнал работ ОТК: фиксирует кто, сколько, по какому тарифу
-- ═══════════════════════════════════════════════════════════════

create table if not exists fulfillment_otk_logs (
  id                  uuid primary key default gen_random_uuid(),
  batch_id            uuid references fulfillment_batches(id) on delete cascade not null,
  -- Кто создал запись
  user_id             uuid references auth.users(id) not null,
  user_email          text not null,
  -- Кто фактически выполнил работу (исполнитель, может отличаться от создателя)
  performer_user_id   uuid references auth.users(id),
  performer_name      text not null,
  -- Тариф и количества
  tariff              text not null,
  qty                 integer not null check (qty > 0),
  qty_defect          integer not null default 0 check (qty_defect >= 0),
  notes               text,
  created_at          timestamptz default now()
);

alter table fulfillment_otk_logs enable row level security;

-- Просмотр: члены компании, к которой относится партия
create policy "otk_logs_select" on fulfillment_otk_logs
  for select using (
    exists (
      select 1 from fulfillment_batches fb
      join account_members am on am.account_id = fb.account_id
      where fb.id = fulfillment_otk_logs.batch_id
        and am.user_id = auth.uid()
    )
  );

-- Вставка: только сам пользователь (user_id = auth.uid()) + член компании
create policy "otk_logs_insert" on fulfillment_otk_logs
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from fulfillment_batches fb
      join account_members am on am.account_id = fb.account_id
      where fb.id = fulfillment_otk_logs.batch_id
        and am.user_id = auth.uid()
    )
  );

-- Удаление: только свои записи
create policy "otk_logs_delete" on fulfillment_otk_logs
  for delete using (auth.uid() = user_id);

-- Индекс для быстрого поиска по batch_id
create index if not exists idx_otk_logs_batch_id on fulfillment_otk_logs(batch_id);
