-- ═══════════════════════════════════════════════════════════════
-- patch_marking_log_barcode.sql
-- Добавляет поля barcode и item_id в журнал маркировки
-- barcode — отсканированный ШК при добавлении записи
-- item_id — ссылка на позицию партии (через barcode lookup)
-- ═══════════════════════════════════════════════════════════════

alter table fulfillment_marking_logs
  add column if not exists barcode  text,
  add column if not exists item_id  uuid references fulfillment_items(id) on delete set null;

-- Индекс для быстрого поиска по товару
create index if not exists idx_marking_logs_item_id
  on fulfillment_marking_logs(item_id)
  where item_id is not null;
