-- Заполняет fulfillment_batch_id для поставок логистики,
-- которые были созданы из фулфилмента ДО добавления этой колонки.
-- Связь берётся из таблицы fulfillment_supplies (fulfillment_supplies.trip_line_id → trip_lines.id).

update public.trip_lines tl
set fulfillment_batch_id = s.batch_id
from public.fulfillment_supplies s
where s.trip_line_id = tl.id
  and s.batch_id is not null
  and tl.fulfillment_batch_id is null;
