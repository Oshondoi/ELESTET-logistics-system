-- Добавляем trip_id в fulfillment_batches для прямой привязки партии к рейсу
-- (trip_line_id остаётся для финальной привязки к конкретной строке рейса)

ALTER TABLE public.fulfillment_batches
  ADD COLUMN IF NOT EXISTS trip_id UUID REFERENCES public.trips(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_fulfillment_batches_trip ON public.fulfillment_batches(trip_id);
