-- Добавляет поле box_catalog_consumable_id (ссылка на consumable_catalog)
-- в таблицу fulfillment_batches для привязки типа короба к партии (для выставления счёта)
alter table fulfillment_batches
  add column if not exists box_catalog_consumable_id uuid references consumable_catalog(id) on delete set null;
