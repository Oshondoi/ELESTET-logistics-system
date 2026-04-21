-- =============================================================
-- Патч: исправить двойной префикс в trip_number
-- Причина: patch_trip_number_format.sql применён после patch_draft_number.sql,
-- из-за чего 'A1' → 'AA1', 'A2' → 'AA2' и т.д.
-- Исправляем: убираем лишнюю 'A' спереди у номеров вида AA{digits}
-- =============================================================

UPDATE public.trips
SET trip_number = substring(trip_number FROM 2)
WHERE trip_number ~ '^AA\d+$';

-- Проверка: покажет исправленные номера
SELECT id, trip_number FROM public.trips WHERE trip_number IS NOT NULL ORDER BY created_at;
