-- Добавляет поле catalog_consumable_id (ссылка на consumable_catalog)
-- в таблицу fulfillment_packaging_logs для связи с ZIP-пакетами из справочника расходников
alter table fulfillment_packaging_logs
  add column if not exists catalog_consumable_id uuid references consumable_catalog(id) on delete set null;
