-- Добавляет поле transit_at (дата смены статуса на "В пути") в таблицу trip_lines.

ALTER TABLE public.trip_lines
  ADD COLUMN IF NOT EXISTS transit_at date NULL;
