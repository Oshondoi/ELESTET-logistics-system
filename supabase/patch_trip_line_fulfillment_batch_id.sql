-- Добавляет поле fulfillment_batch_id в trip_lines
-- Позволяет определить, что поставка создана из модуля Фулфилмент,
-- и заблокировать редактирование её ключевых полей на странице Логистика.

alter table public.trip_lines
  add column if not exists fulfillment_batch_id uuid references public.fulfillment_batches(id) on delete set null;

comment on column public.trip_lines.fulfillment_batch_id is
  'Если поставка создана из модуля Фулфилмент — здесь ID партии. Поля box_qty, units_qty, reception_date и др. управляются фулфилментом и не должны редактироваться вручную.';
