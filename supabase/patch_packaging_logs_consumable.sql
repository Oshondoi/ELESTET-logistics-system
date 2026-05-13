-- Добавляем поле consumable_id в таблицу логов упаковки
alter table fulfillment_packaging_logs
  add column if not exists consumable_id uuid references consumables(id) on delete set null;
