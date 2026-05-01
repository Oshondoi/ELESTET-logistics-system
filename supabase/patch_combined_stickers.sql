-- Добавляем колонку для стикеров 2в1 (комбинированные стикеры)
ALTER TABLE trip_lines
  ADD COLUMN IF NOT EXISTS combined_sticker_urls text[] DEFAULT '{}';
